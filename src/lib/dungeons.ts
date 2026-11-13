import type { Faction, GearItem, PlannerSlot } from "./types.ts";
import type { Ranked } from "./recommend.ts";

export interface DungeonInfo {
  name: string;
  min: number;
  max: number;
  faction: "horde" | "alliance" | "both";
}

/** Classic dungeon brackets that appear by name in the Forever item sources. */
export const DUNGEONS: DungeonInfo[] = [
  { name: "Ragefire Chasm", min: 13, max: 18, faction: "horde" },
  { name: "Wailing Caverns", min: 15, max: 25, faction: "both" },
  { name: "The Deadmines", min: 15, max: 21, faction: "alliance" },
  { name: "Shadowfang Keep", min: 18, max: 25, faction: "both" },
  { name: "Blackfathom Deeps", min: 20, max: 28, faction: "both" },
  { name: "The Stockade", min: 22, max: 30, faction: "alliance" },
  { name: "Gnomeregan", min: 24, max: 34, faction: "alliance" },
  { name: "Razorfen Kraul", min: 25, max: 35, faction: "horde" },
  { name: "Scarlet Monastery", min: 26, max: 45, faction: "both" },
  { name: "Razorfen Downs", min: 35, max: 45, faction: "horde" },
  { name: "Uldaman", min: 35, max: 45, faction: "both" },
  { name: "Zul'Farrak", min: 42, max: 46, faction: "both" },
  { name: "Maraudon", min: 43, max: 48, faction: "both" },
  { name: "The Temple of Atal'Hakkar", min: 45, max: 55, faction: "both" },
  { name: "Blackrock Depths", min: 48, max: 56, faction: "both" },
  { name: "Blackrock Spire", min: 55, max: 60, faction: "both" },
  { name: "Dire Maul", min: 55, max: 60, faction: "both" },
  { name: "Scholomance", min: 56, max: 60, faction: "both" },
  { name: "Stratholme", min: 56, max: 60, faction: "both" },
];

const DUNGEON_BY_NAME = new Map(DUNGEONS.map((dungeon) => [dungeon.name, dungeon]));

export interface DungeonItem {
  slot: string;
  slotId: PlannerSlot;
  name: string;
  id: number;
  delta: number | null;
  levels: number;
}

export interface DungeonRecommendation {
  name: string;
  min: number;
  max: number;
  faction: DungeonInfo["faction"];
  count: number;
  score: number;
  items: DungeonItem[];
}

export function dungeonsNamedInSource(source: string | undefined): DungeonInfo[] {
  if (!source || source === "Unknown source") return [];
  const found: DungeonInfo[] = [];
  for (const part of source.split("·")) {
    const dungeon = DUNGEON_BY_NAME.get(part.trim());
    if (dungeon && !found.some((item) => item.name === dungeon.name)) found.push(dungeon);
  }
  return found;
}

export function canRunDungeon(dungeon: DungeonInfo, level: number, faction: Faction): boolean {
  if (dungeon.faction !== "both" && dungeon.faction !== faction) return false;
  return level >= dungeon.min - 2 && level <= dungeon.max + 2;
}

function pickWeight(pick: Ranked<GearItem>): number {
  const delta = pick.delta != null ? Math.max(0, pick.delta) : Math.max(0, pick.score);
  const levels = pick.longevity?.levels ?? 0;
  return 1 + delta / 20 + levels / 10;
}

/** Rank dungeons by the current upgrade picks whose source line names that dungeon. */
export function recommendDungeons(args: {
  level: number;
  faction: Faction;
  slots: Array<{ label: string; slot: PlannerSlot; picks: Ranked<GearItem>[] }>;
}): DungeonRecommendation[] {
  const buckets = new Map<string, DungeonRecommendation>();
  for (const column of args.slots) {
    for (const pick of column.picks) {
      if (pick.upgrade !== true) continue;
      const source = "source" in pick.entry ? pick.entry.source : undefined;
      for (const dungeon of dungeonsNamedInSource(source)) {
        if (!canRunDungeon(dungeon, args.level, args.faction)) continue;
        const row = buckets.get(dungeon.name) ?? {
          name: dungeon.name,
          min: dungeon.min,
          max: dungeon.max,
          faction: dungeon.faction,
          count: 0,
          score: 0,
          items: [],
        };
        row.count += 1;
        row.score += pickWeight(pick);
        row.items.push({
          slot: column.label,
          slotId: column.slot,
          name: pick.entry.name,
          id: pick.entry.id,
          delta: pick.delta,
          levels: pick.longevity?.levels ?? 0,
        });
        buckets.set(dungeon.name, row);
      }
    }
  }
  return [...buckets.values()].sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);
}
