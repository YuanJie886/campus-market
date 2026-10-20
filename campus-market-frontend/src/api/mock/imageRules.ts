/**
 * 离线演示的图片上传规则，镜像后端 ImageService：按文件头判断 JPEG / PNG（不信任扩展名与 Content-Type），
 * 读出宽高（PNG 的 IHDR、JPEG 的 SOF 段）。Mock 不重新编码：图片以 data: 地址保存在本机。
 */
export type SniffedFormat = 'jpeg' | 'png' | null;

export function sniffImage(bytes: Uint8Array): SniffedFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'png';
  return null;
}

/** 只读文件头里的宽高；读不出时为 null（与后端「图片已损坏或无法识别」同一类） */
export function imageSize(bytes: Uint8Array, format: Exclude<SniffedFormat, null>): { width: number; height: number } | null {
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  if (format === 'png') {
    if (bytes.length < 24) return null;
    return { width: u32(16), height: u32(20) };
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1];
    // SOF0～SOF15（不含 DHT C4、JPG C8、DAC CC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16(i + 5), width: u16(i + 7) };
    }
    i += 2 + u16(i + 2);
  }
  return null;
}

/** 读取文件字节：优先 Blob.arrayBuffer，旧环境回落到 FileReader */
export function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
