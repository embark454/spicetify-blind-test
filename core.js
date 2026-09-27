(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BTCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STEPS = Object.freeze([1, 2, 4, 8, 16]);
  var STEP_POINTS = Object.freeze([100, 80, 60, 40, 20]);

  function parsePlaylist(input) {
    var value = typeof input === "string" ? input.trim() : "";
    if (value === "spotify:collection:tracks") return value;
    var uri = /^spotify:(playlist|album):([A-Za-z0-9]{22})$/.exec(value);
    if (uri) return "spotify:" + uri[1] + ":" + uri[2];
    try {
      var url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.port || url.username || url.password) throw new Error();
      if (/^\/(?:intl-[a-z]{2}\/)?collection\/tracks\/?$/.test(url.pathname)) return "spotify:collection:tracks";
      var path = /^\/(?:intl-[a-z]{2}\/)?(playlist|album)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      if (path) return "spotify:" + path[1] + ":" + path[2];
    } catch (_) { /* All invalid inputs receive the same actionable error. */ }
    throw new Error("Paste a valid Spotify playlist or album link, or a Spotify URI.");
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim().replace(/\s+/g, " ");
  }

  function compact(value) { return normalize(value).replace(/ /g, ""); }

  function buildSuggestionIndex(tracks) {
    var title = new Map(), artist = new Map();
    function add(entries, raw) {
      if (typeof raw !== "string") return;
      var value = raw.trim();
      var search = normalize(value);
      if (search && !entries.has(search)) entries.set(search, { value: value, search: search });
    }
    (Array.isArray(tracks) ? tracks : []).forEach(function (track) {
      if (!track || typeof track !== "object") return;
      add(title, track.title);
      if (Array.isArray(track.artists)) track.artists.forEach(function (name) { add(artist, name); });
    });
    var collator = new Intl.Collator("en", { sensitivity: "base" });
    function alphabetical(left, right) {
      var order = collator.compare(left.value, right.value);
      if (order) return order;
      // Keep a stable total order even when the collator considers two labels equal.
      return left.search < right.search ? -1 : left.search > right.search ? 1 : 0;
    }
    return { title: Array.from(title.values()).sort(alphabetical), artist: Array.from(artist.values()).sort(alphabetical) };
  }

  function suggestions(index, field, query, limit) {
    if ((field !== "title" && field !== "artist") || typeof query !== "string" || !Array.isArray(index && index[field])) return [];
    var search = normalize(query);
    if (!search) return [];
    var maximum = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.min(8, Math.floor(limit))) : 8;
    if (!maximum) return [];
    var words = search.split(" ");
    var prefixes = [], others = [];
    var entries = index[field];
    // The index already holds normalized, alphabetized entries. Each keystroke
    // scans it without renormalizing/sorting the catalog or consulting a deck.
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry || typeof entry.value !== "string" || typeof entry.search !== "string" || !entry.search) continue;
      if (!words.every(function (word) { return entry.search.includes(word); })) continue;
      if (entry.search.startsWith(search)) {
        prefixes.push(entry.value);
        if (prefixes.length === maximum) break;
      } else if (others.length < maximum) others.push(entry.value);
    }
    return prefixes.concat(others).slice(0, maximum);
  }

  // Bounded Levenshtein distance. A whole answer is compared, never a substring.
  function closeEnough(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return false;
    var previous = Array.from({ length: right.length + 1 }, function (_, index) { return index; });
    for (var i = 1; i <= left.length; i++) {
      var next = [i];
      var rowMinimum = i;
      for (var j = 1; j <= right.length; j++) {
        next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        rowMinimum = Math.min(rowMinimum, next[j]);
      }
      if (rowMinimum > limit) return false;
      previous = next;
    }
    return previous[right.length] <= limit;
  }

  function matchAnswer(answer, candidates) {
    var guess = compact(answer);
    if (!guess || guess.length > 512) return false;
    var possibilities = Array.isArray(candidates) ? candidates : [candidates];
    return possibilities.some(function (candidate) {
      var expected = compact(candidate);
      if (!expected || expected.length > 512) return false;
      if (guess === expected) return true;
      var length = Math.min(guess.length, expected.length);
      // Short titles and names require an exact match; no one-letter guesses.
      if (length < 6) return false;
      var limit = length >= 24 ? 3 : length >= 12 ? 2 : 1;
      return closeEnough(guess, expected, limit);
    });
  }

  function isEditionSuffix(value) {
    var suffix = normalize(value);
    return /^(?:\d{4} )?remaster(?:ed)?(?: \d{4})?$/.test(suffix)
      || /^live(?: (?:at|from|in|on) .+| version| \d{4})?$/.test(suffix)
      || /^(?:radio|single) (?:edit|version)$/.test(suffix);
  }

  function isCreditSuffix(value) {
    return /^(?:feat(?:uring)?\.?|ft\.?|with)\s+\S.*$/i.test(value.trim());
  }

  function titleVariants(title) {
    var current = typeof title === "string" ? title.trim() : "";
    if (!current) return [];
    var variants = [current];
    for (var count = 0; count < 6; count++) {
      var bracket = /\s*[([]([^()[\]]+)[)\]]\s*$/.exec(current);
      // Scan dash suffixes from right to left so a real subtitle stays intact.
      var dashes = Array.from(current.matchAll(/\s+[-–—]\s+/g)).reverse();
      var dash = dashes.find(function (item) {
        var suffix = current.slice(item.index + item[0].length);
        return isEditionSuffix(suffix) || isCreditSuffix(suffix);
      });
      // Bare "with" is deliberately excluded: it may be part of the song name.
      var credit = /\s+(?:feat(?:uring)?\.?|ft\.?)\s+\S.*$/i.exec(current);
      var match = bracket && (isEditionSuffix(bracket[1]) || isCreditSuffix(bracket[1])) ? bracket : dash || credit;
      if (!match) break;
      var base = current.slice(0, match.index).trim();
      if (!base) break;
      variants.push(base);
      current = base;
    }
    return variants;
  }

  function artistVariants(artists) {
    var names = (Array.isArray(artists) ? artists : []).filter(function (name) { return typeof name === "string" && name.trim(); });
    var variants = names.slice();
    if (names.length > 1) {
      [", ", " & ", " and ", " et ", " / ", " + ", " x "].forEach(function (separator) { variants.push(names.join(separator)); });
      [" & ", " and ", " et "].forEach(function (separator) {
        variants.push(names.slice(0, -1).join(", ") + separator + names[names.length - 1]);
      });
      [" feat. ", " ft. ", " featuring ", " with "].forEach(function (separator) {
        variants.push(names[0] + separator + names.slice(1).join(", "));
        variants.push(names[0] + separator + names.slice(1).join(" & "));
      });
    }
    return Array.from(new Set(variants));
  }

  function matchArtist(answer, artists) {
    var names = Array.isArray(artists) ? artists : [];
    if (matchAnswer(answer, names)) return true;
    var guess = compact(answer);
    // Combined credits must match a complete list, not just a subset or typo.
    return !!guess && guess.length <= 512 && artistVariants(names).some(function (variant) { return compact(variant) === guess; });
  }

  function unitRandom(random) {
    var value = Number(random());
    return Number.isFinite(value) ? Math.min(0.999999999999, Math.max(0, value)) : 0;
  }

  function validTracks(tracks) {
    var seen = new Set();
    return (Array.isArray(tracks) ? tracks : []).filter(function (track) {
      if (!track || typeof track.uri !== "string" || !track.uri.trim() || typeof track.title !== "string" || !track.title.trim()
        || !Array.isArray(track.artists) || !track.artists.some(function (artist) { return typeof artist === "string" && artist.trim(); })
        || !Number.isFinite(track.durationMs) || track.durationMs <= 0 || seen.has(track.uri)) return false;
      seen.add(track.uri);
      return true;
    });
  }

  function shuffle(deck, random) {
    for (var i = deck.length - 1; i > 0; i--) {
      var index = Math.floor(unitRandom(random) * (i + 1));
      var temporary = deck[i]; deck[i] = deck[index]; deck[index] = temporary;
    }
    return deck;
  }

  function roundCount(rounds) {
    var requested = Number(rounds);
    return Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.floor(requested))) : 10;
  }

  function makeDeck(tracks, rounds, random) {
    return shuffle(validTracks(tracks), typeof random === "function" ? random : Math.random).slice(0, roundCount(rounds));
  }

  function makeSmartDeck(tracks, rounds, options) {
    options = options || {};
    var random = typeof options.random === "function" ? options.random : Math.random;
    var recent = new Set(Array.isArray(options.recentUris) ? options.recentUris : []);
    var normalizedArtists = new Map();
    // Normalize each artist once per draw, rather than once per candidate and
    // round. Keep the shuffled order so equal ranks retain the same tie break.
    var remaining = shuffle(validTracks(tracks), random).map(function (track) {
      var artists = track.artists.map(function (artist) {
        if (!normalizedArtists.has(artist)) normalizedArtists.set(artist, normalize(artist));
        return normalizedArtists.get(artist);
      }).filter(Boolean);
      return { track: track, artists: artists, recent: recent.has(track.uri) ? 1 : 0 };
    });
    var artistCounts = new Map();
    var lastArtists = new Set();
    var deck = [];
    var count = Math.min(roundCount(rounds), remaining.length);
    while (deck.length < count) {
      var bestIndex = 0;
      var bestRank = null;
      for (var index = 0; index < remaining.length; index++) {
        var candidate = remaining[index];
        var artists = candidate.artists;
        var repetitions = artists.reduce(function (sum, artist) { return sum + (artistCounts.get(artist) || 0); }, 0);
        var adjacent = artists.some(function (artist) { return lastArtists.has(artist); });
        // Fresh tracks first; then unseen artists; avoid adjacent repeats when tied.
        var rank = [candidate.recent, repetitions, adjacent ? 1 : 0];
        if (bestRank === null || rank[0] < bestRank[0]
          || rank[0] === bestRank[0] && (rank[1] < bestRank[1] || rank[1] === bestRank[1] && rank[2] < bestRank[2])) {
          bestRank = rank;
          bestIndex = index;
        }
        // No later candidate can beat a fresh track with unused artists.
        if (rank[0] === 0 && rank[1] === 0 && rank[2] === 0) break;
      }
      var selected = remaining.splice(bestIndex, 1)[0];
      deck.push(selected.track);
      lastArtists = new Set(selected.artists);
      lastArtists.forEach(function (artist) { artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1); });
    }
    return deck;
  }

  function grade(track, answers) {
    track = track || {};
    answers = answers || {};
    var titleCorrect = matchAnswer(answers.title, titleVariants(track.title));
    var artistCorrect = matchArtist(answers.artist, track.artists);
    return { titleCorrect: titleCorrect, artistCorrect: artistCorrect, points: Number(titleCorrect) + Number(artistCorrect) };
  }

  function createRound() {
    return { step: 0, title: { found: false, points: 0, step: null, manual: false },
      artist: { found: false, points: 0, step: null, manual: false }, revealed: false, attempts: [] };
  }

  function copyRound(round) {
    return Object.assign({}, round, { title: Object.assign({}, round.title), artist: Object.assign({}, round.artist), attempts: round.attempts.slice() });
  }

  function submitRound(track, round, answers, options) {
    round = round || createRound();
    answers = answers || {};
    options = options || {};
    if (round.revealed) return round;
    var supplied = { title: round.title.found ? "" : String(answers.title == null ? "" : answers.title).trim(),
      artist: round.artist.found ? "" : String(answers.artist == null ? "" : answers.artist).trim() };
    if (!supplied.title && !supplied.artist) return round;
    var result = grade(track, supplied);
    var next = copyRound(round);
    var incorrect = false;
    ["title", "artist"].forEach(function (field) {
      if (round[field].found || !supplied[field]) return;
      if (result[field + "Correct"]) {
        next[field] = { found: true, points: options.mode === "training" ? 1 : STEP_POINTS[round.step], step: round.step, manual: false };
      } else incorrect = true;
    });
    next.attempts.push({ step: round.step, title: supplied.title, artist: supplied.artist,
      titleCorrect: result.titleCorrect, artistCorrect: result.artistCorrect });
    if (next.title.found && next.artist.found) next.revealed = true;
    else if (incorrect && options.mode !== "training") {
      if (next.step === STEPS.length - 1) next.revealed = true;
      else next.step++;
    }
    return next;
  }

  function advanceRound(round) {
    if (round.revealed) return round;
    var next = copyRound(round);
    if (next.step === STEPS.length - 1) next.revealed = true;
    else next.step++;
    return next;
  }

  function revealRound(round) {
    if (round.revealed) return round;
    var next = copyRound(round);
    next.revealed = true;
    return next;
  }

  function correctRound(round, field, options) {
    if (!options || options.mode !== "training" || !round.revealed || (field !== "title" && field !== "artist") || round[field].found) return round;
    if (!round.attempts.some(function (attempt) { return typeof attempt[field] === "string" && attempt[field].trim(); })) return round;
    var next = copyRound(round);
    next[field] = { found: true, points: 1, step: round.step, manual: true };
    return next;
  }

  function totalRound(round) { return round.title.points + round.artist.points; }
  function maxPoints(mode) { return mode === "training" ? 2 : 200; }

  function chooseStart(track, durationSeconds, mode, random) {
    var duration = Number(track && track.durationMs);
    if (mode !== "random" || !Number.isFinite(duration) || duration <= 0) return 0;
    var excerpt = Number(durationSeconds);
    if (!Number.isFinite(excerpt) || excerpt <= 0) excerpt = 10;
    var maxStart = Math.max(0, duration - excerpt * 1000 - 1000);
    var minimum = Math.min(15000, maxStart);
    var maximum = Math.min(Math.floor(duration * 0.75), maxStart);
    minimum = Math.min(minimum, maximum);
    return Math.floor(minimum + unitRandom(typeof random === "function" ? random : Math.random) * (maximum - minimum));
  }

  function chooseNextStart(track, durationSeconds, previousStarts, random) {
    var duration = track && track.durationMs;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return 0;
    var seconds = typeof durationSeconds === "number" || typeof durationSeconds === "string" ? Number(durationSeconds) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) seconds = 10;
    var excerptMs = seconds * 1000;
    // Use the same one-second end margin as chooseStart. If the excerpt cannot
    // fit, zero is the only useful fallback; callers may shorten it for playback.
    var maxStart = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - 1, Math.floor(duration - excerptMs - 1000)));
    if (!maxStart) return 0;
    var starts = Array.from(new Set((Array.isArray(previousStarts) ? previousStarts : []).filter(function (start) {
      return typeof start === "number" && Number.isFinite(start) && start >= 0 && start <= maxStart;
    }))).sort(function (left, right) { return left - right; });
    var sample;
    try { sample = unitRandom(typeof random === "function" ? random : Math.random); }
    catch (_) { sample = 0; }
    var windows = [];
    function addWindow(lower, upper) {
      var first = Math.max(0, Math.ceil(lower));
      var last = Math.min(maxStart, Math.floor(upper));
      if (first <= last) windows.push({ first: first, count: last - first + 1 });
    }
    if (!starts.length) addWindow(0, maxStart);
    else {
      addWindow(0, starts[0] - excerptMs);
      for (var i = 1; i < starts.length; i++) addWindow(starts[i - 1] + excerptMs, starts[i] - excerptMs);
      addWindow(starts[starts.length - 1] + excerptMs, maxStart);
    }
    // Weight each remaining window by its number of valid millisecond starts.
    // Touching the boundary of an old excerpt is allowed; overlap is not.
    var count = windows.reduce(function (sum, window) { return sum + window.count; }, 0);
    if (count) {
      var position = Math.floor(sample * count);
      for (var j = 0; j < windows.length; j++) {
        if (position < windows[j].count) return windows[j].first + position;
        position -= windows[j].count;
      }
      return windows[windows.length - 1].first + windows[windows.length - 1].count - 1;
    }
    // When overlap is unavoidable, maximize the distance to the nearest old
    // start. The optimum is an endpoint or an integer beside a gap's midpoint.
    var bestDistance = -1, candidates = [], seen = new Set();
    function consider(start, distance) {
      if (seen.has(start)) return;
      seen.add(start);
      if (distance > bestDistance) { bestDistance = distance; candidates = [start]; }
      else if (distance === bestDistance) candidates.push(start);
    }
    consider(0, starts[0]);
    for (var k = 1; k < starts.length; k++) {
      var left = starts[k - 1], right = starts[k];
      var middle = left + (right - left) / 2;
      [Math.floor(middle), Math.ceil(middle)].forEach(function (start) {
        if (start >= left && start <= right) consider(start, Math.min(start - left, right - start));
      });
    }
    consider(maxStart, maxStart - starts[starts.length - 1]);
    return candidates[Math.floor(sample * candidates.length)];
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  return { parsePlaylist: parsePlaylist, normalize: normalize, matchAnswer: matchAnswer, titleVariants: titleVariants, artistVariants: artistVariants,
    buildSuggestionIndex: buildSuggestionIndex, suggestions: suggestions,
    makeDeck: makeDeck, makeSmartDeck: makeSmartDeck, grade: grade, chooseStart: chooseStart, chooseNextStart: chooseNextStart, escapeHTML: escapeHTML,
    STEPS: STEPS, STEP_POINTS: STEP_POINTS, createRound: createRound, submitRound: submitRound, advanceRound: advanceRound,
    revealRound: revealRound, correctRound: correctRound, totalRound: totalRound, maxPoints: maxPoints };
});
