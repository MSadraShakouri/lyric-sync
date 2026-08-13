// Generates all Android launcher icons from assets/icon/icon-source.jpg:
//   - legacy PNGs (ic_launcher.png / ic_launcher_round.png) for Android < 8
//   - adaptive-icon layers for Android 8+:
//       * ic_launcher_foreground.png in every mipmap density (artwork scaled
//         into the safe zone, centered on a transparent canvas)
//       * res/values/ic_launcher_background.xml color resource
//
// Android 8+ launchers render the ADAPTIVE icon (mipmap-anydpi-v26 XMLs),
// which takes precedence over the legacy PNGs. Replacing only the legacy
// PNGs is why the custom icon never showed up.
//
// Usage: node scripts/generate-icons.js   (after `npx cap add android`)

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'assets', 'icon', 'icon-source.jpg');
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// Background color of the icon artwork (sampled from the source image edges).
const BACKGROUND_COLOR = '#050A1E';

// Adaptive-icon safe zone: launchers show the central 66dp of the 108dp
// canvas; artwork scaled to 66% and centered stays fully visible.
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
const ADAPTIVE_FG = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error('Icon source not found: ' + SOURCE);
  }

  // 1) Legacy icons — full-bleed square PNGs.
  for (const [folder, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, folder);
    fs.mkdirSync(dir, { recursive: true });
    const base = sharp(SOURCE).resize(size, size).png();
    await base.clone().toFile(path.join(dir, 'ic_launcher.png'));
    await base.clone().toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  // 2) Adaptive foreground — artwork scaled into the safe zone, centered on
  //    a transparent canvas. This overwrites the template's default
  //    (Capacitor robot) foreground PNGs at the same paths.
  for (const [folder, size] of Object.entries(ADAPTIVE_FG)) {
    const dir = path.join(RES, folder);
    fs.mkdirSync(dir, { recursive: true });
    const art = Math.round(size * SAFE_ZONE_SCALE);
    const artwork = await sharp(SOURCE).resize(art, art).png().toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: artwork,
          left: Math.round((size - art) / 2),
          top: Math.round((size - art) / 2),
        },
      ])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  // 3) Adaptive background color — overwrite the template's white value.
  const valuesDir = path.join(RES, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<resources>\n' +
      `    <color name="ic_launcher_background">${BACKGROUND_COLOR}</color>\n` +
      '</resources>\n',
  );

  console.log(
    'Icons generated: legacy PNGs + adaptive foregrounds + background color ' +
      BACKGROUND_COLOR,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
