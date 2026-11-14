import { PNG } from "pngjs";

/** Drop the empty margin around an Armory render so the figure fills the card. The pixels themselves are unchanged. */
export function trimCharacterPng(bytes: Uint8Array, pad = 8): Uint8Array {
  const png = PNG.sync.read(Buffer.from(bytes));
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(png.width * y + x) * 4 + 3] ?? 0;
      if (alpha <= 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return bytes;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(png.width - 1, maxX + pad);
  const y1 = Math.min(png.height - 1, maxY + pad);
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (width === png.width && height === png.height) return bytes;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, x0, y0, width, height, 0, 0);
  return PNG.sync.write(out);
}
