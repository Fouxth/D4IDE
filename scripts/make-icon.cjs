#!/usr/bin/env node
/**
 * Generates the D4IDE app icon.
 *
 * The icon is drawn in code rather than committed as an opaque binary: the
 * artwork is a few shapes, and generating it keeps the source of truth
 * reviewable and lets the tile size, radii and colours be changed in one place.
 *
 * Output (under `build/`, where electron-builder looks):
 *   · icon.png — 512×512, used for non-Windows targets and the window fallback
 *   · icon.ico — 256/128/64/48/32/16, PNG-compressed entries, for Windows
 *
 * Run with `pnpm icon:build`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');
const ACCENT = [20, 184, 166]; // rgb(20 184 166) — the app's single accent colour
const ACCENT_LIGHT = [45, 212, 191];
const TILE_TOP = [24, 26, 31];
const TILE_BOTTOM = [9, 10, 13];
const BORDER = [42, 46, 54];

// ---------------------------------------------------------------- geometry

/** Signed distance to a rounded rectangle centred on the canvas. */
function roundedRectDistance(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Distance from a point to a line segment — used for the diagonal of the "4". */
function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Coverage of the glyphs at a point, as `{ d, four }` in 0..1.
 *
 * Every part is analytic, so the shapes stay crisp at 16 px without hinting.
 * All coordinates are fractions of the canvas, which keeps the sizes consistent.
 */
function glyphCoverage(x, y, size) {
  // A small optical shift keeps the pair centred in the tile: the "4" is
  // narrower than the "D", so centring the bounding box alone looks left-heavy.
  const u = x / size + 0.028;
  const v = y / size;
  const stroke = 0.052; // half-thickness of a stroke, in canvas fractions

  // "D": a stem plus a bowl that is a half-annulus to the right of the stem.
  const stemLeft = 0.165;
  const stemWidth = 0.062;
  const stem = u > stemLeft && u < stemLeft + stemWidth && v > 0.28 && v < 0.72;
  const cx = stemLeft + stemWidth;
  const cy = 0.5;
  const outer = 0.222;
  const inner = outer - stemWidth;
  const radius = Math.hypot(u - cx, v - cy);
  const bowl = u >= cx && radius <= outer && radius >= inner;

  // "4": a diagonal down-left, a vertical stem, and a crossbar that passes
  // through both — the three strokes that make the shape readable at 16 px.
  const diagonal = segmentDistance(u, v, 0.665, 0.295, 0.505, 0.585) < stroke * 0.78;
  const vertical = u > 0.612 && u < 0.612 + stemWidth && v > 0.295 && v < 0.735;
  const bar = u > 0.47 && u < 0.762 && v > 0.598 && v < 0.598 + stemWidth;

  return { d: stem || bowl, four: diagonal || vertical || bar };
}

/** Renders one size, supersampled for smooth edges. */
function render(size, supersample = 3) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.235;
  const borderWidth = Math.max(1, size * 0.012);
  const step = 1 / supersample;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;

          const tile = -roundedRectDistance(x, y, size, radius);
          if (tile <= 0) continue; // outside the rounded tile

          const t = y / size;
          let colour = [
            TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t,
            TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t,
            TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t
          ];

          // A hairline edge so the tile reads as a surface on light backgrounds.
          const edge = tile < borderWidth ? 1 - tile / borderWidth : 0;
          colour = colour.map((channel, index) => channel * (1 - edge * 0.9) + BORDER[index] * edge * 0.9);

          const glyph = glyphCoverage(x, y, size);
          if (glyph.d || glyph.four) {
            const ink = glyph.four ? ACCENT_LIGHT : ACCENT;
            colour = colour.map((channel, index) => channel * 0.08 + ink[index] * 0.92);
          }

          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const samples = supersample * supersample;
      // Alpha is the fraction of samples inside the tile, so the corners come
      // out transparent instead of black.
      const coverage = a / (samples * 255);
      if (coverage <= 0) continue;
      const index = (py * size + px) * 4;
      pixels[index] = Math.round(r / samples / coverage);
      pixels[index + 1] = Math.round(g / samples / coverage);
      pixels[index + 2] = Math.round(b / samples / coverage);
      pixels[index + 3] = Math.round(coverage * 255);
    }
  }

  return pixels;
}

// -------------------------------------------------------------- png / ico

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** An ICO whose entries are PNGs — supported since Windows Vista. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const entry of entries) {
    const record = Buffer.alloc(16);
    record[0] = entry.size >= 256 ? 0 : entry.size;
    record[1] = entry.size >= 256 ? 0 : entry.size;
    record[2] = 0;
    record[3] = 0;
    record.writeUInt16LE(1, 4); // colour planes
    record.writeUInt16LE(32, 6); // bits per pixel
    record.writeUInt32LE(entry.png.length, 8);
    record.writeUInt32LE(offset, 12);
    directory.push(record);
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)]);
}

// ---------------------------------------------------------------- generate

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const icoSizes = [256, 128, 64, 48, 32, 16];
const entries = icoSizes.map((size) => ({ size, png: encodePng(render(size, size <= 48 ? 4 : 3), size) }));

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(entries));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(render(512, 2), 512));

console.log(`Wrote build/icon.ico (${icoSizes.join(', ')}) and build/icon.png (512).`);
