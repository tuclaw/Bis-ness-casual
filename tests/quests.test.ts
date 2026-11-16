import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DURATION_NOTE,
  classifyAction,
  classifyQuest,
  classifyStep,
  isDuoFriendly,
  listZoneQuests,
  nextOpenZone,
  rankZones,
  wowheadQuestUrl,
  type ObjectiveKind,
  type QuestCatalog,
  type QuestRecord,
  type RankedQuest,
} from "../src/lib/quests.ts";

function quest(partial: Partial<QuestRecord> & Pick<QuestRecord, "id" | "name" | "zone">): QuestRecord {
  return {
    level: 20,
    req: 15,
    faction: "Horde",
    classes: [],
    xp: 1000,
    objectives: ["slay"],
    ...partial,
  };
}

describe("quest objective classification", () => {
  it("maps a kill step to slay and ignores the turn-in", () => {
    expect(classifyStep({ type: "kill" })).toBe("slay");
    expect(classifyStep({ type: "finish" })).toBeNull();
    expect(
      classifyQuest([
        { type: "start" },
        { type: "kill" },
        { type: "kill" },
        { type: "finish" },
      ]),
    ).toEqual(["slay", "slay"]);
  });

  it("splits collect steps by the guide's source label", () => {
    expect(classifyStep({ type: "collect", moreText: "Drops from Sunscale Scytheclaw." })).toBe("drop");
    expect(classifyStep({ type: "collect", moreText: "Found in Drizzlik's Emporium." })).toBe("gather");
    expect(classifyStep({ type: "collect", moreText: "Sold by a vendor." })).toBe("errand");
    expect(classifyStep({ type: "collect", moreText: "" })).toBe("unknown");
  });

  it("keeps talk, deliver, and explore distinct from a generic errand", () => {
    expect(classifyAction({ type: "talk" })).toBe("talk");
    expect(classifyAction({ type: "deliver" })).toBe("deliver");
    expect(classifyAction({ type: "explore" })).toBe("explore");
    expect(classifyStep({ type: "explore" })).toBe("errand");
    expect(classifyAction({ type: "use" })).toBe("errand");
  });

  it("treats escort, explore, and a bare turn-in as errands", () => {
    expect(classifyStep({ type: "escort" })).toBe("errand");
    expect(classifyStep({ type: "explore" })).toBe("errand");
    expect(classifyQuest([{ type: "start" }, { type: "finish" }])).toEqual(["errand"]);
    expect(classifyQuest([])).toEqual(["unknown"]);
  });

  it("does not call a quest duo-friendly when any objective is a drop", () => {
    expect(isDuoFriendly(["slay", "drop"], true)).toBe(false);
    expect(isDuoFriendly(["slay"], true)).toBe(true);
    expect(isDuoFriendly(["gather"], true)).toBe(true);
    expect(isDuoFriendly(["gather"], false)).toBe(false);
    expect(isDuoFriendly(["slay", "gather"], false)).toBe(true);
    expect(isDuoFriendly(["unknown"], true)).toBe(false);
  });

  it("builds a Forever Wowhead quest link without putting the URL in the name", () => {
    expect(wowheadQuestUrl(530, "A Husband's Revenge")).toBe(
      "https://www.wowhead.com/forever/quest=530/a-husbands-revenge",
    );
  });
});

describe("zone quest list", () => {
  function ranked(partial: Partial<QuestRecord> & Pick<QuestRecord, "id" | "name">): RankedQuest {
    return { ...quest({ ...partial, zone: partial.zone ?? "The Barrens" }), friendly: !partial.objectives?.includes("drop") };
  }

  it("filters by action and sorts duo-friendly quests first", () => {
    const rows = [
      ranked({ id: 1, name: "Horns", objectives: ["drop"], actions: ["drop"], level: 20, xp: 9000 }),
      ranked({ id: 2, name: "Talk", objectives: ["errand"], actions: ["talk"], level: 22, xp: 500 }),
      ranked({ id: 3, name: "Boars", objectives: ["slay"], actions: ["slay"], level: 18, xp: 2000 }),
    ];
    expect(listZoneQuests(rows, { actions: ["slay", "talk"], sort: "level" }).map((row) => row.name)).toEqual(["Boars", "Talk"]);
    expect(listZoneQuests(rows, { actions: null, sort: "duo" })[0]?.name).not.toBe("Horns");
  });

  it("defaults a zone list to highest XP and opens only one zone", () => {
    const rows = [
      ranked({ id: 1, name: "Small", objectives: ["slay"], level: 18, xp: 100 }),
      ranked({ id: 2, name: "Big", objectives: ["slay"], level: 25, xp: 5000 }),
      ranked({ id: 3, name: "None", objectives: ["errand"], level: 20, xp: null }),
    ];
    expect(listZoneQuests(rows, { actions: null, sort: "xp" }).map((row) => row.name)).toEqual(["Big", "Small", "None"]);
    expect(nextOpenZone(null, "The Barrens")).toBe("The Barrens");
    expect(nextOpenZone("The Barrens", "Hillsbrad Foothills")).toBe("Hillsbrad Foothills");
    expect(nextOpenZone("The Barrens", "The Barrens")).toBeNull();
  });

  it("does not turn map percentages into a duration", () => {
    expect(DURATION_NOTE.toLowerCase()).toContain("no time estimate");
    expect(DURATION_NOTE.toLowerCase()).not.toContain("minute");
  });
});

