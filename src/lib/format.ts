const LABELS: Record<string, string> = {
  str: "Strength",
  agi: "Agility",
  int: "Intellect",
  spi: "Spirit",
  sta: "Stamina",
  sp: "Spell power",
  sd: "Spell damage",
  heal: "Healing",
  fire: "Fire damage",
  frost: "Frost damage",
  arcane: "Arcane damage",
  nature: "Nature damage",
  shadow: "Shadow damage",
  holy: "Holy damage",
  ap: "Attack power",
  apBeast: "AP vs beasts",
  crit: "Crit",
  spellCrit: "Spell crit",
  meleeHit: "Melee hit",
  spellHit: "Spell hit",
  mp5: "Mana per 5",
  armor: "Armor",
  def: "Defense",
  dodge: "Dodge",
  block: "Block",
  haste: "Haste",
  moveSpeed: "Speed",
  wpnDamage: "Weapon damage",
  absorb: "Absorb",
  resAll: "All resistance",
  fireRes: "Fire resistance",
  frostRes: "Frost resistance",
  natureRes: "Nature resistance",
  shadowRes: "Shadow resistance",
  arcaneRes: "Arcane resistance",
};

const PERCENT = new Set(["crit", "spellCrit", "meleeHit", "spellHit", "dodge", "block", "haste", "moveSpeed"]);

export function formatStat(key: string, value: number): string {
  const label = LABELS[key] ?? key;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (PERCENT.has(key)) return `${shown}% ${label}`;
  if (key === "armor" || key === "mp5") return `${shown} ${label}`;
  return `+${shown} ${label}`;
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function qualityName(quality: number | string): string {
  if (typeof quality === "string") return quality;
  return ["poor", "common", "uncommon", "rare", "epic", "legendary"][quality] ?? "common";
}

const STAT_PRIORITY = [
  "HEALTH",
  "MANA",
  "STRENGTH",
  "AGILITY",
  "INTELLECT",
  "STAMINA",
  "SPELLPOWER",
  "ATTACKPOWER",
  "ARMOR",
  "CRITICALSTRIKE",
  "MANAREGEN",
];

export function statLabel(key: string): string {
  const labels: Record<string, string> = {
    HEALTH: "Health",
    MANA: "Mana",
    STRENGTH: "Strength",
    AGILITY: "Agility",
    INTELLECT: "Intellect",
    STAMINA: "Stamina",
    SPELLPOWER: "Spell power",
    ATTACKPOWER: "Attack power",
    ARMOR: "Armor",
    CRITICALSTRIKE: "Crit",
    MANAREGEN: "Mana regen",
    DODGE: "Dodge",
    PARRY: "Parry",
    BLOCK: "Block",
    ITEMLEVEL: "Item level",
  };
  return labels[key] ?? key.toLowerCase();
}

export function preferredStatOrder(key: string): number {
  const index = STAT_PRIORITY.indexOf(key);
  return index === -1 ? 50 : index;
}

/** Large Forever/Wowhead icon file, 56px, the size the Armory uses. */
export function wowheadIconUrl(icon: string): string {
  const file = icon.toLowerCase().replace(/\.jpg$/, "");
  return `https://wow.zamimg.com/images/wow/icons/large/${file}.jpg`;
}

/** Full Forever Wowhead item page, including the name slug. */
export function wowheadItemUrl(id: number, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://www.wowhead.com/forever/item=${id}/${slug}`;
}
