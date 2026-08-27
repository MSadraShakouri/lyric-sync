// Copies the multi-file PWA into www/ for Capacitor (see capacitor.config.json)
// and bumps the service worker cache name from package.json.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const version = require(path.join(root, "package.json")).version;

const files = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

// Bump the service worker cache name so each release gets a fresh cache.
let sw = fs.readFileSync(path.join(out, "sw.js"), "utf8");
sw = sw.replace(/const CACHE = .*/, `const CACHE = "lyric-sync-v${version}";`);
fs.writeFileSync(path.join(out, "sw.js"), sw);

fs.cpSync(path.join(root, "icons"), path.join(out, "icons"), { recursive: true });
fs.cpSync(path.join(root, "vendor"), path.join(out, "vendor"), { recursive: true });

console.log(`Prepared Capacitor web assets in www/ (sw cache lyric-sync-v${version}).`);