describe("duo zone ranking", () => {
  const quests: QuestRecord[] = [
    quest({ id: 1, name: "Kill boars", zone: "The Barrens", objectives: ["slay"], xp: 2000 }),
    quest({ id: 2, name: "Kill raptors", zone: "The Barrens", objectives: ["slay"], xp: 2000 }),
    quest({ id: 3, name: "Talk to Thork", zone: "The Barrens", objectives: ["errand"], xp: 500 }),
    quest({ id: 4, name: "Raptor horns", zone: "The Barrens", objectives: ["drop"], xp: 9000 }),
    quest({ id: 5, name: "Dig", zone: "The Barrens", objectives: ["gather"], xp: 800 }),
    quest({ id: 6, name: "Alliance only", zone: "Westfall", faction: "Alliance", objectives: ["slay"] }),
    quest({ id: 7, name: "Too high", zone: "Tanaris", level: 45, req: 40, objectives: ["slay"] }),
    quest({ id: 8, name: "Warlock only", zone: "The Barrens", classes: ["Warlock"], objectives: ["slay"], xp: 5000 }),
    quest({ id: 9, name: "Share A", zone: "Ashenvale", objectives: ["slay"], xp: 0 }),
    quest({ id: 10, name: "Share B", zone: "Ashenvale", objectives: ["slay"], xp: 0 }),
    quest({ id: 11, name: "Share C", zone: "Thousand Needles", objectives: ["slay"], xp: 0 }),
    quest({ id: 12, name: "Share D", zone: "Thousand Needles", objectives: ["slay"], xp: 0 }),
    quest({ id: 13, name: "Share drop", zone: "Thousand Needles", objectives: ["drop"], xp: 0 }),
    quest({ id: 14, name: "Share drop 2", zone: "Thousand Needles", objectives: ["drop"], xp: 0 }),
    quest({ id: 15, name: "Xp low", zone: "Silverpine Forest", objectives: ["errand"], xp: 100 }),
    quest({ id: 16, name: "Xp high", zone: "Hillsbrad Foothills", objectives: ["errand"], xp: 5000 }),
  ];

  const ranked = (gatherFriendly = true) =>
    rankZones({ quests, level: 23, window: 5, faction: "horde", className: "Shaman", gatherFriendly });

  it("ranks the zone with more non-drop quests first and skips drops, other factions, and other levels", () => {
    const zones = ranked();
    expect(zones.map((zone) => zone.zone)[0]).toBe("The Barrens");
    expect(zones.some((zone) => zone.zone === "Westfall" || zone.zone === "Tanaris")).toBe(false);
    const barrens = zones[0]!;
    expect(barrens.quests.map((quest) => quest.name)).not.toContain("Warlock only");
    expect(barrens.quests.find((quest) => quest.name === "Raptor horns")?.friendly).toBe(false);
    expect(barrens.friendly).toBe(4);
    expect(barrens.byType.drop).toBe(1);
    expect(barrens.quests.every((quest) => quest.level != null && quest.level >= 18 && quest.level <= 28)).toBe(true);
  });

  it("lets the friendly share outrank an equal count, and XP break a remaining tie", () => {
    const zones = ranked();
    const ashenvale = zones.find((zone) => zone.zone === "Ashenvale")!;
    const needles = zones.find((zone) => zone.zone === "Thousand Needles")!;
    expect(ashenvale.friendly).toBe(needles.friendly);
    expect(ashenvale.share).toBeGreaterThan(needles.share);
    expect(ashenvale.score).toBeGreaterThan(needles.score);
    const silver = zones.find((zone) => zone.zone === "Silverpine Forest")!;
    const hills = zones.find((zone) => zone.zone === "Hillsbrad Foothills")!;
    expect(silver.friendly).toBe(hills.friendly);
    expect(silver.share).toBe(hills.share);
    expect(hills.score).toBeGreaterThan(silver.score);
  });

  it("ranks Daz's level 23 Horde window from the Forever catalog", () => {
    const catalog = JSON.parse(readFileSync(new URL("../public/data/quests.json", import.meta.url), "utf8")) as QuestCatalog;
    const kinds = new Set<ObjectiveKind>(["slay", "drop", "gather", "errand", "unknown"]);
    expect(catalog.total).toBeGreaterThan(4000);
    const revenge = catalog.quests.find((quest) => quest.id === 530);
    expect(revenge?.giver).toBe("Raleigh Andrean");
    expect(revenge?.chainPosition).toBe(6);
    expect(revenge?.chainTotal).toBe(6);
    expect(revenge?.pins?.some((pin) => pin.role === "objective" && pin.zone === "Silverpine Forest")).toBe(true);
    expect(catalog.unknownObjectives).toBeGreaterThan(0);
    expect(catalog.unknownObjectives).toBeLessThan(catalog.objectiveSteps);
    for (const quest of catalog.quests) {
      expect(quest.objectives.length).toBeGreaterThan(0);
      for (const kind of quest.objectives) expect(kinds.has(kind)).toBe(true);
    }
    const ranks = rankZones({
      quests: catalog.quests,
      level: 23,
      window: 5,
      faction: "horde",
      className: "Shaman",
      gatherFriendly: true,
    });
    expect(ranks.slice(0, 3).map((zone) => zone.zone)).toEqual([
      "The Barrens",
      "Stonetalon Mountains",
      "Special",
    ]);
    for (const zone of ranks) {
      expect(zone.quests.every((quest) => quest.level != null && quest.level >= 18 && quest.level <= 28)).toBe(true);
      expect(zone.quests.every((quest) => quest.faction.toLowerCase() !== "alliance")).toBe(true);
    }
  });

  it("drops a gather-only quest from the duo count when gathering is not friendly", () => {
    const on = ranked(true).find((zone) => zone.zone === "The Barrens")!;
    const off = ranked(false).find((zone) => zone.zone === "The Barrens")!;
    expect(on.friendly).toBe(off.friendly + 1);
    expect(off.quests.find((quest) => quest.name === "Dig")?.friendly).toBe(false);
  });
});
