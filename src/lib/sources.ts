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

const SPECIFIC_PREFIX: Partial<Record<SourceType, string>> = {
  world: "Drop",
  dungeon: "Dungeon",
  quest: "Quest",
  craft: "Crafted",
  vendor: "Vendor",
  other: "Other",
};

interface SourceSegment {
  type: SourceType;
  details: string[];
}

/** Turn a catalog source line into the label shown on a row. Specific names are used only when the line actually contains them. */
export function sourceLabel(source: string | undefined): string {
  const text = source?.trim();
  if (!text) return SOURCE_LABEL.unknown;
  const parts = text.split("·").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return SOURCE_LABEL.unknown;

  const segments: SourceSegment[] = [];
  let current: SourceSegment | null = null;
  for (const part of parts) {
    const typed = TOKEN_TYPE[part];
    if (typed) {
      current = { type: typed, details: [] };
      segments.push(current);
      continue;
    }
    if (DUNGEON_NAMES.has(part)) {
      current = { type: "dungeon", details: [part] };
      segments.push(current);
      continue;
    }
    if (current) current.details.push(part);
    else {
      current = { type: "other", details: [part] };
      segments.push(current);
    }
  }

  const labels = segments.map((segment) => {
    const detail = segment.details.join(", ");
    if (segment.type === "unknown") return detail ? `${SOURCE_LABEL.unknown} · ${detail}` : SOURCE_LABEL.unknown;
    if (segment.type === "pvp") return SOURCE_LABEL.pvp;
    if (!detail) return SOURCE_LABEL[segment.type];
    const prefix = SPECIFIC_PREFIX[segment.type];
    return prefix ? `${prefix}: ${detail}` : detail;
  });
  return labels.length ? labels.join(" · ") : SOURCE_LABEL.unknown;
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
