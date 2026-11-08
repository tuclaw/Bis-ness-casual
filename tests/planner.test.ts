import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { characterFromArmoryState, parseArmoryHtml } from "../src/lib/armory.ts";
import { parseCharacterQuery } from "../src/lib/names.ts";
import { rankEntries, recommendEnchantments, recommendGear } from "../src/lib/recommend.ts";
import { scoreItem } from "../src/lib/score.ts";
import type { Enchant, GearItem, SavedProfile } from "../src/lib/types.ts";

const characters = JSON.parse(readFileSync(new URL("../src/data/characters.json", import.meta.url), "utf8")) as SavedProfile[];
const items = JSON.parse(readFileSync(new URL("../public/data/items.json", import.meta.url), "utf8")) as GearItem[];
const enchants = JSON.parse(readFileSync(new URL("../public/data/enchants.json", import.meta.url), "utf8")) as Enchant[];

function item(partial: Partial<GearItem> & Pick<GearItem, "id" | "name" | "req" | "bucket">): GearItem {
  return {
    quality: 3,
    ilvl: partial.req + 5,
    stats: {},
    faction: "both",
    pvp: false,
    unique: false,
    ...partial,
  };
}

describe("character names", () => {
  it("parses a two-part name and an Armory URL", () => {
    expect(parseCharacterQuery("Daz Dingomon")).toMatchObject({ slug: "daz-dingomon", region: null });
    expect(parseCharacterQuery("https://worldofwarcraft.blizzard.com/en-us/forever/eu/armory/character/mrs-dingomon")).toMatchObject({
      slug: "mrs-dingomon",
      region: "eu",
    });
  });

  it("rejects a single name", () => {
    expect(parseCharacterQuery("Daz")).toHaveProperty("error");
  });
});

describe("level window", () => {
  const pool = [
    item({ id: 1, name: "Low", req: 10, bucket: "chest", stats: { heal: 5 } }),
    item({ id: 2, name: "Band", req: 17, bucket: "chest", stats: { heal: 12 } }),
    item({ id: 3, name: "Best", req: 60, bucket: "chest", stats: { heal: 80 } }),
    item({ id: 4, name: "Also", req: 18, bucket: "chest", stats: { heal: 9 } }),
  ];

  it("keeps the overall best when the slider would hide it", () => {
    const ranked = rankEntries({
      entries: pool,
      scoreOf: (entry) => scoreItem(entry, "shaman-restoration"),
      level: 17,
      window: 2,
      equippedScore: 1,
    });
    expect(ranked[0]?.entry.name).toBe("Best");
    expect(ranked[0]?.overallBest).toBe(true);
    expect(ranked[0]?.outsideLevel).toBe(true);
    expect(ranked.filter((row) => !row.outsideLevel).every((row) => row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
    expect(ranked.filter((row) => !row.outsideLevel).length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(5);
  });
});

describe("spec scores", () => {
  it("ranks healing cloth over attack power leather for restoration", () => {
    const healing = item({ id: 1, name: "Heal", req: 60, bucket: "chest", armor: "cloth", stats: { int: 20, heal: 40, spi: 15 } });
    const melee = item({ id: 2, name: "Melee", req: 60, bucket: "chest", armor: "leather", stats: { agi: 20, ap: 40, sta: 20 } });
    expect(scoreItem(healing, "shaman-restoration")).toBeGreaterThan(scoreItem(melee, "shaman-restoration"));
    expect(scoreItem(melee, "shaman-enhancement")).toBeGreaterThan(scoreItem(healing, "shaman-enhancement"));
  });

  it("does not recommend Alliance PvP gear to a Horde character", () => {
    const ranked = recommendGear({
      items,
      spec: "shaman-restoration",
      faction: "horde",
      level: 60,
      window: 0,
      slot: "feet",
      equipped: null,
    });
    expect(ranked.every((row) => row.entry.faction !== "alliance")).toBe(true);
    expect(ranked.length).toBeGreaterThan(0);
  });
});

describe("enchants", () => {
  it("surfaces the best chest enchant outside a narrow level window", () => {
    const result = recommendEnchantments({
      enchants,
      spec: "mage-arcane",
      level: 17,
      window: 2,
      slot: "chest",
      equipped: null,
      equippedScore: null,
    });
    expect(result.available).toBe(true);
    const best = result.ranked.find((row) => row.overallBest);
    expect(best?.outsideLevel).toBe(true);
    expect(best?.entry.req).toBeGreaterThan(19);
    expect(result.ranked.filter((row) => !row.outsideLevel).every((row) => row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
  });

  it("has no head enchants and does have Forever necklace enchants", () => {
    expect(recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "head", equipped: null, equippedScore: null }).available).toBe(false);
    const necks = recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "neck", equipped: null, equippedScore: null });
    expect(necks.available).toBe(true);
    expect(necks.ranked.length).toBeGreaterThan(0);
    expect(necks.ranked.length).toBeLessThanOrEqual(5);
  });

  it("prefers frost damage for Frost PvP gloves and healing for restoration", () => {
    const frost = recommendEnchantments({ enchants, spec: "mage-frost-pvp", level: 60, window: 0, slot: "hands", equipped: null, equippedScore: null });
    const resto = recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 0, slot: "hands", equipped: null, equippedScore: null });
    expect(frost.ranked[0]?.entry.stats.frost ?? 0).toBeGreaterThan(0);
    expect((resto.ranked[0]?.entry.stats.heal ?? 0) + (resto.ranked[0]?.entry.stats.int ?? 0)).toBeGreaterThan(0);
  });
});

describe("seed characters", () => {
  it("loads both Horde PvP profiles with the saved specs and real gear", () => {
    const daz = characters.find((profile) => profile.slug === "daz-dingomon");
    const mrs = characters.find((profile) => profile.slug === "mrs-dingomon");
    expect(daz?.mainSpec).toBe("shaman-restoration");
    expect(daz?.offSpec).toBe("shaman-enhancement");
    expect(mrs?.mainSpec).toBe("mage-arcane");
    expect(mrs?.offSpec).toBe("mage-frost-pvp");
    expect(daz?.character.faction).toBe("horde");
    expect(daz?.character.ruleset).toBe("PvP");
    expect(daz?.character.gear.map((piece) => piece.name)).toContain("Satyrskin Cloak");
    expect(mrs?.character.gear.map((piece) => piece.name)).toContain("Staff of Orgrimmar");
    expect(mrs?.character.gear.find((piece) => piece.armorySlot === "wrist")?.enchant?.name).toBe("Enchant Bracer - Minor Deflect");
    expect(daz?.character.specs[0]?.talents.map((talent) => talent.name)).toContain("Tidal Focus");
  });
});

describe("armory html", () => {
  it("reads an embedded profile", () => {
    const html = `<script>var characterProfileInitialState = ${JSON.stringify({
      character: {
        name: "Daxan",
        surname: "Windfury",
        level: 20,
        class: { slug: "shaman", name: "Shaman" },
        race: { name: "Orc" },
        faction: { slug: "horde" },
        ruleset: { name: "Normal", rulesetId: 2 },
        region: "eu",
        gear: {},
        stats: { groups: [] },
        specs: [{ id: "elemental", name: "Elemental", spentPoints: 5, active: true, talents: [] }],
        professions: {},
      },
    })};</script>`;
    const state = parseArmoryHtml(html);
    expect(state).toBeTruthy();
    const character = characterFromArmoryState(state!);
    expect(character.surname).toBe("Windfury");
    expect(character.classId).toBe("shaman");
    expect(character.specs[0]?.name).toBe("Elemental");
  });
});
