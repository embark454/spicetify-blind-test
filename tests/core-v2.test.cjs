"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const song = { uri: "spotify:track:1", title: "Get Lucky", artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"], durationMs: 360000 };
const track = (n, artist = "Same Artist") => ({ uri: `spotify:track:${n}`, title: `Track ${n}`, artists: [artist], durationMs: 180000 });
const challenge = { mode: "challenge" };
const training = { mode: "training" };

function frozen(round) {
  Object.freeze(round.title);
  Object.freeze(round.artist);
  round.attempts.forEach(Object.freeze);
  Object.freeze(round.attempts);
  return Object.freeze(round);
}

test("challenge awards artist at 2 seconds and title at 8 seconds, totaling 120", () => {
  let round = core.advanceRound(frozen(core.createRound()));
  assert.equal(core.STEPS[round.step], 2);
  round = core.submitRound(song, frozen(round), { artist: "Daft Punk" }, challenge);
  assert.equal(round.artist.points, 80);
  assert.equal(round.artist.step, 1);
  assert.equal(round.step, 1);
  assert.equal(round.revealed, false);
  round = core.advanceRound(frozen(round));
  round = core.advanceRound(frozen(round));
  assert.equal(core.STEPS[round.step], 8);
  round = core.submitRound(song, frozen(round), { title: "Get Lucky", artist: "wrong replacement" }, challenge);
  assert.equal(round.title.points, 40);
  assert.equal(round.title.step, 3);
  assert.equal(round.artist.points, 80);
  assert.equal(round.revealed, true);
  assert.equal(core.totalRound(round), 120);
  assert.equal(core.maxPoints("challenge"), 200);
});

test("resolved fields cannot award points again or force a step advance", () => {
  let round = core.submitRound(song, core.createRound(), { artist: "Daft Punk" }, challenge);
  const prior = frozen(round);
  assert.equal(core.submitRound(song, prior, { artist: "Pharrell Williams" }, challenge), prior);
  round = core.submitRound(song, prior, { artist: "Wrong", title: "Not the title" }, challenge);
  assert.equal(round.step, 1);
  assert.equal(round.artist.points, 100);
  assert.equal(round.artist.step, 0);
  assert.equal(round.attempts[1].artist, "");
  assert.equal(prior.step, 0);
  round = core.submitRound(song, round, { title: "Get Lucky" }, challenge);
  assert.equal(core.totalRound(round), 180);
  assert.equal(core.submitRound(song, frozen(round), { title: "Get Lucky" }, challenge), round);
});

test("blanks are a no-op; wrong nonempty unresolved answers advance exactly one step", () => {
  let round = frozen(core.createRound());
  for (const answer of [{}, { title: "  ", artist: null }, null]) assert.equal(core.submitRound(song, round, answer, challenge), round);
  round = core.submitRound(song, round, { title: "wrong", artist: "wrong" }, challenge);
  assert.equal(round.step, 1);
  assert.equal(round.attempts.length, 1);
  assert.deepEqual(round.attempts[0], { step: 0, title: "wrong", artist: "wrong", titleCorrect: false, artistCorrect: false });
  round = core.submitRound(song, round, { title: "wrong", artist: "Daft Punk" }, challenge);
  assert.equal(round.step, 2);
  assert.equal(round.artist.points, 80);
  assert.equal(round.artist.step, 1);
});

test("final partial answer stays open when other field blank, final wrong answer reveals", () => {
  let round = core.createRound();
  for (let i = 0; i < 4; i++) round = core.advanceRound(frozen(round));
  round = core.submitRound(song, frozen(round), { artist: "Daft Punk" }, challenge);
  assert.equal(round.step, 4);
  assert.equal(round.revealed, false);
  assert.equal(round.artist.points, 20);
  round = core.submitRound(song, frozen(round), { title: "Wrong" }, challenge);
  assert.equal(round.revealed, true);
  assert.equal(core.totalRound(round), 20);
  assert.equal(core.advanceRound(frozen(round)), round);
  assert.equal(core.revealRound(round), round);
});

test("explicit advance at the last excerpt reveals and manual reveal preserves earned points", () => {
  let round = core.submitRound(song, core.createRound(), { artist: "Daft Punk" }, challenge);
  const revealed = core.revealRound(frozen(round));
  assert.equal(revealed.revealed, true);
  assert.equal(core.totalRound(revealed), 100);
  assert.equal(round.revealed, false);
  for (let i = 0; i < 5; i++) round = core.advanceRound(frozen(round));
  assert.equal(round.step, 4);
  assert.equal(round.revealed, true);
  assert.equal(core.totalRound(round), 100);
});

