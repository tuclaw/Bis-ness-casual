import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandLink } from "../src/Lineup.tsx";
import { characterKeyFromHash, lineupExit, shouldShowLineup } from "../src/lib/lineup.ts";
import { imageExtension, pickMediaUrl, publicAssetUrl, renderWriteNeeded } from "../src/lib/renders.ts";
import { snapshotChanged } from "../src/lib/snapshot.ts";
import type { SavedProfile } from "../src/lib/types.ts";
import { trimCharacterPng } from "../scripts/trim-png.mts";

describe("character lineup", () => {
  it("shows only on a first visit to the bare site", () => {
    expect(shouldShowLineup("", null)).toBe(true);
    expect(shouldShowLineup("#", null)).toBe(true);
    expect(shouldShowLineup("", "1")).toBe(false);
    expect(shouldShowLineup("#questing", null)).toBe(false);
    expect(shouldShowLineup("#gear", null)).toBe(false);
    expect(shouldShowLineup("#c/us:sir-stackers", null)).toBe(false);
  });

  it("opens the lineup from #select even after the visitor has entered", () => {
    expect(shouldShowLineup("#select", "1")).toBe(true);
    expect(shouldShowLineup("#select", null)).toBe(true);
    expect(shouldShowLineup("#/select", "1")).toBe(true);
    expect(lineupExit("#select")).toBe("push");
    expect(lineupExit("")).toBe("replace");
    expect(lineupExit("#questing")).toBe("keep");
    const html = renderToStaticMarkup(BrandLink());
    expect(html).toContain('href="#select"');
    expect(html).toContain("Bis-ness");
    expect(html).toContain("Casual");
  });

  it("reads a character deep link and ignores other hashes", () => {
    expect(characterKeyFromHash("#c/us:sir-stackers")).toBe("us:sir-stackers");
    expect(characterKeyFromHash("#questing")).toBeNull();
    expect(characterKeyFromHash("")).toBeNull();
  });
});

describe("Armory render files", () => {
  it("prefers the full-body render over inset and avatar", () => {
    expect(
      pickMediaUrl([
        { key: "avatar", value: "https://example.test/avatar.jpg" },
        { key: "inset", value: "https://example.test/inset.jpg" },
        { key: "main-raw", value: "https://example.test/main-raw.png" },
      ]),
    ).toBe("https://example.test/main-raw.png");
    expect(pickMediaUrl([{ key: "avatar", value: "https://example.test/avatar.jpg" }])).toBe("https://example.test/avatar.jpg");
    expect(pickMediaUrl([])).toBeNull();
  });

  it("recognizes PNG and JPEG bytes and skips an unchanged file", () => {
    expect(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(imageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("jpg");
    expect(imageExtension(new Uint8Array([0x00, 0x01]))).toBeNull();
    expect(
      renderWriteNeeded({
        previousHash: "abc",
        nextHash: "abc",
        previousFile: "characters/daz-dingomon.png",
        nextFile: "characters/daz-dingomon.png",
        fileExists: true,
      }),
    ).toBe(false);
    expect(
      renderWriteNeeded({
        previousHash: "abc",
        nextHash: "def",
        previousFile: "characters/daz-dingomon.png",
        nextFile: "characters/daz-dingomon.png",
        fileExists: true,
      }),
    ).toBe(true);
    expect(publicAssetUrl("./", "characters/daz-dingomon.png", "abc")).toBe("./characters/daz-dingomon.png?v=abc");
  });

  it("trims empty margin once and leaves that file alone on the next pass", () => {
    const png = new PNG({ width: 40, height: 30 });
    png.data.fill(0);
    const index = (10 * 40 + 8) * 4;
    png.data[index] = 255;
    png.data[index + 3] = 255;
    const raw = PNG.sync.write(png);
    const once = trimCharacterPng(raw);
    const twice = trimCharacterPng(once);
    const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    expect(once.byteLength).toBeLessThan(raw.byteLength);
    expect(hash(twice)).toBe(hash(once));
  });

  it("treats a new render hash as a snapshot change", () => {
    const profile = { slug: "daz-dingomon", renderHash: "aaa" } as SavedProfile;
    expect(snapshotChanged([profile], [{ ...profile, renderHash: "bbb" }])).toBe(true);
    expect(snapshotChanged([profile], [{ ...profile, fetchedAt: "2026-11-14T00:00:00.000Z" } as SavedProfile])).toBe(false);
  });
});
