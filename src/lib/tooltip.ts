import { formatStat, qualityName } from "./format.ts";
import type { EquippedItem, GearItem, StatBlock } from "./types.ts";

/** Lines the Forever Armory item popup can show. A line is omitted when the record has no value for it. */
export type TipKind =
  | "name"
  | "ilvl"
  | "binding"
  | "unique"
  | "slot"
  | "armor"
  | "weapon"
  | "stat"
  | "effect"
  | "enchant"
  | "durability"
  | "classes"
  | "req"
  | "sell"
  | "source";

export interface TipLine {
  kind: TipKind;
  text: string;
  right?: string;
  /** Set when this stat is higher or lower than the equipped item. */
  delta?: "up" | "down";
}

export interface TipModel {
  quality: string;
  lines: TipLine[];
  href: string | null;
}

const SLOT_LABEL: Record<string, string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  back: "Back",
  chest: "Chest",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger: "Finger",
  trinket: "Trinket",
  mainhand: "Main Hand",
  offhand: "Off Hand",
  onehand: "One-Hand",
  twohand: "Two-Hand",
  ranged: "Ranged",
  relic: "Relic",
  shield: "Shield",
  holdable: "Held In Off-hand",
  CHEST: "Chest",
  HEAD: "Head",
  SHOULDER: "Shoulder",
  BACK: "Back",
  WRIST: "Wrist",
  HANDS: "Hands",
  WAIST: "Waist",
  LEGS: "Legs",
  FEET: "Feet",
  FINGER: "Finger",
  TRINKET: "Trinket",
  WEAPON: "Main Hand",
  MAIN_HAND: "Main Hand",
  OFF_HAND: "Off Hand",
  RANGED: "Ranged",
};

const STAT_ORDER = ["str", "agi", "sta", "int", "spi", "ap", "sp", "sd", "heal", "crit", "spellCrit", "meleeHit", "spellHit", "mp5"];

function titleWord(value: string): string {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : value;
}

function slotLabel(slot: string | null | undefined): string | null {
  if (!slot) return null;
  return SLOT_LABEL[slot] ?? SLOT_LABEL[slot.toLowerCase()] ?? titleWord(slot.toLowerCase());
}

function effectLines(effect: string | null | undefined): string[] {
  if (!effect?.trim()) return [];
  return effect
    .split(/(?=Equip:|Use:)/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function statLines(stats: StatBlock, other: StatBlock | null): TipLine[] {
  const keys = Object.keys(stats).filter((key) => key !== "armor" && stats[key]);
  keys.sort((a, b) => {
    const ai = STAT_ORDER.indexOf(a);
    const bi = STAT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  return keys.map((key) => {
    const value = stats[key] ?? 0;
    let delta: TipLine["delta"];
    if (other) {
      const equipped = other[key] ?? 0;
      if (value > equipped) delta = "up";
      else if (value < equipped) delta = "down";
    }
    return { kind: "stat" as const, text: formatStat(key, value), delta };
  });
}

function build(args: {
  name: string;
  quality: string;
  ilvl?: number | null;
  binding?: string | null;
  unique?: boolean;
  slot?: string | null;
  subtype?: string | null;
  armor?: number | null;
  damageMin?: number | null;
  damageMax?: number | null;
  speed?: number | null;
  dps?: number | null;
  stats?: StatBlock;
  compare?: StatBlock | null;
  effect?: string | null;
  enchant?: string | null;
  durability?: string | null;
  classes?: string[];
  req?: number | null;
  sellCopper?: number | null;
  source?: string;
  href?: string | null;
}): TipModel {
  const lines: TipLine[] = [{ kind: "name", text: args.name }];
  if (args.ilvl != null) lines.push({ kind: "ilvl", text: `Item Level ${args.ilvl}` });
  if (args.binding) lines.push({ kind: "binding", text: args.binding });
  if (args.unique) lines.push({ kind: "unique", text: "Unique" });
  const slot = slotLabel(args.slot);
  const subtype = args.subtype ? titleWord(args.subtype) : null;
  if (slot || subtype) lines.push({ kind: "slot", text: slot ?? "", right: subtype ?? undefined });
  if (args.armor) lines.push({ kind: "armor", text: `${Math.round(args.armor)} Armor` });
  if (args.damageMin != null && args.damageMax != null) {
    lines.push({
      kind: "weapon",
      text: `${args.damageMin} - ${args.damageMax} Damage`,
      right: args.speed != null ? `Speed ${args.speed.toFixed(2)}` : undefined,
    });
  } else if (args.speed != null) {
    lines.push({ kind: "weapon", text: `Speed ${args.speed.toFixed(2)}` });
  }
  if (args.dps != null) lines.push({ kind: "weapon", text: `(${args.dps.toFixed(1)} damage per second)` });
  lines.push(...statLines(args.stats ?? {}, args.compare ?? null));
  for (const effect of effectLines(args.effect)) lines.push({ kind: "effect", text: effect });
  if (args.enchant) lines.push({ kind: "enchant", text: args.enchant });
  if (args.durability) lines.push({ kind: "durability", text: args.durability });
  if (args.classes && args.classes.length) lines.push({ kind: "classes", text: `Classes: ${args.classes.map(titleWord).join(", ")}` });
  if (args.req != null) lines.push({ kind: "req", text: `Requires Level ${args.req}` });
  if (args.sellCopper != null) lines.push({ kind: "sell", text: sellText(args.sellCopper) });
  if (args.source !== undefined) lines.push({ kind: "source", text: args.source });
  return { quality: args.quality, lines, href: args.href ?? null };
}

function sellText(copper: number): string {
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const coins = copper % 100;
  const parts = [];
  if (gold) parts.push(`${gold}g`);
  if (silver || gold) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return `Sell Price: ${parts.join(" ")}`;
}

export function tooltipFromGear(item: GearItem, href: string | null, compare?: StatBlock | null): TipModel {
  return build({
    name: item.name,
    quality: qualityName(item.quality),
    ilvl: item.ilvl,
    unique: item.unique,
    slot: item.bucket,
    subtype: item.armor ?? item.weapon ?? null,
    armor: item.stats.armor,
    speed: item.speed,
    dps: item.dps,
    stats: item.stats,
    compare,
    effect: item.effect,
    classes: item.classes,
    req: item.req,
    source: item.source,
    href,
  });
}

export function tooltipFromEquipped(item: EquippedItem, href: string | null): TipModel {
  return build({
    name: item.name,
    quality: item.quality,
    ilvl: item.ilvl,
    slot: item.inventoryType ?? item.slot,
    subtype: item.armorType ?? item.weaponType,
    armor: item.stats.armor,
    speed: item.speed,
    dps: item.dps,
    stats: item.stats,
    effect: item.effect,
    enchant: item.enchant?.label,
    req: item.req,
    href,
  });
}
