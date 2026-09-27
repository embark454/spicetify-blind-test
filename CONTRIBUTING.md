# Contributing to Blind Test

Bug reports, playback observations, and focused pull requests are welcome. For a substantial feature, open an issue first to discuss the expected behavior.

## Local development

1. Clone the repository.
2. Use Node.js 22 or newer.
3. Run `npm test`. There are no npm dependencies to install and no build step.
4. To test in Spotify on Windows, follow the installation instructions in [README.md](README.md#install-or-update). Re-run the installer after changing runtime files.

The installer applies Spicetify changes and may restart Spotify. Tests do not require Spotify; checks against a locally installed client are skipped when it is unavailable. GitHub Actions runs the suite on Windows and Linux with Node.js 22 and 24. Linux test coverage does not imply support for the Windows installer on Linux.

## Scope and conventions

- Keep changes focused and preserve saved settings and records unless a migration is explicitly required.
- Write interface text, comments, documentation, issues, and commit messages in English. Preserve original song and artist names and intentional language-matching fixtures.
- Keep the app dependency-free unless an addition has a clear benefit. It runs with Spotify's React and Spicetify APIs.
- Test changes to scoring, matching, state transitions, and playback cancellation with meaningful regression cases.
- For playback changes, report simulated and real-client observations separately. Automated timing tests cannot establish audible precision.
- Never commit `sauvegardes/`, credentials, personal Spicetify configuration, or private playlist data.

## Pull requests

Explain the user-visible problem, the behavior after the change, and the validation performed. Include a cropped screenshot for interface changes when useful. Run `npm test` and `git diff --check` before submitting.

See [RELEASING.md](RELEASING.md) for the publication checklist. Contributions are distributed under the repository's [MIT License](LICENSE).
