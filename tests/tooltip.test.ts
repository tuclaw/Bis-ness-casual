import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enchantDisplayText, tooltipFromEnchant, tooltipFromEquipped, tooltipFromGear } from "../src/lib/tooltip.ts";
import type { Enchant, EquippedItem, GearItem, SavedProfile } from "../src/lib/types.ts";

const characters = JSON.parse(readFileSync(new URL("../src/data/characters.json", import.meta.url), "utf8")) as SavedProfile[];
const enchants = JSON.parse(readFileSync(new URL("../public/data/enchants.json", import.meta.url), "utf8")) as Enchant[];

function gear(partial: Partial<GearItem> & Pick<GearItem, "id" | "name">): GearItem {
  return {
    quality: 2,
    ilvl: 27,
    req: 22,
    bucket: "chest",
    stats: { heal: 20, int: 7, armor: 45 },
    faction: "both",
    pvp: false,
    unique: false,
    armor: "cloth",
    effect: "Equip: Increases healing done by up to 20.",
    source: "Crafted",
    ...partial,
  };
}

describe("armory item tooltip", () => {
  it("shows the lines the catalog actually has and skips binding, durability, sell price, and damage range", () => {
    const model = tooltipFromGear(gear({ id: 1, name: "Pristine Gown" }), "https://www.wowhead.com/forever/item=1/gown");
    const kinds = model.lines.map((line) => line.kind);
    expect(kinds).toEqual(["name", "ilvl", "slot", "armor", "stat", "stat", "effect", "req", "source"]);
    expect(model.lines.find((line) => line.kind === "slot")).toMatchObject({ text: "Chest", right: "Cloth" });
    expect(model.lines.find((line) => line.kind === "armor")?.text).toBe("45 Armor");
    expect(model.lines.find((line) => line.kind === "effect")?.text).toContain("Equip:");
    expect(model.lines.some((line) => line.kind === "binding" || line.kind === "durability" || line.kind === "sell")).toBe(false);
    expect(model.lines.some((line) => line.kind === "weapon" && line.text.includes(" - "))).toBe(false);
  });

  it("shows unique, classes, weapon speed, and dps when those fields exist", () => {
    const model = tooltipFromGear(
      gear({
        id: 2,
        name: "Kris",
        bucket: "mainhand",
        armor: undefined,
        weapon: "dagger",
        unique: true,
        classes: ["rogue"],
        stats: { agi: 4 },
        dps: 8,
        speed: 1.5,
        effect: undefined,
      }),
      null,
    );
    expect(model.lines.find((line) => line.kind === "unique")?.text).toBe("Unique");
    expect(model.lines.find((line) => line.kind === "classes")?.text).toBe("Classes: Rogue");
    expect(model.lines.find((line) => line.kind === "slot")).toMatchObject({ text: "Main Hand", right: "Dagger" });
    expect(model.lines.some((line) => line.text.startsWith("Speed 1.50"))).toBe(true);
    expect(model.lines.some((line) => line.text.includes("8.0 damage per second"))).toBe(true);
    expect(model.lines.some((line) => line.kind === "weapon" && line.text.includes(" - "))).toBe(false);
  });

  it("colors stat lines against the equipped item", () => {
    const model = tooltipFromGear(gear({ id: 3, name: "Compared", stats: { heal: 20, int: 4, armor: 40 } }), null, { heal: 10, int: 7, armor: 40 });
    const heal = model.lines.find((line) => line.text.includes("Healing"));
    const intel = model.lines.find((line) => line.text.includes("Intellect"));
    expect(heal?.delta).toBe("up");
    expect(intel?.delta).toBe("down");
  });

  it("includes the equipped enchant and leaves out fields the Armory snapshot did not keep", () => {
    const equipped: EquippedItem = {
      slot: "chest",
      armorySlot: "chest",
      itemId: 6561,
      name: "Seer's Padded Armor",
      quality: "uncommon",
      ilvl: 21,
      req: 16,
      armorType: "cloth",
      weaponType: null,
      inventoryType: "CHEST",
      stats: { sta: 3, spi: 6, armor: 35 },
      dps: null,
      speed: null,
      effect: null,
      enchant: { enchantId: 242, name: "Enchant Chest - Lesser Stamina", label: "Enchanted: Stamina +3" },
    };
    const model = tooltipFromEquipped(equipped, null);
    expect(model.lines.find((line) => line.kind === "enchant")?.text).toBe("Enchanted: Stamina +3");
    expect(model.lines.find((line) => line.kind === "slot")).toMatchObject({ text: "Chest", right: "Cloth" });
    expect(model.lines.some((line) => line.kind === "binding" || line.kind === "durability" || line.kind === "sell")).toBe(false);
  });

  it("uses each saved character's Armory enchant display string on the green line", () => {
    const seen: string[] = [];
    for (const profile of characters) {
      for (const piece of profile.character.gear) {
        if (!piece.enchant) continue;
        const model = tooltipFromEquipped(piece, null);
        const line = model.lines.find((row) => row.kind === "enchant");
        const label = `${profile.slug} ${piece.name}`;
        expect(line?.text, label).toBe(piece.enchant.label);
        expect(line?.text, label).not.toMatch(/^Enchant id /);
        expect(line?.text, label).not.toBe("Enchanted");
        seen.push(`${profile.slug}:${piece.armorySlot}`);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain("daz-dingomon:chest");
    expect(seen).toContain("sir-stackers:chest");
  });

  it("does not invent enchant text when the payload has only an id or a name", () => {
    expect(enchantDisplayText({ enchantId: 242, name: null, label: "" })).toBe(
      "Enchant id 242. The Armory payload has no enchant text.",
    );
    expect(enchantDisplayText({ enchantId: 242, name: "Enchant Chest - Lesser Stamina", label: "Enchanted" })).toBe(
      "Enchant Chest - Lesser Stamina",
    );
    expect(enchantDisplayText({ enchantId: 242, name: null, label: "Enchanted: Stamina +3" })).toBe("Enchanted: Stamina +3");
  });

  it("shows a catalog enchant's effect in the tooltip without an Other: source prefix", () => {
    const enchant = enchants.find((row) => row.name === "Enchant Chest - Lesser Stamina");
    expect(enchant).toBeTruthy();
    const model = tooltipFromEnchant(enchant!);
    expect(model.lines.find((line) => line.kind === "effect")?.text).toBe(enchant!.effect);
    expect(model.lines.some((line) => line.text.startsWith("Other:"))).toBe(false);
    expect(model.lines.some((line) => line.text === enchant!.source)).toBe(true);
  });
});
