import { defaultSpecForClass, specFromArmory } from "./classes.ts";
import type {
  EquippedItem,
  Faction,
  NormalizedCharacter,
  PlannerSlot,
  SavedProfile,
  SpecId,
  StatBlock,
} from "./types.ts";

const CLASS_BY_NUMBER: Record<number, string> = {
  1: "warrior",
  2: "paladin",
  3: "hunter",
  4: "rogue",
  5: "priest",
  7: "shaman",
  8: "mage",
  9: "warlock",
  11: "druid",
};

const ARMORY_SLOT: Record<string, { slot: PlannerSlot; armorySlot: string }> = {
  head: { slot: "head", armorySlot: "head" },
  neck: { slot: "neck", armorySlot: "neck" },
  shoulder: { slot: "shoulder", armorySlot: "shoulder" },
  back: { slot: "back", armorySlot: "back" },
  chest: { slot: "chest", armorySlot: "chest" },
  wrist: { slot: "wrist", armorySlot: "wrist" },
  hand: { slot: "hands", armorySlot: "hand" },
  hands: { slot: "hands", armorySlot: "hand" },
  waist: { slot: "waist", armorySlot: "waist" },
  leg: { slot: "legs", armorySlot: "leg" },
  legs: { slot: "legs", armorySlot: "leg" },
  foot: { slot: "feet", armorySlot: "foot" },
  feet: { slot: "feet", armorySlot: "foot" },
  finger1: { slot: "finger", armorySlot: "finger1" },
  finger2: { slot: "finger", armorySlot: "finger2" },
  leftFinger: { slot: "finger", armorySlot: "finger1" },
  rightFinger: { slot: "finger", armorySlot: "finger2" },
  trinket1: { slot: "trinket", armorySlot: "trinket1" },
  trinket2: { slot: "trinket", armorySlot: "trinket2" },
  weapon: { slot: "mainhand", armorySlot: "weapon" },
  offhand: { slot: "offhand", armorySlot: "offhand" },
  ranged: { slot: "ranged", armorySlot: "ranged" },
};

const TOOL_SLOT: Record<string, { slot: PlannerSlot; armorySlot: string }> = {
  HEAD: { slot: "head", armorySlot: "head" },
  NECK: { slot: "neck", armorySlot: "neck" },
  SHOULDER: { slot: "shoulder", armorySlot: "shoulder" },
  BACK: { slot: "back", armorySlot: "back" },
  CHEST: { slot: "chest", armorySlot: "chest" },
  WRIST: { slot: "wrist", armorySlot: "wrist" },
  HANDS: { slot: "hands", armorySlot: "hand" },
  WAIST: { slot: "waist", armorySlot: "waist" },
  LEGS: { slot: "legs", armorySlot: "leg" },
  FEET: { slot: "feet", armorySlot: "foot" },
  FINGER_1: { slot: "finger", armorySlot: "finger1" },
  FINGER_2: { slot: "finger", armorySlot: "finger2" },
  TRINKET_1: { slot: "trinket", armorySlot: "trinket1" },
  TRINKET_2: { slot: "trinket", armorySlot: "trinket2" },
  MAIN_HAND: { slot: "mainhand", armorySlot: "weapon" },
  OFF_HAND: { slot: "offhand", armorySlot: "offhand" },
  RANGED: { slot: "ranged", armorySlot: "ranged" },
};

const STAT_MAP: Record<string, string> = {
  STAMINA: "sta",
  AGILITY: "agi",
  STRENGTH: "str",
  INTELLECT: "int",
  SPIRIT: "spi",
  SPELL_POWER: "sp",
  SPELL_DAMAGE_DONE: "sd",
  SPELL_HEALING_DONE: "heal",
  ATTACK_POWER: "ap",
  BONUS_STAT_ATTACK_POWER_VS_BEAST: "apBeast",
  FIRE_RESISTANCE: "fireRes",
  FROST_RESISTANCE: "frostRes",
  NATURE_RESISTANCE: "natureRes",
  SHADOW_RESISTANCE: "shadowRes",
  ARCANE_RESISTANCE: "arcaneRes",
};

