const test = require('node:test');
const assert = require('node:assert/strict');
const { create, recordKey, KEY } = require('../storage.js');
const storage = () => { const data = new Map(); return { getItem: key => data.get(key), setItem: (key,val) => data.set(key,val) }; };
const uri = 'spotify:playlist:0000000000000000000001';
const opts = { playlistUris:[uri], mode:'challenge',passage:'intro',rounds:5,seconds:10 };
const result = {score:520,maxScore:1000,rounds:5,firstTry:2,artists:4,uris:['spotify:track:0000000000000000000001']};

test('null settings do not discard valid records and recent tracks', () => {
  const s = storage(), key = recordKey(opts);
  s.setItem(KEY, JSON.stringify({ settings: null, records: { [key]: result }, recent: result.uris }));
  const store = create(s);
  assert.equal(store.getSettings().rounds, 10);
  assert.equal(store.getRecord(key).score, 520);
  assert.deepEqual(store.getRecentUris(), result.uris);
  assert.doesNotThrow(() => store.saveSettings(null));
});

test('record lookup excludes inherited properties and reserved keys cannot be saved', () => {
  const store = create(storage());
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(store.getRecord(key), null);
    assert.equal(store.saveResult(key, result).saved, false);
  }
  assert.equal(store.saveResult(recordKey(opts), result).isNewRecord, true);
});
test('settings survive a new instance and malformed data stays bounded',()=>{ const s=storage();const a=create(s);a.saveSettings({playlists:uri,mode:'training',rounds:20,passage:'random',seconds:5}); assert.equal(create(s).getSettings().rounds,20);s.setItem(KEY,'invalid');assert.equal(create(s).getSettings().rounds,10); });
test('records isolate rules, actual rounds and training, ignoring playlist order',()=>{assert.notEqual(recordKey(opts),recordKey({...opts,mode:'training'}));assert.notEqual(recordKey(opts),recordKey({...opts,rounds:10}));assert.notEqual(recordKey(opts),recordKey({...opts,passage:'random'})); const second='spotify:playlist:0000000000000000000002';assert.equal(recordKey({...opts,playlistUris:[uri,second]}),recordKey({...opts,playlistUris:[second,uri]})); });
test('records improve only and assisted runs cannot replace automatic records',()=>{const a=create(storage()),key=recordKey(opts);assert.equal(a.saveResult(key,result).isNewRecord,true);assert.equal(a.saveResult(key,{...result,score:300}).isNewRecord,false);assert.equal(a.saveResult(key,{...result,score:900,assisted:true}).isNewRecord,false);assert.equal(a.getRecord(key).score,520);assert.equal(a.saveResult(key,{...result,score:1001}).saved,false);assert.equal(a.getRecentUris().length,1);});
test('storage quota failures do not stop a game',()=>{const a=create({getItem:()=>null,setItem:()=>{throw Error('Quota');}});assert.equal(a.saveResult(recordKey(opts),result).saved,false);assert.equal(a.getRecord(recordKey(opts)).score,520);});
test('failed writes preserve newer session data over an old payload and persist it after recovery',()=>{
  const persisted=storage(),key=recordKey(opts),oldTrack='spotify:track:0000000000000000000002';
  const original=create(persisted);
  original.saveSettings({playlists:uri,rounds:5});
  original.saveResult(key,{...result,score:300,uris:[oldTrack]});
  let quotaFull=true;
  const session=create({getItem:persisted.getItem,setItem:(name,value)=>{if(quotaFull)throw Error('Quota');persisted.setItem(name,value);}});
  assert.equal(session.saveResult(key,result).saved,false);
  assert.equal(session.getRecord(key).score,520);
  assert.deepEqual(session.getRecentUris(),[oldTrack,...result.uris]);
  assert.equal(session.saveSettings({playlists:uri,rounds:20,mode:'training'}),false);
  assert.equal(session.getSettings().rounds,20);
  assert.equal(session.saveResult(key,{...result,score:400}).isNewRecord,false);
  assert.equal(session.getRecord(key).score,520);
  assert.equal(create(persisted).getRecord(key).score,300);
  quotaFull=false;
  assert.equal(session.saveSettings(session.getSettings()),true);
  const reloaded=create(persisted);
  assert.equal(reloaded.getSettings().rounds,20);
  assert.equal(reloaded.getRecord(key).score,520);
  assert.deepEqual(reloaded.getRecentUris(),[oldTrack,...result.uris]);
});
test('records are capped and track history remains deduplicated',()=>{const a=create(storage());for(let i=0;i<70;i++)a.saveResult('key'+i,result);assert.equal(a.getRecord('key0'),null);assert.equal(a.getRecord('key69').score,520);assert.equal(a.getRecentUris().length,1);});

test('liked songs records stay distinct from playlists and mixed selections', () => {
  const liked = {...opts,playlistUris:['spotify:collection:tracks']};
  assert.notEqual(recordKey(liked),recordKey(opts));
  assert.notEqual(recordKey(liked),recordKey({...opts,playlistUris:[]}));
  assert.notEqual(recordKey(opts),recordKey({...opts,playlistUris:[uri,'spotify:collection:tracks']}));
});

