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
import { classifyQuest, type GuideStep, type ObjectiveKind, type QuestRecord } from "../src/lib/quests.ts";

const API = "https://wowhelm.com/api/v1/forever/quests";
const CACHE = "/tmp/bis-quests/quests.jsonl";
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
}

function labelText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(labelText).join("");
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function compact(payload: Record<string, unknown>): RawQuest {
  const guide = Array.isArray(payload.guide) ? payload.guide : [];
  const steps: GuideStep[] = [];
  for (const entry of guide) {
    const step = asRecord(entry);
    if (!step || typeof step.type !== "string") continue;
    const more = Array.isArray(step.more) ? step.more.map(labelText).join(" ") : "";
    steps.push({ type: step.type, moreText: more });
  }
  const classes = Array.isArray(payload.classes) ? payload.classes.filter((name): name is string => typeof name === "string") : [];
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

async function getJson(url: string): Promise<unknown> {
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
    });
  }
  quests.sort((a, b) => a.id - b.id);
  const catalog = {
    source:
      "Wowhelm Forever quest API (https://wowhelm.com/api/v1/forever/quests), which reads the Warcraft Forever client and QuestieDB objective steps (GPL-3.0, https://github.com/Questie/QuestieDB). Objective kind is taken from those steps: kill, collect marked Drops from, collect marked Found in, or a talk/escort/explore step. Steps with no such mark stay unknown.",
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

mkdirSync("/tmp/bis-quests", { recursive: true });
const cache = loadCache();
if (!process.argv.includes("--compile-only")) {
  const ids = await listIds();
  await fetchMissing(ids, cache);
}
publish(loadCache());
