const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const publicIconDir = path.join(root, 'public', 'icon');

if (!fs.existsSync(publicIconDir)) fs.mkdirSync(publicIconDir, { recursive: true });

const src125 = path.join(assetsDir, '125x125.png');
const src500 = path.join(assetsDir, '500x500.png');

if (!fs.existsSync(src125) || !fs.existsSync(src500)) {
  console.error('Branding assets not found in assets/: expected 125x125.png and 500x500.png');
  process.exit(1);
}

try {
  fs.copyFileSync(src125, path.join(publicIconDir, '16.png'));
  fs.copyFileSync(src125, path.join(publicIconDir, '32.png'));
  fs.copyFileSync(src125, path.join(publicIconDir, '48.png'));
  fs.copyFileSync(src500, path.join(publicIconDir, '128.png'));
  console.log('Copied branding assets to public/icon');
} catch (err) {
  console.error('Failed to copy branding assets', err);
  process.exit(2);
}