export class ImportError extends Error {
  attempts: string[];

  constructor(message: string, attempts: string[]) {
    super(message);
    this.name = "ImportError";
    this.attempts = attempts;
  }
}

export function parseArmoryHtml(html: string): Record<string, unknown> | null {
  const marker = "characterProfileInitialState = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let index = start + marker.length;
  while (html[index] === " ") index += 1;
  if (html[index] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < html.length; cursor += 1) {
    const char = html[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(index, cursor + 1)) as Record<string, unknown>;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedNumber(value: unknown): number | null {
  const record = asRecord(value);
  return record ? num(record.value) : null;
}

export function characterFromArmoryState(state: Record<string, unknown>): NormalizedCharacter {
  const character = asRecord(state.character);
  if (!character) throw new Error("Armory payload has no character.");
  const gear: EquippedItem[] = [];
  const gearMap = asRecord(character.gear) ?? {};
  for (const [key, raw] of Object.entries(gearMap)) {
    const mapped = ARMORY_SLOT[key];
    const piece = asRecord(raw);
    if (!mapped || !piece) continue;
    const stats: StatBlock = {};
    for (const stat of Array.isArray(piece.stats) ? piece.stats : []) {
      const row = asRecord(stat);
      const type = asRecord(row?.type);
      const kind = text(type?.type)?.replace(/,+$/, "").toUpperCase();
      const mapped = kind ? STAT_MAP[kind] : undefined;
      const value = num(row?.value);
      if (mapped && value) stats[mapped] = (stats[mapped] ?? 0) + value;
    }
    const armor = nestedNumber(piece.armor);
    if (armor) stats.armor = (stats.armor ?? 0) + armor;
    const weapon = asRecord(piece.weapon);
    const dps = nestedNumber(weapon?.dps);
    const speedRaw = nestedNumber(asRecord(weapon?.attack_speed));
    const speed = speedRaw == null ? null : speedRaw > 20 ? speedRaw / 1000 : speedRaw;
    const effects = (Array.isArray(piece.spells) ? piece.spells : [])
      .map((spell) => text(asRecord(spell)?.description))
      .filter((line): line is string => Boolean(line));
    const enchantRaw = (Array.isArray(piece.enchantments) ? piece.enchantments : [])
      .map(asRecord)
      .find(Boolean);
    const itemClass = text(asRecord(piece.item_class)?.name);
    const subclass = text(asRecord(piece.item_subclass)?.name);
    const item = asRecord(piece.item);
    const media = asRecord(asRecord(piece.media)?.content);
    const iconAsset = (Array.isArray(media?.assets) ? media.assets : [])
      .map(asRecord)
      .find((asset) => text(asset?.key) === "icon");
    gear.push({
      slot: mapped.slot,
      armorySlot: mapped.armorySlot,
      itemId: num(item?.id) ?? num(piece.id) ?? 0,
      name: text(piece.name) ?? "Unknown item",
      iconUrl: text(iconAsset?.value),
      quality: (text(asRecord(piece.quality)?.type) ?? "COMMON").toLowerCase(),
      ilvl: nestedNumber(piece.level) ?? 0,
      req: nestedNumber(asRecord(piece.requirements)?.level),
      armorType: itemClass === "Armor" && subclass ? subclass.toLowerCase() : null,
      weaponType: itemClass === "Weapon" && subclass ? subclass.toLowerCase() : null,
      inventoryType: text(asRecord(piece.inventory_type)?.type),
      stats,
      dps,
      speed,
      effect: effects.join(" ") || null,
      enchant: enchantRaw
        ? {
            enchantId: num(enchantRaw.enchantment_id),
            name: text(asRecord(enchantRaw.source_item)?.name),
            label: text(enchantRaw.display_string) ?? "Enchanted",
          }
        : null,
    });
  }

  const display = [];
  const statRoot = asRecord(character.stats);
  for (const group of Array.isArray(statRoot?.groups) ? statRoot.groups : []) {
    const groupRecord = asRecord(group);
    for (const stat of Array.isArray(groupRecord?.stats) ? groupRecord.stats : []) {
      const row = asRecord(stat);
      const value = asRecord(row?.value);
      const amount = num(value?.value);
      if (amount == null || value?.type === "RANGE") continue;
      display.push({
        key: text(row?.enum) ?? text(row?.slug) ?? "STAT",
        value: amount,
        percent: value?.type === "PERCENTAGE",
      });
    }
  }

  const specs = (Array.isArray(character.specs) ? character.specs : []).map((spec) => {
    const row = asRecord(spec) ?? {};
    return {
      id: text(row.id) ?? "",
      name: text(row.name) ?? "Spec",
      spent: num(row.spentPoints) ?? 0,
      active: Boolean(row.active),
      talents: (Array.isArray(row.talents) ? row.talents : []).map((talent) => {
        const talentRow = asRecord(talent) ?? {};
        return {
          name: text(talentRow.name) ?? "Talent",
          rank: num(talentRow.rank) ?? 0,
          description: text(talentRow.description) ?? undefined,
        };
      }),
    };
  });

  const professions = [];
  const profRoot = asRecord(character.professions);
  const primaries = Array.isArray(profRoot?.primaries) ? profRoot.primaries : [];
  const secondaries = Array.isArray(profRoot?.secondaries) ? profRoot.secondaries : [];
  for (const prof of [...primaries, ...secondaries]) {
    const row = asRecord(prof) ?? {};
    const tier = asRecord((Array.isArray(row.tiers) ? row.tiers : [])[0]);
    professions.push({
      name: text(row.name) ?? "Profession",
      skill: num(tier?.skillPoints),
      max: num(tier?.maxSkillPoints),
      primary: primaries.includes(prof),
    });
  }

  const updated = asRecord(character.lastUpdatedTimestamp);
  const render = asRecord(character.render);
  const cls = asRecord(character.class);
  const race = asRecord(character.race);
  const faction = asRecord(character.faction);
  const ruleset = asRecord(character.ruleset);
  const guild = asRecord(character.guild);
  const pvp = asRecord(character.pvp);
  const kills = asRecord(pvp?.honorableKills);
  const factionSlug = (text(faction?.slug) ?? text(faction?.name) ?? "horde").toLowerCase();
  return {
    name: text(character.name) ?? "Unknown",
    surname: text(character.surname) ?? "",
    level: num(character.level) ?? 1,
    classId: (text(cls?.slug) ?? "mage").toLowerCase(),
    className: text(cls?.name) ?? "Mage",
    race: text(race?.name) ?? "Unknown",
    gender: text(asRecord(character.gender)?.name),
    faction: factionSlug === "alliance" ? "alliance" : "horde",
    ruleset: text(ruleset?.name),
    rulesetId: num(ruleset?.rulesetId),
    guild: text(guild?.name),
    ilvl: num(character.averageItemLevel),
    honorableKills: num(kills?.value),
    region: text(character.region) ?? "us",
    updatedAt: text(updated?.iso8601),
    stats: display,
    specs,
    gear,
    professions,
    portraitUrl: text(asRecord(character.avatar)?.url),
    modelUrl: text(asRecord(render?.foreground)?.url),
    backdropUrl: text(asRecord(render?.background)?.url),
  };
}

function parseLooseStat(line: string): [string, number] | null {
  const match = line.match(/([+-]?\d+(?:\.\d+)?)\s+([A-Za-z ]+)/);
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1]);
  const label = match[2].trim().toLowerCase();
  const key =
    label === "stamina"
      ? "sta"
      : label === "agility"
        ? "agi"
        : label === "strength"
          ? "str"
          : label === "intellect"
            ? "int"
            : label === "spirit"
              ? "spi"
              : label === "spell power"
                ? "sp"
                : label === "spell damage"
                  ? "sd"
                  : label === "spell healing"
                    ? "heal"
                    : label === "attack power"
                      ? "ap"
                      : label === "defense"
                        ? "def"
                        : null;
  return key ? [key, value] : null;
}

