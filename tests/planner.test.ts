import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { characterFromArmoryState, parseArmoryHtml } from "../src/lib/armory.ts";
import { parseCharacterQuery } from "../src/lib/names.ts";
import { wowheadIconUrl, wowheadItemUrl } from "../src/lib/format.ts";
import { bisLongevity, longevityLabel, rankEntries, recommendEnchantments, recommendGear } from "../src/lib/recommend.ts";
import { classById, specById } from "../src/lib/classes.ts";
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

  it("lists only items that can be worn inside the level window", () => {
    const ranked = rankEntries({
      entries: pool,
      scoreOf: (entry) => scoreItem(entry, "shaman-restoration"),
      level: 17,
      window: 2,
      equippedScore: 1,
    });
    expect(ranked.map((row) => row.entry.name)).not.toContain("Best");
    expect(ranked[0]?.entry.name).toBe("Band");
    expect(ranked[0]?.overallBest).toBe(true);
    expect(ranked.every((row) => !row.outsideLevel && row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(4);
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
  it("hides chest enchants outside a narrow level window", () => {
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
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked.every((row) => !row.outsideLevel && row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
    expect(result.ranked[0]?.overallBest).toBe(true);
  });

  it("has no head enchants and does have Forever necklace enchants", () => {
    expect(recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "head", equipped: null, equippedScore: null }).available).toBe(false);
    const necks = recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "neck", equipped: null, equippedScore: null });
    expect(necks.available).toBe(true);
    expect(necks.ranked.length).toBeGreaterThan(0);
    expect(necks.ranked.length).toBeLessThanOrEqual(4);
  });

  it("prefers frost damage for Frost PvP gloves and healing for restoration", () => {
    const frost = recommendEnchantments({ enchants, spec: "mage-frost-pvp", level: 60, window: 0, slot: "hands", equipped: null, equippedScore: null });
    const resto = recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 0, slot: "hands", equipped: null, equippedScore: null });
    expect(frost.ranked[0]?.entry.stats.frost ?? 0).toBeGreaterThan(0);
    expect((resto.ranked[0]?.entry.stats.heal ?? 0) + (resto.ranked[0]?.entry.stats.int ?? 0)).toBeGreaterThan(0);
  });
});

describe("wearable best in slot", () => {
  it("skips mail a shaman cannot wear inside the level window", () => {
    const mail = item({ id: 1, name: "Mail", req: 17, bucket: "chest", armor: "mail", stats: { heal: 80 } });
    const cloth = item({ id: 2, name: "Cloth", req: 17, bucket: "chest", armor: "cloth", stats: { heal: 12 } });
    const ranked = recommendGear({
      items: [mail, cloth],
      spec: "shaman-restoration",
      faction: "horde",
      level: 17,
      window: 8,
      slot: "chest",
      equipped: null,
    });
    expect(ranked.map((row) => row.entry.name)).toEqual(["Cloth"]);
  });

  it("allows mail once the level window reaches 40", () => {
    const mail = item({ id: 1, name: "Mail", req: 40, bucket: "chest", armor: "mail", stats: { heal: 80 } });
    const cloth = item({ id: 2, name: "Cloth", req: 36, bucket: "chest", armor: "cloth", stats: { heal: 12 } });
    const ranked = recommendGear({
      items: [mail, cloth],
      spec: "shaman-restoration",
      faction: "horde",
      level: 36,
      window: 8,
      slot: "chest",
      equipped: null,
    });
    expect(ranked[0]?.entry.name).toBe("Mail");
    expect(ranked.every((row) => row.entry.req >= 28 && row.entry.req <= 44)).toBe(true);
  });
});

