import { formatStat } from "./format.ts";
import type { Enchant, GearItem, SpecId, StatBlock } from "./types.ts";
import { weightFor } from "./weights.ts";

export function topStatLines(stats: StatBlock, spec: SpecId, limit = 4): string[] {
  return Object.entries(stats)
    .filter(([, value]) => value)
    .map(([key, value]) => ({ key, value, weight: Math.abs(value * weightFor(spec, key)) }))
    .sort((a, b) => b.weight - a.weight || b.value - a.value)
    .slice(0, limit)
    .map((row) => formatStat(row.key, row.value));
}

export function scoreStats(stats: StatBlock, spec: SpecId, dps = 0): number {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (!value) continue;
    total += value * weightFor(spec, key);
  }
  if (dps) total += dps * weightFor(spec, "dps");
  return total;
}

export function scoreItem(item: GearItem, spec: SpecId): number {
  let total = scoreStats(item.stats, spec, item.dps ?? 0);
  total += item.ilvl * 0.001 + item.quality * 0.0001;
  if (item.pvp && (spec === "mage-frost-pvp" || spec === "shaman-enhancement")) {
    total += spec === "mage-frost-pvp" ? 2 : 1.25;
  }
  return total;
}

export function scoreEnchant(enchant: Enchant, spec: SpecId): number {
  return scoreStats(enchant.stats, spec, 0);
}

export function equippedEnchantStats(label: string): StatBlock {
  const stats: StatBlock = {};
  const patterns: Array<[RegExp, string]> = [
    [/stamina \+?\s*(\d+(?:\.\d+)?)/i, "sta"],
    [/(\d+(?:\.\d+)?)\s+stamina/i, "sta"],
    [/agility \+?\s*(\d+(?:\.\d+)?)/i, "agi"],
    [/(\d+(?:\.\d+)?)\s+agility/i, "agi"],
    [/strength \+?\s*(\d+(?:\.\d+)?)/i, "str"],
    [/(\d+(?:\.\d+)?)\s+strength/i, "str"],
    [/intellect \+?\s*(\d+(?:\.\d+)?)/i, "int"],
    [/(\d+(?:\.\d+)?)\s+intellect/i, "int"],
    [/spirit \+?\s*(\d+(?:\.\d+)?)/i, "spi"],
    [/(\d+(?:\.\d+)?)\s+spirit/i, "spi"],
    [/defense \+?\s*(\d+(?:\.\d+)?)/i, "def"],
    [/(\d+(?:\.\d+)?)\s+defense/i, "def"],
    [/spell power \+?\s*(\d+(?:\.\d+)?)/i, "sp"],
    [/(\d+(?:\.\d+)?)\s+spell power/i, "sp"],
    [/spell damage \+?\s*(\d+(?:\.\d+)?)/i, "sd"],
    [/spell healing \+?\s*(\d+(?:\.\d+)?)/i, "heal"],
    [/attack power \+?\s*(\d+(?:\.\d+)?)/i, "ap"],
  ];
  for (const [pattern, key] of patterns) {
    const match = label.match(pattern);
    if (match?.[1]) stats[key] = (stats[key] ?? 0) + Number(match[1]);
  }
  return stats;
}
