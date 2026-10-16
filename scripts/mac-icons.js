// Render the existing clock mark at native macOS icon sizes, without image dependencies.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function crc(bytes) {
  let result = 0xffffffff;
  for (const b of bytes) { result ^= b; for (let bit = 0; bit < 8; bit++) result = result & 1 ? 0xedb88320 ^ result >>> 1 : result >>> 1; }
  return (result ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
function png(size, template = false) {
  const stride = size * 4 + 1, pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sums = [0, 0, 0, 0];
    for (const dx of [.25, .75]) for (const dy of [.25, .75]) {
      const u = (x + dx) / size * 32 - 16, v = (y + dy) / size * 32 - 16;
      const distance = Math.hypot(u, v);
      const mark = Math.abs(distance - 10.5) < 1.1 || (Math.abs(u) < 1 && v >= -8 && v <= 1) || (Math.abs(v) < 1 && u >= 0 && u <= 7);
      const insideTile = Math.hypot(Math.max(Math.abs(u) - 7.5, 0), Math.max(Math.abs(v) - 7.5, 0)) <= 6;
      if (template ? !mark : !insideTile) continue;
      const light = Math.round((16 - v) / 32 * 18);
      const rgb = template ? [0, 0, 0] : mark ? [255, 255, 255] : [114 + light, 98 + light, 226 + light];
      rgb.forEach((value, i) => sums[i] += value); sums[3]++;
    }
    const p = y * stride + 1 + x * 4;
    if (sums[3]) for (let i = 0; i < 3; i++) pixels[p + i] = Math.round(sums[i] / sums[3]);
    pixels[p + 3] = Math.round(sums[3] / 4 * 255);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
await writeFile(path.join(root, 'src', 'trayTemplate.png'), png(18, true));
await writeFile(path.join(root, 'src', 'trayTemplate@2x.png'), png(36, true));
await writeFile(path.join(root, 'src', 'app-icon.png'), png(1024));
if (process.platform === 'darwin') {
  const iconset = path.join(root, 'tmp', 'Weekwise.iconset');
  await mkdir(iconset, { recursive: true }); await mkdir(path.join(root, 'assets'), { recursive: true });
  for (const size of [16,32,128,256,512]) {
    await writeFile(path.join(iconset, `icon_${size}x${size}.png`), png(size));
    await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2));
  }
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(root, 'assets', 'Weekwise.icns'), iconset]);
  await rm(iconset, { recursive: true, force: true });
}
