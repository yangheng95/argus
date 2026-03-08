// Generate a minimal .ico from the existing icon.png
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/icon.png');

// ICO format: header + directory entry + PNG data
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);     // reserved
header.writeUInt16LE(1, 2);     // ICO type
header.writeUInt16LE(1, 4);     // 1 image

const entry = Buffer.alloc(16);
entry[0] = 32;                  // width (32)
entry[1] = 32;                  // height (32)
entry[2] = 0;                   // color palette
entry[3] = 0;                   // reserved
entry.writeUInt16LE(1, 4);      // color planes
entry.writeUInt16LE(32, 6);     // bits per pixel
entry.writeUInt32LE(png.length, 8);  // image size
entry.writeUInt32LE(22, 12);    // offset (6 + 16 = 22)

const ico = Buffer.concat([header, entry, png]);
fs.writeFileSync(__dirname + '/icon.ico', ico);
console.log('icon.ico created (' + ico.length + ' bytes)');
