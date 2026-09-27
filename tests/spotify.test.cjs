const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../spotify.js'), 'utf8');
const uri = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
const other = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
const playlist = 'spotify:playlist:CCCCCCCCCCCCCCCCCCCCCC';
const albumUri = 'spotify:album:EEEEEEEEEEEEEEEEEEEEEE';
const track = { uri, title: 'Un morceau', artists: ['Artiste'], durationMs: 180000 };

test('an asynchronous seek rejection restores volume and cleans up the excerpt', async () => {
  const e = setup();
  e.player.seek = () => Promise.reject(new Error('Native seek rejected'));
  const rejected = assert.rejects(e.adapter.playExcerpt(track, { startMs: 30000, durationMs: 1000 }), /did not accept/);
  await flush(); await e.advance(100); await rejected;
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.state.isPaused, true);
  assert.equal(e.timers.size, 0);
  assert.ok([...e.listeners.values()].every(listeners => listeners.size === 0));
});

for (const kind of ['playlist', 'album', 'liked']) {
  test(`${kind} pagination treats null totals as unknown rather than zero`, async () => {
    const e = setup(), offsets = [], size = kind === 'album' ? 100 : 200;
    const page = offset => {
      offsets.push(offset);
      return offset === 0 ? Array.from({ length: size }, (_, i) => ({ ...track, uri: `spotify:track:${String(i).padStart(22, '0')}` })) : [{ ...track, uri: other }];
    };
    if (kind === 'album') e.sp.GraphQL = { Definitions: { queryAlbumTracks: {} }, Request: async (_, { offset }) => ({ data: { albumUnion: { tracksV2: { totalCount: null, items: page(offset).map(track => ({ track })) } } } }) };
    else if (kind === 'liked') e.sp.Platform.LibraryAPI = { getTracks: async ({ offset }) => ({ totalLength: null, items: page(offset) }) };
    else e.sp.Platform.PlaylistAPI.getContents = async (_, { offset }) => ({ total: null, items: page(offset) });
    const result = await e.adapter.loadPlaylist(kind === 'album' ? albumUri : kind === 'liked' ? 'spotify:collection:tracks' : playlist);
    assert.equal(result.tracks.length, size + 1);
    assert.deepEqual(offsets, [0, size]);
  });
}

test('malformed artist metadata is skipped without discarding valid playlist tracks', async () => {
  const e = setup();
  e.sp.Platform.PlaylistAPI.getContents = async () => ({ totalLength: 2, items: [{ ...track, artists: { items: {} } }, { ...track, uri: other }] });
  const result = await e.adapter.loadPlaylist(playlist);
  assert.equal(result.skipped, 1);
  assert.equal(result.tracks[0].uri, other);
});

