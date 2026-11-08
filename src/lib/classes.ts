import type { SpecId } from "./types.ts";

export interface ClassInfo {
  id: string;
  name: string;
  color: string;
  mailAt?: number;
  plateAt?: number;
  shield: boolean;
  holdable: boolean;
  dualWield: boolean;
  twoHand: boolean;
  weapons: string[];
  ranged: string[];
}

export interface SpecInfo {
  id: SpecId;
  classId: string;
  name: string;
  armor: string[];
  note?: string;
}

export const CLASSES: Record<string, ClassInfo> = {
  warrior: {
    id: "warrior",
    name: "Warrior",
    color: "#c69b6d",
    plateAt: 40,
    shield: true,
    holdable: false,
    dualWield: true,
    twoHand: true,
    weapons: ["sword", "mace", "axe", "dagger", "fist", "polearm", "staff"],
    ranged: ["bow", "gun", "crossbow", "thrown"],
  },
  paladin: {
    id: "paladin",
    name: "Paladin",
    color: "#f48cba",
    plateAt: 40,
    shield: true,
    holdable: false,
    dualWield: false,
    twoHand: true,
    weapons: ["sword", "mace", "polearm"],
    ranged: ["libram"],
  },
  hunter: {
    id: "hunter",
    name: "Hunter",
    color: "#aad372",
    mailAt: 40,
    shield: false,
    holdable: false,
    dualWield: true,
    twoHand: true,
    weapons: ["sword", "axe", "dagger", "fist", "polearm", "staff"],
    ranged: ["bow", "gun", "crossbow"],
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    color: "#fff468",
    shield: false,
    holdable: false,
    dualWield: true,
    twoHand: false,
    weapons: ["sword", "mace", "dagger", "fist"],
    ranged: ["bow", "gun", "crossbow", "thrown"],
  },
  priest: {
    id: "priest",
    name: "Priest",
    color: "#f0ebe0",
    shield: false,
    holdable: true,
    dualWield: false,
    twoHand: true,
    weapons: ["staff", "mace", "dagger"],
    ranged: ["wand"],
  },
  shaman: {
    id: "shaman",
    name: "Shaman",
    color: "#0070dd",
    mailAt: 40,
    shield: true,
    holdable: true,
    dualWield: false,
    twoHand: true,
    weapons: ["staff", "mace", "axe", "dagger", "fist"],
    ranged: ["totem"],
  },
  mage: {
    id: "mage",
    name: "Mage",
    color: "#3fc7eb",
    shield: false,
    holdable: true,
    dualWield: false,
    twoHand: true,
    weapons: ["staff", "sword", "dagger"],
    ranged: ["wand"],
  },
  warlock: {
    id: "warlock",
    name: "Warlock",
    color: "#8788ee",
    shield: false,
    holdable: true,
    dualWield: false,
    twoHand: true,
    weapons: ["staff", "sword", "dagger"],
    ranged: ["wand"],
  },
  druid: {
    id: "druid",
    name: "Druid",
    color: "#ff7c0a",
    shield: false,
    holdable: true,
    dualWield: false,
    twoHand: true,
    weapons: ["staff", "mace", "dagger", "fist", "polearm"],
    ranged: ["idol"],
  },
};

