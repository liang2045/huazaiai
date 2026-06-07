'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'public', 'imade.svg');
const outDir = path.join(root, 'electron', 'build-resources');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function writeIco(entries, outputPath) {
  const count = entries.length;
  let offset = 6 + 16 * count;
  const header = Buffer.alloc(offset);
  const chunks = [];

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  entries.forEach((entry, index) => {
    const pos = 6 + index * 16;
    header.writeUInt8(entry.size === 256 ? 0 : entry.size, pos);
    header.writeUInt8(entry.size === 256 ? 0 : entry.size, pos + 1);
    header.writeUInt8(0, pos + 2);
    header.writeUInt8(0, pos + 3);
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(entry.png.length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += entry.png.length;
    chunks.push(entry.png);
  });

  fs.writeFileSync(outputPath, Buffer.concat([header, ...chunks]));
}

(async () => {
  const svg = fs.readFileSync(svgPath);
  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  for (const size of sizes) {
    const png = await sharp(svg).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
    entries.push({ size, png });
  }

  writeIco(entries, path.join(outDir, 'icon.ico'));

  const distSvgPath = path.join(root, 'dist', 'imade.svg');
  if (fs.existsSync(path.dirname(distSvgPath))) {
    fs.copyFileSync(svgPath, distSvgPath);
  }

  console.log('Generated iMade icons.');
})();
