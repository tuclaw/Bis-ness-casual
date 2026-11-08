import { wowheadIconUrl } from "./format.ts";

const cache = new Map<number, string | null>();

export async function lookupItemIcon(id: number): Promise<string | null> {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id) ?? null;
  try {
    const response = await fetch(`https://nether.wowhead.com/forever/tooltip/item/${id}`);
    if (!response.ok) {
      cache.set(id, null);
      return null;
    }
    const payload = (await response.json()) as { icon?: string };
    const url = payload.icon ? wowheadIconUrl(payload.icon) : null;
    cache.set(id, url);
    return url;
  } catch {
    cache.set(id, null);
    return null;
  }
}