for (const liked of [false, true]) {
  test(`${liked ? 'Liked Songs' : 'playlist'} rejects an empty page before the declared end`, async () => {
    const e = setup();
    const page = async ({ offset }) => offset === 0
      ? { items: [track], limit: 1, totalLength: 3 }
      : { items: [], limit: 0, totalLength: 3 };
    if (liked) e.sp.Platform.LibraryAPI = { getTracks: page };
    else e.sp.Platform.PlaylistAPI = { getContents: (_, options) => page(options) };
    await assert.rejects(e.adapter.loadPlaylist(liked ? 'spotify:collection:tracks' : playlist), /incomplete/);
  });
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function setup() {
  let now = 0, nextTimer = 1;
  const timers = new Map();
  const listeners = new Map();
  const calls = { pause: 0, play: [], seek: [], volume: [], playedAtVolume: [] };
  const state = { item: { uri: other, type: 'track' }, isPaused: true, isBuffering: false };
  let position = 0;
  let volume = 0.42;
  const audible = [];
  const player = {
    data: state,
    playUri: async requested => { calls.play.push(requested); calls.playedAtVolume.push(volume); state.item.uri = requested; state.isPaused = false; position = 0; },
    pause: () => { calls.pause++; state.isPaused = true; },
    seek: p => { calls.seek.push(p); position = p; },
    isPlaying: () => !state.isPaused,
    getProgress: () => position,
    getDuration: () => track.durationMs,
    getVolume: () => volume,
    getMute: () => volume === 0,
    setVolume: v => { calls.volume.push(v); volume = v; },
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  const setTimer = (fn, ms, repeat) => { const id = nextTimer++; timers.set(id, { fn, ms, at: now + ms, repeat }); return id; };
  const sandbox = { module: { exports: {} }, URL, Date: { now: () => now },
    setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => setTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(source, sandbox);
  const sp = { Player: player, Platform: { PlaylistAPI: {} } };
  const adapter = sandbox.module.exports.create(sp);
  async function advance(ms, move = true) {
    for (let remaining = ms; remaining > 0;) {
      const step = Math.min(25, remaining); remaining -= step; now += step;
      if (move && !state.isPaused && !state.isBuffering && volume > 0) audible.push({ position, durationMs: step });
      if (move && !state.isPaused && !state.isBuffering) position += step;
      for (const [id, timer] of [...timers]) {
        if (!timers.has(id) || timer.at > now) continue;
        if (timer.repeat) timer.at = now + timer.ms; else timers.delete(id);
        timer.fn();
      }
      await flush();
    }
  }
  return { adapter, sp, player, state, calls, timers, listeners, audible, advance,
    setPosition: p => position = p, setVolume: v => { volume = v; },
    schedule: (fn, ms) => setTimer(fn, ms, false), now: () => now };
}

// Match the installed wrapper: its raw state is timestamped and getProgress()
// extrapolates from that timestamp. A delayed event is not at the raw position.
function timestampedPlayer(e) {
  Object.assign(e.state, { timestamp: e.now(), positionAsOfTimestamp: 0 });
  e.player.origin = { _state: e.state };
  e.player.getProgress = () => {
    const state = e.player.origin._state;
    return state.positionAsOfTimestamp + (state.isPaused ? 0 : e.now() - state.timestamp);
  };
  const pause = e.player.pause;
  e.player.pause = () => {
    const position = e.player.getProgress();
    pause();
    Object.assign(e.player.origin._state, { isPaused: true, timestamp: e.now(), positionAsOfTimestamp: position });
  };
  return (positionAsOfTimestamp, timestamp, isBuffering = false) => {
    Object.assign(e.player.origin._state, { positionAsOfTimestamp, timestamp, isBuffering });
    e.setPosition(e.player.getProgress());
  };
}

test('reads all playlist pages, filters local/unavailable tracks and de-duplicates', async () => {
  const e = setup(); const offsets = [];
  e.sp.Platform.PlaylistAPI.getMetadata = async () => ({ name: 'La playlist' });
  e.sp.Platform.PlaylistAPI.getContents = async (_, options) => {
    offsets.push(options.offset);
    const item = { ...track, name: track.title, duration: { milliseconds: track.durationMs } };
    return options.offset === 0
      ? { items: [item, { ...item, isPlayable: false }], totalLength: 4 }
      : { items: [item, { ...item, uri: other }], totalLength: 4 };
  };
  const result = await e.adapter.loadPlaylist(playlist);
  assert.equal(result.name, 'La playlist');
  assert.equal(result.tracks.length, 2);
  assert.equal(result.skipped, 2);
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(e.timers.size, 0);
});

test('loads Liked Songs via the installed LibraryAPI signature and paginates raw row counts', async () => {
  const e = setup(); const offsets = [];
  const third = 'spotify:track:DDDDDDDDDDDDDDDDDDDDDD';
  const nativeTrack = { uri, name: track.title, artists: [{ name: 'Artiste' }],
    duration: { milliseconds: 180000 }, isPlayable: true, type: 'track' };
  const library = {
    async getTracks(options) {
      assert.equal(this, library, 'LibraryAPI method keeps its owner');
      assert.equal(options.limit, 200);
      offsets.push(options.offset);
      return options.offset === 0
        ? { items: [nativeTrack, { ...nativeTrack, uri: other, isPlayable: false }], offset: 0, limit: 3, totalLength: 5 }
        : { items: [{ ...nativeTrack, uri: third }, { ...nativeTrack, uri }], offset: 3, limit: 2, totalLength: 5 };
    },
  };
  e.sp.Platform.LibraryAPI = library;
  e.sp.Platform.PlaylistAPI.getContents = async () => assert.fail('liked tracks must not use PlaylistAPI');
  e.sp.Platform.PlaylistAPI.getMetadata = async () => assert.fail('liked tracks do not have playlist metadata');
  const result = await e.adapter.loadPlaylist('spotify:collection:tracks');
  assert.equal(result.name, 'Liked Songs');
  assert.deepEqual(Array.from(result.tracks, t => t.uri), [uri, third]);
  assert.equal(result.tracks[0].durationMs, 180000);
  assert.equal(result.tracks[0].artists[0], 'Artiste');
  assert.equal(result.skipped, 3, 'one raw filtered row, one unplayable row, and one duplicate');
  assert.deepEqual(offsets, [0, 3]);
  assert.equal(e.timers.size, 0);
});

test('liked-track pagination continues past a page whose rows were all filtered by Spotify', async () => {
  const e = setup(); const offsets = [];
  e.sp.Platform.LibraryAPI = { getTracks: async ({ offset }) => {
    offsets.push(offset);
    return offset === 0
      ? { items: [], limit: 2, totalLength: 3 }
      : { items: [track], limit: 1, totalLength: 3 };
  } };
  const result = await e.adapter.loadPlaylist('https://open.spotify.com/collection/tracks?si=discarded');
  assert.equal(result.name, 'Liked Songs');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(offsets, [0, 2]);
});

test('liked-track API unavailability reports a clear error without a guessed network fallback', async () => {
  const e = setup(); let requests = 0;
  e.sp.CosmosAsync = { get: async () => { requests++; return {}; } };
  await assert.rejects(e.adapter.loadPlaylist('spotify:collection:tracks'), /Liked Songs API is unavailable/);
  assert.equal(requests, 0);
});

test('cancelling liked-track loading does not request later pages', async () => {
  const e = setup(); let release; const offsets = [];
  e.sp.Platform.LibraryAPI = { getTracks: ({ offset }) => {
    offsets.push(offset);
    return new Promise(resolve => { release = resolve; });
  } };
  const loading = e.adapter.loadPlaylist('spotify:collection:tracks');
  const cancelled = assert.rejects(loading, { name: 'AbortError' });
  await flush(); e.adapter.stop();
  release({ items: [track], limit: 1, totalLength: 2 });
  await cancelled;
  assert.deepEqual(offsets, [0]);
  assert.equal(e.timers.size, 0);
});

test('empty liked tracks are reported by name and invalid collection hosts are rejected', async () => {
  const e = setup(); let requests = 0;
  e.sp.Platform.LibraryAPI = { getTracks: async () => { requests++; return { items: [], limit: 0, totalLength: 0 }; } };
  await assert.rejects(e.adapter.loadPlaylist('https://example.com/collection/tracks'), /Spotify link/);
  assert.equal(requests, 0);
  await assert.rejects(e.adapter.loadPlaylist('spotify:collection:tracks'), /Liked Songs have no playable tracks/);
  assert.equal(requests, 1);
});

test('album loading uses verified GraphQL definitions, paginates and normalizes playable tracks', async () => {
  const e = setup(); const requests = [];
  const getAlbum = { name: 'getAlbum' }, queryAlbumTracks = { name: 'queryAlbumTracks' };
  const rawTrack = { __typename: 'Track', uri, name: 'Morceau album', duration: { totalMilliseconds: 180000 },
    artists: { items: [{ profile: { name: 'Artiste album' } }] }, playability: { playable: true } };
  const graph = {
    Definitions: { getAlbum, queryAlbumTracks },
    async Request(definition, variables) {
      assert.equal(this, graph);
      assert.equal(variables.uri, albumUri);
      assert.equal(variables.limit, 100);
      requests.push({ definition, ...variables });
      return { data: { albumUnion: {
        __typename: 'Album', name: 'Un album', playability: { playable: true },
        coverArt: { sources: [{ url: 'https://i.scdn.co/image/ab321' }] },
        tracksV2: { totalCount: 4, items: variables.offset === 0
          ? [{ uid: 'row-1', track: rawTrack }, { uid: 'row-2', track: { ...rawTrack, uri: other, playability: { playable: false } } }]
          : [{ uid: 'row-3', track: rawTrack }, { uid: 'row-4', track: { ...rawTrack, uri: other } }] },
      } } };
    },
  };
  e.sp.GraphQL = graph;
  e.sp.Locale = { getLocale: () => 'fr' };
  e.sp.Platform.PlaylistAPI.getContents = async () => assert.fail('album loading must not use PlaylistAPI');
  const result = await e.adapter.loadPlaylist(albumUri);
  assert.equal(result.name, 'Un album');
  assert.equal(result.tracks.length, 2);
  assert.equal(result.skipped, 2);
  assert.equal(result.tracks[0].title, 'Morceau album');
  assert.equal(result.tracks[0].artists[0], 'Artiste album');
  assert.equal(result.tracks[0].durationMs, 180000);
  assert.equal(result.tracks[0].coverUrl, 'https://i.scdn.co/image/ab321');
  assert.deepEqual(requests.map(r => r.offset), [0, 2]);
  assert.equal(requests[0].definition, getAlbum);
  assert.equal(requests[0].locale, 'fr');
  assert.equal(requests[1].definition, queryAlbumTracks);
  assert.equal(requests[1].locale, undefined);
  assert.deepEqual(e.calls.play, []);
  assert.equal(e.timers.size, 0);
});

test('official album URLs and older tracks response work with the installed queryAlbumTracks fallback', async () => {
  const e = setup(); const definition = { name: 'queryAlbumTracks' };
  e.sp.GraphQL = { Definitions: { queryAlbumTracks: definition }, Request: async (query, variables) => {
    assert.equal(query, definition);
    assert.equal(variables.uri, albumUri);
    assert.equal(variables.locale, undefined);
    return { data: { albumUnion: { tracks: { totalCount: 1, items: [{ track }] } } } };
  } };
  const result = await e.adapter.loadPlaylist('https://open.spotify.com/intl-fr/album/EEEEEEEEEEEEEEEEEEEEEE/?si=discarded');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.name, 'Album');
  await assert.rejects(e.adapter.loadPlaylist('https://example.com/album/EEEEEEEEEEEEEEEEEEEEEE'), /Spotify link/);
});

test('album cancellation prevents later page requests', async () => {
  const e = setup(); const offsets = []; let release;
  e.sp.GraphQL = { Definitions: { queryAlbumTracks: {} }, Request: (_, { offset }) => {
    offsets.push(offset);
    return new Promise(resolve => { release = resolve; });
  } };
  const loading = e.adapter.loadPlaylist(albumUri);
  const cancelled = assert.rejects(loading, { name: 'AbortError' });
  await flush(); e.adapter.stop();
  release({ data: { albumUnion: { tracksV2: { totalCount: 2, items: [{ track }] } } } });
  await cancelled;
  assert.deepEqual(offsets, [0]);
  assert.equal(e.timers.size, 0);
});

test('album errors and unavailable albums are actionable without exposing server payloads', async () => {
  const e = setup();
  e.sp.GraphQL = { Definitions: { getAlbum: {} }, Request: async () => ({ errors: [{ message: 'private server payload' }] }) };
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /^Error: Could not load this album\./);
  e.sp.GraphQL.Request = async () => ({ data: { albumUnion: { __typename: 'NotFound' } } });
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /album is unavailable/);
  e.sp.GraphQL.Request = async () => ({ data: { albumUnion: { playability: { playable: false } } } });
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /album is unavailable/);
  e.sp.GraphQL.Request = async () => ({ data: { albumUnion: {} } });
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /album format/);
});

