/** E2E 用的内存 PNG（不读本机文件）：与 images.spec.ts 里的生成方式相同。 */
// ---------- 生成一张有效的 PNG（存储型 deflate，不依赖 zlib） ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff] }
function chunk(type: string, data: number[]): number[] {
  const body = [...type].map((ch) => ch.charCodeAt(0)).concat(data);
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}
/** size×size 的纯色 RGB PNG */
export function solidPng(size = 16, rgb: [number, number, number] = [220, 60, 40]): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < size; y++) { raw.push(0); for (let x = 0; x < size; x++) raw.push(...rgb) }
  let a = 1, b = 0;
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521 }
  // zlib：头 0x78 0x01 + 一个存储块（BFINAL=1, BTYPE=00）+ Adler-32
  const len = raw.length;
  const zlib = [0x78, 0x01, 0x01, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff, ...raw, ...u32(((b << 16) | a) >>> 0)];
  const ihdr = [...u32(size), ...u32(size), 8, 2, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', zlib), ...chunk('IEND', [])]);
}
