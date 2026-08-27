# Lyric Sync — Mobile Waveform LRC Editor

Everything stays on your device: pick an audio file, paste (or import) lyrics,
stamp each line as it plays, and export a clean `.lrc`.

One codebase, three ways to use it:

| Target | What you get | How it's produced |
| --- | --- | --- |
| **PWA** (web) | Installable, offline app (Android Chrome / iOS) | GitHub Pages, auto-deployed on every push to `main` (and tags) |
| **Single HTML** | One self-contained file to share around | `npm run build:single` → `dist/lyric-sync.html` (also attached to every release) |
| **Android APK** | Native shell with file + share access | Push a `v*` tag → signed APK in the GitHub release |

## Repository layout

- `index.html`, `styles.css`, `app.js` — the app (PWA source)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install/offline bits
- `vendor/` — vendored libraries (wavesurfer.js, jsmediatags); no CDN at runtime
- `scripts/prepare-www.js` — copies the PWA into `www/` for Capacitor
- `scripts/build-single.js` — inlines everything into `dist/lyric-sync.html`
- `scripts/generate-icons.js` — Android launcher icons (run in CI)
- `scripts/generate-pwa-icons.js` — PWA icons (run locally after changing the art)

## Develop

Service workers need HTTP, so serve the folder instead of opening `index.html`
directly:

```bash
python3 -m http.server 4173
```

Build the shareable single file:

```bash
npm run build:single
```

## Releases (APK + HTML)

Pushing a `v*` tag builds the signed APK **and** the single-file HTML and
attaches both to the GitHub release. Before tagging, bump the `version` field
in `package.json` to the new tag — it drives the APK version name (fallback),
the service worker cache name and the single-file build marker.

```bash
git tag v1.3.0
git push --tags
```

The APK signature comes from the `ANDROID_KEYSTORE_BASE64` secret. Keep the
package id (`com.msadrashakouri.lyricsync`) and the keystore stable so new
APKs install as updates over older ones.

## GitHub Pages

Enable once in **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The `pages.yml` workflow then deploys the PWA on every push to
`main` and on tags. The site works from the project URL
(`…/Lyric-Sync/`) thanks to the relative manifest/SW URLs.
