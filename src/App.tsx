import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ImportError, importCharacter, profileFromPaste } from "./lib/armory.ts";
import { classById, specById, specsForClass } from "./lib/classes.ts";
import { formatScore, preferredStatOrder, qualityName, statLabel } from "./lib/format.ts";
import { parseCharacterQuery, REGION_ORDER, type Region } from "./lib/names.ts";
import { recommendEnchantments, recommendGear, type Ranked } from "./lib/recommend.ts";
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
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("us");
  const [searchOthers, setSearchOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [catalog, setCatalog] = useState<{ items: GearItem[]; enchants: Enchant[] } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

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
  const activeSpecId = side === "off" && profile.offSpec ? profile.offSpec : profile.mainSpec;
  const activeArmory = character.specs.find((spec) => spec.active) ?? character.specs[0];
  const showingTalents =
    side === "main" || (activeArmory && specById(activeSpecId).name.toLowerCase().startsWith(activeArmory.name.toLowerCase()));
  const low = Math.max(1, character.level - windowN);
  const high = Math.min(60, character.level + windowN);
  const rangedLabel = cls?.ranged.includes("totem")
    ? "Relic"
    : cls?.ranged.includes("wand")
      ? "Wand"
      : cls?.ranged.includes("libram") || cls?.ranged.includes("idol")
        ? "Relic"
        : "Ranged";

  const gearBySlot = new Map(character.gear.map((item) => [item.armorySlot, item]));
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
              {character.updatedAt ? ` · Armory updated ${character.updatedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
              {profile.sourceNote ? ` · ${profile.sourceNote}` : ""}
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
            Showing required levels {low}–{high}. The overall best item and enchant stay visible even when they sit outside this window.
          </p>
        </div>

        <div>
          <h3>Talents</h3>
          {side === "off" && !showingTalents ? (
            <p className="note">
              The public Armory snapshot only includes the active spec
              {activeArmory ? ` (${activeArmory.name}, ${activeArmory.spent} points)` : ""}. Off-spec talents are not published until that spec is the one logged out. The saved off spec is still {specById(profile.offSpec ?? profile.mainSpec).name}, and recommendations follow the selector above.
            </p>
          ) : activeArmory ? (
            <div className="talents">
              {activeArmory.talents.map((talent) => (
                <div className="talent" key={`${talent.name}-${talent.rank}`}>
                  <b>
                    {talent.name} {talent.rank}
                  </b>
                  {talent.description && <span>{talent.description}</span>}
                </div>
              ))}
              {activeArmory.talents.length === 0 && <p className="note">No talent points in the Armory profile.</p>}
            </div>
          ) : (
            <p className="note">The Armory profile did not include a talent build.</p>
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
        <div className="slots">
          {ROWS.map((row) => {
            const equipped = gearBySlot.get(row.armorySlot) ?? null;
            const label = row.slot === "ranged" ? rangedLabel : row.label;
            const exclude =
              row.id === "finger2" || row.id === "trinket2"
                ? uniquePick(catalog.items, {
                    spec: target,
                    faction: character.faction,
                    level: character.level,
                    window: windowN,
                    slot: row.slot,
                    equipped: gearBySlot.get(row.id === "finger2" ? "finger1" : "trinket1") ?? null,
                  })
                : [];
            const gear = recommendGear({
              items: catalog.items,
              spec: target,
              faction: character.faction,
              level: character.level,
              window: windowN,
              slot: row.slot,
              equipped,
              excludeIds: exclude,
            });
            const enchantPlan = planEnchants(catalog.enchants, target, character.level, windowN, row.slot, equipped);
            return (
              <section className="panel slot" key={row.id}>
                <div>
                  <h3>{label}</h3>
                  {equipped ? <ItemCard item={equipped} spec={target} equipped /> : <p className="empty">Nothing equipped.</p>}
                </div>
                <div>
                  <div className="recs">
                    {gear.length === 0 && <p className="empty">No catalog items for this slot, class, and faction.</p>}
                    {gear.map((pick) => (
                      <MiniCard key={pick.entry.id} pick={pick} spec={target} kind="item" />
                    ))}
                  </div>
                  <div className="enchant-block">
                    <h4>Enchants</h4>
                    {!enchantPlan.available && <p className="empty">This slot cannot be enchanted with the Forever formulas in the catalog.</p>}
                    {enchantPlan.available && equipped?.enchant && (
                      <p className="note">
                        Equipped: {equipped.enchant.label}
                        {equipped.enchant.name ? ` (${equipped.enchant.name})` : ""}
                        {enchantPlan.scored ? "" : ". This enchant is not an Enchanting formula in the catalog, so upgrade marks are withheld."}
                      </p>
                    )}
                    {enchantPlan.available && (
                      <div className="recs">
                        {enchantPlan.ranked.length === 0 && <p className="empty">No enchants for this specialization.</p>}
                        {enchantPlan.ranked.map((pick) => (
                          <MiniCard key={pick.entry.id} pick={pick} spec={target} kind="enchant" />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <footer>
        <p>
          Seed profiles are Daz Dingomon (Restoration / Enhancement) and Mrs Dingomon (Arcane / Frost PvP), Horde, US PvP, from the official Armory on 8 Nov 2026. Gear on the page is that snapshot, not a guessed loadout.
        </p>
        <p>
          Item stats come from Forever Wowhead tooltips. Enchant effects and skill levels come from Warcraft Forever client data build 1.60.1.70862, with formula and trainer notes from WoW Forever DB. Enchant required level is the level needed to learn the formula at 5 Enchanting skill per character level.
        </p>
        <p>Scores are a Forever-oriented stat weighting for the selected spec. They are a planning aid, not a simulation.</p>
      </footer>
    </div>
  );
}

function uniquePick(
  items: GearItem[],
  args: { spec: SpecId; faction: SavedProfile["character"]["faction"]; level: number; window: number; slot: PlannerSlot; equipped: EquippedItem | null },
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
  });
  return { ...result, scored: Boolean(current) && equippedScore != null };
}

function ItemCard({ item, spec, equipped }: { item: EquippedItem; spec: SpecId; equipped?: boolean }) {
  const lines = topStatLines(item.stats, spec);
  return (
    <article className={`card q-${item.quality}`}>
      <div className="card-name">{item.name}</div>
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
    </article>
  );
}

function MiniCard<T extends GearItem | Enchant>({
  pick,
  spec,
  kind,
}: {
  pick: Ranked<T>;
  spec: SpecId;
  kind: "item" | "enchant";
}) {
  const item = pick.entry;
  const lines = topStatLines(item.stats, spec, 3);
  const quality = "quality" in item ? qualityName(item.quality) : "enchant";
  const name = item.name;
  return (
    <article className={`mini q-${quality}`}>
      <div className="card-name">{name}</div>
      <div className="meta">
        {"ilvl" in item ? `ilvl ${item.ilvl} · ` : `skill ${item.skill} · `}
        requires {item.req}
        {"dps" in item && item.dps ? ` · ${item.dps.toFixed(1)} dps` : ""}
        {kind === "enchant" && "fit" in item && item.fit !== "any" ? ` · ${fitLabel(item.fit)}` : ""}
      </div>
      <div className="lines">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
        {lines.length === 0 && "effect" in item && item.effect && <span>{item.effect.slice(0, 80)}</span>}
      </div>
      <div className="tags">
        {pick.overallBest && <span className="tag best">Best</span>}
        {pick.upgrade && <span className="tag good">Upgrade {pick.delta != null ? `+${formatScore(pick.delta)}` : ""}</span>}
        {pick.upgrade === false && pick.delta != null && pick.delta <= 0.05 && <span className="tag">Equipped pace</span>}
        {pick.outsideLevel && <span className="tag warn">Outside level window</span>}
        {pick.outsideFit && <span className="tag warn">Not wearable on the current piece yet</span>}
        {"pvp" in item && item.pvp && <span className="tag">PvP</span>}
        {"changed" in item && item.changed === "new" && <span className="tag">New in Forever</span>}
      </div>
      {"source" in item && item.source && <div className="source">{item.source}</div>}
      {kind === "enchant" && "effect" in item && <div className="source">{item.effect}</div>}
    </article>
  );
}

function fitLabel(fit: Enchant["fit"]): string {
  if (fit === "twohand") return "two-hand";
  if (fit === "shield") return "shield";
  if (fit === "holdable") return "held off-hand";
  if (fit === "weapon") return "weapon";
  return fit;
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
