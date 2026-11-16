/**
 * Build public/data/quests.json from the Wowhelm Forever quest API.
 *
 * Wowhelm reads Warcraft Forever client data (build reported on each quest)
 * and QuestieDB for objective steps. The list endpoint has no objectives, so
 * each quest is fetched once. A JSONL cache in /tmp lets a rerun resume.
 *
 * Nothing here invents a quest. A collect step is a drop only when the guide
 * says "Drops from", and a gather only when it says the item is found in an object.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  classifyActions,
  classifyQuest,
  type GuideStep,
  type ObjectiveKind,
  type QuestPin,
  type QuestRecord,
} from "../src/lib/quests.ts";

const API = "https://wowhelm.com/api/v1/forever/quests";
const CACHE = "/tmp/bis-quests/quests.jsonl";
const RICH = "/tmp/bis-quests/rich.jsonl";
const OUT = new URL("../public/data/quests.json", import.meta.url);
const PACE_MS = 560;

interface RawQuest {
  id: number;
  name: string;
  level: number | null;
  req: number | null;
  zone: string | null;
  faction: string;
  classes: string[];
  xp: number | null;
  steps: GuideStep[];
  build: string | null;
  giver?: string | null;
  chainPosition?: number | null;
  chainTotal?: number | null;
  pins?: QuestPin[];
}

function labelText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(labelText).join("");
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function finitePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function pinFrom(role: QuestPin["role"], where: unknown): QuestPin | null {
  const record = asRecord(where);
  if (!record || typeof record.zone !== "string" || !record.zone.trim()) return null;
  const x = finitePercent(record.x);
  const y = finitePercent(record.y);
  if (x == null || y == null) return null;
  return { role, zone: record.zone.trim(), x, y };
}

function compact(payload: Record<string, unknown>): RawQuest {
  const guide = Array.isArray(payload.guide) ? payload.guide : [];
  const steps: GuideStep[] = [];
  const pins: QuestPin[] = [];
  for (const entry of guide) {
    const step = asRecord(entry);
    if (!step || typeof step.type !== "string") continue;
    const more = Array.isArray(step.more) ? step.more.map(labelText).join(" ") : "";
    steps.push({ type: step.type, moreText: more });
    const type = step.type.trim().toLowerCase();
    const role = type === "start" ? "giver" : type === "finish" ? "turnin" : type === "before" || type === "after" ? null : "objective";
    if (role) {
      const pin = pinFrom(role, step.where);
      if (pin && !pins.some((have) => have.role === pin.role && have.zone === pin.zone && have.x === pin.x && have.y === pin.y)) {
        pins.push(pin);
      }
    }
  }
  const classes = Array.isArray(payload.classes) ? payload.classes.filter((name): name is string => typeof name === "string") : [];
  const started = Array.isArray(payload.startedBy) ? asRecord(payload.startedBy[0]) : null;
  const chain = asRecord(payload.chain);
  const chainTotal = typeof chain?.total === "number" ? chain.total : null;
  const chainPosition = typeof chain?.position === "number" ? chain.position : null;
  return {
    id: Number(payload.id),
    name: String(payload.name ?? ""),
    level: typeof payload.level === "number" ? payload.level : null,
    req: typeof payload.requiredLevel === "number" ? payload.requiredLevel : null,
    zone: typeof payload.zone === "string" && payload.zone.trim() ? payload.zone.trim() : null,
    faction: typeof payload.faction === "string" ? payload.faction : "",
    classes,
    xp: typeof payload.xp === "number" ? payload.xp : null,
    steps,
    build: typeof payload.build === "string" ? payload.build : null,
    giver: started && typeof started.name === "string" ? started.name : null,
    chainPosition: chainTotal != null && chainTotal > 1 ? chainPosition : null,
    chainTotal: chainTotal != null && chainTotal > 1 ? chainTotal : null,
    pins: pins.slice(0, 6),
  };
}

function loadCache(): Map<number, RawQuest> {
  const found = new Map<number, RawQuest>();
  if (!existsSync(CACHE)) return found;
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as RawQuest;
    found.set(row.id, row);
  }
  return found;
}

async function getJson(url: string, paced = true): Promise<unknown> {
  if (paced) await pace();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "Bis-ness-casual quest catalog" } });
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "5");
      await sleep((Number.isFinite(wait) ? wait : 5) * 1000 + 250);
      continue;
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    return response.json();
  }
  throw new Error(`Failed ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextAt = 0;
function pace(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextAt);
  nextAt = start + PACE_MS;
  const wait = start - now;
  return wait > 0 ? sleep(wait) : Promise.resolve();
}

async function listIds(): Promise<number[]> {
  const ids: number[] = [];
  let page = 1;
  let pages = 1;
  while (page <= pages) {
    await pace();
    const payload = (await getJson(`${API}?limit=100&page=${page}&sort=n`)) as {
      quests: Array<{ id: number }>;
      pages: number;
    };
    pages = payload.pages;
    for (const quest of payload.quests) ids.push(quest.id);
    page += 1;
    if (page % 10 === 0) console.log(`listed ${ids.length} through page ${page - 1}/${pages}`);
  }
  return ids;
}

async function fetchMissing(ids: number[], cache: Map<number, RawQuest>): Promise<void> {
  const pending = ids.filter((id) => !cache.has(id));
  console.log(`cached ${cache.size}, fetching ${pending.length}`);
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const id = pending[index]!;
      await pace();
      const payload = await getJson(`${API}/${id}`);
      const record = payload ? compact(asRecord(payload) ?? {}) : compact({ id, name: "", guide: [] });
      if (!payload) record.name = "";
      appendFileSync(CACHE, `${JSON.stringify(record)}\n`);
      cache.set(id, record);
      done += 1;
      if (done % 100 === 0) console.log(`fetched ${done}/${pending.length}`);
    }
  }
  await Promise.all([worker(), worker()]);
}

function publish(cache: Map<number, RawQuest>): void {
  const typeCounts = new Map<string, number>();
  const quests: QuestRecord[] = [];
  let build: string | null = null;
  let objectiveSteps = 0;
  let unknownObjectives = 0;
  for (const raw of cache.values()) {
    if (!raw.name) continue;
    build ??= raw.build;
    for (const step of raw.steps) {
      typeCounts.set(step.type, (typeCounts.get(step.type) ?? 0) + 1);
    }
    const objectives: ObjectiveKind[] = classifyQuest(raw.steps);
    objectiveSteps += objectives.length;
    unknownObjectives += objectives.filter((kind) => kind === "unknown").length;
    quests.push({
      id: raw.id,
      name: raw.name,
      level: raw.level,
      req: raw.req,
      zone: raw.zone,
      faction: raw.faction,
      classes: raw.classes,
      xp: raw.xp,
      objectives,
      actions: classifyActions(raw.steps),
      giver: raw.giver ?? null,
      chainPosition: raw.chainPosition ?? null,
      chainTotal: raw.chainTotal ?? null,
      pins: raw.pins ?? [],
    });
  }
  quests.sort((a, b) => a.id - b.id);
  const catalog = {
    source:
      "Wowhelm Forever quest API (https://wowhelm.com/api/v1/forever/quests), which reads the Warcraft Forever client and QuestieDB objective steps (GPL-3.0, https://github.com/Questie/QuestieDB). Objective kind is taken from those steps: kill, collect marked Drops from, collect marked Found in, or a talk/escort/explore step. Steps with no such mark stay unknown. Giver, chain position, and map pins are the startedBy, chain, and guide where fields from that same response. Pins are a percent of the named zone map.",
    build,
    total: quests.length,
    objectiveSteps,
    unknownObjectives,
    quests,
  };
  writeFileSync(OUT, JSON.stringify(catalog));
  const known = objectiveSteps === 0 ? 0 : (objectiveSteps - unknownObjectives) / objectiveSteps;
  console.log(
    JSON.stringify(
      {
        total: quests.length,
        objectiveSteps,
        unknownObjectives,
        knownPct: Math.round(known * 1000) / 10,
        build,
        stepTypes: Object.fromEntries([...typeCounts.entries()].sort((a, b) => b[1] - a[1])),
      },
      null,
      2,
    ),
  );
}

async function enrich(): Promise<void> {
  const ids = await listIds();
  const have = new Set<number>();
  if (existsSync(RICH)) {
    for (const line of readFileSync(RICH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { id?: number };
      if (typeof row.id === "number") have.add(row.id);
    }
  }
  const pending = ids.filter((id) => !have.has(id));
  console.log(`rich ${have.size}, fetching ${pending.length}`);
  const batch = 24;
  for (let index = 0; index < pending.length; index += batch) {
    const slice = pending.slice(index, index + batch);
    const rows = await Promise.all(
      slice.map(async (id) => {
        const payload = await getJson(`${API}/${id}`, false);
        const record = payload ? compact(asRecord(payload) ?? {}) : compact({ id, name: "", guide: [] });
        if (!payload) record.name = "";
        return record;
      }),
    );
    appendFileSync(RICH, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    if ((index / batch) % 10 === 0) console.log(`enriched ${Math.min(index + batch, pending.length)}/${pending.length}`);
  }
}

mkdirSync("/tmp/bis-quests", { recursive: true });
if (process.argv.includes("--enrich")) {
  await enrich();
}
const useRich = process.argv.includes("--rich") || existsSync(RICH);
const cachePath = useRich ? RICH : CACHE;
function loadChosen(): Map<number, RawQuest> {
  const found = new Map<number, RawQuest>();
  if (!existsSync(cachePath)) return found;
  for (const line of readFileSync(cachePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as RawQuest;
    found.set(row.id, row);
  }
  return found;
}
if (!process.argv.includes("--compile-only") && !process.argv.includes("--enrich")) {
  const cache = loadCache();
  const ids = await listIds();
  await fetchMissing(ids, cache);
}
if (!process.argv.includes("--enrich-only")) publish(loadChosen());
