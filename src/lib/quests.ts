import type { Faction } from "./types.ts";

/** Objective kinds a duo can plan around. Drop is the one that depends on a shared roll. */
export type ObjectiveKind = "slay" | "drop" | "gather" | "errand" | "unknown";

export const OBJECTIVE_KINDS: ObjectiveKind[] = ["slay", "drop", "gather", "errand", "unknown"];

export const OBJECTIVE_LABEL: Record<ObjectiveKind, string> = {
  slay: "Slay",
  drop: "Drop",
  gather: "Gather",
  errand: "Errand",
  unknown: "Unknown",
};

/** Pickup and turn-in steps are not objectives. A quest that is only those is an errand. */
const SKIPPED_STEPS = new Set(["before", "after", "start", "finish", "return", "accept", "turnin", "turn-in"]);

const ERRAND_STEPS = new Set([
  "escort",
  "explore",
  "event",
  "talk",
  "use",
  "interact",
  "deliver",
  "complete",
  "reputation",
  "goto",
  "go",
  "listen",
  "discover",
  "visit",
  "emote",
  "cast",
  "spell",
  "item",
  "use-item",
  "protect",
]);

export interface GuideStep {
  type: string;
  /** Joined label text from the guide, such as "Drops from " or "Found in ". */
  moreText?: string;
}

export interface QuestRecord {
  id: number;
  name: string;
  level: number | null;
  req: number | null;
  zone: string | null;
  faction: string;
  classes: string[];
  xp: number | null;
  objectives: ObjectiveKind[];
}

export interface QuestCatalog {
  source: string;
  build: string | null;
  total: number;
  objectiveSteps: number;
  unknownObjectives: number;
  quests: QuestRecord[];
}

export function classifyStep(step: GuideStep): ObjectiveKind | null {
  const type = step.type.trim().toLowerCase();
  if (!type || SKIPPED_STEPS.has(type)) return null;
  if (type === "kill" || type === "slay") return "slay";
  if (type === "gather") return "gather";
  if (type === "collect" || type === "loot") {
    const more = (step.moreText ?? "").trim().toLowerCase();
    if (more.startsWith("drops from") || more.startsWith("dropped by") || more.startsWith("drop from")) return "drop";
    if (more.startsWith("sold by")) return "errand";
    if (
      more.startsWith("found in") ||
      more.startsWith("contained in") ||
      more.startsWith("fished from") ||
      more.startsWith("mined from") ||
      more.startsWith("gathered from") ||
      more.startsWith("picked from") ||
      more.startsWith("looted from")
    ) {
      return "gather";
    }
    return "unknown";
  }
  if (ERRAND_STEPS.has(type)) return "errand";
  return "unknown";
}

/** One kind per objective step. A quest with only a turn-in is an errand, not unknown. */
export function classifyQuest(steps: GuideStep[]): ObjectiveKind[] {
  const objectives: ObjectiveKind[] = [];
  for (const step of steps) {
    const kind = classifyStep(step);
    if (kind) objectives.push(kind);
  }
  if (objectives.length > 0) return objectives;
  if (steps.some((step) => SKIPPED_STEPS.has(step.type.trim().toLowerCase()))) return ["errand"];
  return ["unknown"];
}

export function wowheadQuestUrl(id: number, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://www.wowhead.com/forever/quest=${id}/${slug}`;
}

export function isDuoFriendly(objectives: ObjectiveKind[], gatherFriendly: boolean): boolean {
  const known = objectives.filter((kind) => kind !== "unknown");
  if (known.length === 0) return false;
  if (known.includes("drop")) return false;
  if (known.includes("slay") || known.includes("errand")) return true;
  if (known.includes("gather")) return gatherFriendly;
  return false;
}

export interface RankedQuest extends QuestRecord {
  friendly: boolean;
}

export interface ZoneRank {
  zone: string;
  score: number;
  inWindow: number;
  friendly: number;
  share: number;
  xp: number;
  levelMin: number;
  levelMax: number;
  byType: Record<ObjectiveKind, number>;
  quests: RankedQuest[];
}

function emptyCounts(): Record<ObjectiveKind, number> {
  return { slay: 0, drop: 0, gather: 0, errand: 0, unknown: 0 };
}

function factionMatches(questFaction: string, faction: Faction): boolean {
  const value = questFaction.trim().toLowerCase();
  if (value === "both") return true;
  return value === faction;
}

function classMatches(classes: string[], className: string | null): boolean {
  if (!className || classes.length === 0) return true;
  const want = className.trim().toLowerCase();
  return classes.some((name) => name.trim().toLowerCase() === want);
}

/**
 * Rank zones for a duo. Friendly quests have no mob-drop objective.
 * Gather quests count only when `gatherFriendly` is set, unless the quest also has a slay or errand objective.
 * Score is the friendly count, raised by the friendly share, plus XP on those quests at 1 point per 10,000 XP.
 */
export function rankZones(args: {
  quests: QuestRecord[];
  level: number;
  window: number;
  faction: Faction;
  className?: string | null;
  gatherFriendly: boolean;
}): ZoneRank[] {
  const low = Math.max(1, args.level - args.window);
  const high = Math.min(60, args.level + args.window);
  const grouped = new Map<string, RankedQuest[]>();

  for (const quest of args.quests) {
    if (!quest.zone) continue;
    if (quest.level == null || quest.level < low || quest.level > high) continue;
    if (quest.req != null && quest.req > high) continue;
    if (!factionMatches(quest.faction, args.faction)) continue;
    if (!classMatches(quest.classes, args.className ?? null)) continue;
    const friendly = isDuoFriendly(quest.objectives, args.gatherFriendly);
    const list = grouped.get(quest.zone) ?? [];
    list.push({ ...quest, friendly });
    grouped.set(quest.zone, list);
  }

  const ranks: ZoneRank[] = [];
  for (const [zone, quests] of grouped) {
    const byType = emptyCounts();
    let xp = 0;
    let friendly = 0;
    let levelMin = 60;
    let levelMax = 1;
    for (const quest of quests) {
      if (quest.friendly) {
        friendly += 1;
        xp += quest.xp ?? 0;
      }
      if (quest.level != null) {
        levelMin = Math.min(levelMin, quest.level);
        levelMax = Math.max(levelMax, quest.level);
      }
      const seen = new Set(quest.objectives);
      for (const kind of seen) byType[kind] += 1;
    }
    const inWindow = quests.length;
    const share = inWindow ? friendly / inWindow : 0;
    const score = friendly * (1 + share) + xp / 10000;
    quests.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name) || a.id - b.id);
    ranks.push({ zone, score, inWindow, friendly, share, xp, levelMin, levelMax, byType, quests });
  }

  ranks.sort((a, b) => b.score - a.score || b.friendly - a.friendly || a.zone.localeCompare(b.zone));
  return ranks;
}
