// Builds the shareable single-file version of the app from the multi-file
// PWA sources: inlines styles.css, app.js and the vendored libraries into
// dist/lyric-sync.html. The result works from file:// with no server.
//
// Usage: node scripts/build-single.js

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const version = require(path.join(root, "package.json")).version;

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const wavesurfer = fs.readFileSync(path.join(root, "vendor", "wavesurfer.min.js"), "utf8");
const jsmediatags = fs.readFileSync(path.join(root, "vendor", "jsmediatags.min.js"), "utf8");
const soundtouch = fs.readFileSync(path.join(root, "vendor", "soundtouch.min.js"), "utf8");

const inlineJs = (code) =>
  "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";

// Drop the PWA-only pieces, inline everything else.
html = html.replace('<link rel="manifest" href="manifest.webmanifest" />', "");
html = html.replace(
  '<link rel="stylesheet" href="styles.css" />',
  "<style>\n" + css + "\n</style>",
);
html = html.replace(
  '<script src="vendor/wavesurfer.min.js"></script>',
  inlineJs(wavesurfer),
);
html = html.replace(
  '<script src="vendor/jsmediatags.min.js"></script>',
  inlineJs(jsmediatags),
);
html = html.replace(
  '<script src="vendor/soundtouch.min.js"></script>',
  inlineJs(soundtouch),
);
html = html.replace('<script src="app.js"></script>', inlineJs(js));
html = html.replace(
  "<title>Lyric Sync</title>",
  `<title>Lyric Sync</title>\n    <!-- single-file build v${version} -->`,
);

// Sanity: every replacement must have happened.
for (const marker of [
  'href="styles.css"',
  'src="vendor/wavesurfer.min.js"',
  'src="vendor/jsmediatags.min.js"',
  'src="vendor/soundtouch.min.js"',
  'src="app.js"',
  'rel="manifest"',
]) {
  if (html.includes(marker)) {
    throw new Error("build-single: un-replaced reference left in output: " + marker);
  }
}

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "lyric-sync.html"), html);
console.log(`Built dist/lyric-sync.html (single file, v${version}).`);
