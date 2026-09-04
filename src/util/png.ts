import zlib from 'node:zlib';

/** Minimal PNG encoder (RGB, 8-bit) for mock images. No dependencies. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

let table: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A placeholder "portrait": soft gradient, a face-ish circle, and a hue picked from the seed. Clearly not a person. */
export function mockPortrait(seed: number, width = 512, height = 640, variant: 'face' | 'full' | 'scene' = 'face'): Buffer {
  const hue = (seed * 137.5) % 360;
  const [r1, g1, b1] = hsl(hue, 0.35, 0.22);
  const [r2, g2, b2] = hsl((hue + 40) % 360, 0.45, 0.55);
  const cx = width / 2, cy = variant === 'face' ? height * 0.42 : height * 0.25;
  const rad = variant === 'face' ? width * 0.28 : width * 0.12;
  return encodePng(width, height, (x, y) => {
    const t = y / height;
    let r = r1 + (r2 - r1) * t, g = g1 + (g2 - g1) * t, b = b1 + (b2 - b1) * t;
    const d = Math.hypot(x - cx, y - cy);
    if (d < rad) { r = 236; g = 205; b = 180; }
    if (d < rad && d > rad * 0.94) { r = 60; g = 40; b = 50; }
    if (variant !== 'face') {
      const bodyTop = cy + rad * 0.9, bodyBottom = variant === 'full' ? height * 0.85 : height * 0.6;
      if (y > bodyTop && y < bodyBottom && Math.abs(x - cx) < rad * 1.6 * (1 - (y - bodyTop) / (bodyBottom - bodyTop) * 0.2)) { r = 210; g = 200; b = 240; }
    }
    // hair pin marker (lavender inner colour nod)
    if (Math.hypot(x - (cx - rad * 0.7), y - (cy - rad * 0.6)) < rad * 0.12) { r = 250; g = 250; b = 250; }
    return [Math.round(r), Math.round(g), Math.round(b)];
  });
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
