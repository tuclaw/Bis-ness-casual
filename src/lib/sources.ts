import { DUNGEONS } from "./dungeons.ts";

/** Source chips. Each token in the catalog maps to one of these, with no extra inference. */
export const SOURCE_TYPES = ["world", "dungeon", "quest", "craft", "vendor", "pvp", "other", "unknown"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_LABEL: Record<SourceType, string> = {
  world: "World drops",
  dungeon: "Dungeons",
  quest: "Quests",
  craft: "Crafting",
  vendor: "Vendor",
  pvp: "PvP",
  other: "Other",
  unknown: "Unknown source",
};

export type SourceFilters = Record<SourceType, boolean>;

const FILTER_KEY = "bis-ness-casual-source-filters";
const DUNGEON_NAMES = new Set(DUNGEONS.map((dungeon) => dungeon.name));

const TOKEN_TYPE: Record<string, SourceType> = {
  Drops: "world",
  "Quest Rewards": "quest",
  Crafted: "craft",
  Vendors: "vendor",
  PvP: "pvp",
  "Unknown source": "unknown",
};

export function defaultSourceFilters(): SourceFilters {
  return {
    world: true,
    dungeon: true,
    quest: true,
    craft: true,
    vendor: true,
    pvp: true,
    other: true,
    unknown: true,
  };
}

export function loadSourceFilters(): SourceFilters {
  const filters = defaultSourceFilters();
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return filters;
    const parsed = JSON.parse(raw) as Partial<SourceFilters>;
    for (const type of SOURCE_TYPES) {
      if (typeof parsed[type] === "boolean") filters[type] = parsed[type];
    }
  } catch {
    return defaultSourceFilters();
  }
  return filters;
}

export function saveSourceFilters(filters: SourceFilters) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
}

/** Split a catalog source line into the types its tokens actually name. */
export function sourceTypes(source: string | undefined): SourceType[] {
  const text = source?.trim();
  if (!text) return ["unknown"];
  const found = new Set<SourceType>();
  for (const part of text.split("·")) {
    const token = part.trim();
    if (!token) continue;
    const known = TOKEN_TYPE[token];
    if (known) found.add(known);
    else if (DUNGEON_NAMES.has(token)) found.add("dungeon");
    else found.add("other");
  }
  return found.size ? [...found] : ["unknown"];
}

export function sourceAllowed(source: string | undefined, filters: SourceFilters): boolean {
  return sourceTypes(source).some((type) => filters[type]);
}

/** How many of these picks disappear if `type` is switched off and the others stay as they are. */
export function hiddenByToggle(sources: Array<string | undefined>, filters: SourceFilters, type: SourceType): number {
  const withType = { ...filters, [type]: true };
  const withoutType = { ...filters, [type]: false };
  return sources.filter((source) => sourceAllowed(source, withType) && !sourceAllowed(source, withoutType)).length;
}
