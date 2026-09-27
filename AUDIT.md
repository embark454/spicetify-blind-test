# Project audit — 2026-09-27

## Scope

Manual source review of the game UI, rules, matching, suggestions, source loading, playback lifecycle, storage, context-menu launcher, Windows installer, manifest, release packaging instructions, and GitHub workflow. Automated regression tests complement this review. This is not an independent penetration test or a guarantee that all defects have been found.

## Findings fixed

| Finding | Impact | Resolution |
| --- | --- | --- |
| Null source totals became zero through numeric coercion | Medium: albums, playlists, or Liked Songs could silently stop after the first page | Only nonnegative safe integer totals are accepted; missing or invalid totals use unknown-length pagination |
| Malformed nested artist lists were passed to `.map()` | Medium: one malformed row could fail an otherwise playable source | Invalid artist lists are skipped as unplayable metadata |
| Null saved settings interrupted the whole storage read | Medium: valid records and recent tracks appeared lost | Settings are sanitized independently of the remaining payload |
| Record lookups included inherited object properties | Low: invalid API keys could produce phantom records or affect the record map's prototype | Own-property lookup and rejection of reserved keys; normal generated record keys remain unchanged |
| Incomplete install packages were checked only while copying | Medium: earlier files could be replaced before discovering a missing file | All eight runtime files must exist before backup or installation starts |
| Asynchronous seek rejections were unhandled | Medium: native seek failure could emit an unhandled rejection and wait for a timeout | Handle rejection immediately through excerpt cleanup and volume restoration |

The record-key issue is local defensive hardening, not evidence of remote code execution or global prototype pollution. No critical remotely exploitable vulnerability was confirmed in this review.

## Verification

- 122 tests pass locally on Windows, including new cases for each finding and the installed route check.
- Existing tests cover cancellation, late player commands, volume restoration, ads, buffering, seek acknowledgement, score isolation, suggestions, invalid links, and image URL filtering.
- Windows installer failure was exercised in an isolated temporary directory: an incomplete package leaves the old app and configuration untouched.
- For the preceding draw optimization, 150 seeded comparisons preserved the previous order. A single synthetic 50,000-track benchmark measured 2,077 ms before and 25 ms after; this is not a universal performance guarantee.
- Runtime metadata is rendered through React text children. Source URLs require Spotify hosts and canonical identifiers; cover URLs are restricted to Spotify's image CDN without query strings or credentials.
- No personal backups, configuration files, ZIPs, or environment files are tracked in the reviewed checkout. This check does not certify all historical Git objects.
- The app declares no npm dependencies. GitHub Actions uses commit-pinned official actions with read-only repository permissions and no persisted checkout credentials.
- Repository secret scanning and push protection were enabled when inspected. The main branch was not protected; requiring reviewed pull requests remains a suggested repository policy rather than an imposed workflow change.

## Remaining limitations

- Real Spotify playback, audible one-second precision, ads, device switching, and OS notifications were not exercised interactively in this audit. Simulations cannot certify audio hardware behavior.
- Native playback commands cannot be forcibly cancelled by the app. Spotify or another extension can change playback or volume independently. Delayed commands have bounded recovery and may require restarting Spotify.
- Other extensions run in the same Spotify client. Local scores and settings are not a security boundary and cannot support a trusted public leaderboard without a different architecture.
- Missing source totals require the existing short-page heuristic. Concurrent playlist edits are not a transactional snapshot.
- Installer preflight prevents missing-file partial installs; it does not make filesystem writes or `spicetify apply` transactional. Dated backups remain the recovery path for permission, disk, or apply failures.
- Browser accessibility and visual layout were reviewed in source, not revalidated with a screen reader or a new interactive browser pass.

## Prioritized improvements

1. **Playback diagnostics:** an optional local timing panel and a sanitized copyable report (no track IDs, tokens, or personal configuration). This would make real-client failures easier to reproduce.
2. **Installer recovery:** stage the new runtime, verify it, and restore the previous files and configuration if apply fails.
3. **Saved game presets:** named combinations of sources and rules, stored locally, with explicit deletion controls.
4. **Practice by weakness:** prioritize missed titles or artists while keeping assisted practice separate from competitive records.
5. **Local party mode:** team names, manual buzzers, and turn-based scoring on one computer. Online multiplayer needs separate design for synchronization, authentication, and score integrity.
6. **Release automation:** build the allowlisted ZIP from a reviewed tag and verify file hashes automatically before publishing.

These are proposals, not implemented features. Original music metadata and the English-only interface and repository conventions remain unchanged.