export function characterFromForeverTool(payload: Record<string, unknown>, region: string): NormalizedCharacter {
  const summary = asRecord(payload.summary);
  if (!summary) throw new Error("Forever Tool response has no summary.");
  const full = text(summary.name) ?? "";
  const parts = full.split(/\s+/);
  const classId = CLASS_BY_NUMBER[num(summary.classId) ?? 8] ?? "mage";
  const gear: EquippedItem[] = [];
  for (const raw of Array.isArray(payload.equipment) ? payload.equipment : []) {
    const row = asRecord(raw);
    if (!row) continue;
    const mapped = TOOL_SLOT[text(row.slotType) ?? ""];
    if (!mapped) continue;
    const stats: StatBlock = {};
    for (const line of Array.isArray(row.stats) ? row.stats : []) {
      if (typeof line !== "string") continue;
      const parsed = parseLooseStat(line);
      if (parsed) stats[parsed[0]] = (stats[parsed[0]] ?? 0) + parsed[1];
    }
    const enchantLine = (Array.isArray(row.enchants) ? row.enchants : []).find((line) => typeof line === "string") as
      | string
      | undefined;
    gear.push({
      slot: mapped.slot,
      armorySlot: mapped.armorySlot,
      itemId: num(row.id) ?? 0,
      name: text(row.name) ?? "Unknown item",
      quality: (text(row.q) ?? "COMMON").toLowerCase(),
      ilvl: num(row.level) ?? 0,
      req: null,
      armorType: null,
      weaponType: null,
      inventoryType: text(row.slotType),
      stats,
      dps: null,
      speed: null,
      effect: null,
      enchant: enchantLine ? { enchantId: null, name: null, label: enchantLine } : null,
    });
  }
  const stats = (Array.isArray(payload.stats) ? payload.stats : []).flatMap((raw) => {
    const row = asRecord(raw);
    const value = num(row?.value);
    if (!row || value == null) return [];
    return [{ key: text(row.key) ?? "STAT", value, percent: text(row.type) === "PERCENTAGE" }];
  });
  const specs = (Array.isArray(payload.talents) ? payload.talents : []).flatMap((raw) => {
    const block = asRecord(raw);
    return (Array.isArray(block?.trees) ? block.trees : []).map((tree) => {
      const row = asRecord(tree) ?? {};
      return {
        id: text(row.slug) ?? "",
        name: text(row.name) ?? "Spec",
        spent: num(row.spent) ?? 0,
        active: Boolean(block?.active),
        talents: (Array.isArray(row.talents) ? row.talents : []).map((talent) => {
          const talentRow = asRecord(talent) ?? {};
          return { name: text(talentRow.name) ?? "Talent", rank: num(talentRow.rank) ?? 0 };
        }),
      };
    });
  });
  const faction = (text(summary.faction) ?? "HORDE").toLowerCase() === "alliance" ? "alliance" : "horde";
  return {
    name: parts[0] || "Unknown",
    surname: parts.slice(1).join(" "),
    level: num(summary.level) ?? 1,
    classId,
    className: text(summary.className) ?? classId,
    race: text(summary.race) ?? "Unknown",
    gender: text(summary.gender),
    faction,
    ruleset: text(summary.ruleset),
    rulesetId: null,
    guild: text(summary.guild),
    ilvl: num(summary.itemLevel),
    honorableKills: num(summary.hk),
    region,
    updatedAt: typeof summary.updatedAt === "number" ? new Date(summary.updatedAt).toISOString() : null,
    stats,
    specs,
    gear,
    professions: (Array.isArray(payload.professions) ? payload.professions : []).flatMap((raw) => {
      const row = asRecord(raw);
      if (!row) return [];
      return [
        {
          name: text(row.name) ?? "Profession",
          skill: num(row.skill),
          max: num(row.max),
          primary: Boolean(row.primary),
        },
      ];
    }),
  };
}

