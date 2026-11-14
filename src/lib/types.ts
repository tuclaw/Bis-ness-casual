export type Faction = "horde" | "alliance";

export type SpecId =
  | "warrior-arms"
  | "warrior-fury"
  | "warrior-protection"
  | "paladin-holy"
  | "paladin-protection"
  | "paladin-retribution"
  | "hunter-beast"
  | "hunter-marksmanship"
  | "hunter-survival"
  | "rogue-assassination"
  | "rogue-combat"
  | "rogue-subtlety"
  | "priest-discipline"
  | "priest-holy"
  | "priest-shadow"
  | "shaman-elemental"
  | "shaman-enhancement"
  | "shaman-restoration"
  | "mage-arcane"
  | "mage-fire"
  | "mage-frost"
  | "mage-frost-pvp"
  | "warlock-affliction"
  | "warlock-demonology"
  | "warlock-destruction"
  | "druid-balance"
  | "druid-feral"
  | "druid-restoration";

export type PlannerSlot =
  | "head"
  | "neck"
  | "shoulder"
  | "back"
  | "chest"
  | "wrist"
  | "hands"
  | "waist"
  | "legs"
  | "feet"
  | "finger"
  | "trinket"
  | "mainhand"
  | "offhand"
  | "ranged";

export type StatBlock = Record<string, number>;

export interface GearItem {
  id: number;
  name: string;
  quality: number;
  ilvl: number;
  req: number;
  bucket: string;
  stats: StatBlock;
  faction: "horde" | "alliance" | "both";
  pvp: boolean;
  unique: boolean;
  armor?: string;
  weapon?: string;
  dps?: number;
  speed?: number;
  classes?: string[];
  source?: string;
  effect?: string;
  changed?: "new" | "updated";
}

export interface Enchant {
  id: number;
  enchantId: number | null;
  name: string;
  slot: PlannerSlot;
  fit: "any" | "weapon" | "twohand" | "shield" | "holdable";
  stats: StatBlock;
  effect: string;
  req: number;
  skill: number;
  source: string;
  proc: boolean;
}

export interface EquippedEnchant {
  enchantId: number | null;
  name: string | null;
  label: string;
}

export interface EquippedItem {
  slot: PlannerSlot;
  armorySlot: string;
  itemId: number;
  name: string;
  quality: string;
  ilvl: number;
  req: number | null;
  armorType: string | null;
  weaponType: string | null;
  inventoryType: string | null;
  stats: StatBlock;
  dps: number | null;
  speed: number | null;
  effect: string | null;
  enchant: EquippedEnchant | null;
  iconUrl?: string | null;
}

export interface Talent {
  name: string;
  rank: number;
  description?: string;
}

export interface CharacterSpec {
  id: string;
  name: string;
  spent: number;
  active: boolean;
  talents: Talent[];
}

export interface DisplayStat {
  key: string;
  value: number;
  percent: boolean;
}

export interface Profession {
  name: string;
  skill: number | null;
  max: number | null;
  primary: boolean;
}

export interface NormalizedCharacter {
  name: string;
  surname: string;
  level: number;
  classId: string;
  className: string;
  race: string;
  gender: string | null;
  faction: Faction;
  ruleset: string | null;
  rulesetId: number | null;
  guild: string | null;
  ilvl: number | null;
  honorableKills: number | null;
  region: string;
  updatedAt: string | null;
  stats: DisplayStat[];
  specs: CharacterSpec[];
  gear: EquippedItem[];
  professions: Profession[];
  portraitUrl?: string | null;
  modelUrl?: string | null;
  backdropUrl?: string | null;
}

export type ProfileSource = "armory-snapshot" | "armory-live" | "forever-tool" | "pasted" | "blizzard-api";

export interface SavedProfile {
  slug: string;
  region: string;
  armoryUrl: string;
  fetchedAt: string;
  source: ProfileSource;
  sourceNote?: string;
  mainSpec: SpecId;
  offSpec: SpecId | null;
  /** Repo-relative Armory full-body render, for example characters/daz-dingomon.png. */
  renderFile?: string;
  /** Short hash of the render bytes. The site appends it so a new image is not cached. */
  renderHash?: string;
  avatarFile?: string;
  avatarHash?: string;
  character: NormalizedCharacter;
}
