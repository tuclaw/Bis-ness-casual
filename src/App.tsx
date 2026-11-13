import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ImportError, importCharacter, profileFromPaste } from "./lib/armory.ts";
import { classById, specById, specsForClass } from "./lib/classes.ts";
import { formatScore, preferredStatOrder, qualityName, statLabel, wowheadItemUrl } from "./lib/format.ts";
import { lookupItemIcon } from "./lib/icons.ts";
import { parseCharacterQuery, REGION_ORDER, type Region } from "./lib/names.ts";
import { recommendDungeons, type DungeonRecommendation } from "./lib/dungeons.ts";
import {
  hiddenByToggle,
  loadSourceFilters,
  saveSourceFilters,
  SOURCE_LABEL,
  SOURCE_TYPES,
  sourceAllowed,
  type SourceFilters,
  type SourceType,
} from "./lib/sources.ts";
import { DEFAULT_PICKS_PER_SLOT, longevityLabel, LONG_BIS_LEVELS, recommendEnchantments, recommendGear, type Ranked } from "./lib/recommend.ts";
import { equippedEnchantStats, scoreEnchant, scoreStats, topStatLines } from "./lib/score.ts";
import type {
  Enchant,
  EquippedItem,
  GearItem,
  PlannerSlot,
  SavedProfile,
  SpecId,
} from "./lib/types.ts";
import seeds from "./data/characters.json";
import { QuestingPage } from "./Questing.tsx";
import { SourceNote } from "./SourceNote.tsx";
import { tooltipFromEnchant, tooltipFromEquipped, tooltipFromGear, type TipModel } from "./lib/tooltip.ts";

const SEED_PROFILES = seeds as SavedProfile[];
const STORAGE_KEY = "bis-ness-casual-imports";
const PICKS_KEY = "bis-ness-casual-picks";

const LEFT_SLOTS = ["head", "neck", "shoulder", "back", "chest", "wrist"];
const RIGHT_SLOTS = ["hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2"];
const WEAPON_SLOTS = ["mainhand", "offhand", "ranged"];

const ROWS: Array<{ id: string; slot: PlannerSlot; label: string; armorySlot: string }> = [
  { id: "head", slot: "head", label: "Head", armorySlot: "head" },
  { id: "neck", slot: "neck", label: "Neck", armorySlot: "neck" },
  { id: "shoulder", slot: "shoulder", label: "Shoulder", armorySlot: "shoulder" },
  { id: "back", slot: "back", label: "Back", armorySlot: "back" },
  { id: "chest", slot: "chest", label: "Chest", armorySlot: "chest" },
  { id: "wrist", slot: "wrist", label: "Wrist", armorySlot: "wrist" },
  { id: "hands", slot: "hands", label: "Hands", armorySlot: "hand" },
  { id: "waist", slot: "waist", label: "Waist", armorySlot: "waist" },
  { id: "legs", slot: "legs", label: "Legs", armorySlot: "leg" },
  { id: "feet", slot: "feet", label: "Feet", armorySlot: "foot" },
  { id: "finger1", slot: "finger", label: "Finger", armorySlot: "finger1" },
  { id: "finger2", slot: "finger", label: "Finger", armorySlot: "finger2" },
  { id: "trinket1", slot: "trinket", label: "Trinket", armorySlot: "trinket1" },
  { id: "trinket2", slot: "trinket", label: "Trinket", armorySlot: "trinket2" },
  { id: "mainhand", slot: "mainhand", label: "Main hand", armorySlot: "weapon" },
  { id: "offhand", slot: "offhand", label: "Off hand", armorySlot: "offhand" },
  { id: "ranged", slot: "ranged", label: "Ranged", armorySlot: "ranged" },
];