test('album pagination refuses repeated or prematurely empty pages instead of returning partial contents', async () => {
  const e = setup(); let calls = 0;
  e.sp.GraphQL = { Definitions: { getAlbum: {} }, Request: async () => {
    calls++;
    return { data: { albumUnion: { tracksV2: { totalCount: 3, items: [{ track }] } } } };
  } };
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /next page of this album/);
  assert.equal(calls, 2);
  e.sp.GraphQL.Request = async () => ({ data: { albumUnion: { tracksV2: { totalCount: 3, items: [] } } } });
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /all tracks from this album/);
});

test('missing album definitions fail without attempting an invented API or network endpoint', async () => {
  const e = setup();
  e.sp.Platform.AlbumAPI = { getTracks: () => assert.fail('unverified AlbumAPI must not be called') };
  e.sp.CosmosAsync = { get: () => assert.fail('album request must not build a network endpoint') };
  await assert.rejects(e.adapter.loadPlaylist(albumUri), /Spicetify album API is unavailable/);
});

test('rejects non-Spotify input before issuing a request', async () => {
  const e = setup(); let requests = 0;
  e.sp.Platform.PlaylistAPI.getContents = async () => { requests++; return {}; };
  await assert.rejects(e.adapter.loadPlaylist('https://example.com/playlist/CCCCCCCCCCCCCCCCCCCCCC'), /Spotify link/);
  assert.equal(requests, 0);
});

