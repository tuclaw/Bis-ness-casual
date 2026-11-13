# Bis-ness Casual

A static planner for World of Warcraft: Forever. Load a character from the official Armory, switch the spec the recommendations target, and compare the best upgrades per equipment slot that can be worn in the required-level window. Each item links to its full Forever Wowhead page.

Daz Dingomon (Horde shaman, Restoration / Enhancement) and Mrs Dingomon (Horde mage, Arcane / Frost PvP) are saved profiles from the US PvP Armory. Their equipped items, stats, and active-spec talents are the live Armory embed captured on 13 Nov 2026. The Armory only returned the spec they were logged out on, so the off spec is the previously saved profile and its talents are marked as not published. The page shows that snapshot date because GitHub Pages cannot refresh the Armory (no CORS). `npm run dev` still proxies a live import.

## Run locally

```bash
npm install
npm test
npm run dev
```

The dev server is [http://127.0.0.1:4177](http://127.0.0.1:4177). In dev, character import is proxied to the official Armory, so a two-part name lookup can succeed. `npm run build` writes the GitHub Pages site to `docs/`.

## Import a character

Forever names are unique in a region and have no realm. Use `First Surname`, or paste an Armory URL:

`https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/daz-dingomon`

The page tries, in order:

1. The local dev proxy (`/armory-proxy`), which only exists under `npm run dev`.
2. The official Armory HTML, which embeds `characterProfileInitialState`.
3. [Forever Tool](https://forever-tool.com/en/character/), which reads that same Armory page.

Blizzard does not send CORS headers, and Forever Tool does not either, so a browser on GitHub Pages cannot read those responses. When that happens the page says so. You can still paste the Armory page source (the embedded profile is enough). Profiles appear after level 10 and only update when the character logs out.

Nothing here asks for a Battle.net API key.

## How recommendations are scored

Items come from Forever Wowhead tooltips (the Forever cache published with Classic item data, tooltips current through 7 Nov 2026), not a Classic Era copy. Random-suffix greens are left out because the tooltip has no rolled stats. Horde characters are not offered Alliance-only pieces, and the reverse. Armor and weapons the class can never equip are removed. Mail and plate are listed only when the required-level window reaches the level the class can wear them (40). Item names link to `https://www.wowhead.com/forever/item=<id>/<name>`.

Each spec has weights for the stats Forever items actually carry: intellect, spirit, mana per 5, spell power, healing, school damage, attack power, weapon DPS, crit, hit, stamina, and defense. Restoration favors healing, intellect, spirit, and mana per 5. Enhancement favors weapon DPS, agility, strength, attack power, crit, and hit. Arcane favors arcane and generic spell damage, intellect, crit, and hit, with some wand DPS. Frost (PvP) keeps frost damage and adds stamina and other survivability, so a stamina piece can beat a glass-cannon piece. PvP gear gets only a small nudge for Enhancement and Frost (PvP). It does not automatically win for Restoration.

The slider is the character's level plus or minus N, applied to item required level. Only items that can be worn inside that window are shown, and the highest-scoring one is the best-in-slot pick for the range. Each recommendation also says how long it stays that pick: from the level it can be worn until a strictly better item for the slot and spec becomes wearable, or through 60. The longest of those picks is badged, and a slot whose current best lasts at least 10 levels is marked on the paper doll.

Enchants come from Warcraft Forever's client data for build 1.60.1.70862 (effects and the skill at which the formula turns yellow), with source notes from WoW Forever DB: trainer, formula, or unconfirmed when the client does not say. The required level is that skill divided by 5, because Forever caps profession skill at 5 per character level. The same slider applies, and enchants outside the window are hidden. Slots with no Forever formula (head, shoulder, waist, legs, finger, trinket, relic, wand) say so. An Armory enchant is shown only when the profile includes it. If that enchant is in the catalog, a higher-scoring recommendation is marked as an upgrade. Weapon imbues such as Rockbiter are shown and are not scored as Enchanting formulas.

## GitHub Pages

The production build is the `docs/` folder (`vite build` with relative asset paths).

[`.github/workflows/refresh-armory.yml`](.github/workflows/refresh-armory.yml) refreshes every character in [`characters.config.json`](characters.config.json) every 6 hours. It uses the Blizzard Profile API (`profile-forever-{region}`) when the Actions secrets `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` are set, and otherwise parses the official Armory page. It commits a new snapshot only when the character data changed, then rebuilds `docs/`.

Either:

- Settings → Pages → Deploy from a branch → `main` → `/docs`, or
- Settings → Pages → GitHub Actions, which runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on push to `main` (`npm test` and `npm run build`).

Refresh the catalogs with `npm run catalog` when you have the Forever item cache and the Warcraft Forever recipe API available. The script documents its inputs in `scripts/compile_catalog.py`.