function loadImports(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function profileKey(profile: SavedProfile): string {
  return `${profile.region}:${profile.slug}`;
}

export function App() {
  const [imports, setImports] = useState<SavedProfile[]>(() => loadImports());
  const profiles = useMemo(() => {
    const keys = new Set(SEED_PROFILES.map(profileKey));
    return [...SEED_PROFILES, ...imports.filter((profile) => !keys.has(profileKey(profile)))];
  }, [imports]);
  const [activeKey, setActiveKey] = useState(() => profileKey(SEED_PROFILES[0]!));
  const profile = profiles.find((item) => profileKey(item) === activeKey) ?? profiles[0]!;
  const [side, setSide] = useState<"main" | "off">("main");
  const [target, setTarget] = useState<SpecId>(profile.mainSpec);
  const [windowN, setWindowN] = useState(8);
  const [picksPerSlot, setPicksPerSlot] = useState(() => loadPickCount());
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("us");
  const [searchOthers, setSearchOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [catalog, setCatalog] = useState<{ items: GearItem[]; enchants: Enchant[] } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("chest");
  const [icons, setIcons] = useState<Record<number, string | null>>({});
  const [sourceFilters, setSourceFilters] = useState<SourceFilters>(() => loadSourceFilters());
  const [page, setPage] = useState<"gear" | "questing">(() => (window.location.hash.replace(/^#\/?/, "").startsWith("questing") ? "questing" : "gear"));

  useEffect(() => {
    function onHash() {
      setPage(window.location.hash.replace(/^#\/?/, "").startsWith("questing") ? "questing" : "gear");
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([fetch(`${base}data/items.json`), fetch(`${base}data/enchants.json`)])
      .then(async ([itemsResponse, enchantResponse]) => {
        if (!itemsResponse.ok || !enchantResponse.ok) throw new Error("catalog");
        const [items, enchants] = await Promise.all([itemsResponse.json(), enchantResponse.json()]);
        setCatalog({ items: items as GearItem[], enchants: enchants as Enchant[] });
      })
      .catch(() => setCatalogError("The Forever item catalog did not load. Refresh the page."));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imports));
  }, [imports]);

  function selectProfile(next: SavedProfile) {
    setActiveKey(profileKey(next));
    setSide("main");
    setTarget(next.mainSpec);
    setError(null);
  }

  function remember(next: SavedProfile) {
    if (SEED_PROFILES.some((seed) => profileKey(seed) === profileKey(next))) {
      setImports((current) => current.filter((item) => profileKey(item) !== profileKey(next)));
    } else {
      setImports((current) => [next, ...current.filter((item) => profileKey(item) !== profileKey(next))].slice(0, 12));
    }
    selectProfile(next);
  }

  async function onImport(event: FormEvent) {
    event.preventDefault();
    const parsed = parseCharacterQuery(query);
    if ("error" in parsed) {
      setError(parsed.error);
      setAttempts([]);
      return;
    }
    const regions = parsed.region
      ? [parsed.region]
      : searchOthers
        ? [region, ...REGION_ORDER.filter((item) => item !== region)]
        : [region];
    setBusy(true);
    setError(null);
    setAttempts([]);
    const log: string[] = [];
    for (const candidate of regions) {
      try {
        const imported = await importCharacter(parsed.slug, candidate);
        const seed = SEED_PROFILES.find((item) => item.slug === imported.slug);
        if (seed && seed.character.classId === imported.character.classId) {
          imported.mainSpec = seed.mainSpec;
          imported.offSpec = seed.offSpec;
        }
        remember(imported);
        setBusy(false);
        return;
      } catch (reason) {
        if (reason instanceof ImportError) log.push(...reason.attempts.map((line) => `${candidate.toUpperCase()} ${line}`));
        else log.push(`${candidate.toUpperCase()}: ${reason instanceof Error ? reason.message : "failed"}`);
      }
    }
    setBusy(false);
    setAttempts(log);
    setError(
      `Could not import ${parsed.first} ${parsed.surname}. A static site cannot read the Armory directly because Blizzard does not send CORS headers. Profiles also stay hidden until the character is at least level 10 and has logged out.`,
    );
  }

  function onPaste() {
    try {
      const imported = profileFromPaste(paste, region);
      const seed = SEED_PROFILES.find((item) => item.slug === imported.slug);
      if (seed && seed.character.classId === imported.character.classId) {
        imported.mainSpec = seed.mainSpec;
        imported.offSpec = seed.offSpec;
      }
      remember(imported);
      setPaste("");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that paste.");
    }
  }

  const character = profile.character;
  const cls = classById(character.classId);
  const specOptions = specsForClass(character.classId);
  const publishedTree = character.specs.find((spec) => spec.name.toLowerCase() === specById(target).name.toLowerCase());
  const low = Math.max(1, character.level - windowN);
  const high = Math.min(60, character.level + windowN);
  const rangedLabel = cls?.ranged.includes("totem")
    ? "Relic"
    : cls?.ranged.includes("wand")
      ? "Wand"
      : cls?.ranged.includes("libram") || cls?.ranged.includes("idol")
        ? "Relic"
        : "Ranged";

  useEffect(() => {
    saveSourceFilters(sourceFilters);
  }, [sourceFilters]);

  useEffect(() => {
    localStorage.setItem(PICKS_KEY, String(picksPerSlot));
  }, [picksPerSlot]);

  const plans = useMemo(() => {
    if (!catalog) return [];
    const items = catalog.items.filter((item) => sourceAllowed(item.source, sourceFilters));
    return buildSlotPlans(items, character, target, windowN, catalog.enchants, picksPerSlot);
  }, [catalog, character, target, windowN, sourceFilters, picksPerSlot]);

  const unfilteredPlans = useMemo(() => {
    if (!catalog) return [];
    return buildSlotPlans(catalog.items, character, target, windowN, catalog.enchants, picksPerSlot);
  }, [catalog, character, target, windowN, picksPerSlot]);

  const hideCounts = useMemo(() => {
    const sources = unfilteredPlans.flatMap((plan) => plan.gear.map((pick) => pick.entry.source));
    return Object.fromEntries(SOURCE_TYPES.map((type) => [type, hiddenByToggle(sources, sourceFilters, type)])) as Record<SourceType, number>;
  }, [unfilteredPlans, sourceFilters]);

  const dungeonPicks = useMemo(
    () =>
      recommendDungeons({
        level: character.level,
        faction: character.faction,
        slots: plans.map((plan) => ({
          label: plan.row.slot === "ranged" ? rangedLabel : plan.row.label,
          slot: plan.row.slot,
          picks: plan.gear,
        })),
      }),
    [plans, character.level, character.faction, rangedLabel],
  );

  useEffect(() => {
    const ids = new Set<number>();
    for (const plan of plans) {
      if (plan.equipped?.itemId) ids.add(plan.equipped.itemId);
      for (const pick of plan.gear) ids.add(pick.entry.id);
    }
    const missing = [...ids].filter((id) => id > 0 && icons[id] === undefined);
    if (!missing.length) return;
    let cancel = false;
    void Promise.all(missing.map(async (id) => [id, await lookupItemIcon(id)] as const)).then((rows) => {
      if (cancel) return;
      setIcons((current) => {
        const next = { ...current };
        for (const [id, url] of rows) next[id] = url;
        return next;
      });
    });
    return () => {
      cancel = true;
    };
  }, [plans, icons]);
  const visibleStats = character.stats
    .filter((stat) => ["HEALTH", "MANA", "STRENGTH", "AGILITY", "INTELLECT", "STAMINA", "SPELLPOWER", "ATTACKPOWER", "ARMOR", "CRITICALSTRIKE"].includes(stat.key))
    .sort((a, b) => preferredStatOrder(a.key) - preferredStatOrder(b.key));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Bis-ness</span>
          <span className="brand-sub">Casual</span>
          <nav className="app-nav" aria-label="Sections">
            <a href="#gear" aria-current={page === "gear" ? "page" : undefined}>
              Gear
            </a>
            <a href="#questing" aria-current={page === "questing" ? "page" : undefined}>
              Questing
            </a>
          </nav>
        </div>
        <div className="switchers">
          <label className="char-pick">
            {character.portraitUrl && <img src={character.portraitUrl} alt="" />}
            <select
              value={profileKey(profile)}
              aria-label="Character"
              onChange={(event) => {
                const next = profiles.find((item) => profileKey(item) === event.target.value);
                if (next) selectProfile(next);
              }}
            >
              {profiles.map((item) => (
                <option key={profileKey(item)} value={profileKey(item)}>
                  {item.character.name} {item.character.surname} · {item.character.level} {item.character.className} · {item.region.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {page === "gear" && <div className="spec-switch" role="group" aria-label="Dual specialization">
            <button type="button" aria-pressed={side === "main"} onClick={() => { setSide("main"); setTarget(profile.mainSpec); }}>
              {specById(profile.mainSpec).name}
            </button>
            <button
              type="button"
              aria-pressed={side === "off"}
              disabled={!profile.offSpec}
              onClick={() => {
                if (!profile.offSpec) return;
                setSide("off");
                setTarget(profile.offSpec);
              }}
            >
              {profile.offSpec ? specById(profile.offSpec).name : "No off spec"}
            </button>
          </div>}
        </div>
      </header>

      <section className="identity">
        <div>
          <h1>
            {character.name} {character.surname}
          </h1>
          <p className="idline">
            Level {character.level} {character.race} {character.className} ·{" "}
            <span className={`faction-${character.faction}`}>{character.faction}</span>
            {" · "}
            {character.ruleset ?? "ruleset unknown"}
          </p>
          <p className="idline">
            {[
              character.guild,
              character.ilvl != null ? `ilvl ${character.ilvl}` : null,
              character.honorableKills != null ? `${character.honorableKills} HK` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="fine">
            <a href={profile.armoryUrl}>Armory</a>
            {profile.fetchedAt ? ` · snapshot ${formatAsOf(profile.fetchedAt)}` : ""}
            {character.updatedAt ? ` · updated ${formatAsOf(character.updatedAt)}` : ""}. The page keeps this snapshot because the Armory does not send CORS headers.
          </p>
          {character.professions.length > 0 && (
            <p className="fine">
              {character.professions.map((prof) => `${prof.name} ${prof.skill ?? "?"}/${prof.max ?? "?"}`).join(" · ")}
            </p>
          )}
        </div>
        <dl className="statline">
          {visibleStats.map((stat) => (
            <div key={stat.key}>
              <dt>{statLabel(stat.key)}</dt>
              <dd className="num">{stat.percent ? `${stat.value.toFixed(1)}%` : Math.round(stat.value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {page === "questing" ? (
        <QuestingPage character={character} />
      ) : (
        <>
      {catalog && sourceFilters.dungeon && <DungeonBoard dungeons={dungeonPicks} />}

      <section className="toolbar" aria-label="Planner controls">
        <label className="field">
          <span>Recommend for</span>
          <select value={target} onChange={(event) => setTarget(event.target.value as SpecId)} aria-label="Target specialization">
            {specOptions.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.name}
              </option>
            ))}
          </select>
          <span className="fine">{specById(target).note ?? "Scores use this spec, even if it is not the spec logged out on the Armory."}</span>
        </label>
        <label className="slider">
          <span>
            Level window <b className="num">± {windowN}</b> <span className="fine">{low}–{high}</span>
          </span>
          <input
            type="range"
            min={0}
            max={40}
            value={windowN}
            onChange={(event) => setWindowN(Number(event.target.value))}
            aria-valuetext={`level ${character.level} plus or minus ${windowN}, required levels ${low} to ${high}`}
          />
        </label>
        <label className="slider">
          <span>
            Per slot <b className="num">{picksPerSlot}</b>
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={picksPerSlot}
            onChange={(event) => setPicksPerSlot(clampPickCount(Number(event.target.value)))}
            aria-valuetext={`${picksPerSlot} recommendations per slot`}
          />
        </label>
        <SourceFiltersBar
          filters={sourceFilters}
          hideCounts={hideCounts}
          onToggle={(type) => setSourceFilters((current) => ({ ...current, [type]: !current[type] }))}
        />
        <details className="fold">
          <summary>Talents · {specById(target).name}</summary>
          <div className="fold-body">
            {publishedTree ? (
              publishedTree.talents.length > 0 ? (
                <ul className="talent-list">
                  {publishedTree.talents.map((talent) => (
                    <li key={`${talent.name}-${talent.rank}`}>
                      <b>
                        {talent.name} {talent.rank}
                      </b>
                      {talent.description && <span>{talent.description}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No talent points in the Armory profile for {publishedTree.name}.</p>
              )
            ) : (
              <p className="empty">
                The Armory snapshot does not include the {specById(target).name} talent tree. Recommendations still follow the selector above.
              </p>
            )}
          </div>
        </details>
        <details className="fold">
          <summary>Import a character</summary>
          <div className="fold-body">
            <form className="import" onSubmit={onImport}>
              <label className="field">
                Name or Armory URL
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Daz Dingomon"
                  aria-label="Character name or Armory URL"
                />
              </label>
              <label className="field">
                Region
                <select value={region} onChange={(event) => setRegion(event.target.value as Region)} aria-label="Region">
                  {REGION_ORDER.map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" disabled={busy} type="submit">
                {busy ? "Looking up…" : "Import"}
              </button>
              <label className="check">
                <input type="checkbox" checked={searchOthers} onChange={(event) => setSearchOthers(event.target.checked)} />
                If this region has no profile, try the others
              </label>
              {error && (
                <div className="banner" role="alert">
                  <p>{error}</p>
                  {attempts.length > 0 && (
                    <ul>
                      {attempts.slice(0, 8).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </form>
            <div className="fold-span">
              <p className="fine">
                If the browser is blocked, open the character on the official Armory, view the page source, and paste it here. The planner reads the embedded profile and does not invent gear.
              </p>
              <textarea value={paste} onChange={(event) => setPaste(event.target.value)} aria-label="Pasted Armory page" />
              <button className="btn secondary" type="button" onClick={onPaste}>
                Use pasted profile
              </button>
            </div>
          </div>
        </details>
      </section>

      {catalogError && <p className="banner">{catalogError}</p>}
      {!catalog && !catalogError && <p className="fine">Loading the Forever item and enchant catalogs…</p>}

      {catalog && (
        <ArmoryBoard
          rows={ROWS}
          plans={plans}
          character={character}
          rangedLabel={rangedLabel}
          selectedId={selectedSlot}
          onSelect={setSelectedSlot}
          icons={icons}
          low={low}
          high={high}
          spec={target}
        />
      )}
        </>
      )}

      <footer>
        <p>
          Saved profiles are the characters in characters.config.json, pulled from the official US Forever Armory. Gear on the page is that snapshot, not a guessed loadout.
        </p>
        <p>
          Item stats come from Forever Wowhead tooltips. Enchant effects and skill levels come from Warcraft Forever client data build 1.60.1.70862, with formula and trainer notes from WoW Forever DB. Enchant required level is the level needed to learn the formula at 5 Enchanting skill per character level.
        </p>
        <p>Scores are a Forever-oriented stat weighting for the selected spec. They are a planning aid, not a simulation.</p>
      </footer>
    </div>
  );
}

function buildSlotPlans(
  items: GearItem[],
  character: SavedProfile["character"],
  target: SpecId,
  windowN: number,
  enchants: Enchant[],
  limit: number,
) {
  const bySlot = new Map(character.gear.map((item) => [item.armorySlot, item]));
  return ROWS.map((row) => {
    const equipped = bySlot.get(row.armorySlot) ?? null;
    const exclude =
      row.id === "finger2" || row.id === "trinket2"
        ? uniquePick(items, {
            spec: target,
            faction: character.faction,
            level: character.level,
            window: windowN,
            slot: row.slot,
            equipped: bySlot.get(row.id === "finger2" ? "finger1" : "trinket1") ?? null,
            limit,
          })
        : [];
    return {
      row,
      equipped,
      gear: recommendGear({
        items,
        spec: target,
        faction: character.faction,
        level: character.level,
        window: windowN,
        slot: row.slot,
        equipped,
        excludeIds: exclude,
        limit,
      }),
      enchantPlan: planEnchants(enchants, target, character.level, windowN, row.slot, equipped, limit),
    };
  });
}

function uniquePick(
  items: GearItem[],
  args: { spec: SpecId; faction: SavedProfile["character"]["faction"]; level: number; window: number; slot: PlannerSlot; equipped: EquippedItem | null; limit: number },
): number[] {
  const ranked = recommendGear({ items, ...args });
  const unique = ranked.find((pick) => pick.entry.unique);
  return unique ? [unique.entry.id] : [];
}

function planEnchants(
  enchants: Enchant[],
  spec: SpecId,
  level: number,
  window: number,
  slot: PlannerSlot,
  equipped: EquippedItem | null,
  limit: number,
) {
  const current = equipped?.enchant ?? null;
  const match = current
    ? enchants.find((enchant) => current.enchantId != null && enchant.enchantId === current.enchantId) ??
      enchants.find((enchant) => current.name && enchant.name === current.name)
    : undefined;
  const parsed = current ? equippedEnchantStats(`${current.label} ${current.name ?? ""}`) : {};
  const equippedScore = match ? scoreEnchant(match, spec) : Object.keys(parsed).length ? scoreStats(parsed, spec) : null;
  const result = recommendEnchantments({
    enchants,
    spec,
    level,
    window,
    slot,
    equipped,
    equippedScore,
    equippedEnchantId: match?.id ?? null,
    limit,
  });
  return { ...result, scored: Boolean(current) && equippedScore != null };
}

function deltaView(pick: Ranked<unknown>): { text: string; tone: "up" | "down" | "flat" } | null {
  if (pick.delta == null) return null;
  if (pick.upgrade) return { text: `+${formatScore(pick.delta)}`, tone: "up" };
  if (pick.delta < -0.05) return { text: formatScore(pick.delta), tone: "down" };
  return { text: "0.0", tone: "flat" };
}

function titleCase(value: string): string {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : value;
}

function coarsePointer(): boolean {
  return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function ItemIcon({ src, quality }: { src?: string | null; quality: string }) {
  return (
    <span className={`item-icon q-${quality}`}>
      {src ? <img src={src} alt="" /> : <span className="item-icon-empty" />}
    </span>
  );
}

function TipHost({
  id,
  pinned,
  onToggle,
  children,
  tip,
}: {
  id: string;
  pinned: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  tip: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  function place() {
    const host = hostRef.current;
    const tip = tipRef.current;
    if (!host || !tip) return;
    tip.style.display = "block";
    const rect = host.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8));
    let top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, rect.top - box.height - 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  return (
    <div
      ref={hostRef}
      className={pinned ? "tip-host pinned" : "tip-host"}
      onMouseEnter={() => {
        if (!coarsePointer()) place();
      }}
      onMouseLeave={() => {
        const tip = tipRef.current;
        if (tip && !pinned) tip.style.display = "";
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-tip-go]")) return;
        if (!coarsePointer() && target.closest("a")) return;
        if (coarsePointer()) event.preventDefault();
        onToggle(id);
        requestAnimationFrame(place);
      }}
    >
      {children}
      <div ref={tipRef} className="armory-tip" role="tooltip">
        {tip}
      </div>
    </div>
  );
}

function ArmoryPanel({ model }: { model: TipModel }) {
  return (
    <div className={`armory-panel q-${model.quality}`}>
      {model.lines.map((line, index) => {
        if (line.kind === "name") return <p key={index} className={`tip-name qtext-${model.quality}`}>{line.text}</p>;
        if (line.kind === "slot") {
          return (
            <p key={index} className="tip-split">
              <span>{line.text}</span>
              {line.right && <span>{line.right}</span>}
            </p>
          );
        }
        if (line.kind === "effect" || line.kind === "enchant") return <p key={index} className="tip-green">{line.text}</p>;
        if (line.kind === "source") return <p key={index}><SourceNote source={line.text} /></p>;
        if (line.kind === "stat") return <p key={index} className={line.delta ? `tip-${line.delta}` : undefined}>{line.text}</p>;
        return <p key={index}>{line.text}</p>;
      })}
      {model.href && <WowLink href={model.href} />}
    </div>
  );
}

function ArmoryPanels({ item, equipped }: { item: TipModel; equipped?: TipModel | null }) {
  return (
    <div className="armory-compare">
      <ArmoryPanel model={item} />
      {equipped && <ArmoryPanel model={equipped} />}
    </div>
  );
}

function ItemName({ name, quality, href }: { name: string; quality: string; href: string | null }) {
  if (!href) return <span className={`name qtext-${quality}`}>{name}</span>;
  return (
    <a
      className={`name qtext-${quality}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (coarsePointer()) event.preventDefault();
      }}
    >
      {name}
    </a>
  );
}

function WowLink({ href }: { href: string }) {
  return (
    <p>
      <a href={href} target="_blank" rel="noreferrer" data-tip-go="">
        Wowhead
      </a>
    </p>
  );
}

function DataRow({
  id,
  pinned,
  onToggle,
  rank,
  best,
  icon,
  quality,
  name,
  href,
  sub,
  mark,
  detail,
  sourceNote,
  delta,
  solo,
  tip,
}: {
  id: string;
  pinned: boolean;
  onToggle: (id: string) => void;
  rank?: number;
  best?: boolean;
  icon?: string | null;
  quality: string;
  name: string;
  href: string | null;
  sub: string;
  mark?: string | null;
  detail?: string | null;
  /** Catalog source. Pass "" when the row should still show Unknown source. Omit to hide the line. */
  sourceNote?: string;
  delta?: { text: string; tone: "up" | "down" | "flat" } | null;
  solo?: boolean;
  tip: ReactNode;
}) {
  const showIcon = icon !== undefined;
  return (
    <TipHost id={id} pinned={pinned} onToggle={onToggle} tip={tip}>
      <div className={`gear-row${best ? " best" : ""}${solo ? " solo" : ""}${showIcon ? "" : " no-icon"}`}>
        {!solo && <span className="rank">{rank ?? ""}</span>}
        {showIcon && <ItemIcon src={icon} quality={quality} />}
        <div className="gear-main">
          <div>
            {best && <span className="sr">Recommended. </span>}
            <ItemName name={name} quality={quality} href={href} />
          </div>
          <div className="sub">
            <span className="sub-text">{sub}</span>
            {mark && <span className="mark">{mark}</span>}
          </div>
          {sourceNote != null && (
            <div className="sub">
              <SourceNote source={sourceNote} />
            </div>
          )}
          {detail && (
            <div className="sub">
              <span className="sub-text">{detail}</span>
            </div>
          )}
        </div>
        {delta && (
          <span className={`delta ${delta.tone}`} title={delta.tone === "flat" ? "Same score as equipped" : undefined}>
            {delta.text}
          </span>
        )}
      </div>
    </TipHost>
  );
}

function ArmoryBoard({
  rows,
  plans,
  character,
  rangedLabel,
  selectedId,
  onSelect,
  icons,
  low,
  high,
  spec,
}: {
  rows: typeof ROWS;
  plans: Array<{
    row: (typeof ROWS)[number];
    equipped: EquippedItem | null;
    gear: Ranked<GearItem>[];
    enchantPlan: ReturnType<typeof planEnchants>;
  }>;
  character: SavedProfile["character"];
  rangedLabel: string;
  selectedId: string;
  onSelect: (id: string) => void;
  icons: Record<number, string | null>;
  low: number;
  high: number;
  spec: SpecId;
}) {
  const byId = new Map(plans.map((plan) => [plan.row.id, plan]));
  const selected = byId.get(selectedId) ?? plans[0];
  const [pinned, setPinned] = useState<string | null>(null);
  const labelFor = (row: (typeof ROWS)[number]) => (row.slot === "ranged" ? rangedLabel : row.label);
  const iconFor = (item: EquippedItem | null) => (item ? item.iconUrl || icons[item.itemId] || null : null);

  useEffect(() => {
    setPinned(null);
  }, [selectedId]);

  useEffect(() => {
    function close(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".tip-host")) setPinned(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function onToggle(id: string) {
    setPinned((current) => (current === id ? null : id));
  }

  return (
    <section className="board">
      <div className="doll">
        <div className="doll-col">{LEFT_SLOTS.map((id) => slotButton(id))}</div>
        <div className="doll-center">
          <div className="doll-stage" style={character.backdropUrl ? { backgroundImage: `url(${character.backdropUrl})` } : undefined}>
            {character.modelUrl ? (
              <img className="doll-model" src={character.modelUrl} alt={`${character.name} ${character.surname}`} />
            ) : (
              <p className="empty">No Armory portrait for this profile.</p>
            )}
          </div>
        </div>
        <div className="doll-col">{RIGHT_SLOTS.map((id) => slotButton(id))}</div>
      </div>
      <div className="doll-weapons">{WEAPON_SLOTS.map((id) => slotButton(id))}</div>
      {selected && (
        <div>
          <h2 className="slot-banner" id="slot-detail">
            {labelFor(selected.row)}
          </h2>
          <h3 className="section-label">Equipped</h3>
          {selected.equipped ? (
            <EquippedRow item={selected.equipped} spec={spec} icon={iconFor(selected.equipped)} pinned={pinned} onToggle={onToggle} />
          ) : (
            <p className="empty">Nothing equipped.</p>
          )}
          <h3 className="section-label">Upgrades</h3>
          <div className="gear-list">
            {selected.gear.length === 0 && (
              <p className="empty">No item for this slot can be worn at required levels {low}–{high}.</p>
            )}
            {selected.gear.map((pick, index) => (
              <GearPick key={pick.entry.id} pick={pick} spec={spec} rank={index + 1} icon={icons[pick.entry.id]} pinned={pinned} onToggle={onToggle} equipped={selected.equipped} />
            ))}
          </div>
          <h3 className="section-label">Enchants</h3>
          {!selected.enchantPlan.available && (
            <p className="empty">This slot cannot be enchanted with the Forever formulas in the catalog.</p>
          )}
          {selected.enchantPlan.available && selected.equipped?.enchant && (
            <p className="fine">
              Equipped: {selected.equipped.enchant.label}
              {selected.equipped.enchant.name ? ` (${selected.equipped.enchant.name})` : ""}
              {selected.enchantPlan.scored ? "" : ". This enchant is not an Enchanting formula in the catalog, so upgrade marks are withheld."}
            </p>
          )}
          {selected.enchantPlan.available && (
            <div className="gear-list">
              {selected.enchantPlan.ranked.length === 0 && <p className="empty">No enchants in this level window.</p>}
              {selected.enchantPlan.ranked.map((pick, index) => (
                <EnchantPick key={pick.entry.id} pick={pick} spec={spec} rank={index + 1} pinned={pinned} onToggle={onToggle} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );

  function slotButton(id: string) {
    const plan = byId.get(id);
    const row = rows.find((item) => item.id === id);
    if (!plan || !row) return null;
    const equipped = plan.equipped;
    const isLong = Boolean(plan.gear[0]?.longevity && plan.gear[0].longevity.levels >= LONG_BIS_LEVELS);
    const label = labelFor(row);
    const button = (
      <button
        type="button"
        className={`slot-btn${id === selectedId ? " active" : ""}${isLong ? " long" : ""}`}
        aria-pressed={id === selectedId}
        aria-label={`${label}: ${equipped ? equipped.name : "Empty"}${isLong ? ", long BiS" : ""}`}
        onClick={() => {
          onSelect(id);
          document.getElementById("slot-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }}
      >
        <ItemIcon src={iconFor(equipped)} quality={equipped?.quality ?? "empty"} />
        <span className="slot-copy">
          <b>
            {label}
            {isLong && <span className="mark"> long</span>}
          </b>
          <span className={`item-name${equipped ? ` qtext-${equipped.quality}` : ""}`}>{equipped ? equipped.name : "Empty"}</span>
        </span>
      </button>
    );
    if (!equipped) return button;
    return (
      <TipHost
        id={`slot-${id}`}
        pinned={pinned === `slot-${id}`}
        onToggle={onToggle}
        tip={<ArmoryPanels item={tooltipFromEquipped(equipped, equipped.itemId > 0 ? wowheadItemUrl(equipped.itemId, equipped.name) : null)} />}
      >
        {button}
      </TipHost>
    );
  }
}

function EquippedRow({
  item,
  spec,
  icon,
  pinned,
  onToggle,
}: {
  item: EquippedItem;
  spec: SpecId;
  icon?: string | null;
  pinned: string | null;
  onToggle: (id: string) => void;
}) {
  const href = item.itemId > 0 ? wowheadItemUrl(item.itemId, item.name) : null;
  const bits = [titleCase(item.quality), `ilvl ${item.ilvl}`];
  if (item.req != null) bits.push(`req ${item.req}`);
  bits.push(...topStatLines(item.stats, spec, 2));
  return (
    <DataRow
      id={`equipped-${item.armorySlot}`}
      pinned={pinned === `equipped-${item.armorySlot}`}
      onToggle={onToggle}
      solo
      icon={icon ?? null}
      quality={item.quality}
      name={item.name}
      href={href}
      sub={bits.join(" · ")}
      detail={item.enchant ? item.enchant.label : null}
      tip={<ArmoryPanels item={tooltipFromEquipped(item, href)} />}
    />
  );
}

function GearPick({
  pick,
  spec,
  rank,
  icon,
  pinned,
  onToggle,
  equipped,
}: {
  pick: Ranked<GearItem>;
  spec: SpecId;
  rank: number;
  icon?: string | null;
  pinned: string | null;
  onToggle: (id: string) => void;
  equipped: EquippedItem | null;
}) {
  const item = pick.entry;
  const href = wowheadItemUrl(item.id, item.name);
  const id = `gear-${item.id}`;
  const bits = [`ilvl ${item.ilvl}`, `req ${item.req}`, ...topStatLines(item.stats, spec, 2)];
  if (item.dps) bits.push(`${item.dps.toFixed(1)} dps`);
  if (pick.longevity) bits.push(longevityLabel(pick.longevity));
  if (item.pvp) bits.push("PvP");
  if (item.changed === "new") bits.push("new");
  return (
    <DataRow
      id={id}
      pinned={pinned === id}
      onToggle={onToggle}
      rank={rank}
      best={pick.overallBest}
      icon={icon ?? null}
      quality={qualityName(item.quality)}
      name={item.name}
      href={href}
      sub={bits.join(" · ")}
      mark={pick.longest ? "longest" : null}
      sourceNote={item.source ?? ""}
      delta={deltaView(pick)}
      tip={
        <ArmoryPanels
          item={tooltipFromGear(item, href, equipped && equipped.itemId !== item.id ? equipped.stats : null)}
          equipped={equipped && equipped.itemId !== item.id ? tooltipFromEquipped(equipped, equipped.itemId > 0 ? wowheadItemUrl(equipped.itemId, equipped.name) : null) : null}
        />
      }
    />
  );
}

function EnchantPick({
  pick,
  spec,
  rank,
  pinned,
  onToggle,
}: {
  pick: Ranked<Enchant>;
  spec: SpecId;
  rank: number;
  pinned: string | null;
  onToggle: (id: string) => void;
}) {
  const item = pick.entry;
  const id = `enchant-${item.id}`;
  const bits = [`skill ${item.skill}`, `req ${item.req}`];
  const compact = topStatLines(item.stats, spec, 2);
  if (compact.length) bits.push(...compact);
  else if (item.effect) bits.push(item.effect);
  if (item.fit !== "any") bits.push(fitLabel(item.fit));
  return (
    <DataRow
      id={id}
      pinned={pinned === id}
      onToggle={onToggle}
      rank={rank}
      best={pick.overallBest}
      quality="enchant"
      name={item.name}
      href={null}
      sub={bits.join(" · ")}
      delta={deltaView(pick)}
      tip={<ArmoryPanels item={tooltipFromEnchant(item)} />}
    />
  );
}

function SourceFiltersBar({
  filters,
  hideCounts,
  onToggle,
}: {
  filters: SourceFilters;
  hideCounts: Record<SourceType, number>;
  onToggle: (type: SourceType) => void;
}) {
  return (
    <fieldset className="sources">
      <legend>Sources</legend>
      {SOURCE_TYPES.map((type) => (
        <label key={type} className={filters[type] ? undefined : "off"}>
          <input
            type="checkbox"
            checked={filters[type]}
            aria-label={`${SOURCE_LABEL[type]}, hides ${hideCounts[type]} if turned off`}
            onChange={() => onToggle(type)}
          />
          {SOURCE_LABEL[type]}
          <span className="hide-count">{filters[type] ? hideCounts[type] : "off"}</span>
        </label>
      ))}
    </fieldset>
  );
}

function DungeonBoard({ dungeons }: { dungeons: DungeonRecommendation[] }) {
  const [pinned, setPinned] = useState<string | null>(null);
  return (
    <section className="dungeons" aria-label="Best dungeon right now">
      <h2 className="kicker">Best dungeon</h2>
      {dungeons.length === 0 ? (
        <p className="empty">None of the current upgrades name a dungeon you can run at this level and faction.</p>
      ) : (
        <ol className="dungeon-list">
          {dungeons.map((dungeon, index) => (
            <li key={dungeon.name} className={index === 0 ? "top" : undefined}>
              <span className="rank">{index + 1}</span>
              <div className="dungeon-name">
                <span>{dungeon.name}</span>
                <span className="dungeon-count">
                  {dungeon.count} {dungeon.count === 1 ? "upgrade" : "upgrades"}
                </span>
              </div>
              <div className="dungeon-meta">
                Levels {dungeon.min}–{dungeon.max}
                {dungeon.faction === "both" ? " · both factions" : ` · ${dungeon.faction}`}
              </div>
              <div className="dungeon-meta">
                {dungeon.items.map((item) => (
                  <span key={`${item.slot}-${item.id}`} className="dungeon-item">
                    {item.gear ? (
                      <TipHost
                        id={`dungeon-${item.slot}-${item.id}`}
                        pinned={pinned === `dungeon-${item.slot}-${item.id}`}
                        onToggle={(id) => setPinned((current) => (current === id ? null : id))}
                        tip={<ArmoryPanels item={tooltipFromGear(item.gear, wowheadItemUrl(item.gear.id, item.gear.name))} />}
                      >
                        <span>
                          {item.slot} {item.name} <SourceNote source={item.source} />
                        </span>
                      </TipHost>
                    ) : (
                      <>
                        {item.slot} {item.name} <SourceNote source={item.source} />
                      </>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function loadPickCount(): number {
  try {
    const raw = localStorage.getItem(PICKS_KEY);
    if (raw == null || raw === "") return DEFAULT_PICKS_PER_SLOT;
    return clampPickCount(Number(raw));
  } catch {
    return DEFAULT_PICKS_PER_SLOT;
  }
}

function clampPickCount(value: number): number {
  if (!Number.isInteger(value)) return DEFAULT_PICKS_PER_SLOT;
  return Math.min(10, Math.max(1, value));
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function fitLabel(fit: Enchant["fit"]): string {
  if (fit === "twohand") return "two-hand";
  if (fit === "shield") return "shield";
  if (fit === "holdable") return "held off-hand";
  if (fit === "weapon") return "weapon";
  return fit;
}