test('cancelling a playlist load aborts before requesting the next page', async () => {
  const e = setup(); const offsets = []; let release;
  e.sp.Platform.PlaylistAPI.getContents = (_, options) => {
    offsets.push(options.offset);
    return new Promise(resolve => { release = resolve; });
  };
  const loading = e.adapter.loadPlaylist(playlist);
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  await flush();
  e.adapter.stop();
  release({ items: [{ ...track, name: track.title }], totalLength: 3 });
  await rejected;
  assert.deepEqual(offsets, [0]);
  assert.equal(e.timers.size, 0);
});

test('excludes assets too short for the minimum playable excerpt', async () => {
  const e = setup();
  e.sp.Platform.PlaylistAPI.getContents = async () => ({
    items: [{ ...track, durationMs: 1499 }, { ...track, uri: other, durationMs: 1500 }],
    totalLength: 2,
  });
  const result = await e.adapter.loadPlaylist(playlist);
  assert.equal(result.skipped, 1);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].uri, other);
});

test('only exposes optional cover art from an observed Spotify image shape and safe CDN path', async () => {
  const e = setup();
  e.sp.Platform.PlaylistAPI.getContents = async () => ({
    items: [
      { ...track, album: { images: [{ url: 'https://example.com/track/user' }, { url: 'https://i.scdn.co/image/ab123' }] } },
      { ...track, uri: other, images: [{ url: 'https://i.scdn.co/image/ab123?tracking=user' }, { url: 'javascript:alert(1)' }] },
    ], totalLength: 2,
  });
  const result = await e.adapter.loadPlaylist(playlist);
  assert.equal(result.tracks[0].coverUrl, 'https://i.scdn.co/image/ab123');
  assert.equal(result.tracks[1].coverUrl, undefined);
});

