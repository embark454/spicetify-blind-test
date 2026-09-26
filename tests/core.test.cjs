"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const id = "37i9dQZF1DXcBWIGoYBM5M";
const track = (n, extra = {}) => ({ uri: `spotify:track:${n}`, title: `Titre ${n}`, artists: ["Artiste"], durationMs: 180000, ...extra });

test("playlist parser accepts official share links and URI", () => {
  for (const input of [`spotify:playlist:${id}`, ` https://open.spotify.com/playlist/${id}?si=share `, `https://open.spotify.com/intl-fr/playlist/${id}/`]) {
    assert.equal(core.parsePlaylist(input), `spotify:playlist:${id}`);
  }
});

test("playlist parser rejects non-playlists, deceptive hosts and malformed IDs", () => {
  for (const input of [null, "", "hello", `https://open.spotify.com.evil.example/playlist/${id}`, `https://evil.example/playlist/${id}`, `https://open.spotify.com@evil.example/playlist/${id}`, `https://user@open.spotify.com/playlist/${id}`, `https://open.spotify.com:444/playlist/${id}`, `http://open.spotify.com/playlist/${id}`, `https://open.spotify.com/track/${id}`, "spotify:playlist:a", `https://open.spotify.com/playlist/${id}/extra`]) {
    assert.throws(() => core.parsePlaylist(input), /Spotify playlist/);
  }
});

test("normalization accepts accents, case, apostrophes, ligatures and punctuation", () => {
  assert.equal(core.normalize("  CŒUR — D'ÉTÉ!  "), "coeur d ete");
  assert.ok(core.matchAnswer("ACDC", "AC/DC"));
  assert.ok(core.matchAnswer("Beyonce", "Beyoncé"));
  assert.ok(core.matchAnswer("dont stop me now", "Don't Stop Me Now"));
  assert.ok(core.matchAnswer("ひこうき雲", "ひこうき雲"));
});

test("whole-answer typo tolerance accepts modest errors without short or substring false positives", () => {
  assert.ok(core.matchAnswer("Bohemian Rapsody", "Bohemian Rhapsody"));
  assert.ok(core.matchAnswer("Daft Punk", ["Pharrell Williams", "Daft Punk"]));
  assert.ok(core.matchAnswer("U2", "U2"));
  for (const [answer, expected] of [["", ""], ["!!!", ""], ["U", "U2"], ["Queen", "Queens"], ["Adele", "Adèle X"], ["Beatles", "The Beatles"], ["Get", "Get Lucky"], ["Live", "Live and Let Die"], ["wonderwallll", "Wonderwall"], ["x".repeat(600), "x".repeat(600)]]) {
    assert.equal(core.matchAnswer(answer, expected), false, `${answer.slice(0, 20)} should not match ${expected.slice(0, 20)}`);
  }
});

test("title variants strip only terminal, recognized live/remaster metadata", () => {
  assert.deepEqual(core.titleVariants("Heroes - 2017 Remaster"), ["Heroes - 2017 Remaster", "Heroes"]);
  assert.deepEqual(core.titleVariants("Dreams (Live at Wembley) [Remastered 2011]"), ["Dreams (Live at Wembley) [Remastered 2011]", "Dreams (Live at Wembley)", "Dreams"]);
  for (const title of ["Live and Let Die", "Song (Live Forever)", "Song (Part II)", "Song - Another Song", "(Live)", "Song (Taylor's Version)"]) assert.deepEqual(core.titleVariants(title), [title]);
});

test("grading awards one point per whole title or individual credited artist", () => {
  const song = track(1, { title: "Éblouie par la nuit - Remastered 2020", artists: ["Zaz", "Guest"] });
  assert.deepEqual(core.grade(song, { title: "eblouie par la nuit", artist: "guest" }), { titleCorrect: true, artistCorrect: true, points: 2 });
  assert.deepEqual(core.grade(song, { title: "wrong", artist: "Zaz" }), { titleCorrect: false, artistCorrect: true, points: 1 });
  assert.equal(core.grade(song, {}).points, 0);
  assert.equal(core.grade(null, null).points, 0);
});

test("deck skips invalid entries, deduplicates songs and never reorders the input", () => {
  const source = [track(1), track(2), track(1, { title: "Duplicate" }), null, track(3, { durationMs: 0 }), track(4, { artists: [] }), track(5, { title: " " })];
  const before = JSON.stringify(source);
  const deck = core.makeDeck(source, 10, () => 0);
  assert.deepEqual(deck.map(song => song.uri), ["spotify:track:2", "spotify:track:1"]);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(core.makeDeck(null, 10), []);
});

test("round counts remain between 1 and 50, capped by available songs", () => {
  const source = Array.from({ length: 70 }, (_, i) => track(i));
  for (const [rounds, expected] of [[0, 1], [-20, 1], [2.8, 2], ["5", 5], [999, 50], [Infinity, 10], [undefined, 10], ["bad", 10]]) assert.equal(core.makeDeck(source, rounds, () => 0.5).length, expected);
  assert.equal(core.makeDeck([track(1)], 50).length, 1);
  assert.equal(core.makeDeck(source, 3, () => 1).filter(Boolean).length, 3);
});

test("start selection respects intro and fits the requested excerpt before the song ends", () => {
  assert.equal(core.chooseStart(track(1), 10, "intro", () => 0.9), 0);
  assert.equal(core.chooseStart(track(1), 10, "random", () => 0), 15000);
  for (const durationMs of [500, 10000, 13000, 50000, 180000]) {
    for (const durationSeconds of [5, 10, 20, 999]) {
      for (const random of [-1, 0, 0.5, 1, 2, NaN]) {
        const start = core.chooseStart(track(1, { durationMs }), durationSeconds, "random", () => random);
        assert.ok(start >= 0 && start <= Math.max(0, durationMs - durationSeconds * 1000 - 1000));
        assert.ok(Number.isInteger(start));
      }
    }
  }
  assert.equal(core.chooseStart({}, 10, "random"), 0);
});

test("HTML escaping prevents metadata from creating HTML elements or attributes", () => {
  assert.equal(core.escapeHTML(`<script x="'">&</script>`), "&lt;script x=&quot;&#39;&quot;&gt;&amp;&lt;/script&gt;");
  assert.equal(core.escapeHTML(null), "");
});

test('liked songs accepts the exact collection source and official URL only', () => {
  for (const input of ['spotify:collection:tracks', 'https://open.spotify.com/collection/tracks', 'https://open.spotify.com/intl-fr/collection/tracks']) assert.equal(core.parsePlaylist(input), 'spotify:collection:tracks');
  for (const input of ['spotify:collection:albums', 'https://open.spotify.com.evil.test/collection/tracks', 'https://user@open.spotify.com/collection/tracks', 'https://open.spotify.com/collection/tracks/extra']) assert.throws(() => core.parsePlaylist(input));
});

test('album parser accepts only canonical IDs and official album links', () => {
  for (const input of [`spotify:album:${id}`, `https://open.spotify.com/album/${id}?si=share`, `https://open.spotify.com/intl-fr/album/${id}/`]) assert.equal(core.parsePlaylist(input), `spotify:album:${id}`);
  for (const input of ['spotify:album:short', `https://open.spotify.com.evil.test/album/${id}`, `https://user@open.spotify.com/album/${id}`, `https://open.spotify.com/album/${id}/extra`]) assert.throws(() => core.parsePlaylist(input));
});
