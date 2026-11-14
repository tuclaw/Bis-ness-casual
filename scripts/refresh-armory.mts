/**
 * Refresh the baked Forever character snapshots.
 *
 * Uses the Blizzard Profile API (profile-forever-{region}) when
 * BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are set. Otherwise, or when a
 * character request fails, it parses the official Armory HTML. Gear is only
 * what those responses contain.
 *
 * Every run re-downloads each character image. Profile API character-media is
 * tried first (main-raw, then main, inset, avatar). The Armory page render is
 * the fallback. A file is written only when its bytes changed, and renderHash
 * cache-busts the static site.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  armoryStateFromProfileApi,
  characterFromArmoryState,
  parseArmoryHtml,
  profileFromCharacter,
} from "../src/lib/armory.ts";
import { specFromArmory } from "../src/lib/classes.ts";
import { imageExtension, pickMediaUrl, renderWriteNeeded, type MediaAsset } from "../src/lib/renders.ts";
import { trimCharacterPng } from "./trim-png.mts";
import { snapshotChanged } from "../src/lib/snapshot.ts";
import type { SavedProfile, SpecId } from "../src/lib/types.ts";

const PUBLIC_ROOT = new URL("../public/", import.meta.url);

interface WatchEntry {
  slug: string;
  region: string;
}

const CONFIG_PATH = new URL("../characters.config.json", import.meta.url);
const SNAPSHOT_PATH = new URL("../src/data/characters.json", import.meta.url);

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function localeFor(region: string): string {
  if (region === "eu") return "en_GB";
  if (region === "kr") return "ko_KR";
  if (region === "tw") return "zh_TW";
  return "en_US";
}

async function blizzardToken(): Promise<string | null> {
  const id = process.env.BLIZZARD_CLIENT_ID?.trim();
  const secret = process.env.BLIZZARD_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    console.log("Blizzard client credentials are not set. Parsing Armory pages.");
    return null;
  }
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    console.warn(`Blizzard token request failed (${response.status}). Parsing Armory pages.`);
    return null;
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    console.warn("Blizzard token response had no access_token. Parsing Armory pages.");
    return null;
  }
  console.log("Using Blizzard Profile API namespace profile-forever-{region}.");
  return payload.access_token;
}

async function apiGet(token: string, url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as Record<string, unknown>;
}

async function profileFromApi(token: string, entry: WatchEntry, previous: SavedProfile | undefined, fetchedAt: string): Promise<SavedProfile> {
  const { region, slug } = entry;
  const locale = localeFor(region);
  const base = `https://${region}.api.blizzard.com/profile/wow/character/${slug}`;
  const profileQuery = `namespace=profile-forever-${region}&locale=${locale}`;
  const summary = await apiGet(token, `${base}?${profileQuery}`);
  if (!summary) throw new Error(`Profile API has no character ${slug} on ${region}`);
  const equipment = await apiGet(token, `${base}/equipment?${profileQuery}`);
  if (!equipment || !Array.isArray(equipment.equipped_items) || equipment.equipped_items.length === 0) {
    throw new Error(`Profile API returned no equipped items for ${slug}`);
  }
  const [statistics, specializations, professions, media, pvp] = await Promise.all([
    apiGet(token, `${base}/statistics?${profileQuery}`),
    apiGet(token, `${base}/specializations?${profileQuery}`),
    apiGet(token, `${base}/professions?${profileQuery}`),
    apiGet(token, `${base}/character-media?${profileQuery}`),
    apiGet(token, `${base}/pvp-summary?${profileQuery}`),
  ]);

  const iconUrls: Record<number, string> = {};
  const ids = [
    ...new Set(
      (equipment.equipped_items as unknown[]).flatMap((raw) => {
        const item = raw && typeof raw === "object" ? (raw as { item?: { id?: number } }).item : undefined;
        return typeof item?.id === "number" ? [item.id] : [];
      }),
    ),
  ];
  await Promise.all(
    ids.map(async (itemId) => {
      const mediaDoc = await apiGet(
        token,
        `https://${region}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=static-forever-${region}&locale=${locale}`,
      );
      const assets = Array.isArray(mediaDoc?.assets) ? mediaDoc.assets : [];
      const icon = assets.find((asset) => asset && typeof asset === "object" && (asset as { key?: string }).key === "icon") as
        | { value?: string }
        | undefined;
      if (icon?.value) iconUrls[itemId] = icon.value;
    }),
  );

  const state = armoryStateFromProfileApi({
    summary,
    equipment,
    statistics,
    specializations,
    professions,
    media,
    pvp,
    iconUrls,
    region,
  });
  const character = characterFromArmoryState(state);
  if (!character.gear.length) throw new Error(`Profile API gear for ${slug} did not parse`);
  return finishProfile(character, entry, previous, fetchedAt, "blizzard-api", `Blizzard Profile API profile-forever-${region}.`);
}

async function profileFromArmoryPage(entry: WatchEntry, previous: SavedProfile | undefined, fetchedAt: string): Promise<SavedProfile> {
  const { region, slug } = entry;
  const url = `https://worldofwarcraft.blizzard.com/en-us/forever/${region}/armory/character/${slug}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Bis-nessCasual/1.0; +https://github.com/tuclaw/Bis-ness-casual)" },
  });
  if (!response.ok) throw new Error(`Armory page ${url} returned ${response.status}`);
  const html = await response.text();
  const state = parseArmoryHtml(html);
  if (!state) throw new Error(`Armory page for ${slug} had no characterProfileInitialState`);
  const character = characterFromArmoryState(state);
  if (!character.gear.length) throw new Error(`Armory page for ${slug} had no gear`);
  return finishProfile(character, entry, previous, fetchedAt, "armory-snapshot", "Official Forever Armory page. Profile API credentials were not used.");
}

function finishProfile(
  character: ReturnType<typeof characterFromArmoryState>,
  entry: WatchEntry,
  previous: SavedProfile | undefined,
  fetchedAt: string,
  source: SavedProfile["source"],
  note: string,
): SavedProfile {
  const published = character.specs
    .map((spec) => ({ spec: specFromArmory(character.classId, spec.name), spent: spec.spent, active: spec.active }))
    .filter((spec): spec is { spec: SpecId; spent: number; active: boolean } => spec.spec != null)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.spent - a.spent);
  const mainSpec = (published[0]?.spec ?? previous?.mainSpec) as SpecId | undefined;
  const otherPublished = published.find((spec) => spec.spec !== mainSpec)?.spec ?? null;
  const offSpec = otherPublished ?? (previous?.offSpec && previous.offSpec !== mainSpec ? previous.offSpec : null);
  const offNote = otherPublished
    ? ""
    : offSpec
      ? " The off spec is the previously saved profile; this pull only included the active spec."
      : "";
  const profile = profileFromCharacter(character, {
    slug: entry.slug,
    region: entry.region,
    source,
    note: `${note}${offNote}`,
    mainSpec,
    offSpec,
  });
  profile.fetchedAt = fetchedAt;
  return profile;
}

async function refreshOne(token: string | null, entry: WatchEntry, previous: SavedProfile | undefined, fetchedAt: string): Promise<SavedProfile> {
  if (token) {
    try {
      return await profileFromApi(token, entry, previous, fetchedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      console.warn(`Profile API failed for ${entry.slug} (${message}). Trying the Armory page.`);
    }
  }
  return profileFromArmoryPage(entry, previous, fetchedAt);
}

function fileUrl(relativePath: string): URL {
  return new URL(relativePath, PUBLIC_ROOT);
}

function assetList(doc: Record<string, unknown> | null): MediaAsset[] {
  const assets = Array.isArray(doc?.assets) ? doc.assets : [];
  return assets.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as { key?: unknown; value?: unknown };
    return [{ key: typeof row.key === "string" ? row.key : null, value: typeof row.value === "string" ? row.value : null }];
  });
}

async function mediaDocument(token: string | null, entry: WatchEntry): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const locale = localeFor(entry.region);
  try {
    return await apiGet(
      token,
      `https://${entry.region}.api.blizzard.com/profile/wow/character/${entry.slug}/character-media?namespace=profile-forever-${entry.region}&locale=${locale}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.warn(`character-media failed for ${entry.slug} (${message}). Using the Armory page image.`);
    return null;
  }
}

async function downloadImage(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Bis-nessCasual/1.0; +https://github.com/tuclaw/Bis-ness-casual)" },
  });
  if (!response.ok) {
    console.warn(`Image ${url} returned ${response.status}`);
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!imageExtension(bytes)) {
    console.warn(`Image ${url} was not a PNG or JPEG`);
    return null;
  }
  return bytes;
}

function storeImage(args: {
  bytes: Uint8Array;
  relativePath: string;
  previousFile?: string | null;
  previousHash?: string | null;
}): { file: string; hash: string; wrote: boolean } {
  const hash = createHash("sha256").update(args.bytes).digest("hex").slice(0, 12);
  const dest = fileUrl(args.relativePath);
  const write = renderWriteNeeded({
    previousHash: args.previousHash,
    nextHash: hash,
    previousFile: args.previousFile,
    nextFile: args.relativePath,
    fileExists: existsSync(dest),
  });
  if (write) {
    mkdirSync(new URL("./", dest), { recursive: true });
    writeFileSync(dest, args.bytes);
    if (args.previousFile && args.previousFile !== args.relativePath) {
      const old = fileUrl(args.previousFile);
      if (existsSync(old)) unlinkSync(old);
    }
  }
  return { file: args.relativePath, hash, wrote: write };
}

async function refreshImages(token: string | null, entry: WatchEntry, profile: SavedProfile, previous: SavedProfile | undefined): Promise<boolean> {
  const media = await mediaDocument(token, entry);
  const assets = assetList(media);
  const avatarFromApi = assets.find((asset) => asset.key === "avatar" && asset.value)?.value ?? null;
  const renderUrl = pickMediaUrl(assets) ?? profile.character.modelUrl ?? profile.character.portraitUrl ?? null;
  const avatarUrl = avatarFromApi ?? profile.character.portraitUrl ?? null;
  let wrote = false;

  if (!renderUrl) console.warn(`No Armory render for ${entry.slug}`);
  const renderBytes = renderUrl ? await downloadImage(renderUrl) : null;
  if (renderBytes) {
    const ext = imageExtension(renderBytes);
    if (ext) {
      const trimmed = ext === "png" ? trimCharacterPng(renderBytes) : renderBytes;
      const saved = storeImage({
        bytes: trimmed,
        relativePath: `characters/${entry.slug}.${ext}`,
        previousFile: previous?.renderFile,
        previousHash: previous?.renderHash,
      });
      profile.renderFile = saved.file;
      profile.renderHash = saved.hash;
      wrote ||= saved.wrote;
      console.log(`${entry.slug} render ${saved.wrote ? "updated" : "unchanged"} ${saved.hash}`);
    }
  } else if (previous?.renderFile && previous.renderHash) {
    profile.renderFile = previous.renderFile;
    profile.renderHash = previous.renderHash;
    console.warn(`Kept the previous render for ${entry.slug}`);
  }

  if (avatarUrl && avatarUrl !== renderUrl) {
    const avatarBytes = await downloadImage(avatarUrl);
    if (avatarBytes) {
      const ext = imageExtension(avatarBytes);
      if (ext) {
        const saved = storeImage({
          bytes: avatarBytes,
          relativePath: `characters/${entry.slug}-avatar.${ext}`,
          previousFile: previous?.avatarFile,
          previousHash: previous?.avatarHash,
        });
        profile.avatarFile = saved.file;
        profile.avatarHash = saved.hash;
        wrote ||= saved.wrote;
        console.log(`${entry.slug} avatar ${saved.wrote ? "updated" : "unchanged"} ${saved.hash}`);
      }
    } else if (previous?.avatarFile && previous.avatarHash) {
      profile.avatarFile = previous.avatarFile;
      profile.avatarHash = previous.avatarHash;
    }
  }
  return wrote;
}

function markChanged(changed: boolean) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(output, `changed=${changed ? "true" : "false"}\n`);
}

const config = readJson<{ characters: WatchEntry[] }>(CONFIG_PATH);
if (!Array.isArray(config.characters) || config.characters.length === 0) {
  throw new Error("characters.config.json needs a characters list");
}
const previous = readJson<SavedProfile[]>(SNAPSHOT_PATH);
const fetchedAt = new Date().toISOString();
const token = await blizzardToken();
const next: SavedProfile[] = [];
let imagesWritten = false;
for (const entry of config.characters) {
  if (!entry.slug || !entry.region) throw new Error("Each character needs a slug and a region");
  const prior = previous.find((profile) => profile.slug === entry.slug && profile.region === entry.region);
  const profile = await refreshOne(token, entry, prior, fetchedAt);
  const wroteImage = await refreshImages(token, entry, profile, prior);
  imagesWritten ||= wroteImage;
  console.log(`${profile.region}/${profile.slug} level ${profile.character.level} via ${profile.source} (${profile.character.gear.length} pieces)`);
  next.push(profile);
}

if (!snapshotChanged(previous, next) && !imagesWritten) {
  console.log("Armory data is unchanged. Not writing a new snapshot.");
  markChanged(false);
} else {
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${SNAPSHOT_PATH.pathname} at ${fetchedAt}`);
  markChanged(true);
}
