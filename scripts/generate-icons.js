import fs from 'fs';
import zlib from 'zlib';

function createPng(width, height, isMaskable) {
  // Generar buffer RGBA
  const buffer = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = isMaskable ? width * 0.38 : width * 0.44;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Fondo oscuro #07080b
      let r = 7, g = 8, b = 11, a = 255;

      // Círculo exterior con borde cian #00f0ff
      if (dist < radius) {
        r = 16; g = 18; b = 26; // #10121a
        if (Math.abs(dist - radius) < width * 0.02) {
          r = 0; g = 240; b = 255; // borde cian
        }
      }

      // Detalle central de tijeras o cruz cian
      if (Math.abs(dx) < width * 0.15 && Math.abs(dy) < width * 0.15) {
        if (Math.abs(dx - dy) < width * 0.04 || Math.abs(dx + dy) < width * 0.04) {
          r = 0; g = 240; b = 255;
        }
      }

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  // Filtrar scanlines para PNG (filtro 0: None)
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawIdx = y * (width * 4 + 1);
    rawData[rawIdx] = 0; // Filter type 0
    buffer.copy(rawData, rawIdx + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  // Armar PNG chunks
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);

    // Calcular CRC32
    let c = 0xffffffff;
    const combined = Buffer.concat([typeBuf, data]);
    for (let i = 0; i < combined.length; i++) {
      c ^= combined[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
      }
    }
    crcBuf.writeInt32BE((c ^ 0xffffffff) | 0, 0);

    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type 6: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

if (!fs.existsSync('public')) fs.mkdirSync('public');

fs.writeFileSync('public/pwa-192x192.png', createPng(192, 192, false));
fs.writeFileSync('public/pwa-512x512.png', createPng(512, 512, false));
fs.writeFileSync('public/pwa-maskable-512x512.png', createPng(512, 512, true));
fs.writeFileSync('public/apple-touch-icon.png', createPng(180, 180, false));
console.log('Iconos PWA generados con éxito');