export const SPECS: SpecInfo[] = [
  { id: "warrior-arms", classId: "warrior", name: "Arms", armor: ["mail", "plate"] },
  { id: "warrior-fury", classId: "warrior", name: "Fury", armor: ["mail", "plate"] },
  { id: "warrior-protection", classId: "warrior", name: "Protection", armor: ["mail", "plate"] },
  { id: "paladin-holy", classId: "paladin", name: "Holy", armor: ["cloth", "leather", "mail", "plate"] },
  { id: "paladin-protection", classId: "paladin", name: "Protection", armor: ["mail", "plate"] },
  { id: "paladin-retribution", classId: "paladin", name: "Retribution", armor: ["leather", "mail", "plate"] },
  { id: "hunter-beast", classId: "hunter", name: "Beast Mastery", armor: ["leather", "mail"] },
  { id: "hunter-marksmanship", classId: "hunter", name: "Marksmanship", armor: ["leather", "mail"] },
  { id: "hunter-survival", classId: "hunter", name: "Survival", armor: ["leather", "mail"] },
  { id: "rogue-assassination", classId: "rogue", name: "Assassination", armor: ["leather"] },
  { id: "rogue-combat", classId: "rogue", name: "Combat", armor: ["leather"] },
  { id: "rogue-subtlety", classId: "rogue", name: "Subtlety", armor: ["leather"] },
  { id: "priest-discipline", classId: "priest", name: "Discipline", armor: ["cloth"] },
  { id: "priest-holy", classId: "priest", name: "Holy", armor: ["cloth"] },
  { id: "priest-shadow", classId: "priest", name: "Shadow", armor: ["cloth"] },
  { id: "shaman-elemental", classId: "shaman", name: "Elemental", armor: ["cloth", "leather", "mail"] },
  { id: "shaman-enhancement", classId: "shaman", name: "Enhancement", armor: ["leather", "mail"] },
  { id: "shaman-restoration", classId: "shaman", name: "Restoration", armor: ["cloth", "leather", "mail"] },
  { id: "mage-arcane", classId: "mage", name: "Arcane", armor: ["cloth"] },
  { id: "mage-fire", classId: "mage", name: "Fire", armor: ["cloth"] },
  { id: "mage-frost", classId: "mage", name: "Frost", armor: ["cloth"] },
  {
    id: "mage-frost-pvp",
    classId: "mage",
    name: "Frost (PvP)",
    armor: ["cloth"],
    note: "Frost damage, with extra weight on stamina and other survivability.",
  },
  { id: "warlock-affliction", classId: "warlock", name: "Affliction", armor: ["cloth"] },
  { id: "warlock-demonology", classId: "warlock", name: "Demonology", armor: ["cloth"] },
  { id: "warlock-destruction", classId: "warlock", name: "Destruction", armor: ["cloth"] },
  { id: "druid-balance", classId: "druid", name: "Balance", armor: ["leather"] },
  { id: "druid-feral", classId: "druid", name: "Feral Combat", armor: ["leather"] },
  { id: "druid-restoration", classId: "druid", name: "Restoration", armor: ["leather"] },
];

const SPEC_MAP = new Map(SPECS.map((spec) => [spec.id, spec]));

export function specById(id: SpecId): SpecInfo {
  const spec = SPEC_MAP.get(id);
  if (!spec) throw new Error(`Unknown spec ${id}`);
  return spec;
}

export function classById(id: string): ClassInfo | undefined {
  return CLASSES[id];
}

export function specsForClass(classId: string): SpecInfo[] {
  return SPECS.filter((spec) => spec.classId === classId);
}

export function defaultSpecForClass(classId: string): SpecId {
  return specsForClass(classId)[0]?.id ?? "mage-arcane";
}

const ARMORY_SPEC: Record<string, SpecId> = {
  "shaman:elemental": "shaman-elemental",
  "shaman:enhancement": "shaman-enhancement",
  "shaman:restoration": "shaman-restoration",
  "mage:arcane": "mage-arcane",
  "mage:fire": "mage-fire",
  "mage:frost": "mage-frost",
  "warrior:arms": "warrior-arms",
  "warrior:fury": "warrior-fury",
  "warrior:protection": "warrior-protection",
  "paladin:holy": "paladin-holy",
  "paladin:protection": "paladin-protection",
  "paladin:retribution": "paladin-retribution",
  "hunter:beast mastery": "hunter-beast",
  "hunter:marksmanship": "hunter-marksmanship",
  "hunter:survival": "hunter-survival",
  "rogue:assassination": "rogue-assassination",
  "rogue:combat": "rogue-combat",
  "rogue:subtlety": "rogue-subtlety",
  "priest:discipline": "priest-discipline",
  "priest:holy": "priest-holy",
  "priest:shadow": "priest-shadow",
  "warlock:affliction": "warlock-affliction",
  "warlock:demonology": "warlock-demonology",
  "warlock:destruction": "warlock-destruction",
  "druid:balance": "druid-balance",
  "druid:feral combat": "druid-feral",
  "druid:feral": "druid-feral",
  "druid:restoration": "druid-restoration",
};

export function specFromArmory(classId: string, specName: string): SpecId | null {
  const key = `${classId}:${specName.trim().toLowerCase()}`;
  return ARMORY_SPEC[key] ?? null;
}

export function weaponKind(raw?: string | null): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (text.includes("fist")) return "fist";
  if (text.includes("staff")) return "staff";
  if (text.includes("dagger")) return "dagger";
  if (text.includes("polearm")) return "polearm";
  if (text.includes("crossbow")) return "crossbow";
  if (text.includes("bow")) return "bow";
  if (text.includes("gun")) return "gun";
  if (text.includes("wand")) return "wand";
  if (text.includes("thrown")) return "thrown";
  if (text.includes("totem")) return "totem";
  if (text.includes("libram")) return "libram";
  if (text.includes("idol")) return "idol";
  if (text.includes("shield")) return "shield";
  if (text.includes("sword")) return "sword";
  if (text.includes("mace")) return "mace";
  if (text.includes("axe")) return "axe";
  return text;
}
