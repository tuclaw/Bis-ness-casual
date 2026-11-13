import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { longevityLabel, LONG_BIS_LEVELS, recommendEnchantments, recommendGear, type Ranked } from "./lib/recommend.ts";
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
      <header className="hero">
        <div className="mark">
          <Mark />
          <div>
            <p className="eyebrow">World of Warcraft: Forever</p>
            <h1>Bis-ness Casual</h1>
          </div>
        </div>
        <p className="lede">
          Import a two-part Forever name, read the equipped gear the Armory actually has, and rank slot upgrades for the spec you want to play.
        </p>
      </header>

      <section className="panel switcher">
        <div className="profile-row" role="list">
          {profiles.map((item) => (
            <button
              key={profileKey(item)}
              className={profileKey(item) === profileKey(profile) ? "profile-card active" : "profile-card"}
              onClick={() => selectProfile(item)}
              role="listitem"
            >
              {item.character.portraitUrl && <img className="profile-portrait" src={item.character.portraitUrl} alt="" />}
              <strong>
                {item.character.name} {item.character.surname}
              </strong>
              <span>
                {" "}
                · {item.character.level} {item.character.className}
              </span>
              <small>
                {item.character.faction} · {item.character.ruleset ?? "ruleset unknown"} · {item.region.toUpperCase()}
              </small>
            </button>
          ))}
        </div>
        <form className="import" onSubmit={onImport}>
          <label>
            Import by name or Armory URL
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Daz Dingomon"
              aria-label="Character name or Armory URL"
            />
          </label>
          <label>
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
        </form>
        <label className="check">
          <input type="checkbox" checked={searchOthers} onChange={(event) => setSearchOthers(event.target.checked)} />
          If the chosen region has no profile, try the other regions
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
        <details className="paste">
          <summary>Paste an Armory page if the browser is blocked</summary>
          <p className="note">
            Open the character on the official Armory, view the page source, and paste it here. The planner reads the embedded profile and does not invent gear.
          </p>
          <textarea value={paste} onChange={(event) => setPaste(event.target.value)} aria-label="Pasted Armory page" />
          <button className="btn secondary" type="button" onClick={onPaste}>
            Use pasted profile
          </button>
        </details>
      </section>

      <section className="panel sheet">
        <div className="who">
          <div>
            <h2>
              {character.name} {character.surname}
            </h2>
            <div className="chips">
              <span className={`chip ${character.faction}`}>{character.faction}</span>
              <span className="chip">{character.race}</span>
              <span className="chip" style={{ borderColor: cls?.color }}>
                {character.className}
              </span>
              <span className="chip">{character.ruleset ?? "Ruleset unknown"}</span>
              <span className="chip">Level {character.level}</span>
              {character.guild && <span className="chip">{character.guild}</span>}
              {character.ilvl != null && <span className="chip">ilvl {character.ilvl}</span>}
              {character.honorableKills != null && <span className="chip">{character.honorableKills} HK</span>}
            </div>
            <p className="note">
              <a href={profile.armoryUrl}>Official Armory</a>
              {profile.fetchedAt ? ` · Snapshot as of ${formatAsOf(profile.fetchedAt)}` : ""}
              {character.updatedAt ? ` · Armory last updated ${formatAsOf(character.updatedAt)}` : ""}
              . This is the last captured snapshot. A scheduled job refreshes it; the browser cannot, because the Armory does not send CORS headers.
            </p>
          </div>
          <div className="stats">
            {visibleStats.map((stat) => (
              <div className="stat" key={stat.key}>
                <b>{stat.percent ? `${stat.value.toFixed(1)}%` : Math.round(stat.value)}</b>
                <span>{statLabel(stat.key)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="controls">
          <div className="toggle" role="group" aria-label="Dual specialization">
            <button type="button" aria-pressed={side === "main"} onClick={() => { setSide("main"); setTarget(profile.mainSpec); }}>
              Main · {specById(profile.mainSpec).name}
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
              Off spec · {profile.offSpec ? specById(profile.offSpec).name : "not in Armory"}
            </button>
          </div>
          <div>
            <div className="spec-row">
              <label>
                Recommend for
                <select value={target} onChange={(event) => setTarget(event.target.value as SpecId)} aria-label="Target specialization">
                  {specOptions.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="note">{specById(target).note ?? "Scores use this spec, even if it is not the spec logged out on the Armory."}</p>
            </div>
          </div>
        </div>

        <div className="slider-row">
          <label>
            Required level window: character level ± {windowN}
            <input
              type="range"
              min={0}
              max={40}
              value={windowN}
              onChange={(event) => setWindowN(Number(event.target.value))}
              aria-valuetext={`level ${character.level} plus or minus ${windowN}, required levels ${low} to ${high}`}
            />
          </label>
          <p className="note">
            Showing required levels {low}–{high}. The overall best stays on the list even when its required level is outside this window.
          </p>
        </div>
        <div className="slider-row">
          <label>
            Recommendations per slot: {picksPerSlot}
            <input
              type="range"
              min={1}
              max={10}
              value={picksPerSlot}
              onChange={(event) => setPicksPerSlot(clampPickCount(Number(event.target.value)))}
              aria-valuetext={`${picksPerSlot} recommendations per slot`}
            />
          </label>
          <p className="note">Each slot and its flyout show this many ranked picks. A slot with fewer eligible items shows only those.</p>
        </div>

        <SourceFiltersBar
          filters={sourceFilters}
          hideCounts={hideCounts}
          onToggle={(type) => setSourceFilters((current) => ({ ...current, [type]: !current[type] }))}
        />

        {catalog && sourceFilters.dungeon && <DungeonBoard dungeons={dungeonPicks} />}

        <div>
          <h3>Talents</h3>
          {publishedTree ? (
            <div className="talents">
              {publishedTree.talents.map((talent) => (
                <div className="talent" key={`${talent.name}-${talent.rank}`}>
                  <b>
                    {talent.name} {talent.rank}
                  </b>
                  {talent.description && <span>{talent.description}</span>}
                </div>
              ))}
              {publishedTree.talents.length === 0 && <p className="note">No talent points in the Armory profile for {publishedTree.name}.</p>}
            </div>
          ) : (
            <p className="note">
              The Armory snapshot does not include the {specById(target).name} talent tree. Recommendations still follow the selector above.
            </p>
          )}
          {character.professions.length > 0 && (
            <p className="note">
              {character.professions.map((prof) => `${prof.name} ${prof.skill ?? "?"}/${prof.max ?? "?"}`).join(" · ")}
            </p>
          )}
        </div>
      </section>

      {catalogError && <p className="banner">{catalogError}</p>}
      {!catalog && !catalogError && <p className="note">Loading the Forever item and enchant catalogs…</p>}

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

function ItemCard({ item, spec, equipped, icon }: { item: EquippedItem; spec: SpecId; equipped?: boolean; icon?: string | null }) {
  const lines = topStatLines(item.stats, spec);
  const href = wowheadItemUrl(item.itemId, item.name);
  return (
    <article className={`card q-${item.quality}`}>
      <div className="card-head">
        <ItemIcon src={icon ?? item.iconUrl} quality={item.quality} />
        <div>
      <div className="card-name">
        <ItemLink href={href}>{item.name}</ItemLink>
      </div>
      <div className="meta">
        {qualityName(item.quality)} · ilvl {item.ilvl}
        {item.req != null ? ` · requires ${item.req}` : ""}
        {item.dps ? ` · ${item.dps.toFixed(1)} dps` : ""}
        {equipped ? " · equipped" : ""}
      </div>
      <div className="lines">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      {item.effect && <div className="source">{item.effect}</div>}
      {item.enchant && <div className="source">Enchant: {item.enchant.label}</div>}
      <ItemLink className="full-link" href={href}>
        {href}
      </ItemLink>
        </div>
      </div>
    </article>
  );
}

function MiniCard<T extends GearItem | Enchant>({
  pick,
  spec,
  kind,
  icon,
  rank,
}: {
  pick: Ranked<T>;
  spec: SpecId;
  kind: "item" | "enchant";
  icon?: string | null;
  rank?: number;
}) {
  const item = pick.entry;
  const lines = topStatLines(item.stats, spec, 3);
  const quality = "quality" in item ? qualityName(item.quality) : "enchant";
  const name = item.name;
  const href = kind === "item" ? wowheadItemUrl(item.id, name) : null;
  const span = kind === "item" ? pick.longevity : undefined;
  return (
    <article className={`hunt ${pick.overallBest ? "rank1" : ""} ${pick.longest ? "longest" : ""}`}>
      <span className="rank">{rank ?? ""}</span>
      {kind === "item" && <ItemIcon src={icon} quality={quality} />}
      <div className="hunt-body">
        <div className="hunt-title">
          <span className={`card-name qtext-${quality}`}>{href ? <ItemLink href={href}>{name}</ItemLink> : name}</span>
          {pick.upgrade && <span className="arrow up" title="Upgrade">▲ {pick.delta != null ? `+${formatScore(pick.delta)}` : ""}</span>}
          {pick.upgrade === false && pick.delta != null && pick.delta < -0.05 && (
            <span className="arrow down" title="Below equipped">▼ {formatScore(pick.delta)}</span>
          )}
        </div>
        <div className="meta">
          {"ilvl" in item ? `ilvl ${item.ilvl} · ` : `skill ${item.skill} · `}
          requires {item.req}
          {"dps" in item && item.dps ? ` · ${item.dps.toFixed(1)} dps` : ""}
          {kind === "enchant" && "fit" in item && item.fit !== "any" ? ` · ${fitLabel(item.fit)}` : ""}
          {span ? ` · ${longevityLabel(span)}` : ""}
        </div>
        <div className="lines">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {lines.length === 0 && "effect" in item && item.effect && <span>{item.effect.slice(0, 80)}</span>}
        </div>
        <div className="tags">
          {pick.overallBest && <span className="tag recommended">Recommended</span>}
          {pick.longest && <span className="tag longest">Longest BiS</span>}
          {pick.upgrade === false && pick.delta != null && Math.abs(pick.delta) <= 0.05 && <span className="tag">Equipped pace</span>}
          {"pvp" in item && item.pvp && <span className="tag">PvP</span>}
          {"changed" in item && item.changed === "new" && <span className="tag">New in Forever</span>}
        </div>
        {"source" in item && item.source && <div className="source">Source: {item.source}</div>}
        {kind === "enchant" && "effect" in item && <div className="source">{item.effect}</div>}
        {href && (
          <ItemLink className="full-link" href={href}>
            {href}
          </ItemLink>
        )}
      </div>
    </article>
  );
}

function ItemIcon({ src, quality }: { src?: string | null; quality: string }) {
  return (
    <span className={`item-icon q-${quality}`}>
      {src ? <img src={src} alt="" /> : <span className="item-icon-empty" />}
    </span>
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
  const labelFor = (row: (typeof ROWS)[number]) => (row.slot === "ranged" ? rangedLabel : row.label);
  const iconFor = (item: EquippedItem | null) => (item ? item.iconUrl || icons[item.itemId] || null : null);

  return (
    <section className="panel armory">
      <div className="doll">
        <div className="doll-col">{LEFT_SLOTS.map((id) => slotButton(id))}</div>
        <div className="doll-center">
          <div className="doll-id">
            {character.portraitUrl && <img className="portrait" src={character.portraitUrl} alt="" />}
            <div>
              <h2>
                {character.name} {character.surname}
              </h2>
              <p>
                Level {character.level} {character.className}
                {character.ilvl != null ? ` · ilvl ${character.ilvl}` : ""}
              </p>
            </div>
          </div>
          <div
            className="doll-stage"
            style={character.backdropUrl ? { backgroundImage: `url(${character.backdropUrl})` } : undefined}
          >
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
        <div className="slot-detail">
          <div>
            <h3>{labelFor(selected.row)}</h3>
            {selected.equipped ? (
              <ItemCard item={selected.equipped} spec={spec} equipped icon={iconFor(selected.equipped)} />
            ) : (
              <p className="empty">Nothing equipped.</p>
            )}
          </div>
          <div>
            <h3>Best in slot</h3>
            <div className="parchment">
              <div className="wow-title">Upgrades · {labelFor(selected.row)}</div>
              {selected.gear.length === 0 && (
                <p className="empty">
                  No item for this slot can be worn at required levels {low}–{high}.
                </p>
              )}
              {selected.gear.map((pick, index) => (
                <MiniCard key={pick.entry.id} rank={index + 1} pick={pick} spec={spec} kind="item" icon={icons[pick.entry.id]} />
              ))}
            </div>
            <div className="enchant-block">
              <h4>Enchants</h4>
              {!selected.enchantPlan.available && (
                <p className="empty">This slot cannot be enchanted with the Forever formulas in the catalog.</p>
              )}
              {selected.enchantPlan.available && selected.equipped?.enchant && (
                <p className="note">
                  Equipped: {selected.equipped.enchant.label}
                  {selected.equipped.enchant.name ? ` (${selected.equipped.enchant.name})` : ""}
                  {selected.enchantPlan.scored
                    ? ""
                    : ". This enchant is not an Enchanting formula in the catalog, so upgrade marks are withheld."}
                </p>
              )}
              {selected.enchantPlan.available && (
                <div className="recs">
                  {selected.enchantPlan.ranked.length === 0 && <p className="empty">No enchants in this level window.</p>}
                  {selected.enchantPlan.ranked.map((pick) => (
                    <MiniCard key={pick.entry.id} pick={pick} spec={spec} kind="enchant" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );

  function slotButton(id: string) {
    const plan = byId.get(id);
    const row = rows.find((item) => item.id === id);
    if (!plan || !row) return null;
    const equipped = plan.equipped;
    return (
      <button
        key={id}
        type="button"
        className={id === selectedId ? "slot-btn active" : "slot-btn"}
        aria-pressed={id === selectedId}
        onClick={() => onSelect(id)}
      >
        <ItemIcon src={iconFor(equipped)} quality={equipped?.quality ?? "empty"} />
        <span className="slot-copy">
          <b>
            {labelFor(row)}
            {plan.gear[0]?.longevity && plan.gear[0].longevity.levels >= LONG_BIS_LEVELS && (
              <span className="long-mark" title={longevityLabel(plan.gear[0].longevity)}>
                long
              </span>
            )}
          </b>
          <span className={equipped ? `qtext-${equipped.quality}` : ""}>{equipped ? equipped.name : "Empty"}</span>
        </span>
      </button>
    );
  }
}

function ItemLink({ href, className, children }: { href: string; className?: string; children: string }) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function fitLabel(fit: Enchant["fit"]): string {
  if (fit === "twohand") return "two-hand";
  if (fit === "shield") return "shield";
  if (fit === "holdable") return "held off-hand";
  if (fit === "weapon") return "weapon";
  return fit;
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
    <section className="source-filters">
      <div className="wow-title">Item sources</div>
      <div className="source-chips">
        {SOURCE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={filters[type] ? "source-chip on" : "source-chip"}
            aria-pressed={filters[type]}
            onClick={() => onToggle(type)}
          >
            {SOURCE_LABEL[type]}
            <span>{filters[type] ? `hides ${hideCounts[type]}` : "off"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DungeonBoard({ dungeons }: { dungeons: DungeonRecommendation[] }) {
  return (
    <section className="dungeon-board">
      <div className="wow-title">Best dungeon right now</div>
      {dungeons.length === 0 ? (
        <p className="empty">None of the current upgrades name a dungeon you can run at this level and faction.</p>
      ) : (
        dungeons.map((dungeon, index) => (
          <article key={dungeon.name} className={index === 0 ? "hunt rank1" : "hunt"}>
            <span className="rank">{index + 1}</span>
            <div className="hunt-body">
              <div className="hunt-title">
                <span className="card-name">{dungeon.name}</span>
                <span className="tag recommended">
                  {dungeon.count} upgrade{dungeon.count === 1 ? "" : "s"}
                </span>
                {index === 0 && <span className="tag longest">Best now</span>}
              </div>
              <div className="meta">
                Levels {dungeon.min}–{dungeon.max}
                {dungeon.faction === "both" ? " · both factions" : ` · ${dungeon.faction}`}
              </div>
              <div className="lines">
                {dungeon.items.map((item) => (
                  <span key={`${item.slot}-${item.id}`}>
                    {item.slot}: {item.name}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

function loadPickCount(): number {
  try {
    return clampPickCount(Number(localStorage.getItem(PICKS_KEY)));
  } catch {
    return 4;
  }
}

function clampPickCount(value: number): number {
  if (!Number.isInteger(value)) return 4;
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

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" rx="8" fill="#2a1c13" stroke="#e4b15a" strokeWidth="2" />
      <path d="M32 10 L46 32 L32 54 L18 32 Z" fill="none" stroke="#e4b15a" strokeWidth="2" />
      <circle cx="32" cy="32" r="4" fill="#d35245" />
    </svg>
  );
}
