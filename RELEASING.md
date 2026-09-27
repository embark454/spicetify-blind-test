# Publishing a release

Blind Test is a Spicetify **custom app**. Marketplace discovery and a GitHub release are separate: the Marketplace lists the repository using its `spicetify-apps` topic and root manifest; users install or update the app manually.

## Prepare

1. Run `npm test` and check the GitHub Actions results for the intended commit.
2. Update `package.json`, the interface version badge in `app.js`, version comments in `app.js` and `index.js`, and the README download links and archive filename.
3. Add an English changelog entry describing the changes and any migration or validation limitations.
4. Refresh `assets/preview.png` when the interface changes. Use a preview without personal music data.
5. Check that `manifest.json` still has valid preview and README paths. Do not add an extension-style `main` property: this project is a custom app.

## Package

Create a ZIP named `blind-test-vX.Y.Z-windows.zip` with one top-level `blind-test/` directory. Include **only**:

```text
blind-test/
  index.js
  manifest.json
  style.css
  core.js
  spotify.js
  storage.js
  launcher.js
  app.js
  INSTALLER.ps1
  README.md
  LICENSE
  CHANGELOG.md
  AUDIT.md
  CONTRIBUTING.md
  RELEASING.md
  assets/
    preview.png
```

Use an explicit file allowlist, never an archive of the entire working directory. Check archive entries and compare extracted file hashes with the intended source commit. Do not include backups, configuration, credentials, or `.git`.

## Publish and verify

1. Commit the reviewed changes and create the corresponding `vX.Y.Z` tag.
2. Publish a GitHub release for that tag with English notes and the ZIP asset. Keep experimental builds marked as prereleases; do not mark a beta stable just to change a latest-release badge.
3. Verify that the public release and ZIP are accessible without signing in.
4. Extract the ZIP to a fresh folder and check its structure. Test installation and playback on Windows, documenting any real-client checks that remain incomplete.
5. Confirm the README, game badge, and download filename agree on the version.

## An older version appears in Marketplace

Check where the number appears: the listing preview, README, GitHub release, or installed game. Verify the public `main` branch and release first. Marketplace session caching and HTTP caching can retain old content; reopen the listing after restarting Spotify before changing publication metadata.

A new GitHub release does not automatically update an installed custom app. Follow the README update instructions. Preserve users' local settings and records, and never reset all Marketplace data to resolve a stale listing.