test('rejects malformed playlist responses without exposing upstream errors', async () => {
  const e = setup();
  e.sp.Platform.PlaylistAPI.getContents = async () => ({});
  await assert.rejects(e.adapter.loadPlaylist(playlist), /format/);
  e.sp.Platform.PlaylistAPI.getContents = async () => { throw new Error('private upstream payload'); };
  await assert.rejects(e.adapter.loadPlaylist(playlist), /^Error: Could not load/);
});

test('waits for actual seek and progress, pauses at the endpoint and removes listeners', async () => {
  const e = setup(); const progress = []; let complete = false;
  const playback = e.adapter.playExcerpt(track, { startMs: 30000, durationMs: 2000, onProgress: p => progress.push(p.elapsedMs) });
  playback.then(() => { complete = true; });
  await flush();
  assert.deepEqual(e.calls.seek, [30000]);
  await e.advance(1000, false);
  assert.equal(complete, false, 'wall-clock time alone must not finish a frozen player');
  assert.ok(progress.every(n => n === 0));
  await e.advance(2000);
  await playback;
  assert.equal(complete, true);
  assert.equal(e.state.isPaused, true);
  assert.equal(progress.at(-1), 2000);
  assert.equal(e.timers.size, 0);
  assert.ok([...e.listeners.values()].every(s => s.size === 0));
});

test('buffering does not complete the excerpt', async () => {
  const e = setup(); let complete = false;
  const playback = e.adapter.playExcerpt(track, { startMs: 10000, durationMs: 2000 });
  playback.then(() => { complete = true; }); await flush(); await e.advance(200);
  e.state.isBuffering = true; await e.advance(3000);
  assert.equal(complete, false);
  e.state.isBuffering = false; await e.advance(2000);
  await playback;
});

test('stop rejects AbortError and clears active timers without resuming', async () => {
  const e = setup();
  const playback = e.adapter.playExcerpt(track, { startMs: 0, durationMs: 2000 });
  const rejected = assert.rejects(playback, { name: 'AbortError' });
  await flush(); e.adapter.stop(); await rejected;
  assert.equal(e.state.isPaused, true);
  assert.equal(e.timers.size, 0);
  const count = e.calls.play.length;
  e.adapter.dispose(); await e.advance(3000);
  assert.equal(e.calls.play.length, count);
});

test('serializes a delayed cancelled play request before starting a new excerpt', async () => {
  const e = setup(); let release;
  const native = e.player.playUri;
  e.player.playUri = requested => requested === uri ? new Promise(resolve => {
    release = async () => { await native(requested); resolve(); };
  }) : native(requested);
  const first = e.adapter.playExcerpt(track, { startMs: 0, durationMs: 2000 });
  const cancelled = assert.rejects(first, { name: 'AbortError' }); await flush();
  const second = e.adapter.playExcerpt({ ...track, uri: other }, { startMs: 20000, durationMs: 2000 });
  await flush(); assert.deepEqual(e.calls.play, []);
  await release(); await flush();
  await e.advance(25); await cancelled;
  assert.deepEqual(e.calls.play, [uri, other]);
  assert.deepEqual(e.calls.playedAtVolume, [0, 0], 'both native starts must happen muted');
  assert.equal(e.state.isPaused, false, 'old operation must not pause the new excerpt');
  await e.advance(2100); await second;
  assert.equal(e.player.getVolume(), 0.42);
});

test('disposal silences late native completion', async () => {
  const e = setup(); let release;
  e.player.playUri = () => new Promise(resolve => { release = () => { e.state.item.uri = uri; e.state.isPaused = false; resolve(); }; });
  const playback = e.adapter.playExcerpt(track);
  const cancelled = assert.rejects(playback, { name: 'AbortError' });
  await flush(); e.adapter.dispose();
  release(); await flush(); await e.advance(25); await cancelled;
  assert.equal(e.state.isPaused, true);
  assert.equal(e.timers.size, 0);
});

