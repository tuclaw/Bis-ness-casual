import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceNote } from "../src/SourceNote.tsx";
import { describe, expect, it } from "vitest";
import { armoryStateFromProfileApi, characterFromArmoryState, parseArmoryHtml } from "../src/lib/armory.ts";
import { snapshotChanged } from "../src/lib/snapshot.ts";
import { parseCharacterQuery } from "../src/lib/names.ts";
import { wowheadIconUrl, wowheadItemUrl } from "../src/lib/format.ts";
import { recommendDungeons } from "../src/lib/dungeons.ts";
import { defaultSourceFilters, hiddenByToggle, sourceAllowed, sourceLabel, sourceTypes } from "../src/lib/sources.ts";
import { bisLongevity, hardAllowItem, itemFitsSlot, longevityLabel, rankEntries, recommendEnchantments, recommendGear, type Ranked } from "../src/lib/recommend.ts";
import { classById, specById, specsForClass } from "../src/lib/classes.ts";
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

  it("ranks only items inside the level window", () => {
    const ranked = rankEntries({
      entries: pool,
      scoreOf: (entry) => scoreItem(entry, "shaman-restoration"),
      level: 17,
      window: 2,
      equippedScore: 1,
      limit: 2,
    });
    expect(ranked.map((row) => row.entry.name)).toEqual(["Band", "Also"]);
    expect(ranked[0]?.overallBest).toBe(true);
    expect(ranked.every((row) => !row.outsideLevel && row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
  });

  it("does not invent extra picks when fewer items are eligible", () => {
    const ranked = rankEntries({
      entries: [pool[2]!, pool[1]!],
      scoreOf: (entry) => scoreItem(entry, "shaman-restoration"),
      level: 17,
      window: 2,
      limit: 10,
    });
    expect(ranked.map((row) => row.entry.name)).toEqual(["Band"]);
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
  it("hides chest enchants whose required level is outside a narrow window", () => {
    const result = recommendEnchantments({
      enchants,
      spec: "mage-arcane",
      level: 17,
      window: 2,
      slot: "chest",
      equipped: null,
      equippedScore: null,
      limit: 3,
    });
    expect(result.available).toBe(true);
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked[0]?.overallBest).toBe(true);
    expect(result.ranked.every((row) => !row.outsideLevel && row.entry.req >= 15 && row.entry.req <= 19)).toBe(true);
  });

  it("has no head enchants and does have Forever necklace enchants", () => {
    expect(recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "head", equipped: null, equippedScore: null }).available).toBe(false);
    const necks = recommendEnchantments({ enchants, spec: "shaman-restoration", level: 60, window: 40, slot: "neck", equipped: null, equippedScore: null });
    expect(necks.available).toBe(true);
    expect(necks.ranked.length).toBeGreaterThan(0);
    expect(necks.ranked.length).toBeLessThanOrEqual(3);
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
      limit: 2,
    });
    expect(ranked.map((row) => row.entry.name)).toEqual(["Cloth"]);
    expect(ranked[0]?.overallBest).toBe(true);
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

function rankedPick(entry: GearItem, extras: Partial<Ranked<GearItem>> = {}): Ranked<GearItem> {
  return {
    entry,
    score: 10,
    outsideLevel: false,
    outsideFit: false,
    overallBest: false,
    upgrade: true,
    delta: 4,
    longevity: { from: 20, until: 30, levels: 10 },
    ...extras,
  };
}

describe("best dungeon", () => {
  it("groups upgrades by the dungeon named in the source and skips missing sources", () => {
    const sfk = item({ id: 1, name: "Fang Gloves", req: 20, bucket: "hands", source: "Shadowfang Keep · Shadowfang Gloves" });
    const deadmines = item({ id: 2, name: "Defias", req: 18, bucket: "chest", source: "The Deadmines · Edwin VanCleef" });
    const unknown = item({ id: 3, name: "Mystery", req: 20, bucket: "head", source: "Unknown source" });
    const raid = item({ id: 4, name: "Spire", req: 55, bucket: "legs", source: "Blackrock Spire · General Drakkisath" });
    const ranked = recommendDungeons({
      level: 23,
      faction: "horde",
      slots: [
        { label: "Hands", slot: "hands", picks: [rankedPick(sfk, { delta: 6, longevity: { from: 20, until: 32, levels: 12 } })] },
        { label: "Chest", slot: "chest", picks: [rankedPick(deadmines)] },
        { label: "Head", slot: "head", picks: [rankedPick(unknown)] },
        { label: "Legs", slot: "legs", picks: [rankedPick(raid)] },
      ],
    });
    expect(ranked.map((row) => row.name)).toEqual(["Shadowfang Keep"]);
    expect(ranked[0]?.count).toBe(1);
    expect(ranked[0]?.items.map((row) => row.name)).toEqual(["Fang Gloves"]);
    expect(ranked[0]?.min).toBe(18);
    expect(ranked[0]?.max).toBe(25);
  });

  it("ranks a bigger, longer upgrade ahead of a small one", () => {
    const small = item({ id: 1, name: "Small", req: 20, bucket: "hands", source: "Wailing Caverns" });
    const big = item({ id: 2, name: "Big", req: 22, bucket: "chest", source: "Blackfathom Deeps" });
    const ranked = recommendDungeons({
      level: 23,
      faction: "horde",
      slots: [
        { label: "Hands", slot: "hands", picks: [rankedPick(small, { delta: 1, longevity: { from: 20, until: 22, levels: 2 } })] },
        { label: "Chest", slot: "chest", picks: [rankedPick(big, { delta: 30, longevity: { from: 22, until: null, levels: 39 } })] },
      ],
    });
    expect(ranked[0]?.name).toBe("Blackfathom Deeps");
    expect(ranked[1]?.name).toBe("Wailing Caverns");
  });
});

describe("recommendations per slot", () => {
  it("defaults to three picks when the caller does not set a limit", () => {
    const items = [1, 2, 3, 4, 5].map((id) =>
      item({ id, name: `Cloth ${id}`, req: 17, bucket: "chest", armor: "cloth", stats: { heal: id } }),
    );
    const ranked = recommendGear({
      items,
      spec: "shaman-restoration",
      faction: "horde",
      level: 17,
      window: 2,
      slot: "chest",
      equipped: null,
    });
    expect(ranked).toHaveLength(3);
    expect(ranked.map((row) => row.entry.name)).toEqual(["Cloth 5", "Cloth 4", "Cloth 3"]);
  });

  it("badges the longest pick among however many the slider asks for", () => {
    const short = item({ id: 1, name: "Short", req: 50, bucket: "chest", armor: "cloth", stats: { heal: 100 } });
    const lasting = item({ id: 2, name: "Long", req: 17, bucket: "chest", armor: "cloth", stats: { heal: 20 } });
    const two = recommendGear({
      items: [short, lasting],
      spec: "shaman-restoration",
      faction: "horde",
      level: 17,
      window: 2,
      slot: "chest",
      equipped: null,
      limit: 2,
    });
    expect(two.map((row) => row.entry.name)).toEqual(["Long"]);
    expect(two.find((row) => row.longest)?.entry.name).toBe("Long");
    const one = recommendGear({
      items: [short, lasting],
      spec: "shaman-restoration",
      faction: "horde",
      level: 17,
      window: 2,
      slot: "chest",
      equipped: null,
      limit: 1,
    });
    expect(one.map((row) => row.entry.name)).toEqual(["Long"]);
    expect(one[0]?.longest).toBe(true);
  });
});

describe("source filters", () => {
  it("maps catalog source tokens without adding a dungeon that is not named", () => {
    expect(sourceTypes("Unknown source")).toEqual(["unknown"]);
    expect(sourceTypes(undefined)).toEqual(["unknown"]);
    expect(sourceTypes("Drops")).toEqual(["world"]);
    expect(sourceTypes("Quest Rewards")).toEqual(["quest"]);
    expect(sourceTypes("Crafted")).toEqual(["craft"]);
    expect(sourceTypes("Vendors · PvP")).toEqual(["vendor", "pvp"]);
    expect(sourceTypes("Shadowfang Keep · Baron Silverlaine")).toEqual(["dungeon", "other"]);
    expect(sourceTypes("Drops · C'Thun")).toEqual(["world", "other"]);
    expect(sourceLabel(undefined)).toBe("Unknown source");
    expect(sourceLabel("")).toBe("Unknown source");
    expect(sourceLabel("Unknown source")).toBe("Unknown source");
    expect(sourceLabel("Crafted")).toBe("Crafting");
    expect(sourceLabel("Crafted · Tailoring")).toBe("Crafted: Tailoring");
    expect(sourceLabel("Quest Rewards")).toBe("Quests");
    expect(sourceLabel("Quest Rewards · The Barrens Oases")).toBe("Quest: The Barrens Oases");
    expect(sourceLabel("Vendors")).toBe("Vendor");
    expect(sourceLabel("Vendors · PvP")).toBe("Vendor · PvP");
    expect(sourceLabel("Drops")).toBe("World drops");
    expect(sourceLabel("Drops · Shal'ma")).toBe("Drop: Shal'ma");
    expect(sourceLabel("Razorfen Kraul · Roogug")).toBe("Dungeon: Razorfen Kraul, Roogug");
    expect(sourceLabel("Drops · Quest Rewards")).toBe("World drops · Quests");
    const filters = defaultSourceFilters();
    expect(sourceAllowed("Shadowfang Keep", { ...filters, dungeon: false })).toBe(false);
    expect(sourceAllowed("Vendors · Shadowfang Keep", { ...filters, dungeon: false })).toBe(true);
    expect(hiddenByToggle(["Shadowfang Keep", "Vendors", "Vendors · Shadowfang Keep"], filters, "dungeon")).toBe(1);
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

const PLANNER_SLOTS: Array<{ id: string; slot: import("../src/lib/types.ts").PlannerSlot; armorySlot: string }> = [
  { id: "head", slot: "head", armorySlot: "head" },
  { id: "neck", slot: "neck", armorySlot: "neck" },
  { id: "shoulder", slot: "shoulder", armorySlot: "shoulder" },
  { id: "back", slot: "back", armorySlot: "back" },
  { id: "chest", slot: "chest", armorySlot: "chest" },
  { id: "wrist", slot: "wrist", armorySlot: "wrist" },
  { id: "hands", slot: "hands", armorySlot: "hand" },
  { id: "waist", slot: "waist", armorySlot: "waist" },
  { id: "legs", slot: "legs", armorySlot: "leg" },
  { id: "feet", slot: "feet", armorySlot: "foot" },
  { id: "finger1", slot: "finger", armorySlot: "finger1" },
  { id: "finger2", slot: "finger", armorySlot: "finger2" },
  { id: "trinket1", slot: "trinket", armorySlot: "trinket1" },
  { id: "trinket2", slot: "trinket", armorySlot: "trinket2" },
  { id: "mainhand", slot: "mainhand", armorySlot: "weapon" },
  { id: "offhand", slot: "offhand", armorySlot: "offhand" },
  { id: "ranged", slot: "ranged", armorySlot: "ranged" },
];

describe("recommendation source labels", () => {
  it("renders a source label on every recommendation row", () => {
    for (const profile of characters) {
      for (const spec of specsForClass(profile.character.classId)) {
        for (const row of PLANNER_SLOTS) {
          const ranked = recommendGear({
            items,
            spec: spec.id,
            faction: profile.character.faction,
            level: profile.character.level,
            window: 8,
            slot: row.slot,
            equipped: profile.character.gear.find((piece) => piece.armorySlot === row.armorySlot) ?? null,
            limit: 3,
          });
          for (const pick of ranked) {
            const html = renderToStaticMarkup(SourceNote({ source: pick.entry.source }));
            const text = html.replace(/<[^>]+>/g, "").trim();
            const label = `${profile.slug} ${spec.id} ${row.id} ${pick.entry.name}`;
            expect(html, label).toContain("source-note");
            expect(text, label).not.toBe("");
            if (!pick.entry.source) expect(text, label).toBe("Unknown source");
          }
        }
      }
    }
  });
});

describe("slot inventory types", () => {
  it("keeps every recommendation in a legal slot for every saved character and spec", () => {
    for (const profile of characters) {
      const cls = classById(profile.character.classId);
      expect(cls, profile.slug).toBeTruthy();
      for (const piece of profile.character.gear) {
        const row = PLANNER_SLOTS.find((candidate) => candidate.armorySlot === piece.armorySlot);
        expect(row, `${profile.slug} ${piece.name} -> ${piece.armorySlot}`).toBeTruthy();
        expect(piece.slot, `${profile.slug} ${piece.name}`).toBe(row?.slot);
      }
      for (const spec of specsForClass(profile.character.classId)) {
        for (const row of PLANNER_SLOTS) {
          const ranked = recommendGear({
            items,
            spec: spec.id,
            faction: profile.character.faction,
            level: profile.character.level,
            window: 8,
            slot: row.slot,
            equipped: profile.character.gear.find((piece) => piece.armorySlot === row.armorySlot) ?? null,
            limit: 10,
          });
          for (const pick of ranked) {
            const label = `${profile.slug} ${spec.id} ${row.id} ${pick.entry.name} bucket=${pick.entry.bucket} weapon=${pick.entry.weapon ?? "-"}`;
            expect(itemFitsSlot(pick.entry, row.slot, cls!), label).toBe(true);
            expect(hardAllowItem(pick.entry, spec.id, profile.character.faction), label).toBe(true);
            const low = Math.max(1, profile.character.level - 8);
            const high = Math.min(60, profile.character.level + 8);
            expect(pick.entry.req, label).toBeGreaterThanOrEqual(low);
            expect(pick.entry.req, label).toBeLessThanOrEqual(high);
            if (row.slot === "ranged") {
              expect(pick.entry.name.toLowerCase(), label).not.toContain("bracer");
              expect(cls!.ranged, label).toContain(pick.entry.weapon);
            }
            if (row.slot === "wrist") expect(pick.entry.bucket, label).toBe("wrist");
          }
        }
      }
    }
  });

  it("gives shaman totems, paladin librams, and druid idols, never a bracer", () => {
    const relic = (spec: import("../src/lib/types.ts").SpecId, faction: "horde" | "alliance") =>
      recommendGear({ items, spec, faction, level: 30, window: 10, slot: "ranged", equipped: null, limit: 6 }).map((row) => row.entry);
    expect(relic("shaman-restoration", "horde").every((item) => item.weapon === "totem")).toBe(true);
    expect(relic("paladin-holy", "horde").every((item) => item.weapon === "libram")).toBe(true);
    expect(relic("druid-feral", "horde").every((item) => item.weapon === "idol")).toBe(true);
    expect(relic("shaman-restoration", "horde").some((item) => /bracer|belt/i.test(item.name))).toBe(false);
    expect(relic("druid-balance", "horde").some((item) => /bracer/i.test(item.name))).toBe(false);
  });
});

function expectLiveSnapshot(profile: (typeof characters)[number] | undefined) {
  expect(profile).toBeTruthy();
  expect(profile!.character.level).toBeGreaterThanOrEqual(1);
  expect(profile!.character.level).toBeLessThanOrEqual(60);
  expect(profile!.mainSpec.length).toBeGreaterThan(0);
  expect(profile!.character.gear.length).toBeGreaterThan(0);
  expect(profile!.character.gear.every((piece) => piece.name.length > 0 && piece.armorySlot.length > 0)).toBe(true);
  expect(profile!.renderFile).toMatch(/^characters\//);
  expect(profile!.renderHash).toMatch(/^[a-f0-9]{12}$/);
}

describe("seed characters", () => {
  it("loads both Horde PvP profiles with the saved specs and real gear", () => {
    const daz = characters.find((profile) => profile.slug === "daz-dingomon");
    const mrs = characters.find((profile) => profile.slug === "mrs-dingomon");
    expectLiveSnapshot(daz);
    expectLiveSnapshot(mrs);
    expect(daz?.character.className).toBe("Shaman");
    expect(daz?.character.race).toBe("Troll");
    expect(mrs?.character.className).toBe("Mage");
    expect(mrs?.character.race).toBe("Troll");
    expect(daz?.character.faction).toBe("horde");
    expect(daz?.character.ruleset).toBe("PvP");
    expect(mrs?.character.faction).toBe("horde");
  });

  it("includes Sir Stackers from the US Forever Armory", () => {
    const profile = characters.find((item) => item.slug === "sir-stackers");
    expectLiveSnapshot(profile);
    expect(profile?.region).toBe("us");
    expect(profile?.character.className).toBe("Warrior");
    expect(profile?.character.race).toBe("Undead");
    expect(profile?.character.faction).toBe("horde");
  });
});

describe("profile api snapshot", () => {
  it("maps a Forever profile equipment document without adding gear", () => {
    const state = armoryStateFromProfileApi({
      region: "us",
      summary: {
        name: "Daz",
        surname: "Dingomon",
        level: 23,
        character_class: { name: "Shaman", id: 7 },
        race: { name: "Troll" },
        faction: { type: "HORDE", name: "Horde" },
        ruleset: { name: "PvP", id: 1 },
        average_item_level: 16,
        last_login_timestamp: Date.parse("2026-11-13T11:08:31Z"),
      },
      equipment: {
        equipped_items: [
          {
            name: "Woolen Cape",
            slot: { type: "BACK" },
            item: { id: 2584 },
            quality: { type: "UNCOMMON" },
            level: { value: 16 },
            requirements: { level: { value: 11 } },
            inventory_type: { type: "CLOAK" },
            item_class: { name: "Armor" },
            item_subclass: { name: "Cloth" },
            stats: [{ type: { type: "SPIRIT" }, value: 1 }],
          },
        ],
      },
      statistics: { health: 764, power: 933, power_type: { name: "Mana" }, intellect: { effective: 51 } },
      iconUrls: { 2584: "https://render.worldofwarcraft.com/forever-us/icons/56/133770.jpg" },
    });
    const character = characterFromArmoryState(state);
    expect(character.level).toBe(23);
    expect(character.classId).toBe("shaman");
    expect(character.gear.map((piece) => piece.name)).toEqual(["Woolen Cape"]);
    expect(character.gear[0]?.armorySlot).toBe("back");
    expect(character.gear[0]?.iconUrl).toContain("133770.jpg");
    expect(character.stats.find((stat) => stat.key === "HEALTH")?.value).toBe(764);
  });

  it("ignores the fetch clock when deciding whether a snapshot changed", () => {
    const [first] = characters;
    expect(first).toBeTruthy();
    const later = { ...first!, fetchedAt: "2026-11-14T00:00:00.000Z" };
    expect(snapshotChanged([first!], [later])).toBe(false);
    expect(snapshotChanged([first!], [{ ...first!, character: { ...first!.character, level: first!.character.level + 1 } }])).toBe(true);
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
