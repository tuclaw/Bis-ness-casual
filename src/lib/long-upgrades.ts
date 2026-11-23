import { scoreEquippedItem, type Ranked } from "./recommend.ts";
import type { EquippedItem, GearItem, PlannerSlot, SpecId } from "./types.ts";

export interface LongUpgradeSlot {
  id: string;
  label: string;
  slot: PlannerSlot;
  equipped: EquippedItem | null;
  gear: Ranked<GearItem>[];
}

export interface LongUpgrade {
  slotId: string;
  slot: PlannerSlot;
  slotLabel: string;
  item: GearItem;
  /** Spec score minus the equipped baseline. */
  delta: number;
  /** Delta divided by the equipped score, or the delta itself when the slot is empty. */
  relative: number;
  /** Level a better item shows up, after the window cap. Null when longevity is unknown. */
  until: number | null;
  /** Levels the item stays ahead. Null when longevity is unknown. */
  levels: number | null;
  value: number;
  unknownLongevity: boolean;
}

export const LONG_UPGRADE_NOTE =
  "Upgrade size is this item's spec score minus what is equipped. Rings and trinkets replace the weaker of the two pieces; an empty slot counts as zero. Longevity runs from your level, or the required level if that is higher, until a strictly better catalog item for that slot and spec can be worn. That end is capped at this level window and at 60. Value is the relative upgrade (size divided by the equipped score, or the size when the slot is empty) times those levels. An item a better piece replaces as soon as it can be worn is left off. If longevity is unknown, the value is the relative upgrade alone.";

function matesFor(slot: PlannerSlot, slots: LongUpgradeSlot[]): LongUpgradeSlot[] {
  return slots.filter((row) => row.slot === slot);
}

function baselineFor(slot: PlannerSlot, slots: LongUpgradeSlot[], spec: SpecId): number {
  const mates = matesFor(slot, slots);
  if (!mates.length || mates.every((row) => !row.equipped)) return 0;
  return Math.min(...mates.map((row) => (row.equipped ? (scoreEquippedItem(row.equipped, spec) ?? 0) : 0)));
}

/** The equipped piece a candidate replaces. Rings and trinkets use the lower score. An empty mate means there is nothing to compare. */
export function baselineEquipped(slot: PlannerSlot, slots: LongUpgradeSlot[], spec: SpecId): EquippedItem | null {
  const mates = matesFor(slot, slots);
  if (!mates.length || mates.some((row) => !row.equipped)) return null;
  let weakest: EquippedItem | null = null;
  let weakestScore = Infinity;
  for (const row of mates) {
    if (!row.equipped) continue;
    const score = scoreEquippedItem(row.equipped, spec) ?? 0;
    if (score < weakestScore) {
      weakestScore = score;
      weakest = row.equipped;
    }
  }
  return weakest;
}

function equippedIds(slot: PlannerSlot, slots: LongUpgradeSlot[]): Set<number> {
  const ids = new Set<number>();
  for (const row of matesFor(slot, slots)) {
    if (row.equipped?.itemId) ids.add(row.equipped.itemId);
  }
  return ids;
}

export function rankLongUpgrades(args: {
  slots: LongUpgradeSlot[];
  spec: SpecId;
  level: number;
  horizon: number;
  limit?: number;
}): LongUpgrade[] {
  const horizon = Math.max(args.level, Math.min(60, args.horizon));
  const ranked: LongUpgrade[] = [];
  const seen = new Set<number>();

  for (const row of args.slots) {
    const baseline = baselineFor(row.slot, args.slots, args.spec);
    const worn = equippedIds(row.slot, args.slots);
    for (const pick of row.gear) {
      if (seen.has(pick.entry.id) || worn.has(pick.entry.id)) continue;
      const delta = pick.score - baseline;
      if (delta <= 0.05) continue;
      const relative = baseline > 0.05 ? delta / baseline : delta;
      const span = pick.longevity;
      let until: number | null = null;
      let levels: number | null = null;
      let unknownLongevity = false;
      if (!span) {
        unknownLongevity = true;
      } else {
        const rawUntil = span.until == null ? 60 : span.until;
        const wearFrom = Math.max(args.level, span.from);
        until = Math.min(rawUntil, horizon);
        levels = until - wearFrom;
        if (levels <= 0) continue;
      }
      const value = levels == null ? relative : relative * levels;
      ranked.push({
        slotId: row.id,
        slot: row.slot,
        slotLabel: row.label,
        item: pick.entry,
        delta,
        relative,
        until: unknownLongevity ? null : until,
        levels,
        value,
        unknownLongevity,
      });
      seen.add(pick.entry.id);
    }
  }

  ranked.sort((a, b) => b.value - a.value || b.delta - a.delta || a.item.req - b.item.req || a.item.id - b.item.id);
  return ranked.slice(0, args.limit ?? 10);
}
