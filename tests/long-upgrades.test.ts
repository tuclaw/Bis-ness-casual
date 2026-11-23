import { describe, expect, it } from "vitest";
import { LONG_UPGRADE_NOTE, rankLongUpgrades, type LongUpgradeSlot } from "../src/lib/long-upgrades.ts";
import type { Ranked } from "../src/lib/recommend.ts";
import type { EquippedItem, GearItem } from "../src/lib/types.ts";

function gear(partial: Partial<GearItem> & Pick<GearItem, "id" | "name" | "req">): GearItem {
  return {
    quality: 2,
    ilvl: partial.req,
    bucket: "chest",
    stats: {},
    faction: "both",
    pvp: false,
    unique: false,
    source: "Vendors",
    ...partial,
  };
}

function equipped(itemId: number, stats: EquippedItem["stats"]): EquippedItem {
  return {
    slot: "finger",
    armorySlot: "finger1",
    itemId,
    name: `Ring ${itemId}`,
    quality: "uncommon",
    ilvl: 20,
    req: 20,
    armorType: null,
    weaponType: null,
    inventoryType: "FINGER",
    stats,
    dps: null,
    speed: null,
    effect: null,
    enchant: null,
  };
}

function ranked(item: GearItem, score: number, longevity?: Ranked<GearItem>["longevity"]): Ranked<GearItem> {
  return {
    entry: item,
    score,
    outsideLevel: false,
    outsideFit: false,
    overallBest: false,
    upgrade: true,
    delta: null,
    longevity,
  };
}

function slot(partial: Partial<LongUpgradeSlot> & Pick<LongUpgradeSlot, "id" | "slot">): LongUpgradeSlot {
  return { label: partial.id, equipped: null, gear: [], ...partial };
}

describe("long-term upgrades", () => {
  it("ranks a longer lead ahead of a slightly larger short upgrade", () => {
    const rows = rankLongUpgrades({
      spec: "mage-arcane",
      level: 30,
      horizon: 40,
      slots: [
        slot({
          id: "chest",
          slot: "chest",
          equipped: equipped(1, { sta: 10 }),
          gear: [
            ranked(gear({ id: 10, name: "Short", req: 30 }), 20, { from: 30, until: 32, levels: 2 }),
            ranked(gear({ id: 11, name: "Long", req: 30 }), 12, { from: 30, until: 40, levels: 10 }),
          ],
        }),
      ],
    });
    expect(rows.map((row) => row.item.name)).toEqual(["Long", "Short"]);
    expect(rows[0]?.until).toBe(40);
    expect(rows[0]?.levels).toBe(10);
  });

  it("compares a ring with the weaker equipped ring and keeps a single row", () => {
    const candidate = gear({ id: 50, name: "New ring", req: 30, bucket: "finger" });
    const rows = rankLongUpgrades({
      spec: "mage-arcane",
      level: 30,
      horizon: 40,
      slots: [
        slot({
          id: "finger1",
          label: "Finger",
          slot: "finger",
          equipped: equipped(2, { sta: 1 }),
          gear: [ranked(candidate, 8, { from: 30, until: 36, levels: 6 })],
        }),
        slot({
          id: "finger2",
          label: "Finger",
          slot: "finger",
          equipped: equipped(3, { sta: 20 }),
          gear: [ranked(candidate, 8, { from: 30, until: 36, levels: 6 })],
        }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBeCloseTo(8 - 0.22, 2);
  });

  it("ranks an unknown longevity by the relative upgrade alone", () => {
    const rows = rankLongUpgrades({
      spec: "warrior-arms",
      level: 32,
      horizon: 40,
      slots: [
        slot({
          id: "head",
          slot: "head",
          gear: [ranked(gear({ id: 70, name: "Mystery", req: 32, bucket: "head" }), 9)],
        }),
      ],
    });
    expect(rows[0]?.unknownLongevity).toBe(true);
    expect(rows[0]?.until).toBeNull();
    expect(rows[0]?.levels).toBeNull();
    expect(rows[0]?.value).toBeCloseTo(rows[0]!.relative);
    expect(LONG_UPGRADE_NOTE.toLowerCase()).toContain("unknown");
    expect(LONG_UPGRADE_NOTE.toLowerCase()).toContain("weaker");
  });

  it("caps longevity at the level window and skips a downgrade", () => {
    const rows = rankLongUpgrades({
      spec: "mage-arcane",
      level: 31,
      horizon: 39,
      slots: [
        slot({
          id: "legs",
          slot: "legs",
          equipped: equipped(9, { sta: 5 }),
          gear: [
            ranked(gear({ id: 80, name: "Later", req: 31, bucket: "legs" }), 30, { from: 20, until: 55, levels: 35 }),
            ranked(gear({ id: 81, name: "Worse", req: 31, bucket: "legs" }), 0.1, { from: 31, until: 60, levels: 29 }),
          ],
        }),
      ],
    });
    expect(rows.map((row) => row.item.name)).toEqual(["Later"]);
    expect(rows[0]?.until).toBe(39);
    expect(rows[0]?.levels).toBe(8);
  });

  it("leaves off an item that is replaced as soon as it can be worn", () => {
    const rows = rankLongUpgrades({
      spec: "warrior-arms",
      level: 37,
      horizon: 45,
      slots: [
        slot({
          id: "offhand",
          slot: "offhand",
          gear: [ranked(gear({ id: 90, name: "Brief", req: 42, bucket: "offhand" }), 40, { from: 42, until: 42, levels: 0 })],
        }),
      ],
    });
    expect(rows).toEqual([]);
  });
});
