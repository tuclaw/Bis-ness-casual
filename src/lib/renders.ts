/** Armory character-media keys, most useful full-body render first. */
export const RENDER_ASSET_ORDER = ["main-raw", "main", "inset", "avatar"] as const;

export interface MediaAsset {
  key?: string | null;
  value?: string | null;
}

/** Profile API character-media, then nothing. Callers fall back to the Armory page URL. */
export function pickMediaUrl(assets: MediaAsset[]): string | null {
  for (const key of RENDER_ASSET_ORDER) {
    const found = assets.find((asset) => asset?.key === key && asset.value);
    if (found?.value) return found.value;
  }
  return null;
}

export function imageExtension(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** Same bytes and the same relative path means the snapshot image stays as it is. */
export function renderWriteNeeded(args: {
  previousHash?: string | null;
  nextHash: string;
  previousFile?: string | null;
  nextFile: string;
  fileExists: boolean;
}): boolean {
  return !(args.fileExists && args.previousHash === args.nextHash && args.previousFile === args.nextFile);
}

export function publicAssetUrl(base: string, file?: string | null, hash?: string | null): string | null {
  if (!file || !hash) return null;
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}${file}?v=${encodeURIComponent(hash)}`;
}