test('unexpected track changes stop and produce a visible error', async () => {
  const e = setup(); const playback = e.adapter.playExcerpt(track);
  const rejected = assert.rejects(playback, /track changed/);
  await flush(); await e.advance(200); e.state.item.uri = other; await e.advance(100);
  await rejected; assert.equal(e.state.isPaused, true);
});

test('a stuck seek fails within a bounded interval', async () => {
  const e = setup(); e.player.seek = () => {};
  const playback = e.adapter.playExcerpt(track, { startMs: 60000 });
  const rejected = assert.rejects(playback, /excerpt start/);
  await flush(); await e.advance(8200); await rejected;
  assert.equal(e.timers.size, 0);
  assert.equal(e.player.getVolume(), 0.42);
});

test('one-second excerpts get a full second from actual unmute position and replay the same seek', async () => {
  const e = setup();
  e.player.seek = requested => { e.calls.seek.push(requested); e.setPosition(requested + 80); };
  for (let attempt = 0; attempt < 2; attempt++) {
    const heardBefore = e.audible.length;
    const playback = e.adapter.playExcerpt(track, { startMs: 45000, durationMs: 1000 });
    await flush(); await e.advance(1100);
    const diagnostic = await playback;
    const heard = e.audible.slice(heardBefore);
    assert.equal(heard.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
    assert.equal(heard[0].position, 45105, 'full duration starts at acknowledged unmute, not requested seek');
    assert.equal(diagnostic.durationMs, 1000);
    assert.equal(diagnostic.elapsedMs, 1000);
    assert.equal(diagnostic.overshootMs, 0);
    assert.equal(diagnostic.startupMs, 25);
    assert.equal(e.player.getVolume(), 0.42);
  }
  assert.deepEqual(e.calls.seek, [45000, 45000]);
  assert.deepEqual(e.calls.playedAtVolume, [0, 0]);
});

test('random seek stays silent through delayed seek acknowledgement, so no intro is heard', async () => {
  const e = setup();
  e.state.positionAsOfTimestamp = 0;
  e.player.seek = requested => {
    e.calls.seek.push(requested);
    e.schedule(() => { e.setPosition(requested); e.state.positionAsOfTimestamp = requested; }, 300);
  };
  const playback = e.adapter.playExcerpt(track, { startMs: 60000, durationMs: 1000 });
  await flush(); await e.advance(250);
  assert.equal(e.audible.length, 0);
  assert.equal(e.player.getVolume(), 0);
  await e.advance(1100);
  const diagnostic = await playback;
  assert.ok(e.audible.every(piece => piece.position >= 60000));
  assert.equal(e.audible.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
  assert.ok(diagnostic.startupMs >= 300);
  assert.equal(e.player.getVolume(), 0.42);
});

test('timestamped seek acknowledgements delivered 300 or 800 ms late still play a full second', async () => {
  for (const delay of [300, 800]) {
    const e = setup(); const publish = timestampedPlayer(e);
    e.player.seek = requested => {
      e.calls.seek.push(requested);
      const appliedAt = e.now();
      e.schedule(() => publish(requested, appliedAt), delay);
    };
    const playback = e.adapter.playExcerpt(track, { startMs: 60000, durationMs: 1000 });
    await flush(); await e.advance(delay);
    assert.equal(e.audible.length, 0, 'the intro stays muted until a seek-specific state arrives');
    await e.advance(1100);
    const diagnostic = await playback;
    assert.equal(diagnostic.elapsedMs, 1000);
    assert.ok(diagnostic.startupMs >= delay);
    assert.equal(e.audible.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
    assert.ok(e.audible.every(piece => piece.position >= 60000));
    assert.equal(e.player.getVolume(), 0.42);
    assert.equal(e.timers.size, 0);
  }
});

test('a fresh raw state already past the target can acknowledge the correct seek trajectory', async () => {
  const e = setup(); const publish = timestampedPlayer(e);
  e.player.seek = requested => {
    e.schedule(() => publish(requested + 500, 500), 800);
  };
  const playback = e.adapter.playExcerpt(track, { startMs: 30000, durationMs: 1000 });
  await flush(); await e.advance(1900);
  const diagnostic = await playback;
  assert.equal(diagnostic.elapsedMs, 1000);
  assert.ok(e.audible.every(piece => piece.position >= 30800));
  assert.equal(e.audible.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
});

test('seek verification uses the same origin snapshot as getProgress when Player.data is stale', async () => {
  const e = setup(); const publish = timestampedPlayer(e);
  const play = e.player.playUri;
  e.player.playUri = async requested => {
    await play(requested);
    e.player.origin._state = { ...e.state };
  };
  e.player.seek = requested => e.schedule(() => publish(requested, 0), 300);
  const playback = e.adapter.playExcerpt(track, { startMs: 45000, durationMs: 1000 });
  await flush(); await e.advance(1500); await playback;
  assert.equal(e.player.data.positionAsOfTimestamp, 0, 'cached event data deliberately lags the origin');
  assert.equal(e.audible.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
  assert.ok(e.audible.every(piece => piece.position >= 45000));
});

test('an ignored nearby seek cannot be acknowledged by natural playback crossing its target', async () => {
  const e = setup(); e.player.seek = () => {};
  const playback = e.adapter.playExcerpt(track, { startMs: 500, durationMs: 1000 });
  const rejected = assert.rejects(playback, /excerpt start/);
  await flush(); await e.advance(8200); await rejected;
  assert.equal(e.audible.length, 0);
  assert.equal(e.player.getVolume(), 0.42);
});

test('an unchanged previous-round snapshot at the target is not a new seek acknowledgement', async () => {
  const e = setup(); const publish = timestampedPlayer(e);
  e.state.item.uri = uri;
  e.state.isPaused = false;
  publish(60000, 0);
  e.player.seek = () => {};
  const playback = e.adapter.playExcerpt(track, { startMs: 60000, durationMs: 1000 });
  const rejected = assert.rejects(playback, /excerpt start/);
  await flush(); await e.advance(8200); await rejected;
  assert.equal(e.audible.length, 0);
  assert.equal(e.player.getVolume(), 0.42);
});

test('an intro already at the requested start can play without a new state at a nonzero clock', async () => {
  const e = setup(); const publish = timestampedPlayer(e);
  await e.advance(100);
  publish(0, 90);
  e.player.seek = () => {};
  const playback = e.adapter.playExcerpt(track, { startMs: 0, durationMs: 1000 });
  await flush(); await e.advance(1100);
  const diagnostic = await playback;
  assert.equal(diagnostic.elapsedMs, 1000);
  assert.equal(e.audible.reduce((sum, piece) => sum + piece.durationMs, 0), 1000);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.state.isPaused, true);
  assert.equal(e.timers.size, 0);
});

test('a changed but older snapshot cannot acknowledge a seek while the actual audio stays at the intro', async () => {
  // Cover both a regressing timestamp and a timestamp newer than the previous
  // snapshot but still older than this seek request.
  for (const [requestAt, oldTimestamp] of [[0, -100], [100, 50]]) {
    const e = setup(); const publish = timestampedPlayer(e);
    await e.advance(requestAt);
    e.player.seek = () => {
      e.schedule(() => {
        publish(60000, oldTimestamp);
        // The stale state describes a previous round. The real output still
        // advances from the intro because the new seek was never applied.
        e.setPosition(300);
      }, 300);
    };
    const playback = e.adapter.playExcerpt(track, { startMs: 60000, durationMs: 1000 });
    const rejected = assert.rejects(playback, /excerpt start/);
    await flush(); await e.advance(8200); await rejected;
    assert.equal(e.audible.length, 0);
    assert.equal(e.player.getVolume(), 0.42);
    assert.equal(e.state.isPaused, true);
    assert.equal(e.timers.size, 0);
  }
});

test('fractional millisecond input is rounded before the fraction-aware Spicetify seek wrapper', async () => {
  const e = setup();
  e.player.seek = value => {
    e.calls.seek.push(value);
    const position = !Number.isInteger(value) && value >= 0 && value <= 1 ? value * track.durationMs : value;
    e.setPosition(position);
  };
  const playback = e.adapter.playExcerpt(track, { startMs: 0.6, durationMs: 1000 });
  await flush(); await e.advance(1100); await playback;
  assert.deepEqual(e.calls.seek, [1]);
  assert.ok(e.audible.every(piece => piece.position < 1500), 'one millisecond must not mean 100% of the track');
});

test('cancelling before a delayed timestamped seek update keeps playback paused and restores volume', async () => {
  const e = setup(); const publish = timestampedPlayer(e);
  e.player.seek = requested => e.schedule(() => publish(requested, 0), 300);
  const playback = e.adapter.playExcerpt(track, { startMs: 30000, durationMs: 1000 });
  const cancelled = assert.rejects(playback, { name: 'AbortError' });
  await flush(); await e.advance(100); e.adapter.stop(); await cancelled;
  await e.advance(400);
  assert.equal(e.audible.length, 0);
  assert.equal(e.state.isPaused, true);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.timers.size, 0);
});

test('seek errors of half a second fail silently instead of consuming a one-second excerpt', async () => {
  const e = setup();
  e.player.seek = requested => e.setPosition(requested + 500);
  const playback = e.adapter.playExcerpt(track, { startMs: 60000, durationMs: 1000 });
  const rejected = assert.rejects(playback, /excerpt start/);
  await flush(); await e.advance(8200); await rejected;
  assert.equal(e.audible.length, 0);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.state.isPaused, true);
});

test('preserves an originally muted player without making it audible', async () => {
  const e = setup(); e.setVolume(0);
  const playback = e.adapter.playExcerpt(track, { startMs: 30000, durationMs: 1000 });
  await flush(); await e.advance(1100);
  const diagnostic = await playback;
  assert.equal(diagnostic.elapsedMs, 1000);
  assert.equal(e.audible.length, 0);
  assert.equal(e.player.getVolume(), 0);
  assert.deepEqual(e.calls.volume, []);
});

test('cancellation during an asynchronous mute restores the exact original volume before settling', async () => {
  const e = setup();
  e.player.setVolume = volume => e.schedule(() => e.setVolume(volume), 100);
  const playback = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const cancelled = assert.rejects(playback, { name: 'AbortError' });
  await flush(); e.adapter.stop();
  await e.advance(300); await cancelled;
  assert.equal(e.player.getVolume(), 0.42);
  assert.deepEqual(e.calls.play, []);
  assert.equal(e.timers.size, 0);
});

test('a mute arriving three seconds after cancel cannot leave Spotify permanently muted', async () => {
  const e = setup();
  e.player.setVolume = volume => {
    if (volume === 0) e.schedule(() => e.setVolume(0), 3000);
    else e.setVolume(volume);
  };
  const playback = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const cancelled = assert.rejects(playback, { name: 'AbortError' });
  await flush(); e.adapter.stop(); await e.advance(3200); await cancelled;
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.calls.play.length, 0);
  assert.equal(e.timers.size, 0);
});

test('a cancelled native request remains muted if it starts before its promise resolves', async () => {
  const e = setup();
  e.player.playUri = () => new Promise(resolve => {
    e.schedule(() => { e.state.item.uri = uri; e.state.isPaused = false; }, 500);
    e.schedule(resolve, 1500);
  });
  const playback = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const cancelled = assert.rejects(playback, { name: 'AbortError' });
  await flush(); e.adapter.stop(); await e.advance(1600); await cancelled;
  assert.equal(e.audible.length, 0);
  assert.equal(e.state.isPaused, true);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.timers.size, 0);
});