test('difficulty settings persist and missing or invalid values use existing hard rules', () => {
  const persisted = storage();
  assert.equal(create(persisted).getSettings().difficulty, 'hard');
  create(persisted).saveSettings({ difficulty: 'easy' });
  assert.equal(create(persisted).getSettings().difficulty, 'easy');
  create(persisted).saveSettings({ difficulty: 'hard' });
  assert.equal(create(persisted).getSettings().difficulty, 'hard');
  for (const difficulty of [undefined, null, 'medium', 'EASY', 1, true]) {
    create(persisted).saveSettings({ difficulty });
    assert.equal(create(persisted).getSettings().difficulty, 'hard');
  }
  persisted.setItem(KEY, JSON.stringify({ settings: { rounds: 5 }, records: {}, recent: [] }));
  assert.equal(create(persisted).getSettings().difficulty, 'hard', 'legacy payloads migrate without changing their rules');
});

test('hard and invalid difficulties retain the exact legacy v2 record key', () => {
  const legacyChallengeKey = '["v2",["spotify:playlist:0000000000000000000001"],"challenge","intro",[1,2,4,8,16],5]';
  const legacyTrainingKey = '["v2",["spotify:playlist:0000000000000000000001"],"training","intro",10,5]';
  for (const difficulty of [undefined, 'hard', null, 'medium', 1]) {
    assert.equal(recordKey({ ...opts, difficulty }), legacyChallengeKey);
    assert.equal(recordKey({ ...opts, mode: 'training', difficulty }), legacyTrainingKey);
  }
  assert.equal(recordKey({ ...opts, difficulty: 'easy' }), legacyChallengeKey.slice(0, -1) + ',"easy"]');
});

test('easy records remain isolated while existing hard records survive reload and updates', () => {
  const persisted = storage();
  const legacyKey = '["v2",["spotify:playlist:0000000000000000000001"],"challenge","intro",[1,2,4,8,16],5]';
  persisted.setItem(KEY, JSON.stringify({ settings: {}, records: { [legacyKey]: { ...result, at: 123 } }, recent: [] }));
  const session = create(persisted);
  const hardKey = recordKey({ ...opts, difficulty: 'hard' });
  const easyKey = recordKey({ ...opts, difficulty: 'easy' });
  assert.equal(session.getRecord(hardKey).score, 520);
  assert.equal(session.getRecord(easyKey), null);
  assert.equal(session.saveResult(easyKey, { ...result, score: 900 }).isNewRecord, true);
  assert.equal(session.getRecord(hardKey).score, 520);
  assert.equal(session.saveResult(hardKey, { ...result, score: 600 }).isNewRecord, true);
  assert.equal(session.getRecord(easyKey).score, 900);
  const reloaded = create(persisted);
  assert.equal(reloaded.getRecord(legacyKey).score, 600);
  assert.equal(reloaded.getRecord(recordKey(opts)).score, 600);
  assert.equal(reloaded.getRecord(easyKey).score, 900);
});

test('album records differ from the playlist with the same ID and survive mixed sources', () => {
  const album = uri.replace(':playlist:', ':album:');
  assert.notEqual(recordKey({...opts,playlistUris:[album]}),recordKey(opts));
  assert.notEqual(recordKey({...opts,playlistUris:[album]}),recordKey({...opts,playlistUris:[]}));
  assert.notEqual(recordKey({...opts,playlistUris:[uri,album]}),recordKey(opts));
});

test('new random-passage rules isolate records while retaining legacy random and intro scores', () => {
  const persisted = storage();
  for (const mode of ['challenge', 'training']) {
    for (const difficulty of ['hard', 'easy']) {
      const rules = { ...opts, passage: 'random', mode, difficulty };
      const legacyParts = ['v2', [uri], mode, 'random', mode === 'training' ? 10 : [1,2,4,8,16], 5];
      if (difficulty === 'easy') legacyParts.push('easy');
      const legacyKey = JSON.stringify(legacyParts);
      const oldResult = mode === 'training' ? { ...result, score: 5, maxScore: 10 } : result;
      const session = create(persisted);
      session.saveResult(legacyKey, oldResult);
      assert.notEqual(recordKey(rules), legacyKey);
      assert.equal(session.getRecord(recordKey(rules)), null);
      session.saveResult(recordKey(rules), { ...oldResult, score: oldResult.score + 1 });
      const reloaded = create(persisted);
      assert.equal(reloaded.getRecord(legacyKey).score, oldResult.score);
      assert.equal(reloaded.getRecord(recordKey(rules)).score, oldResult.score + 1);
    }
  }
  assert.equal(recordKey(opts), '["v2",["spotify:playlist:0000000000000000000001"],"challenge","intro",[1,2,4,8,16],5]');
});
