// Generate a simple 32x32 PNG icon (blue circle)
// Run: node gen-icon.js
const size = 32;
const cx = size / 2, cy = size / 2, r = 12;
const rgba = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const idx = (y * size + x) * 4;
    if (dist <= r) {
      rgba[idx] = 0x5b; rgba[idx+1] = 0x8d; rgba[idx+2] = 0xef;
      const edge = r - dist;
      rgba[idx+3] = edge >= 1 ? 255 : Math.round(edge * 255);
    }
  }
}
// Minimal PNG encoder
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const sig = Buffer.from([137,80,78,71,13,10,26,10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) {
  raw[y * (1 + size * 4)] = 0; // filter none
  rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
}
const { deflateSync } = require('zlib');
const compressed = deflateSync(raw);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
require('fs').writeFileSync(__dirname + '/icon.png', png);
console.log('icon.png created (' + png.length + ' bytes)');
