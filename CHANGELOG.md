# Changelog

## 0.3.4

- Fixed source pagination when Spotify returns null or invalid totals, and skipped malformed artist metadata safely.
- Preserved valid records when saved settings are malformed; hardened record lookups and reserved keys.
- Validated all runtime files before installation to prevent partial updates from incomplete packages.
- Handled asynchronous seek rejection through playback cleanup and volume restoration.
- Added eight regression tests and documented the audit scope, findings, limitations, and proposed improvements in `AUDIT.md`.

## 0.3.3

- Accelerated smart draws for large catalogs by reusing normalized artist names and stopping candidate searches as soon as the best possible rank is found. Fresh-track priority, artist rotation, and shuffled tie order are preserved.
- Reused the full catalog's suggestion index across new draws and missed-track practice. Reloading sources refreshes the index, and Hard mode still skips indexing.
- Rejected prematurely empty playlist and Liked Songs pages instead of silently starting a game from an incomplete selection.
- Added regression coverage for draw ordering, suggestion reuse and refresh, and incomplete source pagination.

## 0.3.2

- Translated all game screens, rules, results, context menus, accessibility labels, and error messages into English.
- Updated suggestion sorting and game language attributes for English while preserving original song and artist names.
- Preserved settings, records, scoring, and playback behavior.

## 0.3.1

- Fixed false seek timeouts when Spotify confirms a random excerpt after playback has already advanced.
- Random Challenge now chooses another passage of the same song at every step, keeping the 1, 2, 4, 8, and 16-second progression and earned points.
- Added another-passage control to Random Practice without changing its selected duration.
- Kept free replays and failed playback retries at the current position, avoiding repeated passages on new hints when possible.
- Separated new random-passage records from the earlier rules while preserving existing scores.

## 0.3.0

- First public Windows beta, with Marketplace metadata and a preview image.
- Easy and Hard difficulty levels, with separate records and existing records preserved.
- Title and artist suggestions in Easy mode, with mouse and keyboard selection.
- Album support through the context menu or a Spotify link.

## 0.2.1

- Fixed context menu initialization during Spicetify startup.
- Added Liked Songs support and an in-game shortcut.

## 0.2.0

- Progressive challenge with 1, 2, 4, 8 and 16-second excerpts.
- Points earned separately for the title and artist.
- Playlist mixing, local records and practice rounds for missed answers.

## 0.1.0

- First solo version with excerpts, answer entry and a session recap.
