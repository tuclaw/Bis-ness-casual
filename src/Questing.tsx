import { useEffect, useMemo, useState } from "react";
import {
  ACTION_LABEL,
  DURATION_NOTE,
  OBJECTIVE_KINDS,
  OBJECTIVE_LABEL,
  QUEST_ACTIONS,
  listZoneQuests,
  nextOpenZone,
  rankZones,
  wowheadQuestUrl,
  type QuestAction,
  type QuestCatalog,
  type QuestListSort,
  type ZoneRank,
} from "./lib/quests.ts";
import type { Faction, SavedProfile } from "./lib/types.ts";

const WINDOW_KEY = "bis-ness-casual-quest-window";
const GATHER_KEY = "bis-ness-casual-quest-gather";

export function QuestingPage({ character }: { character: SavedProfile["character"] }) {
  const [catalog, setCatalog] = useState<QuestCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualLevel, setManualLevel] = useState(character.level);
  const [manualFaction, setManualFaction] = useState<Faction>(character.faction);
  const [windowN, setWindowN] = useState(loadWindow);
  const [gatherFriendly, setGatherFriendly] = useState(loadGather);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<QuestListSort>("xp");
  const [typeFilter, setTypeFilter] = useState<QuestAction[] | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}data/quests.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error("quests");
        setCatalog((await response.json()) as QuestCatalog);
      })
      .catch(() => setError("The Forever quest catalog did not load. Refresh the page."));
  }, []);

  useEffect(() => {
    localStorage.setItem(WINDOW_KEY, String(windowN));
  }, [windowN]);

  useEffect(() => {
    localStorage.setItem(GATHER_KEY, gatherFriendly ? "1" : "0");
  }, [gatherFriendly]);

  const level = manual ? manualLevel : character.level;
  const faction = manual ? manualFaction : character.faction;
  const className = manual ? null : character.className;
  const low = Math.max(1, level - windowN);
  const high = Math.min(60, level + windowN);

  const ranks = useMemo(() => {
    if (!catalog) return [];
    return rankZones({
      quests: catalog.quests,
      level,
      window: windowN,
      faction,
      className,
      gatherFriendly,
    });
  }, [catalog, level, windowN, faction, className, gatherFriendly]);

  useEffect(() => {
    if (!selected) return;
    document.getElementById("zone-quest-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  return (
    <section className="questing" aria-label="Questing planner">
      <section className="toolbar" aria-label="Questing controls">
        <label className="check">
          <input type="checkbox" checked={manual} onChange={(event) => setManual(event.target.checked)} />
          Set level and faction manually
        </label>
        {manual && (
          <>
            <label className="field">
              Level
              <input
                type="number"
                min={1}
                max={60}
                value={manualLevel}
                aria-label="Manual level"
                onChange={(event) => setManualLevel(clampLevel(Number(event.target.value)))}
              />
            </label>
            <label className="field">
              Faction
              <select
                value={manualFaction}
                aria-label="Manual faction"
                onChange={(event) => setManualFaction(event.target.value as Faction)}
              >
                <option value="horde">Horde</option>
                <option value="alliance">Alliance</option>
              </select>
            </label>
          </>
        )}
        <label className="slider">
          <span>
            Level window <b className="num">± {windowN}</b> <span className="fine">{low}–{high}</span>
          </span>
          <input
            type="range"
            min={0}
            max={20}
            value={windowN}
            aria-valuetext={`quest levels ${low} to ${high}`}
            onChange={(event) => setWindowN(clampWindow(Number(event.target.value)))}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={gatherFriendly} onChange={(event) => setGatherFriendly(event.target.checked)} />
          Count object gathering as duo-friendly
        </label>
        <p className="fine">
          {manual
            ? `Using level ${level} ${faction}, every class.`
            : `Using ${character.name} ${character.surname}, level ${level} ${faction} ${character.className}. Other classes' quests are left out.`}{" "}
          Slay and errands (deliver, talk, explore, escort, use an item) count. Mob drops do not. A quest with any drop objective stays drop-dependent.
        </p>
      </section>

      {error && <p className="banner">{error}</p>}
      {!catalog && !error && <p className="fine">Loading the Forever quest catalog…</p>}

      {catalog && ranks.length === 0 && <p className="empty">No quests in this window for this faction.</p>}

      {ranks.length > 0 && (
        <>
          <section className="next-zone" aria-label="Next zone">
            <h2 className="kicker">Next zone</h2>
            <p className="zone-title">{ranks[0]!.zone}</p>
            <ZoneStats zone={ranks[0]!} />
          </section>

          <h2 className="section-label">Zones</h2>
          <ol className="zone-list">
            {ranks.map((zone, index) => {
              const open = zone.zone === selected;
              const listed = open ? listZoneQuests(zone.quests, { actions: typeFilter, sort }) : [];
              const maxXp = zone.quests.reduce((best, quest) => Math.max(best, quest.xp ?? 0), 0);
              return (
                <li key={zone.zone}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? "zone-quest-panel" : undefined}
                    onClick={() => setSelected((current) => nextOpenZone(current, zone.zone))}
                  >
                    <span className="zone-name">
                      <span>
                        <span className="rank">{index + 1}</span> {zone.zone}
                      </span>
                      <span className="num">{zone.friendly} duo</span>
                    </span>
                    <ZoneStats zone={zone} />
                  </button>
                  {open && (
                    <section id="zone-quest-panel" className="zone-detail" aria-label={`${zone.zone} quests`}>
                      <p className="fine" title={DURATION_NOTE}>
                        {DURATION_NOTE}
                      </p>
                      <div className="quest-tools">
                        <label className="field">
                          Sort
                          <select aria-label="Sort quests" value={sort} onChange={(event) => setSort(event.target.value as QuestListSort)}>
                            <option value="xp">Highest XP</option>
                            <option value="level">Level</option>
                            <option value="name">Name</option>
                            <option value="duo">Duo-friendly first</option>
                          </select>
                        </label>
                        <div className="quest-filters" role="group" aria-label="Quest type">
                          <button type="button" aria-pressed={typeFilter == null} onClick={() => setTypeFilter(null)}>
                            All
                          </button>
                          {QUEST_ACTIONS.map((action) => (
                            <button
                              key={action}
                              type="button"
                              aria-pressed={typeFilter?.includes(action) ?? false}
                              onClick={() =>
                                setTypeFilter((current) => {
                                  const base = current ?? [];
                                  const next = base.includes(action) ? base.filter((kind) => kind !== action) : [...base, action];
                                  return next.length ? next : null;
                                })
                              }
                            >
                              {ACTION_LABEL[action]}
                            </button>
                          ))}
                        </div>
                      </div>
                      {listed.length === 0 && <p className="empty">No quests in this zone match the type filter.</p>}
                      <div className="quest-list">
                        {listed.map((quest, questIndex) => {
                          const actions = quest.actions?.length ? quest.actions : (quest.objectives as QuestAction[]);
                          const drop = quest.objectives.includes("drop");
                          const xp = quest.xp ?? 0;
                          const xpTop = sort === "xp" && questIndex < 3 && xp > 0;
                          const width = maxXp > 0 ? Math.round((xp / maxXp) * 100) : 0;
                          return (
                            <article key={quest.id} className={`quest-row${drop ? " quest-drop" : ""}${xpTop ? " xp-top" : ""}`}>
                              <div>
                                <a href={wowheadQuestUrl(quest.id, quest.name)} target="_blank" rel="noreferrer">
                                  {quest.name}
                                </a>
                                <div className="sub">
                                  <span className="sub-text">
                                    lvl {quest.level ?? "—"}
                                    {quest.req != null ? ` · req ${quest.req}` : ""}
                                    {quest.faction ? ` · ${quest.faction}` : ""}
                                    {quest.giver ? ` · ${quest.giver}` : ""}
                                    {quest.chainTotal != null && quest.chainPosition != null
                                      ? ` · chain ${quest.chainPosition} of ${quest.chainTotal}`
                                      : ""}
                                  </span>
                                </div>
                                {drop && <div className="quest-drop-label">Drop-dependent. A duo shares this roll.</div>}
                                <div className="quest-xp-bar" aria-hidden="true">
                                  <span style={{ width: `${width}%` }} />
                                </div>
                              </div>
                              <div className="quest-side">
                                <span className="quest-xp">{quest.xp != null ? `${quest.xp.toLocaleString("en-US")} xp` : "No XP"}</span>
                                <div className="quest-kinds">{actionTags(actions)}</div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {catalog && (
        <p className="fine">
          {catalog.total.toLocaleString("en-US")} quests from the Wowhelm Forever API
          {catalog.build ? ` (client ${catalog.build})` : ""}.{" "}
          {catalog.objectiveSteps.toLocaleString("en-US")} objective steps,{" "}
          {catalog.unknownObjectives.toLocaleString("en-US")} unknown (
          {catalog.objectiveSteps
            ? `${(((catalog.objectiveSteps - catalog.unknownObjectives) / catalog.objectiveSteps) * 100).toFixed(1)}% known`
            : "no steps"}
          ). Objective steps come from QuestieDB (GPL-3.0) through{" "}
          <a href="https://wowhelm.com/api">Wowhelm</a>. Names and levels are the Forever client records that API publishes.{" "}
          <a href="https://github.com/Questie/QuestieDB">QuestieDB</a>.
        </p>
      )}
    </section>
  );
}

function ZoneStats({ zone }: { zone: ZoneRank }) {
  return (
    <span className="fine zone-stats">
      Levels {zone.levelMin}–{zone.levelMax} · {zone.inWindow} quests · {zone.friendly} duo-friendly (
      {Math.round(zone.share * 100)}%)
      {zone.xp > 0 ? ` · ${zone.xp.toLocaleString("en-US")} xp on duo quests` : ""}
      {" · "}
      {OBJECTIVE_KINDS.map((kind) => `${OBJECTIVE_LABEL[kind]} ${zone.byType[kind]}`).join(" · ")}
    </span>
  );
}

function actionTags(actions: QuestAction[]) {
  const unique = QUEST_ACTIONS.filter((kind) => actions.includes(kind));
  return unique.map((kind, index) => (
    <span key={kind}>
      {index > 0 ? " · " : ""}
      <span className={`kind-${kind}`}>{ACTION_LABEL[kind]}</span>
    </span>
  ));
}

function loadWindow(): number {
  try {
    const raw = localStorage.getItem(WINDOW_KEY);
    if (raw == null || raw === "") return 5;
    return clampWindow(Number(raw));
  } catch {
    return 5;
  }
}

function loadGather(): boolean {
  try {
    const raw = localStorage.getItem(GATHER_KEY);
    if (raw == null || raw === "") return true;
    return raw !== "0";
  } catch {
    return true;
  }
}

function clampWindow(value: number): number {
  if (!Number.isInteger(value)) return 5;
  return Math.min(20, Math.max(0, value));
}

function clampLevel(value: number): number {
  if (!Number.isInteger(value)) return 1;
  return Math.min(60, Math.max(1, value));
}
