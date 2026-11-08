import { classById, specById, weaponKind, type ClassInfo } from "./classes.ts";
import { scoreEnchant, scoreItem, scoreStats } from "./score.ts";
import type {
  Enchant,
  EquippedItem,
  Faction,
  GearItem,
  PlannerSlot,
  SpecId,
} from "./types.ts";

export interface Ranked<T> {
  entry: T;
  score: number;
  outsideLevel: boolean;
  outsideFit: boolean;
  overallBest: boolean;
  upgrade: boolean | null;
  delta: number | null;
}

interface RankArgs<T extends { id: number; req: number }> {
  entries: T[];
  scoreOf: (entry: T) => number;
  level: number;
  window: number;
  fitOk?: (entry: T) => boolean;
  equippedScore?: number | null;
  equippedId?: number | null;
  emptySlot?: boolean;
  limit?: number;
}

export function rankEntries<T extends { id: number; req: number }>(args: RankArgs<T>): Ranked<T>[] {
  const limit = args.limit ?? 4;
  const scored = args.entries
    .map((entry) => ({ entry, score: args.scoreOf(entry) }))
    .sort((a, b) => b.score - a.score || a.entry.req - b.entry.req || a.entry.id - b.entry.id);
  if (!scored.length) return [];

  const decorate = (
    row: { entry: T; score: number },
    overallBest: boolean,
  ): Ranked<T> => {
    const outsideLevel = row.entry.req < args.level - args.window || row.entry.req > args.level + args.window;
    const outsideFit = args.fitOk ? !args.fitOk(row.entry) : false;
    let upgrade: boolean | null = null;
    let delta: number | null = null;
    if (args.emptySlot) {
      upgrade = row.score > 0 && !outsideFit;
    } else if (args.equippedScore != null) {
      delta = row.score - args.equippedScore;
      if (args.equippedId != null && row.entry.id === args.equippedId) upgrade = false;
      else if (outsideFit) upgrade = false;
      else upgrade = delta > 0.05;
    }
    return { ...row, outsideLevel, outsideFit, overallBest, upgrade, delta };
  };

  const practical = (row: { entry: T; score: number }) => {
    const outsideLevel = row.entry.req < args.level - args.window || row.entry.req > args.level + args.window;
    const outsideFit = args.fitOk ? !args.fitOk(row.entry) : false;
    return !outsideLevel && !outsideFit;
  };

  const picks: Ranked<T>[] = [];
  for (const row of scored) {
    if (!practical(row)) continue;
    picks.push(decorate(row, picks.length === 0));
    if (picks.length >= limit) break;
  }
  return picks;
}

const ARMOR_SLOTS = new Set(["head", "shoulder", "chest", "wrist", "hands", "waist", "legs", "feet"]);

export function hardAllowItem(item: GearItem, specId: SpecId, faction: Faction): boolean {
  const spec = specById(specId);
  const cls = classById(spec.classId);
  if (!cls) return false;
  if (item.faction === "horde" && faction !== "horde") return false;
  if (item.faction === "alliance" && faction !== "alliance") return false;
  if (item.classes?.length && !item.classes.includes(cls.name.toLowerCase())) return false;
  if (ARMOR_SLOTS.has(item.bucket) && item.armor && !spec.armor.includes(item.armor)) return false;
  if (item.bucket === "shield" && !cls.shield) return false;
  if (item.bucket === "holdable" && !cls.holdable) return false;
  if (item.bucket === "twohand" && !cls.twoHand) return false;
  const kind = weaponKind(item.weapon);
  if (["twohand", "onehand", "mainhand", "offhand"].includes(item.bucket) && kind && !cls.weapons.includes(kind)) {
    return false;
  }
  if (item.bucket === "ranged" || item.bucket === "relic") {
    if (kind && !cls.ranged.includes(kind)) return false;
    if (!kind && !cls.ranged.length) return false;
  }
  return true;
}

function slotMatch(item: GearItem, slot: PlannerSlot, cls: ClassInfo): boolean {
  if (slot === "mainhand") return ["mainhand", "onehand", "twohand"].includes(item.bucket);
  if (slot === "offhand") {
    if (item.bucket === "shield") return cls.shield;
    if (item.bucket === "holdable") return cls.holdable;
    if (item.bucket === "onehand" || item.bucket === "offhand") return cls.dualWield;
    return false;
  }
  if (slot === "ranged") return item.bucket === "ranged" || item.bucket === "relic";
  if (slot === "chest") return item.bucket === "chest";
  return item.bucket === slot;
}

