const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const route = process.env.APPDATA ? path.join(process.env.APPDATA, 'Spotify/Apps/xpui/spicetify-routes-blind-test.js') : null;
test('Spicetify-generated route exposes the UI and current game modules', { skip: !route || !fs.existsSync(route) }, () => {
  const sandbox = { Spicetify: { React: { createElement: component => ({ component }) } }, URL };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(route, 'utf8'), sandbox);
  const chunk = sandbox.rspackChunk[0];
  assert.equal(chunk[0][0], 'spicetify-routes-blind-test');
  const exports = {};
  const runtime = { r: () => {}, d: (target, props) => Object.entries(props).forEach(([key, get]) => Object.defineProperty(target, key, { get })) };
  chunk[1]['spicetify-routes-blind-test']({}, exports, runtime);
  assert.equal(typeof exports.default, 'function');
  assert.equal(typeof exports.default().component, 'function');
  assert.equal(typeof sandbox.BTCore.grade, 'function');
  assert.equal(typeof sandbox.BTSpotify.create, 'function');
  assert.equal(typeof sandbox.BTStore.create, 'function');
  assert.equal(typeof sandbox.BTCore.submitRound, 'function');
  assert.equal(sandbox.BTCore.parsePlaylist('spotify:collection:tracks'), 'spotify:collection:tracks');
  assert.equal(sandbox.BTCore.parsePlaylist('spotify:album:0000000000000000000001'), 'spotify:album:0000000000000000000001');
  assert.equal(typeof sandbox.BTCore.buildSuggestionIndex, 'function');
  assert.equal(typeof sandbox.BTCore.suggestions, 'function');
  assert.equal(typeof sandbox.BlindTestApp, 'undefined'); // Route-local UI, not a global Spotify collision.
});
