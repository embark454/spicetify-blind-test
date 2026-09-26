"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseStart, chooseNextStart } = require("../core.js");
const track = durationMs => ({ durationMs });

test("repeated RNG values still produce separate passages when enough space remains", () => {
  const song = Object.freeze(track(180000));
  const starts = [chooseStart(song, 16, "random", () => 0)];
  for (let i = 0; i < 5; i++) {
    const next = chooseNextStart(song, 16, Object.freeze([...starts]), () => 0);
    assert.ok(starts.every(previous => Math.abs(previous - next) >= 16000));
    assert.ok(Number.isInteger(next) && next >= 0 && next + 16000 + 1000 <= song.durationMs);
    starts.push(next);
  }
  assert.equal(new Set(starts).size, starts.length);
});

test("remaining windows are weighted by their valid start positions", () => {
  // Valid starts: 0..3000 (3001 choices), 5000..9000 (4001 choices).
  const song = track(11000), previous = [4000];
  assert.equal(chooseNextStart(song, 1, previous, () => 0), 0);
  assert.equal(chooseNextStart(song, 1, previous, () => 3000.5 / 7002), 3000);
  assert.equal(chooseNextStart(song, 1, previous, () => 3001.5 / 7002), 5000);
  assert.equal(chooseNextStart(song, 1, previous, () => 0.5), 5500);
  assert.equal(chooseNextStart(song, 1, previous, () => 1), 9000);
});

test("exact touching boundaries remain selectable even when each window has one position", () => {
  const song = track(5000), previous = [1000, 3000];
  assert.equal(chooseNextStart(song, 1, previous, () => 0), 0);
  assert.equal(chooseNextStart(song, 1, previous, () => 1), 2000);
  const fractional = [1000.5, 3000.5];
  assert.equal(chooseNextStart(track(5001), 1, fractional, () => 1), 0);
});

test("exhausted intervals choose the farthest feasible position from prior starts", () => {
  const song = track(16000); // Only 0..5000 fits a 10-second excerpt and margin.
  assert.equal(chooseNextStart(song, 10, [0], () => 0), 5000);
  assert.equal(chooseNextStart(song, 10, [0, 5000], () => 0), 2500);
  assert.equal(chooseNextStart(song, 10, [0, 2500, 5000], () => 0), 1250);
  assert.equal(chooseNextStart(song, 10, [0, 2500, 5000], () => 1), 3750);
  assert.equal(chooseNextStart(song, 10, [5000], () => 0), 0);
});

test("fallback maximizes nearest distance over every feasible integer in small domains", () => {
  for (const previous of [[0], [0, 9], [1, 4, 9], [0, 3.5, 6.7, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
    const closest = start => Math.min(...previous.map(old => Math.abs(start - old)));
    const best = Math.max(...Array.from({ length: 10 }, (_, start) => closest(start)));
    for (const random of [0, 0.5, 1]) {
      const next = chooseNextStart(track(2009), 1, previous, () => random);
      assert.equal(closest(next), best);
    }
  }
});

test("short or invalid tracks return zero without invoking random", () => {
  const unexpectedRandom = () => { throw Error("Random should not be called"); };
  for (const song of [null, undefined, {}, track(0), track(-100), track(NaN), track(Infinity), track("180000"), track(Symbol("bad")), track(500), track(11000)]) {
    assert.equal(chooseNextStart(song, 10, [0], unexpectedRandom), 0);
  }
  assert.equal(chooseNextStart(track(180000), Number.MAX_VALUE, [0], unexpectedRandom), 0);
});

test("boundary RNG values are clamped and invalid RNG output never escapes the track", () => {
  for (const durationMs of [11001, 12000, 30000, 180000, Number.MAX_VALUE]) {
    for (const seconds of [1, 5, 10, 16, 20]) {
      for (const value of [-1, 0, 0.5, 1, 2, NaN, Infinity, -Infinity, Symbol("bad")]) {
        const next = chooseNextStart(track(durationMs), seconds, [0, 2000, 5000], () => value);
        assert.ok(Number.isFinite(next) && Number.isInteger(next) && next >= 0);
        assert.ok(next <= Math.max(0, durationMs - seconds * 1000 - 1000));
      }
    }
  }
  assert.equal(chooseNextStart(track(30000), 1, [], () => { throw Error("Unavailable RNG"); }), 0);
});

test("invalid histories are ignored, histories are not mutated, and invalid lengths default to ten seconds", () => {
  const previous = Object.freeze([25000, 5000, 5000, null, "12000", -1, Infinity, NaN, 180000]);
  const before = [...previous];
  const song = Object.freeze(track(180000));
  const expected = chooseNextStart(song, 10, [25000, 5000], () => 0.5);
  for (const seconds of [undefined, null, 0, -1, NaN, Infinity, {}, Symbol("bad")]) {
    assert.equal(chooseNextStart(song, seconds, previous, () => 0.5), expected);
  }
  assert.deepEqual(previous, before);
  assert.equal(chooseNextStart(song, "10", previous, () => 0.5), expected);
  assert.equal(chooseNextStart(song, 10, null, () => 0), 0);
});

test("the existing intro and initial random passage behavior is unchanged", () => {
  const song = track(180000);
  assert.equal(chooseStart(song, 16, "intro", () => 0.9), 0);
  assert.equal(chooseStart(song, 16, "random", () => 0), 15000);
  assert.equal(chooseStart(song, 16, "random", () => 0.5), 75000);
});