function proficiencyOk(item: GearItem, cls: ClassInfo, level: number, window: number): boolean {
  const high = Math.min(60, level + window);
  const gate = item.armor === "mail" ? cls.mailAt : item.armor === "plate" ? cls.plateAt : undefined;
  const earliest = gate ? Math.max(item.req, gate) : item.req;
  return earliest <= high;
}

export function scoreEquippedItem(item: EquippedItem | null, spec: SpecId): number | null {
  if (!item) return null;
  return scoreStats(item.stats, spec, item.dps ?? 0);
}

export function recommendGear(args: {
  items: GearItem[];
  spec: SpecId;
  faction: Faction;
  level: number;
  window: number;
  slot: PlannerSlot;
  equipped: EquippedItem | null;
  excludeIds?: number[];
}): Ranked<GearItem>[] {
  const spec = specById(args.spec);
  const cls = classById(spec.classId);
  if (!cls) return [];
  const exclude = new Set(args.excludeIds ?? []);
  const pool = args.items.filter(
    (item) => !exclude.has(item.id) && slotMatch(item, args.slot, cls) && hardAllowItem(item, args.spec, args.faction),
  );
  return rankEntries({
    entries: pool,
    scoreOf: (item) => scoreItem(item, args.spec),
    level: args.level,
    window: args.window,
    fitOk: (item) => proficiencyOk(item, cls, args.level, args.window),
    equippedScore: scoreEquippedItem(args.equipped, args.spec),
    equippedId: args.equipped?.itemId ?? null,
    emptySlot: !args.equipped,
  });
}

function isTwoHand(item: EquippedItem | null): boolean {
  if (!item) return false;
  const inventory = (item.inventoryType ?? "").toUpperCase();
  const weapon = weaponKind(item.weaponType);
  return inventory === "TWOHWEAPON" || weapon === "staff" || weapon === "polearm";
}

function isShield(item: EquippedItem | null): boolean {
  if (!item) return false;
  const inventory = (item.inventoryType ?? "").toUpperCase();
  return inventory === "SHIELD" || weaponKind(item.weaponType) === "shield" || item.armorType === "shield";
}

function isHoldable(item: EquippedItem | null): boolean {
  if (!item) return false;
  return (item.inventoryType ?? "").toUpperCase() === "HOLDABLE";
}

export function enchantApplies(enchant: Enchant, cls: ClassInfo): boolean {
  if (enchant.fit === "shield") return cls.shield;
  if (enchant.fit === "holdable") return cls.holdable;
  if (enchant.fit === "twohand") return cls.twoHand;
  if (enchant.fit === "weapon") return cls.weapons.length > 0;
  return true;
}

export function recommendEnchantments(args: {
  enchants: Enchant[];
  spec: SpecId;
  level: number;
  window: number;
  slot: PlannerSlot;
  equipped: EquippedItem | null;
  equippedScore: number | null;
  equippedEnchantId?: number | null;
}): { available: boolean; ranked: Ranked<Enchant>[] } {
  const spec = specById(args.spec);
  const cls = classById(spec.classId);
  const forSlot = args.enchants.filter((enchant) => enchant.slot === args.slot);
  if (!forSlot.length || !cls) return { available: false, ranked: [] };
  const usable = forSlot.filter((enchant) => enchantApplies(enchant, cls));
  if (!usable.length) return { available: false, ranked: [] };
  const ranked = rankEntries({
    entries: usable,
    scoreOf: (enchant) => scoreEnchant(enchant, args.spec),
    level: args.level,
    window: args.window,
    fitOk: (enchant) => {
      if (args.slot === "mainhand") {
        if (!args.equipped) return true;
        if (enchant.fit === "twohand") return isTwoHand(args.equipped);
        return true;
      }
      if (args.slot === "offhand") {
        if (!args.equipped) return true;
        if (enchant.fit === "shield") return isShield(args.equipped);
        if (enchant.fit === "holdable") return isHoldable(args.equipped);
        return false;
      }
      return true;
    },
    equippedScore: args.equippedScore,
    equippedId: args.equippedEnchantId ?? null,
    emptySlot: false,
  });
  return { available: true, ranked };
}