test('a hung native command gives explicit recovery guidance and does not repeat silent 15-second waits', async () => {
  const e = setup(); let nativeCalls = 0;
  e.player.playUri = () => { nativeCalls++; return new Promise(() => {}); };
  const playback = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const failed = assert.rejects(playback, /has not been confirmed/);
  await flush(); await e.advance(15200); await failed;
  await assert.rejects(e.adapter.playExcerpt(track, { durationMs: 1000 }), /is stuck/);
  assert.equal(nativeCalls, 1);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.timers.size, 0);
});

test('repeated cancel while awaiting volume restoration cannot corrupt the next volume snapshot', async () => {
  const e = setup();
  e.player.setVolume = volume => e.schedule(() => e.setVolume(volume), 100);
  const first = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const cancelledFirst = assert.rejects(first, { name: 'AbortError' }); await flush();
  const second = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const cancelledSecond = assert.rejects(second, { name: 'AbortError' });
  const third = e.adapter.playExcerpt(track, { startMs: 40000, durationMs: 1000 });
  await flush(); await e.advance(1700);
  await Promise.all([cancelledFirst, cancelledSecond, third]);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.calls.play.length, 1);
  assert.equal(e.timers.size, 0);
});

test('does not issue a play request if muting cannot be confirmed', async () => {
  const e = setup(); e.player.setVolume = () => {};
  const playback = e.adapter.playExcerpt(track, { durationMs: 1000 });
  const rejected = assert.rejects(playback, /has not been confirmed/);
  await flush(); await e.advance(5200); await rejected;
  assert.equal(e.calls.play.length, 0);
  assert.equal(e.player.getVolume(), 0.42);
  assert.equal(e.timers.size, 0);
});

test('reports actual polling overshoot without clamping measured elapsed time', async () => {
  const e = setup(); const progress = [];
  const playback = e.adapter.playExcerpt(track, { durationMs: 1001, onProgress: p => progress.push(p.elapsedMs) });
  await flush(); await e.advance(1100);
  const diagnostic = await playback;
  assert.equal(diagnostic.elapsedMs, 1025);
  assert.equal(diagnostic.overshootMs, 24);
  assert.equal(progress.at(-1), 1025);
  assert.equal(e.state.isPaused, true);
});
