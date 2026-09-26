(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BTStore = api;
})(globalThis, function() {
  'use strict';
  const KEY = 'blind-test:data:v2';
  const uriPattern = /^spotify:(?:(?:playlist|album):[A-Za-z0-9]{22}|collection:tracks)$/;
  const trackPattern = /^spotify:track:[A-Za-z0-9]{22}$/;
  const defaults = { playlists: '', rounds: 10, mode: 'challenge', passage: 'intro', seconds: 10, difficulty: 'hard' };
  function settings(value = {}) {
    return { playlists: typeof value.playlists === 'string' ? value.playlists.slice(0, 4000) : '',
      rounds: [5,10,15,20].includes(value.rounds) ? value.rounds : 10,
      mode: value.mode === 'training' ? 'training' : 'challenge', passage: value.passage === 'random' ? 'random' : 'intro',
      seconds: [5,10,15,20].includes(value.seconds) ? value.seconds : 10,
      difficulty: value.difficulty === 'easy' ? 'easy' : 'hard' };
  }
  function recordKey({ playlistUris = [], mode, passage, seconds, rounds, difficulty }) {
    const uris = [...new Set(playlistUris.filter(uri => uriPattern.test(uri)))].sort();
    const parts = ['v2', uris, mode === 'training' ? 'training' : 'challenge', passage === 'random' ? 'random' : 'intro', mode === 'training' ? Number(seconds) : [1,2,4,8,16], Number(rounds)];
    // Existing v2 records used hard rules. Preserve the original intro keys;
    // easy mode adds its own discriminator so the difficulties stay separate.
    if (difficulty === 'easy') parts.push('easy');
    // New random passages provide different hints than the original fixed-start
    // random mode. Retain old scores without comparing incompatible rules.
    if (passage === 'random') parts.push('random-passages-v1');
    return JSON.stringify(parts);
  }
  function validRecord(value) {
    return value && Number.isInteger(value.score) && value.score >= 0 && Number.isInteger(value.rounds) && value.rounds > 0 && value.rounds <= 50 &&
      Number.isInteger(value.maxScore) && [value.rounds * 2, value.rounds * 200].includes(value.maxScore) && value.score <= value.maxScore &&
      Number.isInteger(value.firstTry) && value.firstTry >= 0 && value.firstTry <= value.rounds &&
      Number.isInteger(value.artists) && value.artists >= 0 && value.artists <= value.rounds;
  }
  function create(storage) {
    if (!storage) { try { storage = globalThis.localStorage; } catch (_) { /* Private mode may deny storage. */ } }
    let memory = { settings: { ...defaults }, records: {}, recent: [] };
    let dirty = false;
    function read() {
      // A failed write leaves this session newer than the persisted payload.
      if (dirty) return memory;
      try {
        const raw = storage?.getItem(KEY);
        if (raw) {
          const data = JSON.parse(raw);
          memory = { settings: settings(data?.settings), records: Object.fromEntries(Object.entries(data?.records || {}).filter(([key, val]) => key.length < 2000 && validRecord(val)).slice(-50)),
            recent: Array.isArray(data?.recent) ? [...new Set(data.recent.filter(uri => trackPattern.test(uri)))].slice(-100) : [] };
        }
      } catch (_) { /* Retain the safe in-memory state. */ }
      return memory;
    }
    function write(data) {
      memory = data;
      dirty = true;
      try {
        if (!storage) return false;
        storage.setItem(KEY, JSON.stringify(data));
        dirty = false;
        return true;
      } catch (_) { return false; }
    }
    return {
      getSettings: () => ({ ...read().settings }),
      saveSettings: value => write({ ...read(), settings: settings(value) }),
      getRecentUris: () => [...read().recent], recordKey,
      getRecord: key => { const value = read().records[key]; return value ? { ...value } : null; },
      saveResult: (key, result) => {
        const data = read();
        const previous = data.records[key] || null;
        if (!validRecord(result)) return { previous, best: previous, isNewRecord: false, saved: false };
        const recent = [...data.recent];
        for (const uri of result.uris || []) if (trackPattern.test(uri)) { const i = recent.indexOf(uri); if (i >= 0) recent.splice(i, 1); recent.push(uri); }
        const isNewRecord = !result.assisted && (!previous || result.score > previous.score);
        const records = { ...data.records };
        if (isNewRecord) records[key] = { score: result.score, maxScore: result.maxScore, rounds: result.rounds, firstTry: result.firstTry, artists: result.artists, at: Date.now() };
        const boundedRecords = Object.fromEntries(Object.entries(records).sort((a,b) => (a[1].at || 0) - (b[1].at || 0)).slice(-50));
        const saved = write({ ...data, records: boundedRecords, recent: recent.slice(-100) });
        return { previous, best: records[key] || null, isNewRecord, saved };
      }
    };
  }
  return { create, recordKey, KEY };
});
