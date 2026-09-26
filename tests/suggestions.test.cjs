"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const catalog = [
  { title: "  Éblouie par la nuit  ", artists: ["Zaz", "Nile Rodgers"] },
  { title: "Nuit d’été", artists: ["Beyoncé"] },
  { title: "Nuit blanche", artists: ["Daft Punk"] },
  { title: "Avant la nuit", artists: ["Pharrell Williams", "DAFT  PUNK"] },
  { title: "éBLOUIE PAR LA NUIT", artists: ["ZAZ"] },
  { title: "ひこうき雲", artists: ["松任谷由実"] },
];

test("index preserves original display and deduplicates accents, case, punctuation and spacing", () => {
  const source = catalog.concat([{ title: "Eblouie  par la nuit", artists: ["Beyonce", "Nile-Rodgers"] }]);
  const before = JSON.stringify(source);
  const index = core.buildSuggestionIndex(source);
  assert.equal(index.title.filter(entry => entry.search === "eblouie par la nuit").length, 1);
  assert.equal(index.title.find(entry => entry.search === "eblouie par la nuit").value, "Éblouie par la nuit");
  assert.deepEqual(index.artist.map(entry => entry.value), ["Beyoncé", "Daft Punk", "Nile Rodgers", "Pharrell Williams", "Zaz", "松任谷由実"]);
  assert.equal(JSON.stringify(source), before);
});

test("matching ignores accents, case and repeated whitespace and prioritizes prefixes", () => {
  const index = core.buildSuggestionIndex(catalog);
  assert.deepEqual(core.suggestions(index, "title", "  NÚIT "), ["Nuit blanche", "Nuit d’été", "Avant la nuit", "Éblouie par la nuit"]);
  assert.deepEqual(core.suggestions(index, "title", "  PAR   LA NUIT "), ["Éblouie par la nuit"]);
  assert.deepEqual(core.suggestions(index, "title", "nuit eblou"), ["Éblouie par la nuit"]);
  assert.deepEqual(core.suggestions(index, "artist", "beyonce"), ["Beyoncé"]);
  assert.deepEqual(core.suggestions(index, "artist", "  DAFT   P "), ["Daft Punk"]);
  assert.deepEqual(core.suggestions(index, "title", "ひこう"), ["ひこうき雲"]);
  assert.deepEqual(core.suggestions(index, "artist", "松任谷"), ["松任谷由実"]);
});

test("English alphabetical ordering is independent of catalog order within each rank", () => {
  const tracks = ["Zèbre nuit", "Écouter nuit", "Eau nuit", "Nuit zinc", "Nuit été", "Nuit alpha"].map(title => ({ title, artists: [] }));
  const expected = ["Nuit alpha", "Nuit été", "Nuit zinc", "Eau nuit", "Écouter nuit", "Zèbre nuit"];
  assert.deepEqual(core.suggestions(core.buildSuggestionIndex(tracks), "title", "nuit"), expected);
  assert.deepEqual(core.suggestions(core.buildSuggestionIndex([...tracks].reverse()), "title", "nuit"), expected);
});

test("suggestions use the whole catalog and never promote a selected track or combine artists", () => {
  const source = [
    { title: "Song Zebra", artists: ["Daft Punk", "Pharrell Williams"], selected: true },
    { title: "Song Alpha", artists: ["Queen"] },
    { title: "Song Delta", artists: ["Adele"], current: true },
  ];
  const index = core.buildSuggestionIndex(source);
  assert.deepEqual(core.suggestions(index, "title", "song"), ["Song Alpha", "Song Delta", "Song Zebra"]);
  assert.deepEqual(core.suggestions(index, "artist", "phar"), ["Pharrell Williams"]);
  assert.deepEqual(core.suggestions(index, "artist", "daft pharrell"), []);
  source[0].title = "Changed after indexing";
  source.splice(1);
  assert.deepEqual(core.suggestions(index, "title", "song"), ["Song Alpha", "Song Delta", "Song Zebra"]);
});

test("blank/nontext queries and invalid fields do not expose a list", () => {
  const index = core.buildSuggestionIndex(catalog);
  for (const query of ["", "  ", "!!!", "🎵", null, undefined, 12, {}, ["nuit"]]) {
    assert.deepEqual(core.suggestions(index, "title", query), []);
  }
  for (const field of ["album", "constructor", "__proto__", null]) assert.deepEqual(core.suggestions(index, field, "nuit"), []);
  for (const invalid of [null, undefined, [], { title: null }, { title: {} }]) assert.deepEqual(core.suggestions(invalid, "title", "nuit"), []);
});

test("index skips malformed metadata and punctuation-only entries safely", () => {
  for (const source of [null, undefined, {}, "catalog"]) assert.deepEqual(core.buildSuggestionIndex(source), { title: [], artist: [] });
  const index = core.buildSuggestionIndex([null, false, 10, "title", {}, { title: 42, artists: "Artist" },
    { title: "!!!", artists: [null, 12, {}, "  ", "--"] }, { title: "Song", artists: ["Artist", null] }]);
  assert.deepEqual(index, { title: [{ value: "Song", search: "song" }], artist: [{ value: "Artist", search: "artist" }] });
  assert.deepEqual(core.suggestions({ title: [null, {}, { search: "song", value: 42 }, { value: "Song", search: "song" }] }, "title", "son"), ["Song"]);
});

test("results have a strict eight-item bound and preserve prefix priority beyond early matches", () => {
  const source = Array.from({ length: 20 }, (_, i) => ({ title: `Before song ${String(i).padStart(2, "0")}`, artists: [] }))
    .concat(Array.from({ length: 20 }, (_, i) => ({ title: `Song ${String(i).padStart(2, "0")}`, artists: [] })));
  const index = core.buildSuggestionIndex(source);
  assert.deepEqual(core.suggestions(index, "title", "song"), Array.from({ length: 8 }, (_, i) => `Song 0${i}`));
  for (const [limit, count] of [[0, 0], [-1, 0], [1, 1], [3.9, 3], [99, 8], [NaN, 8], [Infinity, 8]]) {
    assert.equal(core.suggestions(index, "title", "song", limit).length, count);
  }
});

test("a 50,000-track catalog is preindexed independently of any chosen deck", () => {
  const source = Array.from({ length: 50000 }, (_, i) => ({ title: `Track ${String(i).padStart(5, "0")}`, artists: [`Artist ${i % 100}`] }));
  const index = core.buildSuggestionIndex(source);
  assert.equal(index.title.length, 50000);
  assert.equal(index.artist.length, 100);
  assert.deepEqual(core.suggestions(index, "title", "track 49999"), ["Track 49999"]);
  assert.deepEqual(core.suggestions(index, "title", "track 1234", 3), ["Track 12340", "Track 12341", "Track 12342"]);
  assert.equal(core.suggestions(index, "artist", "artist").length, 8);
});
