const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Render the real app with a minimal hook host and a controllable audio adapter.
// This exercises event handlers and state transitions without a browser dependency.
function setup(rules = {}) {
  const hooks = [], pendingEffects = [], data = new Map(), calls = [];
  let cursor = 0, tree, failNext = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { deps, value: factory() };
      return hooks[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) {
        const previous = hooks[i];
        hooks[i] = { deps };
        pendingEffects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = effect(); });
      }
    }
  };
  const track = { uri: 'spotify:track:0000000000000000000001', title: 'Get Lucky', artists: ['Daft Punk'], durationMs: 248000 };
  const adapter = {
    loadPlaylist: async () => ({ name: 'Test album', tracks: [track] }),
    playExcerpt: async (playedTrack, options) => {
      calls.push({ uri: playedTrack.uri, startMs: options.startMs, durationMs: options.durationMs });
      if (failNext) { failNext = false; throw new Error('Playback test failure'); }
      options.onProgress({ elapsedMs: options.durationMs, durationMs: options.durationMs });
    },
    stop() {}, dispose() {}
  };
  const sandbox = {
    Spicetify: { React }, BTPreviewAdapter: adapter, URL,
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
    addEventListener() {}, removeEventListener() {}
  };
  vm.createContext(sandbox);
  for (const file of ['core.js', 'storage.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox);
  sandbox.BTStore.create().saveSettings({ playlists: 'spotify:album:0000000000000000000001', mode: 'challenge', passage: 'random', rounds: 5, ...rules });
  const text = element => typeof element === 'string' || typeof element === 'number' ? String(element) : (element?.children || []).map(text).join('');
  const all = (element = tree) => element && typeof element === 'object' ? [element, ...element.children.flatMap(child => all(child))] : [];
  const find = predicate => {
    const found = all().find(predicate);
    assert.ok(found, 'Expected app control was not rendered');
    return found;
  };
  function render() { cursor = 0; tree = sandbox.BlindTestApp(); pendingEffects.splice(0).forEach(run => run()); return tree; }
  const button = label => find(node => node.type === 'button' && (typeof label === 'string' ? text(node) === label : label.test(text(node))));
  async function click(label) { const node = button(label); assert.ok(!node.props.disabled); await node.props.onClick(); render(); }
  async function start() { render(); await find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); }
  function answer(field, value) { find(node => node.props.fieldName === field).props.onChange(value); render(); }
  function submit() {
    assert.equal(button('Valider ma réponse').props.disabled, false);
    find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render();
  }
  return { calls, start, click, button, answer, submit, text: () => text(tree), failNext: () => { failNext = true; } };
}

test('random challenge moves to new passages on hints and wrong answers, retaining earned points', async () => {
  const app = setup(); await app.start();
  await app.click('▶ Écouter 1 s');
  app.answer('artist', 'Daft Punk'); app.submit();
  assert.match(app.text(), /100 points acquis/);
  await app.click('↻ Réécouter 1 s');
  assert.deepEqual(app.calls[1], app.calls[0], 'free replay must retain the same position');
  await app.click('Autre passage : 2 secondes →');
  app.answer('title', 'wrong answer');
  assert.equal(app.button('Valider ma réponse').props.disabled, true, 'a previous listen cannot unlock the new passage');
  await app.click('▶ Écouter 2 s');
  assert.notEqual(app.calls[2].startMs, app.calls[0].startMs);
  app.submit();
  await app.click('▶ Écouter 4 s');
  assert.notEqual(app.calls[3].startMs, app.calls[2].startMs);
  await app.click('Autre passage : 8 secondes →'); await app.click('▶ Écouter 8 s');
  await app.click('Autre passage : 16 secondes →'); await app.click('▶ Écouter 16 s');
  assert.deepEqual(app.calls.map(call => call.durationMs), [1000,1000,2000,4000,8000,16000]);
  assert.equal(new Set(app.calls.map(call => call.uri)).size, 1, 'all hints must stay on the same song');
  const starts = app.calls.filter((_, i) => i !== 1).map(call => call.startMs);
  for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) assert.ok(Math.abs(starts[i] - starts[j]) >= 16000);
  app.answer('title', 'Get Lucky'); app.submit();
  assert.match(app.text(), /120 points acquis/);
});

test('intro challenge extends the same position and preserves free replay', async () => {
  const app = setup({ passage: 'intro' }); await app.start();
  await app.click('▶ Écouter 1 s');
  await app.click('Un peu plus : 2 secondes →'); await app.click('▶ Écouter 2 s');
  await app.click('↻ Réécouter 2 s');
  assert.deepEqual(app.calls.map(call => [call.startMs, call.durationMs]), [[0,1000],[0,2000],[0,2000]]);
});

test('random practice changes only the passage and requires a new listen before submission', async () => {
  const app = setup({ mode: 'training', seconds: 10 }); await app.start();
  await app.click('▶ Écouter 10 s');
  app.answer('artist', 'Daft Punk'); app.submit();
  app.answer('title', 'Get Lucky');
  await app.click('Autre passage au hasard →');
  assert.equal(app.button('Valider ma réponse').props.disabled, true);
  assert.match(app.text(), /1 point acquis/);
  await app.click('▶ Écouter 10 s');
  assert.notEqual(app.calls[1].startMs, app.calls[0].startMs);
  await app.click('↻ Réécouter 10 s');
  assert.deepEqual(app.calls[2], app.calls[1]);
  app.submit();
  assert.match(app.text(), /2 points acquis/);
});

test('retrying a failed random excerpt does not reroll it or unlock unanswered hints', async () => {
  const app = setup(); await app.start();
  app.failNext(); await app.click('▶ Écouter 1 s');
  app.answer('title', 'Get Lucky');
  assert.equal(app.button('Valider ma réponse').props.disabled, true);
  await app.click('▶ Écouter 1 s');
  assert.deepEqual(app.calls[1], app.calls[0]);
  assert.equal(app.button('Valider ma réponse').props.disabled, false);
});
