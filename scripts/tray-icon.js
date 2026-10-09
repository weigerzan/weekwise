// Small code-drawn clock icon; no external asset or runtime image dependency.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
const size = 32, pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const p = y * (size * 4 + 1) + 1 + x * 4, distance = Math.hypot(x - 15.5, y - 15.5);
  if (distance > 15) continue;
  const white = Math.abs(distance - 10.5) < 1 || (x >= 15 && x <= 16 && y >= 8 && y <= 16) || (y >= 15 && y <= 16 && x >= 15 && x <= 23);
  pixels[p] = white ? 255 : 124; pixels[p+1] = white ? 255 : 108; pixels[p+2] = white ? 255 : 240; pixels[p+3] = 255;
}
function crc(bytes) { let result = 0xffffffff; for (const b of bytes) { result ^= b; for (let bit = 0; bit < 8; bit++) result = result & 1 ? 0xedb88320 ^ result >>> 1 : result >>> 1; } return (result ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, checksum]); }
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
await writeFile(new URL('../src/tray.png', import.meta.url), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