test("training allows retries without tier progression and awards one point per field", () => {
  let round = core.submitRound(song, core.createRound(), { artist: "incorrect" }, training);
  for (let i = 0; i < 6; i++) round = core.submitRound(song, frozen(round), { title: "incorrect" }, training);
  assert.equal(round.step, 0);
  assert.equal(round.revealed, false);
  round = core.submitRound(song, frozen(round), { title: "Get Lucky" }, training);
  assert.equal(core.totalRound(round), 1);
  assert.equal(round.revealed, false);
  round = core.submitRound(song, frozen(round), { artist: "Daft Punk" }, training);
  assert.equal(core.totalRound(round), 2);
  assert.equal(round.revealed, true);
  assert.equal(core.maxPoints("training"), 2);
});

test("manual correction requires training, revelation and a prior nonblank answer", () => {
  const untouched = frozen(core.createRound());
  assert.equal(core.correctRound(untouched, "artist", training), untouched);
  let round = core.submitRound(song, untouched, { title: "Lucky", artist: " " }, training);
  assert.equal(core.correctRound(frozen(round), "title", training), round);
  round = frozen(core.revealRound(round));
  for (const field of ["artist", "bad", "__proto__"]) assert.equal(core.correctRound(round, field, training), round);
  assert.equal(core.correctRound(round, "title", challenge), round);
  assert.equal(core.correctRound(round, "title"), round);
  const corrected = core.correctRound(round, "title", training);
  assert.equal(corrected.title.found, true);
  assert.equal(corrected.title.manual, true);
  assert.equal(core.totalRound(corrected), 1);
  assert.equal(core.totalRound(round), 0);
  assert.equal(core.correctRound(frozen(corrected), "title", training), corrected);
});

test("matching strips explicit credit and edition suffixes without deleting subtitles", () => {
  for (const title of ["Song (feat. Guest)", "Song [with Guest]", "Song - ft. M", "Song featuring Guest", "Song - Radio Edit", "Song (Single Version)", "Song (feat. Guest) - Remastered 2020"]) {
    assert.ok(core.titleVariants(title).includes("Song"), title);
  }
  assert.ok(core.titleVariants("Song - Real Subtitle - 2020 Remaster").includes("Song - Real Subtitle"));
  for (const title of ["Song - Real Subtitle", "Song With You", "Song (Live Forever)", "Song (Part II)", "Song (Taylor's Version)"]) {
    assert.deepEqual(core.titleVariants(title), [title]);
  }
});

test("artist answers accept individuals and full credited lists with bounded matching", () => {
  for (const artist of ["Daft Punk", "Pharrell Williams", "Daft Punk, Pharrell Williams, Nile Rodgers", "Daft Punk, Pharrell Williams & Nile Rodgers", "Daft Punk feat. Pharrell Williams & Nile Rodgers"]) {
    assert.equal(core.grade(song, { artist }).artistCorrect, true, artist);
  }
  for (const artist of ["Daft", "Daft Punk & Pharrell Williams", "Daft Punk & Pharrell Williams & Nile Roggers"]) {
    assert.equal(core.grade(song, { artist }).artistCorrect, false, artist);
  }
  assert.equal(core.grade({ title: "Song", artists: ["M"] }, { artist: "N" }).artistCorrect, false);
});

test("smart deck prioritizes fresh tracks, rotates artists and still fills a small pool", () => {
  const source = [track(1, "A"), track(2, "A"), track(3, "A"), track(4, "B"), track(5, "C"), track(6, "D"), track(1, "Duplicate")];
  const before = JSON.stringify(source);
  const deck = core.makeSmartDeck(source, 6, { recentUris: ["spotify:track:6"], random: () => 0.999 });
  assert.deepEqual(deck.slice(0, 3).map(item => item.artists[0]), ["A", "B", "C"]);
  assert.equal(deck[5].uri, "spotify:track:6");
  assert.equal(new Set(deck.map(item => item.uri)).size, 6);
  assert.equal(JSON.stringify(source), before);
  assert.equal(core.makeSmartDeck([track(1), track(2)], 50).length, 2);
  assert.equal(core.makeSmartDeck([track(1), track(2)], 50, { recentUris: ["spotify:track:1", "spotify:track:2"] }).length, 2);
  assert.deepEqual(core.makeSmartDeck(null, 3), []);
});

test("smart deck samples beyond the first 50 source songs and respects requested limits", () => {
  const source = Array.from({ length: 70 }, (_, i) => track(i, `Artist ${i}`));
  const recentUris = source.slice(0, 65).map(item => item.uri);
  const deck = core.makeSmartDeck(source, 3, { recentUris, random: () => 0.999 });
  assert.deepEqual(deck.map(item => item.uri), ["spotify:track:65", "spotify:track:66", "spotify:track:67"]);
  assert.equal(core.makeSmartDeck(source, 100).length, 50);
});
