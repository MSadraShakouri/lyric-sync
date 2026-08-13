// Generates all Android launcher icons from assets/icon/icon-source.jpg:
//   - legacy PNGs (ic_launcher.png / ic_launcher_round.png) for Android < 8
//   - adaptive-icon layers for Android 8+:
//       * ic_launcher_foreground.png (coloured, scaled 66% into safe zone)
//       * ic_launcher_monochrome.png (monochrome, from a separate source)
//       * res/values/ic_launcher_background.xml color resource
//   - adaptive XMLs (mipmap-anydpi-v26) with monochrome layer
//
// Android 8+ launchers use the adaptive icon, which takes precedence over legacy PNGs.

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_COLOR = path.join(__dirname, '..', 'assets', 'icon', 'icon-source.jpg');
const SOURCE_MONO = path.join(__dirname, '..', 'assets', 'icon', 'ic_launcher_monochrome_source.png');
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const BACKGROUND_COLOR = '#050A1E';
const SAFE_ZONE_SCALE = 0.66;

// Legacy launcher icons (px per density bucket).
const LEGACY = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// Adaptive foreground canvas (px per density bucket).
const ADAPTIVE = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

async function generateIconSet(source, outputName, sizeMap) {
  for (const [folder, size] of Object.entries(sizeMap)) {
    const dir = path.join(RES, folder);
    fs.mkdirSync(dir, { recursive: true });
    const artSize = Math.round(size * SAFE_ZONE_SCALE);
    const art = await sharp(source).resize(artSize, artSize).png().toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: art, left: Math.round((size - artSize) / 2), top: Math.round((size - artSize) / 2) }])
      .png()
      .toFile(path.join(dir, outputName));
  }
}

async function main() {
  // Check source files
  if (!fs.existsSync(SOURCE_COLOR)) throw new Error('Color icon source not found: ' + SOURCE_COLOR);
  if (!fs.existsSync(SOURCE_MONO)) {
    console.warn('Monochrome source not found, skipping monochrome generation.');
  }

  // 1) Legacy icons — full-bleed square PNGs.
  for (const [folder, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, folder);
    fs.mkdirSync(dir, { recursive: true });
    const base = sharp(SOURCE_COLOR).resize(size, size).png();
    await base.clone().toFile(path.join(dir, 'ic_launcher.png'));
    await base.clone().toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  // 2) Adaptive foreground (coloured) — scaled 66% into transparent canvas.
  await generateIconSet(SOURCE_COLOR, 'ic_launcher_foreground.png', ADAPTIVE);

  // 3) Adaptive monochrome (if source exists).
  if (fs.existsSync(SOURCE_MONO)) {
    await generateIconSet(SOURCE_MONO, 'ic_launcher_monochrome.png', ADAPTIVE);
  }

  // 4) Background color resource (overwrites template white).
  const valuesDir = path.join(RES, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BACKGROUND_COLOR}</color>
</resources>`
  );

  // 5) Adaptive XMLs with monochrome layer (overwrite template files).
  const anydpiDir = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpiDir, { recursive: true });

  const xmlTemplate = (round) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>`;

  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), xmlTemplate(false));
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), xmlTemplate(true));

  console.log('All icons generated (legacy, adaptive foreground, monochrome, background color, XMLs).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
