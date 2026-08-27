// Generates the PWA icons (icons/icon-192.png, icons/icon-512.png) from
// assets/icon/icon-source.jpg. The output is committed to the repo (used by
// the manifest, GitHub Pages and the Capacitor build).
//
// Run after changing the icon art: node scripts/generate-pwa-icons.js

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "assets", "icon", "icon-source.jpg");
const OUT = path.join(__dirname, "..", "icons");

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error("Icon source not found: " + SOURCE);
  }
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(SOURCE).resize(192, 192).png().toFile(path.join(OUT, "icon-192.png"));
  await sharp(SOURCE).resize(512, 512).png().toFile(path.join(OUT, "icon-512.png"));
  console.log("PWA icons generated in icons/ (192x192, 512x512).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