describe("bis longevity", () => {
  const cls = classById(specById("shaman-restoration").classId)!;
  const pool = [
    item({ id: 1, name: "Low", req: 10, bucket: "chest", armor: "cloth", stats: { heal: 10 } }),
    item({ id: 2, name: "Mid", req: 20, bucket: "chest", armor: "cloth", stats: { heal: 30 } }),
    item({ id: 3, name: "High", req: 40, bucket: "chest", armor: "cloth", stats: { heal: 80 } }),
  ];

  it("keeps an item best until a strictly better one can be worn", () => {
    const mid = bisLongevity(pool[1]!, pool, "shaman-restoration", cls);
    expect(mid).toMatchObject({ from: 20, until: 40, levels: 20 });
    expect(longevityLabel(mid)).toBe("BiS until lvl 40");
    const high = bisLongevity(pool[2]!, pool, "shaman-restoration", cls);
    expect(high.until).toBeNull();
    expect(longevityLabel(high)).toBe("BiS through 60");
    expect(high.levels).toBe(21);
  });

  it("holds cloth until mail is actually wearable", () => {
    const cloth = item({ id: 4, name: "Cloth", req: 10, bucket: "chest", armor: "cloth", stats: { heal: 20 } });
    const mail = item({ id: 5, name: "Mail", req: 10, bucket: "chest", armor: "mail", stats: { heal: 80 } });
    const span = bisLongevity(cloth, [cloth, mail], "shaman-restoration", cls);
    expect(span).toMatchObject({ from: 10, until: 40, levels: 30 });
    expect(bisLongevity(mail, [cloth, mail], "shaman-restoration", cls).from).toBe(40);
  });

  it("does not treat a missing required level on a high item level as level 1", () => {
    const gown = item({ id: 6, name: "Gown", req: 22, bucket: "chest", armor: "cloth", stats: { heal: 20 } });
    const robe = item({ id: 7, name: "Robe", req: 1, bucket: "chest", armor: "cloth", ilvl: 60, stats: { heal: 80 } });
    const span = bisLongevity(gown, [gown, robe], "shaman-restoration", cls);
    expect(span.until).toBe(60);
    expect(longevityLabel(span)).toBe("BiS until lvl 60");
  });

  it("reports zero levels when a better item is already wearable", () => {
    const weak = item({ id: 9, name: "Weak", req: 30, bucket: "chest", armor: "cloth", stats: { heal: 5 } });
    const strong = item({ id: 8, name: "Strong", req: 10, bucket: "chest", armor: "cloth", stats: { heal: 80 } });
    const span = bisLongevity(weak, [weak, strong], "shaman-restoration", cls);
    expect(span).toMatchObject({ from: 30, until: 10, levels: 0 });
    expect(longevityLabel(span)).toBe("Outranked at lvl 30");
  });
});

describe("item links", () => {
  it("builds the full Forever Wowhead item URL", () => {
    expect(wowheadItemUrl(6832, "Cloak of Blight")).toBe("https://www.wowhead.com/forever/item=6832/cloak-of-blight");
    expect(wowheadItemUrl(271810, "Corpsefeeder's Shedding")).toBe(
      "https://www.wowhead.com/forever/item=271810/corpsefeeders-shedding",
    );
    expect(wowheadIconUrl("INV_Misc_Cape_18")).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_misc_cape_18.jpg");
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
    expect(daz?.character.level).toBe(23);
    expect(mrs?.character.level).toBe(22);
    expect(daz?.character.gear.map((piece) => piece.name)).toContain("Woolen Cape");
    expect(daz?.character.gear.find((piece) => piece.armorySlot === "finger1")?.name).toBe("Slain Baron's Signet");
    expect(mrs?.character.gear.map((piece) => piece.name)).toContain("Coldspire Staff");
    expect(mrs?.character.gear.find((piece) => piece.armorySlot === "wrist")?.name).toBe("Tabitha's Cuffs");
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
        avatar: { url: "https://render.worldofwarcraft.com/forever-us/character/1/2-avatar.jpg" },
        render: {
          foreground: { url: "https://render.worldofwarcraft.com/forever-us/character/1/2-main-raw.png" },
          background: { url: "https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_race_troll.jpg" },
        },
        gear: {
          back: {
            name: "Satyrskin Cloak",
            quality: { type: "RARE" },
            level: { value: 18 },
            item: { id: 273005 },
            media: { content: { assets: [{ key: "icon", value: "https://render.worldofwarcraft.com/forever-us/icons/56/133770.jpg" }] } },
            inventory_type: { type: "CLOAK" },
            stats: [],
          },
        },
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
    expect(character.portraitUrl).toContain("2-avatar.jpg");
    expect(character.modelUrl).toContain("main-raw.png");
    expect(character.gear[0]?.iconUrl).toContain("133770.jpg");
    expect(character.gear[0]?.name).toBe("Satyrskin Cloak");
  });
});