export function profileFromCharacter(
  character: NormalizedCharacter,
  meta: { slug: string; region: string; source: SavedProfile["source"]; note?: string; mainSpec?: SpecId; offSpec?: SpecId | null },
): SavedProfile {
  const active = character.specs.find((spec) => spec.active) ?? character.specs[0];
  const fromArmory = active ? specFromArmory(character.classId, active.name) : null;
  const mainSpec = meta.mainSpec ?? fromArmory ?? defaultSpecForClass(character.classId);
  return {
    slug: meta.slug,
    region: meta.region,
    armoryUrl: `https://worldofwarcraft.blizzard.com/en-us/forever/${meta.region}/armory/character/${meta.slug}`,
    fetchedAt: new Date().toISOString(),
    source: meta.source,
    sourceNote: meta.note,
    mainSpec,
    offSpec: meta.offSpec === undefined ? null : meta.offSpec,
    character,
  };
}

export async function importCharacter(slug: string, region: string): Promise<SavedProfile> {
  const path = `/en-us/forever/${region}/armory/character/${slug}`;
  const attempts: string[] = [];
  const candidates = [
    { label: "local dev proxy", url: `/armory-proxy${path}` },
    { label: "official Armory", url: `https://worldofwarcraft.blizzard.com${path}` },
    {
      label: "Forever Tool",
      url: `https://forever-tool.com/api/character?name=${encodeURIComponent(slug)}&region=${region}&locale=en_US`,
    },
  ];
  let lastStatus = "";
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url);
      const body = await response.text();
      attempts.push(`${candidate.label}: HTTP ${response.status}`);
      if (!response.ok) {
        lastStatus = `${candidate.label} returned ${response.status}`;
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json") || body.trim().startsWith("{")) {
        const payload = JSON.parse(body) as Record<string, unknown>;
        if (payload.ok === true && payload.summary) {
          const character = characterFromForeverTool(payload, region);
          return profileFromCharacter(character, {
            slug,
            region,
            source: "forever-tool",
            note: "Gear and stats from Forever Tool, which reads the official Armory. Weapon damage and required level are not in that summary.",
          });
        }
        if (payload.character) {
          const character = characterFromArmoryState(payload);
          return profileFromCharacter(character, { slug, region, source: "armory-live" });
        }
      }
      const state = parseArmoryHtml(body);
      if (state) {
        const character = characterFromArmoryState(state);
        return profileFromCharacter(character, {
          slug,
          region,
          source: "armory-live",
          note: "Read from the official Armory page.",
        });
      }
      lastStatus = `${candidate.label} responded without a character profile`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      attempts.push(`${candidate.label}: ${message}`);
      lastStatus = message;
    }
  }
  throw new ImportError(
    `No Forever profile for ${slug} on ${region.toUpperCase()}. ${lastStatus}. The public Armory does not allow browser fetches from another site (no CORS header), and profiles only exist after a character reaches level 10 and logs out.`,
    attempts,
  );
}

export function profileFromPaste(text: string, fallbackRegion = "us"): SavedProfile {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste the Armory page source or its character JSON.");
  const htmlState = parseArmoryHtml(trimmed);
  if (htmlState) {
    const character = characterFromArmoryState(htmlState);
    const slug = `${character.name}-${character.surname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return profileFromCharacter(character, {
      slug,
      region: character.region || fallbackRegion,
      source: "pasted",
      note: "Pasted from an official Armory page. Equipped items are whatever that page contained.",
    });
  }
  const payload = JSON.parse(trimmed) as Record<string, unknown>;
  if (payload.character) {
    const character = characterFromArmoryState(payload);
    const slug = `${character.name}-${character.surname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return profileFromCharacter(character, {
      slug,
      region: character.region || fallbackRegion,
      source: "pasted",
    });
  }
  if (payload.ok === true && payload.summary) {
    const character = characterFromForeverTool(payload, fallbackRegion);
    const slug = `${character.name}-${character.surname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return profileFromCharacter(character, { slug, region: fallbackRegion, source: "pasted" });
  }
  throw new Error("That paste is not an Armory character profile.");
}

export function factionOf(character: NormalizedCharacter): Faction {
  return character.faction === "alliance" ? "alliance" : "horde";
}
