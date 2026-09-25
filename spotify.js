(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BTSpotify = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  // Verified against Spicetify 2.45.1 and its installed Spotify PlaylistAPI.
  // stop(), dispose(), and superseding an excerpt reject it with AbortError.
  // Loading and seeking are silenced; exact initial volume (including mute) is
  // restored on completion/cancellation. Repeat/shuffle are never changed.
  // Timing diagnostics describe Spotify's player position, not audio hardware.
  // Cleanup observes late mute commands for up to 5 s and native playback for
  // 15 s. After those limits it requests the original volume and reports a
  // recovery error: the wrapper cannot cancel an indefinitely delayed command.
  const abortError = () => Object.assign(new Error('Lecture annulée.'), { name: 'AbortError' });
  const error = message => new Error(message);
  const trackUri = /^spotify:track:[A-Za-z0-9]{22}$/;

  function playlistUri(input) {
    const value = String(input || '').trim();
    if (value === 'spotify:collection:tracks') return value;
    if (/^spotify:(?:playlist|album):[A-Za-z0-9]{22}$/.test(value)) return value;
    if (/^[A-Za-z0-9]{22}$/.test(value)) return 'spotify:playlist:' + value;
    try {
      const url = new URL(value);
      const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]{22})\/?$/i);
      if (url.protocol === 'https:' && url.hostname === 'open.spotify.com' &&
          !url.port && !url.username && !url.password) {
        if (url.pathname === '/collection/tracks' || url.pathname === '/collection/tracks/') return 'spotify:collection:tracks';
        if (match) return 'spotify:' + match[1].toLowerCase() + ':' + match[2];
      }
    } catch (_) { /* A validation message below is more useful than URL errors. */ }
    throw error('Colle le lien Spotify ou l’URI d’une playlist ou d’un album.');
  }

  function normalizeTrack(item) {
    const t = item && (item.track || item);
    if (!t || !trackUri.test(t.uri || '') || t.isLocal || t.is_local ||
        t.isPlayable === false || t.is_playable === false || t.playability?.playable === false ||
        (t.type && t.type !== 'track')) return null;
    const artists = (Array.isArray(t.artists) ? t.artists : t.artists?.items || [])
      .map(a => typeof a === 'string' ? a : a?.name || a?.profile?.name)
      .filter(a => typeof a === 'string' && a.trim());
    const durationMs = Number(t.duration?.milliseconds ?? t.duration?.totalMilliseconds ?? t.duration_ms ?? t.durationMs);
    const title = t.name || t.title;
    if (!title || !artists.length || !Number.isFinite(durationMs) || durationMs < 1500) return null;
    const normalized = { uri: t.uri, title: String(title), artists, durationMs };
    // Both the installed PlaylistAPI and Web API use images[].url. Accept only
    // Spotify's image CDN path, without credentials, query strings, or trackers.
    const images = [...(Array.isArray(t.album?.images) ? t.album.images : []),
      ...(Array.isArray(t.images) ? t.images : [])];
    for (const image of images) {
      try {
        const url = new URL(image?.url);
        if (url.protocol === 'https:' && url.hostname === 'i.scdn.co' && !url.port &&
            !url.username && !url.password && !url.search && !url.hash && /^\/image\/[a-zA-Z0-9]+$/.test(url.pathname)) {
          normalized.coverUrl = url.href;
          break;
        }
      } catch (_) { /* Artwork is optional; unsupported formats are omitted. */ }
    }
    return normalized;
  }

  function withTimeout(task, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(error(message)), ms); });
    return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer));
  }

  function create(sp = globalThis.Spicetify) {
    const player = sp?.Player;
    let disposed = false;
    let epoch = 0;
    let loadEpoch = 0;
    let active = null;
    let commandTail = Promise.resolve();
    let restorationTail = Promise.resolve();
    let pendingNative = null;

    function pause() {
      try { player?.pause?.(); } catch (_) { /* Player can disappear during navigation. */ }
    }

    function assertAvailable() {
      if (disposed) throw abortError();
      if (!player || typeof player.playUri !== 'function' || typeof player.seek !== 'function' ||
          typeof player.getProgress !== 'function' || typeof player.pause !== 'function' ||
          typeof player.getVolume !== 'function' || typeof player.setVolume !== 'function') {
        throw error('Le lecteur Spicetify n’est pas prêt. Réouvre Blind Test dans Spotify.');
      }
    }

    async function loadAlbum(uri, assertCurrent) {
      const graph = sp?.GraphQL;
      const metadataQuery = graph?.Definitions?.getAlbum;
      const tracksQuery = graph?.Definitions?.queryAlbumTracks;
      if (typeof graph?.Request !== 'function' || (!metadataQuery && !tracksQuery)) {
        throw error('L’API des albums Spicetify est indisponible. Recharge Spotify puis réessaie.');
      }
      const tracks = [];
      const seen = new Set();
      const limit = 100;
      let name = 'Album';
      let coverSources = [];
      let offset = 0;
      let total = null;
      let skipped = 0;
      let previousPage = null;
      while (offset < 10000) {
        assertCurrent();
        // These definitions and response shapes are verified in the installed
        // Spotify modules and Spicetify's bundled shuffle+ extension. They use
        // the client's injected GraphQL API; no endpoint or token is constructed.
        const definition = offset === 0 ? metadataQuery || tracksQuery : tracksQuery || metadataQuery;
        const variables = { uri, offset, limit };
        if (definition === metadataQuery) variables.locale = sp?.Locale?.getLocale?.() || '';
        let response;
        try {
          response = await withTimeout(() => graph.Request(definition, variables), 15000,
            'Spotify met trop de temps à charger cet album. Réessaie.');
        } catch (cause) {
          assertCurrent();
          if (/trop de temps/.test(cause?.message || '')) throw cause;
          throw error('Impossible de charger cet album. Vérifie son accès dans Spotify puis réessaie.');
        }
        assertCurrent();
        if (response?.errors?.length) throw error('Impossible de charger cet album. Vérifie son accès dans Spotify puis réessaie.');
        const album = response?.data?.albumUnion;
        if (!album || (album.__typename && album.__typename !== 'Album') || album.playability?.playable === false) {
          throw error('Cet album est indisponible pour le blind test. Essaie un autre album.');
        }
        const page = album.tracksV2 ?? album.tracks;
        if (!Array.isArray(page?.items)) throw error('Le format de cet album n’est pas reconnu par cette version de test.');
        if (typeof album.name === 'string' && album.name.trim()) name = album.name;
        if (Array.isArray(album.coverArt?.sources)) coverSources = album.coverArt.sources;
        const declaredTotal = Number(page.totalCount);
        if (Number.isFinite(declaredTotal) && declaredTotal >= 0) total = declaredTotal;
        const signature = page.items.map(row => row?.uid || row?.track?.uri || '').join('|');
        if (offset && page.items.length && signature === previousPage) {
          throw error('Spotify n’a pas chargé la suite de cet album. Réessaie.');
        }
        previousPage = signature;
        for (const row of page.items) {
          const decorated = row?.track ? { track: { ...row.track, album: row.track.album || { images: coverSources } } } : row;
          const normalized = normalizeTrack(decorated);
          if (!normalized || seen.has(normalized.uri)) { skipped++; continue; }
          seen.add(normalized.uri);
          tracks.push(normalized);
        }
        offset += page.items.length;
        if (!page.items.length) {
          if (total !== null && offset < total) throw error('Spotify n’a pas chargé tous les morceaux de cet album. Réessaie.');
          break;
        }
        if ((total !== null && offset >= total) || (total === null && page.items.length < limit)) break;
      }
      if (offset >= 10000 && (total === null || offset < total)) {
        throw error('Cette version de test accepte les albums de 10 000 titres maximum.');
      }
      if (!tracks.length) throw error('Cet album ne contient aucun morceau lisible pour le blind test.');
      return { name, tracks, skipped };
    }

    async function loadPlaylist(input) {
      if (disposed) throw abortError();
      const uri = playlistUri(input);
      const isLikedTracks = uri === 'spotify:collection:tracks';
      const id = uri.split(':')[2];
      const ticket = ++loadEpoch;
      const assertCurrent = () => { if (disposed || ticket !== loadEpoch) throw abortError(); };
      if (uri.startsWith('spotify:album:')) return loadAlbum(uri, assertCurrent);
      const internal = isLikedTracks ? sp?.Platform?.LibraryAPI : sp?.Platform?.PlaylistAPI;
      const cosmos = sp?.CosmosAsync;
      const hasInternal = isLikedTracks ? typeof internal?.getTracks === 'function' : typeof internal?.getContents === 'function';
      if (isLikedTracks && !hasInternal) {
        throw error('L’API des Titres likés est indisponible. Recharge Spotify puis réessaie.');
      }
      if (!hasInternal && !cosmos?.get) {
        throw error('L’API des playlists Spicetify est indisponible. Recharge Spotify.');
      }
      const tracks = [];
      const seen = new Set();
      let name = isLikedTracks ? 'Titres likés' : 'Ma playlist';
      let skipped = 0;
      let offset = 0;
      let total = null;
      const limit = 200;
      let previousPage = null;

      // Metadata is optional; do not make a playable playlist depend on its name.
      if (!isLikedTracks && internal?.getMetadata) {
        try {
          const meta = await withTimeout(() => internal.getMetadata(uri), 8000, 'Nom de playlist indisponible.');
          if (typeof meta?.name === 'string' && meta.name) name = meta.name;
        } catch (_) { /* Continue with the generic display name. */ }
        assertCurrent();
      }
      while (offset < 10000) {
        assertCurrent();
        let page;
        try {
          page = await withTimeout(() => isLikedTracks
            ? internal.getTracks({ offset, limit })
            : hasInternal ? internal.getContents(uri, { offset, limit })
            : cosmos.get(`https://api.spotify.com/v1/playlists/${id}/tracks?offset=${offset}&limit=100`),
          15000, isLikedTracks ? 'Spotify met trop de temps à charger les Titres likés. Réessaie.' : 'Spotify met trop de temps à charger cette playlist. Réessaie.');
        } catch (cause) {
          assertCurrent();
          if (/trop de temps/.test(cause?.message || '')) throw cause;
          throw error(isLikedTracks ? 'Impossible de lire les Titres likés. Vérifie leur accès dans Spotify puis réessaie.' : 'Impossible de lire cette playlist. Vérifie son lien et son accès dans Spotify.');
        }
        assertCurrent();
        if (!Array.isArray(page?.items)) throw error(isLikedTracks ? 'Le format des Titres likés n’est pas reconnu par cette version de test.' : 'Le format de cette playlist n’est pas reconnu par cette version de test.');
        const declaredTotal = Number(page.totalLength ?? page.total);
        if (Number.isFinite(declaredTotal) && declaredTotal >= 0) total = declaredTotal;
        const signature = page.items.map(t => t?.uid || t?.track?.uri || t?.uri || '').join('|');
        if (offset && page.items.length && signature === previousPage) {
          throw error(isLikedTracks ? 'Spotify n’a pas chargé la suite des Titres likés. Réessaie.' : 'Spotify n’a pas chargé la suite de la playlist. Essaie une playlist plus courte.');
        }
        previousPage = signature;
        for (const item of page.items) {
          const normalized = normalizeTrack(item);
          if (!normalized || seen.has(normalized.uri)) { skipped++; continue; }
          seen.add(normalized.uri);
          tracks.push(normalized);
        }
        // Installed LibraryAPI.getTracks filters rows without trackMetadata,
        // while its `limit` retains the consumed raw row count. Advancing by
        // items.length would re-read/skip pages around those unavailable rows.
        const rawCount = Number(page.limit);
        const consumed = isLikedTracks && Number.isInteger(rawCount) && rawCount >= page.items.length && rawCount <= limit
          ? rawCount : page.items.length;
        if (isLikedTracks) skipped += consumed - page.items.length;
        offset += consumed;
        if (!consumed || (total !== null && offset >= total)) break;
        if (total === null && consumed < (hasInternal ? limit : 100)) break;
      }
      if (offset >= 10000 && (total === null || offset < total)) {
        throw error(isLikedTracks ? 'Cette version de test accepte jusqu’à 10 000 Titres likés.' : 'Cette version de test accepte les playlists de 10 000 titres maximum.');
      }
      if (!tracks.length) throw error(isLikedTracks ? 'Tes Titres likés ne contiennent aucun morceau lisible pour le blind test.' : 'Cette playlist ne contient aucun morceau lisible pour le blind test.');
      return { name, tracks, skipped };
    }

    function stop() {
      ++epoch;
      ++loadEpoch;
      if (active) active.finish(abortError());
    }

    function playExcerpt(track, { startMs = 0, durationMs = 10000, onProgress } = {}) {
      try {
        assertAvailable();
        if (pendingNative?.expired) {
          throw error('Une commande de lecture Spotify reste bloquée. Redémarre Spotify avant de réessayer.');
        }
        if (!trackUri.test(track?.uri || '') || !Number.isFinite(startMs) || startMs < 0 ||
            !Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 60000) {
          throw error('Cet extrait ne peut pas être lu. Choisis un autre morceau.');
        }
      } catch (cause) { return Promise.reject(cause); }
      stop();
      const ticket = epoch;
      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let phase = 'preparing';
        let seekAt = 0;
        let volumeRequestAt = 0;
        let interval;
        let done = false;
        let originalVolume = null;
        let muteRequestPending = false;
        let muteRequestedAt = 0;
        let lastVolumeRequested = null;
        let lastPosition = null;
        let lastSampleAt = Date.now();
        let lastAdvanceAt = Date.now();
        let elapsedMs = 0;
        let startupMs = 0;
        let actualDuration = Number(track.durationMs);
        const events = ['songchange', 'onplaypause', 'onprogress'];
        const isCurrent = () => !done && !disposed && ticket === epoch;
        const operation = { finish, nativeStarted: false, nativePending: false, nativeStartedAt: 0, expired: false };
        active = operation;

        function volumeMatches(expected) {
          const current = Number(player.getVolume());
          return Number.isFinite(current) && (expected === 0 ? current === 0 : Math.abs(current - expected) < 0.0001);
        }

        // The installed setMute() merely clicks a DOM button. setVolume() and
        // checking getVolume() avoid a silent no-op and restore the exact level.
        function requestVolume(value) {
          if (volumeMatches(value)) return;
          if (value === 0) { muteRequestPending = true; muteRequestedAt = Date.now(); }
          lastVolumeRequested = value;
          const pending = player.setVolume(value);
          if (pending?.catch) pending.catch(() => {
            if (isCurrent()) finish(error('Spotify n’a pas accepté le réglage du son. Réessaie.'));
          });
        }

        function restoreVolume() {
          if (originalVolume === null || (!operation.nativePending && !muteRequestPending && volumeMatches(originalVolume))) return Promise.resolve();
          return new Promise((resolveRestore, rejectRestore) => {
            const restoreAt = Date.now();
            let restoreInterval;
            // A restore request may already be in flight from unmuting. Do not
            // duplicate it: a delayed duplicate could unmute the next excerpt.
            let requested = lastVolumeRequested === originalVolume;
            let restoreRequestAt = requested ? volumeRequestAt : 0;
            let settled = false;
            let recoveryError = null;
            const settle = cause => {
              if (settled) return;
              settled = true;
              clearInterval(restoreInterval);
              if (cause) rejectRestore(cause); else resolveRestore();
            };
            function restoreSample() {
              try {
                // Pause is asynchronous in Spotify. Observe it before restoring
                // sound after a cancelled/failed muted load or seek.
                const now = Date.now();
                const nativeExpired = operation.nativePending && now - operation.nativeStartedAt >= 15000;
                const muteExpired = muteRequestPending && !volumeMatches(0) && now - muteRequestedAt >= 5000;
                if (nativeExpired || muteExpired) {
                  operation.expired = true;
                  recoveryError = error('Une commande Spotify reste sans confirmation. Le volume initial a été redemandé. Redémarre Spotify et vérifie son volume.');
                }
                // A cancelled native request can start playing before its
                // promise resolves. Keep it muted and pause observed playback.
                if (operation.nativePending && player.data?.item?.uri === track.uri && player.isPlaying?.()) pause();
                const mayRestore = (!operation.nativePending || nativeExpired) &&
                  (!muteRequestPending || volumeMatches(0) || muteExpired);
                if (!requested && mayRestore && (!player.isPlaying?.() || now - restoreAt >= 2500)) {
                  requested = true;
                  restoreRequestAt = now;
                  lastVolumeRequested = originalVolume;
                  const pending = player.setVolume(originalVolume);
                  if (pending?.catch) pending.catch(() => settle(error('Le volume initial n’a pas pu être rétabli. Vérifie le volume Spotify.')));
                }
                if (requested && volumeMatches(originalVolume)) settle(recoveryError);
                else if (requested && now - restoreRequestAt > 2500) settle(error('Le volume initial n’a pas pu être rétabli. Vérifie le volume Spotify.'));
              } catch (_) { settle(error('Le volume initial n’a pas pu être rétabli. Vérifie le volume Spotify.')); }
            }
            restoreInterval = setInterval(restoreSample, 25);
            restoreSample();
          });
        }

        function finish(cause, diagnostics) {
          if (done) return;
          done = true;
          clearInterval(interval);
          for (const type of events) player.removeEventListener?.(type, sample);
          if (active === operation) {
            active = null;
            pause();
            // A newer operation waits for this restoration before taking its
            // own volume snapshot. Old callbacks never restore a newer lease.
            if (originalVolume !== null) {
              try { restorationTail = restoreVolume(); }
              catch (_) { restorationTail = Promise.reject(error('Le volume initial n’a pas pu être rétabli. Vérifie le volume Spotify.')); }
            }
          }
          if (diagnostics) report(diagnostics.elapsedMs);
          restorationTail.then(() => {
            if (cause) reject(cause); else resolve(diagnostics);
          }, restoreError => reject(restoreError));
        }

        function report(value) {
          // Keep measured elapsed time, including polling overshoot. The UI may
          // clamp its progress bar, while retaining the actual timing result.
          try { if (typeof onProgress === 'function') onProgress({ elapsedMs: Math.max(0, value), durationMs }); }
          catch (_) { /* UI rendering must not delay the stop or leak playback. */ }
        }

        function beginAudible(now, position) {
          if (Number.isFinite(actualDuration) && position + durationMs > actualDuration - 150) {
            finish(error('L’extrait dépasse la fin du morceau. Relance la manche avec un extrait plus court.'));
            return;
          }
          phase = 'playing';
          lastPosition = position;
          lastSampleAt = now;
          lastAdvanceAt = now;
          startupMs = now - startedAt;
          report(0);
        }

        function queueNativePlay() {
          muteRequestPending = false;
          phase = 'loading';
          // Native play requests cannot be cancelled. Serialization prevents an
          // old request overtaking a newer one. Muting happens before queuing.
          commandTail = commandTail.catch(() => {}).then(async () => {
            if (!isCurrent()) return;
            try {
              operation.nativeStarted = true;
              operation.nativePending = true;
              operation.nativeStartedAt = Date.now();
              pendingNative = operation;
              await player.playUri(track.uri);
              operation.nativePending = false;
              if (pendingNative === operation) pendingNative = null;
              if (!isCurrent()) {
                if ((!active || !active.nativeStarted) && player.data?.item?.uri === track.uri) pause();
                if (operation.expired && !active) {
                  restorationTail = restoreVolume();
                  restorationTail.catch(() => {});
                }
                return;
              }
              phase = 'waiting';
              sample();
            } catch (_) {
              operation.nativePending = false;
              if (pendingNative === operation) pendingNative = null;
              if (isCurrent()) finish(error('Spotify refuse de lire ce morceau. Essaie un autre titre.'));
            }
          });
        }

        function sample() {
          if (!isCurrent()) return;
          try {
            const now = Date.now();
            if (now - startedAt > durationMs + 30000) {
              finish(error('Lecture interrompue : Spotify ne progresse plus. Relance l’extrait.'));
              return;
            }
            if (phase === 'preparing') return;
            if (phase === 'muting') {
              if (volumeMatches(0)) queueNativePlay();
              else if (now - volumeRequestAt > 2000) finish(error('Impossible de couper le son pendant le chargement. Vérifie le volume Spotify puis réessaie.'));
              return;
            }
            const state = player.data;
            const item = state?.item;
            const isAd = item?.type === 'ad' || item?.uri?.startsWith('spotify:ad:') || item?.metadata?.is_advertisement === 'true';
            if (isAd) { finish(error('Une publicité interrompt l’extrait. Attends sa fin puis réessaie.')); return; }
            if (phase === 'loading') {
              if (now - startedAt > 15000) finish(error('Le morceau ne démarre pas. Vérifie le lecteur Spotify puis réessaie.'));
              return;
            }
            if (item?.uri !== track.uri) {
              if (phase === 'waiting') {
                if (now - startedAt > 15000) finish(error('Spotify n’a pas lancé le morceau demandé. Il est peut-être indisponible.'));
                return;
              }
              finish(error('Le morceau a changé pendant l’extrait. Relance la manche.'));
              return;
            }
            if (phase === 'waiting') {
              actualDuration = Number(player.getDuration?.() || track.durationMs);
              if (Number.isFinite(actualDuration) && startMs + durationMs > actualDuration - 150) {
                finish(error('L’extrait dépasse la fin du morceau. Relance la manche avec un extrait plus court.'));
                return;
              }
              phase = 'seeking';
              seekAt = now;
              player.seek(Math.round(startMs));
              return;
            }
            const position = Number(player.getProgress());
            if (!Number.isFinite(position)) return;
            const playing = typeof player.isPlaying === 'function' ? player.isPlaying() : state?.isPaused === false;
            if (phase === 'seeking') {
              if (now - seekAt > 8000) { finish(error('Spotify n’a pas accepté le début de l’extrait. Réessaie.')); return; }
              // getProgress() extrapolates state.timestamp; when available the
              // raw position must also acknowledge the requested seek.
              const rawPosition = Number(state?.positionAsOfTimestamp);
              if (Math.abs(position - startMs) > 150 || !playing || state?.isBuffering ||
                  (Number.isFinite(rawPosition) && Math.abs(rawPosition - startMs) > 150)) return;
              phase = 'unmuting';
              volumeRequestAt = now;
              requestVolume(originalVolume);
              if (isCurrent() && volumeMatches(originalVolume)) beginAudible(now, Number(player.getProgress()));
              return;
            }
            if (phase === 'unmuting') {
              if (volumeMatches(originalVolume) && playing && !state?.isBuffering) beginAudible(now, position);
              else if (now - volumeRequestAt > 2000) finish(error('Spotify n’a pas rétabli le son de l’extrait. Réessaie.'));
              return;
            }
            if (!playing || state?.isBuffering) {
              lastSampleAt = now;
              lastPosition = null;
              if (now - lastAdvanceAt > 10000) finish(error('La lecture est en pause ou en attente. Relance l’extrait.'));
              return;
            }
            if (lastPosition !== null) {
              const advance = position - lastPosition;
              if (advance < -150 || advance > now - lastSampleAt + 200) {
                finish(error('La position de lecture a changé. Relance l’extrait.'));
                return;
              }
              if (advance > 0) { elapsedMs += advance; lastAdvanceAt = now; }
            }
            lastPosition = position;
            lastSampleAt = now;
            if (now - lastAdvanceAt > 10000) { finish(error('Spotify ne joue pas cet extrait. Essaie un autre morceau.')); return; }
            if (elapsedMs >= durationMs) {
              // Pause before rendering progress: UI work must not lengthen an
              // excerpt. Overshoot is measured at the pause request, not output.
              finish(null, { durationMs, elapsedMs, overshootMs: Math.max(0, elapsedMs - durationMs), startupMs });
              return;
            }
            report(elapsedMs);
          } catch (_) { finish(error('Le lecteur Spotify a rencontré une erreur. Réessaie l’extrait.')); }
        }

        for (const type of events) player.addEventListener?.(type, sample);
        interval = setInterval(sample, 25);
        restorationTail.then(() => {
          if (!isCurrent()) return;
          try {
            originalVolume = Number(player.getVolume());
            if (!Number.isFinite(originalVolume) || originalVolume < 0 || originalVolume > 1) {
              originalVolume = null;
              finish(error('Le volume Spotify est indisponible. Sélectionne cet ordinateur comme appareil de lecture.'));
              return;
            }
            phase = 'muting';
            volumeRequestAt = Date.now();
            requestVolume(0);
            sample();
          } catch (_) { finish(error('Impossible de couper le son pendant le chargement. Réessaie.')); }
        }, () => finish(error('Le volume précédent n’a pas pu être rétabli. Vérifie le volume Spotify puis réessaie.')));
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      ++loadEpoch;
      stop();
    }

    return { loadPlaylist, playExcerpt, stop, dispose };
  }

  return { create };
});
