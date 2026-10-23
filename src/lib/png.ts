/**
 * Minimal lossless PNG encoder (8-bit RGB/RGBA/gray, or 1-bit gray), so pixel
 * data is written exactly as decoded — no canvas round-trip, no premultiplied
 * alpha, no colour management.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" in the Compression Streams API is the zlib format PNG requires.
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type PngColor = 'gray1' | 'gray' | 'rgb' | 'rgba';

const LAYOUT: Record<PngColor, { type: number; depth: number; channels: number }> = {
  gray1: { type: 0, depth: 1, channels: 1 },
  gray: { type: 0, depth: 8, channels: 1 },
  rgb: { type: 2, depth: 8, channels: 3 },
  rgba: { type: 6, depth: 8, channels: 4 },
};

/** `pixels` rows are tightly packed (1-bit rows padded to whole bytes, MSB first, 1 = white). */
export async function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array | Uint8ClampedArray,
  color: PngColor,
): Promise<Uint8Array> {
  const { type, depth, channels } = LAYOUT[color];
  const rowBytes = depth === 1 ? (width + 7) >> 3 : width * channels;

  // Each scanline is prefixed with filter type 0 (None): the bytes are stored as-is.
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = type;
  // compression 0, filter 0, interlace 0

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
