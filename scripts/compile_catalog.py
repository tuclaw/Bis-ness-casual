#!/usr/bin/env python3
"""Build the static Forever item and enchant catalogs, plus seed character snapshots.

Item tooltips come from the Forever Wowhead cache (Napalmsteak/Classic-WoW-Item-Caches).
Enchant effects and skill levels come from the Warcraft Forever client-data API
(build 1.60.1.70862). Source notes come from wowfdb.com's enchanting recipe tables.
Character snapshots are parsed from official Armory HTML embeds already saved locally,
or re-downloaded when --online is passed.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CHARACTER_DATA = ROOT / "src" / "data"
CACHE = Path("/tmp/wowdata/Forever Cache.json")
RECIPES = Path("/tmp/wowdata/recipes-enchant.json")
WOWFDB = Path("/tmp/wowdata/wowfdb-ench.html")
ARMORY = {
    "daz-dingomon": Path("/tmp/wowprobe/armory_daz.json"),
    "mrs-dingomon": Path("/tmp/wowprobe/armory_mrs.json"),
}

HORDE_REPS = (
    "the defilers",
    "warsong outriders",
    "frostwolf clan",
    "orgrimmar",
    "darkspear trolls",
    "undercity",
    "thunder bluff",
    "revantusk tribe",
)
ALLIANCE_REPS = (
    "the league of arathor",
    "league of arathor",
    "silverwing sentinels",
    "stormpike guard",
    "stormwind",
    "ironforge",
    "darnassus",
    "gnomeregan exiles",
    "wildhammer clan",
)
PVP_REPS = HORDE_REPS + (
    "the league of arathor",
    "league of arathor",
    "silverwing sentinels",
    "stormpike guard",
)

STAT_WORDS = {
    "stamina": "sta",
    "strength": "str",
    "agility": "agi",
    "intellect": "int",
    "spirit": "spi",
}

SLOT_WORDS = {
    "Head": "head",
    "Neck": "neck",
    "Shoulder": "shoulder",
    "Back": "back",
    "Chest": "chest",
    "Wrist": "wrist",
    "Hands": "hands",
    "Waist": "waist",
    "Legs": "legs",
    "Feet": "feet",
    "Finger": "finger",
    "Trinket": "trinket",
}

HAND_WORDS = (
    ("Held In Off-hand", "holdable"),
    ("Two-Hand", "twohand"),
    ("One-Hand", "onehand"),
    ("Main Hand", "mainhand"),
    ("Off Hand", "offhand"),
    ("Ranged", "ranged"),
    ("Thrown", "ranged"),
    ("Relic", "relic"),
)

ARMOR_TYPES = {"cloth", "leather", "mail", "plate"}
WEAPON_TYPES = {
    "staff",
    "sword",
    "mace",
    "axe",
    "dagger",
    "fist weapon",
    "polearm",
    "bow",
    "gun",
    "crossbow",
    "wand",
    "thrown",
    "totem",
    "libram",
    "idol",
    "shield",
    "fist",
}


def detect_slot(text: str) -> tuple[str | None, str | None, str | None]:
    """Slot words sit on the bind line in stripped Wowhead tooltips."""
    lines = text.split("\n")
    window = "\n".join(lines[:6])
    for phrase, bucket in HAND_WORDS:
        match = re.search(rf"\b{re.escape(phrase)}\b\s*([A-Za-z][A-Za-z \-]*)?", window)
        if not match:
            continue
        rest = " ".join((match.group(1) or "").split()[:3]).lower()
        weapon = None
        armor = None
        for candidate in sorted(WEAPON_TYPES, key=len, reverse=True):
            if rest.startswith(candidate):
                weapon = "fist" if candidate.startswith("fist") else candidate
                break
        if weapon == "shield":
            return "shield", None, None
        if rest.split(" ")[0] in ARMOR_TYPES:
            armor = rest.split(" ")[0]
        return bucket, weapon, armor
    for word, bucket in SLOT_WORDS.items():
        match = re.search(rf"\b{word}\b(?:\s+([A-Za-z]+))?", window)
        if not match:
            continue
        maybe = (match.group(1) or "").lower()
        armor = maybe if maybe in ARMOR_TYPES else None
        return bucket, None, armor
    return None, None, None


def strip_html(raw: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = re.sub(r"</(tr|div|p|li)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def add_stat(stats: dict, key: str, value: float) -> None:
    if not value:
        return
    stats[key] = round(stats.get(key, 0) + float(value), 4)


def parse_stat_text(text: str) -> tuple[dict, bool]:
    """Pull combat stats out of an enchant or item tooltip. Returns (stats, proc)."""
    stats: dict[str, float] = {}
    proc = bool(
        re.search(
            r"\boften\b|cannot occur|chance per hit|chance of|chance to (grant|trigger|strike|stun|chill)",
            text,
            re.I,
        )
    )
    coef = 0.35 if proc else 1.0
    consumed = text

    def take(pattern: str, handler) -> None:
        nonlocal consumed
        for match in list(re.finditer(pattern, consumed, flags=re.I)):
            handler(match)
        consumed = re.sub(pattern, " ", consumed, flags=re.I)

    def all_stats(match: re.Match) -> None:
        for key in ("str", "agi", "int", "spi", "sta"):
            add_stat(stats, key, float(match.group(1)) * coef)

    take(r"(?:grant|give|adds?)\s+\+?\s*(\d+)\s+to all stats", all_stats)
    take(r"\+\s*(\d+)\s+to all stats", all_stats)

    def heal_and_damage(match: re.Match) -> None:
        add_stat(stats, "heal", float(match.group(1)) * coef)
        add_stat(stats, "sd", float(match.group(2)) * coef)

    take(
        r"(?:increase|increases|add|adds)?[^\n.]{0,40}?healing(?: spells| done)? by up to (\d+)[^\n.]{0,80}?damage(?: spells| done)? by up to (\d+)",
        heal_and_damage,
    )
    take(
        r"(\d+)\s+points of healing to healing spells and up to (\d+)\s+points of damage",
        heal_and_damage,
    )
    take(
        r"healing done by up to (\d+) and damage done by up to (\d+)",
        heal_and_damage,
    )

    def combined_sp(match: re.Match) -> None:
        add_stat(stats, "sp", float(match.group(1)) * coef)

    take(
        r"(?:spell damage and healing|damage and healing(?: done by (?:magical )?spells and effects)?) by up to (\d+)",
        combined_sp,
    )
    take(r"increase damage and healing by up to (\d+)", combined_sp)

    def school(match: re.Match) -> None:
        name = match.group(1).lower()
        key = {
            "fire": "fire",
            "frost": "frost",
            "arcane": "arcane",
            "nature": "nature",
            "shadow": "shadow",
            "holy": "holy",
        }[name]
        add_stat(stats, key, float(match.group(2)) * coef)

    take(r"\b(fire|frost|arcane|nature|shadow|holy)\s+damage by up to (\d+)", school)
    take(
        r"(\d+)\s+additional (fire|frost|arcane|nature|shadow|holy) damage",
        lambda m: add_stat(stats, m.group(2).lower(), float(m.group(1)) * coef),
    )

    take(
        r"(?:add|adds|increase|increases)\s+(?:up to\s+)?(\d+)\s+(?:points of\s+)?damage to (?:damage )?spells",
        lambda m: add_stat(stats, "sd", float(m.group(1)) * coef),
    )
    take(
        r"add up to (\d+)\s+damage to spells",
        lambda m: add_stat(stats, "sd", float(m.group(1)) * coef),
    )
    take(
        r"(?:add|adds)\s+(\d+)\s+(?:to\s+)?spell power",
        lambda m: add_stat(stats, "sp", float(m.group(1)) * coef),
    )
    take(
        r"spell power(?: by)?(?: up to)? (\d+)",
        lambda m: add_stat(stats, "sp", float(m.group(1)) * coef),
    )

    def named(match: re.Match) -> None:
        add_stat(stats, STAT_WORDS[match.group(1).lower()], float(match.group(2)) * coef)

    def named_rev(match: re.Match) -> None:
        add_stat(stats, STAT_WORDS[match.group(2).lower()], float(match.group(1)) * coef)

    take(
        r"\b(stamina|strength|agility|intellect|spirit)\b(?: of the (?:wearer|bearer|caster))? by (\d+)",
        named,
    )
    take(
        r"(?:grant|give|add|adds|increase|increases)\s+\+?\s*(\d+)\s+(stamina|strength|agility|intellect|spirit)\b",
        named_rev,
    )
    take(
        r"add (\d+) to (stamina|strength|agility|intellect|spirit)\b",
        named_rev,
    )
    take(r"\+\s*(\d+)\s+(stamina|strength|agility|intellect|spirit)\b", named_rev)

    take(
        r"(\d+)\s+mana (?:per|every) 5",
        lambda m: add_stat(stats, "mp5", float(m.group(1)) * coef),
    )
    take(
        r"defense(?: skill)?(?: of the wearer)?(?: is)? increased by (\d+)",
        lambda m: add_stat(stats, "def", float(m.group(1)) * coef),
    )
    take(
        r"increase defense skill by (\d+)",
        lambda m: add_stat(stats, "def", float(m.group(1)) * coef),
    )
    take(
        r"(\d+(?:\.\d+)?)%\s+chance to dodge",
        lambda m: add_stat(stats, "dodge", float(m.group(1))),
    )
    take(
        r"dodge(?: chance)? by (\d+(?:\.\d+)?)%",
        lambda m: add_stat(stats, "dodge", float(m.group(1))),
    )
    take(
        r"critical strike with spells by (\d+(?:\.\d+)?)%",
        lambda m: add_stat(stats, "spellCrit", float(m.group(1)) * coef),
    )
    take(
        r"critical strike(?: chance)? by (\d+(?:\.\d+)?)%",
        lambda m: add_stat(stats, "crit", float(m.group(1)) * coef),
    )
    take(
        r"chance to hit with spells by (\d+(?:\.\d+)?)%",
        lambda m: add_stat(stats, "spellHit", float(m.group(1)) * coef),
    )
    take(
        r"chance to hit by (\d+(?:\.\d+)?)%",
        lambda m: add_stat(stats, "meleeHit", float(m.group(1)) * coef),
    )
    take(
        r"(?:give|grant)\s+\+?(\d+)\s+defense\b",
        lambda m: add_stat(stats, "def", float(m.group(1)) * coef),
    )
    take(
        r"(?:give|grant)\s+(\d+)\s+additional armor",
        lambda m: add_stat(stats, "armor", float(m.group(1)) * coef),
    )
    take(
        r"increase(?:s)? (?:its )?armor by (\d+)",
        lambda m: add_stat(stats, "armor", float(m.group(1)) * coef),
    )
    take(
        r"add (\d+(?:\.\d+)?)%\s+critical strike",
        lambda m: add_stat(stats, "crit", float(m.group(1)) * coef),
    )
    take(
        r"(\d+(?:\.\d+)?)%\s+chance to block",
        lambda m: add_stat(stats, "block", float(m.group(1))),
    )
    take(
        r"resistance to (fire|frost|nature|shadow|arcane) by (\d+)",
        lambda m: add_stat(stats, m.group(1).lower() + "Res", float(m.group(2)) * coef),
    )
    take(
        r"(\d+)\s+(fire|frost|nature|shadow|arcane)\s+resistance",
        lambda m: add_stat(stats, m.group(2).lower() + "Res", float(m.group(1)) * coef),
    )
    take(
        r"(\d+)\s+to all resistances",
        lambda m: add_stat(stats, "resAll", float(m.group(1)) * coef),
    )
    take(
        r"resistance to all schools of magic by (\d+)",
        lambda m: add_stat(stats, "resAll", float(m.group(1)) * coef),
    )
    take(
        r"movement speed by (\d+)%",
        lambda m: add_stat(stats, "moveSpeed", float(m.group(1))),
    )
    take(
        r"(\d+)%\s+attack and casting speed",
        lambda m: add_stat(stats, "haste", float(m.group(1)) * coef),
    )
    take(
        r"(\d+)\s+points of damage absorption",
        lambda m: add_stat(stats, "absorb", float(m.group(1)) * coef),
    )
    take(
        r"do \+?(\d+) additional points? of damage",
        lambda m: add_stat(stats, "wpnDamage", float(m.group(1)) * coef),
    )
    take(
        r"do \+?(\d+) damage\b",
        lambda m: add_stat(stats, "wpnDamage", float(m.group(1)) * coef),
    )
    take(
        r"(\d+) additional points of damage(?! to)",
        lambda m: add_stat(stats, "wpnDamage", float(m.group(1)) * coef),
    )

    # Item-style lines that remain after the sentence parser.
    for line in consumed.split("\n"):
        line = line.strip()
        if re.search(r"against| vs ", line, re.I) and re.search(r"attack power", line, re.I):
            m = re.search(r"\+\s*(\d+)\s+Attack Power", line, re.I)
            if m:
                add_stat(stats, "apBeast", float(m.group(1)))
            continue
        m = re.search(r"\+\s*(\d+)\s+Attack Power", line, re.I)
        if m:
            add_stat(stats, "ap", float(m.group(1)))
        m = re.search(r"\+\s*(\d+)\s+Spell Power\b", line, re.I)
        if m:
            add_stat(stats, "sp", float(m.group(1)))
        m = re.search(r"\+\s*(\d+)\s+Spell Damage\b", line, re.I)
        if m:
            add_stat(stats, "sd", float(m.group(1)))
        m = re.search(r"\+\s*(\d+)\s+Spell Healing\b", line, re.I)
        if m:
            add_stat(stats, "heal", float(m.group(1)))
        m = re.search(r"\+\s*(\d+)\s+Armor\b", line)
        if m:
            add_stat(stats, "armor", float(m.group(1)))
        for word, key in STAT_WORDS.items():
            m = re.search(rf"\+\s*(\d+)\s+{word}\b", line, re.I)
            if m:
                add_stat(stats, key, float(m.group(1)))

    return {k: v for k, v in stats.items() if abs(v) > 0}, proc


def requirement_text(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        low = line.lower().strip()
        if low.startswith("requires ") or "horde only" in low or "alliance only" in low:
            lines.append(low)
    return "\n".join(lines)


def faction_of(text: str) -> str:
    low = requirement_text(text)
    horde = "horde only" in low or bool(re.search(r"requires horde\b", low))
    alliance = "alliance only" in low or bool(re.search(r"requires alliance\b", low))
    for rep in HORDE_REPS:
        if rep in low:
            horde = True
    for rep in ALLIANCE_REPS:
        if rep in low:
            alliance = True
    if horde and not alliance:
        return "horde"
    if alliance and not horde:
        return "alliance"
    return "both"


PVP_ONLY = (
    "the defilers",
    "warsong outriders",
    "frostwolf clan",
    "the league of arathor",
    "league of arathor",
    "silverwing sentinels",
    "stormpike guard",
)


def is_pvp(text: str, source_types: list[str]) -> bool:
    if any(t == "PvP" for t in source_types):
        return True
    low = requirement_text(text)
    return any(rep in low for rep in PVP_ONLY)


def parse_item(raw: dict) -> dict | None:
    tooltip = raw.get("tooltipHtml") or ""
    if "Random enchantment" in tooltip:
        return None
    quality_match = re.search(r'class="q(\d)"', tooltip)
    quality = int(quality_match.group(1)) if quality_match else 0
    if quality < 2 or quality > 5:
        return None
    text = strip_html(tooltip)
    name = raw["name"]
    if re.match(r"^(Formula|Pattern|Plans|Schematic|Recipe|Design):", name):
        return None
    if any(bad in name for bad in ("[PH]", "(Test)", "Monster -", "Deprecated")):
        return None

    bucket, weapon, armor = detect_slot(text)
    if not bucket:
        return None

    ilvl_m = re.search(r"Item Level\s+(\d+)", text)
    req_m = re.search(r"Requires Level\s+(\d+)", text)
    ilvl = int(ilvl_m.group(1)) if ilvl_m else 0
    req = int(req_m.group(1)) if req_m else 1
    if req > 60:
        return None

    stat_text = "\n".join(
        line
        for line in text.split("\n")
        if "Set :" not in line and not re.match(r"\(\d+\)", line.strip())
    )
    stats, _proc = parse_stat_text(stat_text)
    armor_m = re.search(r"(?:^|\n)\s*(\d+) Armor\b", "\n" + text)
    if armor_m:
        add_stat(stats, "armor", float(armor_m.group(1)))
    dps_m = re.search(r"\(([\d.]+) damage per second\)", text, re.I)
    speed_m = re.search(r"Speed\s+([\d.]+)", text)
    dps = float(dps_m.group(1)) if dps_m else None
    speed = float(speed_m.group(1)) if speed_m else None

    classes = []
    class_m = re.search(r"Classes:\s*([A-Za-z ,]+)", text)
    if class_m:
        classes = [c.strip().lower() for c in class_m.group(1).split(",") if c.strip()]

    equip_lines = [
        ln.strip()
        for ln in text.split("\n")
        if ln.strip().startswith("Equip:") or ln.strip().startswith("Use:")
    ]
    effect = " ".join(equip_lines)[:220] or None
    if not stats and not dps and not effect:
        return None

    labels = []
    for label in raw.get("sourceLabels") or []:
        if label and label not in labels:
            labels.append(label)
    for boss in raw.get("bossNames") or []:
        if boss and boss not in labels:
            labels.append(boss)
    drop = re.search(r"Dropped by:\s*(.+)", text)
    if drop:
        boss = drop.group(1).split("Drop Chance")[0].strip(" .")
        if boss and boss not in labels:
            labels.append(boss)
    source = " · ".join(labels[:3]) or None
    change = (raw.get("changeFromClassic") or {}).get("status")
    if change not in {"new", "updated", "unchanged"}:
        change = None

    item = {
        "id": raw["itemId"],
        "name": name,
        "quality": quality,
        "ilvl": ilvl,
        "req": req,
        "bucket": bucket,
        "stats": stats,
        "faction": faction_of(text),
        "pvp": is_pvp(text, raw.get("sourceTypes") or []),
        "unique": bool(re.search(r"\bUnique\b", text)),
    }
    if armor:
        item["armor"] = armor
    if weapon:
        item["weapon"] = weapon
    if dps is not None:
        item["dps"] = dps
    if speed is not None:
        item["speed"] = speed
    if classes:
        item["classes"] = classes
    if source:
        item["source"] = source
    if effect and not re.fullmatch(r"(Equip: \+\s*\d+\s+\w+\.?\s*)+", effect):
        item["effect"] = effect
    if change in {"new", "updated"}:
        item["changed"] = change
    return item


def enchant_slot(name: str) -> tuple[str, str] | None:
    rules = (
        ("Enchant Bracer", "wrist", "any"),
        ("Enchant Chest", "chest", "any"),
        ("Enchant Cloak", "back", "any"),
        ("Enchant Gloves", "hands", "any"),
        ("Enchant Boots", "feet", "any"),
        ("Enchant Necklace", "neck", "any"),
        ("Enchant Shield", "offhand", "shield"),
        ("Enchant Off-Hand", "offhand", "holdable"),
        ("Enchant Off Hand", "offhand", "holdable"),
        ("Enchant 2H Weapon", "mainhand", "twohand"),
        ("Enchant Weapon", "mainhand", "weapon"),
    )
    for prefix, slot, fit in rules:
        if name.startswith(prefix):
            return slot, fit
    return None


UTILITY = re.compile(
    r"fishing|herbalism|mining|skinning|lotus claw|riding skill|threat",
    re.I,
)


def clean_source(text: str | None) -> str:
    if not text:
        return "Source unconfirmed in client data"
    text = re.sub(r"\s+", " ", text).strip()
    if text.startswith("Not in the client data"):
        return "Source unconfirmed in client data (trainer or quest)"
    if text == "Learned with the profession":
        return "Trainer (learned with Enchanting)"
    return text


def load_sources(path: Path) -> dict[int, str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    out = {}
    for rid, _attrs, body in re.findall(r'<tr id="r-(\d+)"([^>]*)>(.*?)</tr>', raw, flags=re.S):
        tds = re.findall(r"<td>(.*?)</td>", body, flags=re.S)
        if len(tds) < 2:
            continue
        learned = re.sub(r"<[^>]+>", " ", tds[1])
        learned = html.unescape(re.sub(r"\s+", " ", learned)).strip()
        out[int(rid)] = clean_source(learned)
    return out


def compile_enchants() -> tuple[list[dict], list[str]]:
    recipes = json.loads(RECIPES.read_text())
    sources = load_sources(WOWFDB)
    enchants = []
    unparsed = []
    for recipe in recipes:
        name = recipe.get("name") or ""
        placed = enchant_slot(name)
        if not placed:
            continue
        slot, fit = placed
        if UTILITY.search(name):
            continue
        description = (recipe.get("description") or "").strip()
        stats, proc = parse_stat_text(description)
        if not stats:
            unparsed.append(f"{name}: {description[:140]}")
        skill = recipe.get("skill") or {}
        learn = skill.get("learn") or skill.get("yellow") or 1
        req = max(1, min(60, (int(learn) + 4) // 5))
        enchant_meta = recipe.get("enchant") or {}
        enchants.append(
            {
                "id": recipe["id"],
                "enchantId": enchant_meta.get("id"),
                "name": name,
                "slot": slot,
                "fit": fit,
                "stats": stats,
                "effect": description,
                "req": req,
                "skill": int(skill.get("yellow") or learn),
                "source": sources.get(recipe["id"], "Source unconfirmed in client data"),
                "proc": proc,
            }
        )
    enchants.sort(key=lambda e: (e["slot"], -e["skill"], e["name"]))
    return enchants, unparsed


ARMORY_STAT = {
    "STAMINA": "sta",
    "AGILITY": "agi",
    "STRENGTH": "str",
    "INTELLECT": "int",
    "SPIRIT": "spi",
    "SPELL_POWER": "sp",
    "SPELL_DAMAGE_DONE": "sd",
    "SPELL_HEALING_DONE": "heal",
    "ATTACK_POWER": "ap",
    "BONUS_STAT_ATTACK_POWER_VS_BEAST": "apBeast",
    "FIRE_RESISTANCE": "fireRes",
    "NATURE_RESISTANCE": "natureRes",
    "FROST_RESISTANCE": "frostRes",
    "SHADOW_RESISTANCE": "shadowRes",
    "ARCANE_RESISTANCE": "arcaneRes",
}

ARMORY_SLOT = {
    "head": "head",
    "neck": "neck",
    "shoulder": "shoulder",
    "back": "back",
    "chest": "chest",
    "wrist": "wrist",
    "hand": "hands",
    "hands": "hands",
    "waist": "waist",
    "leg": "legs",
    "legs": "legs",
    "foot": "feet",
    "feet": "feet",
    "finger1": "finger",
    "finger2": "finger",
    "trinket1": "trinket",
    "trinket2": "trinket",
    "weapon": "mainhand",
    "offhand": "offhand",
    "ranged": "ranged",
}


def num(node) -> float | None:
    if not isinstance(node, dict):
        return None
    value = node.get("value")
    if isinstance(value, (int, float)):
        return float(value)
    return None


def snapshot_character(payload: dict) -> dict:
    character = payload["character"]
    gear = []
    for key, piece in (character.get("gear") or {}).items():
        slot = ARMORY_SLOT.get(key)
        if not slot or not piece:
            continue
        stats: dict[str, float] = {}
        for stat in piece.get("stats") or []:
            kind = (stat.get("type") or {}).get("type") or ""
            kind = kind.rstrip(",").upper()
            mapped = ARMORY_STAT.get(kind)
            if mapped:
                add_stat(stats, mapped, stat.get("value") or 0)
        armor_val = num(piece.get("armor"))
        if armor_val:
            add_stat(stats, "armor", armor_val)
        weapon = piece.get("weapon") or {}
        dps = num((weapon.get("dps") or {}))
        speed_raw = num((weapon.get("attack_speed") or {}))
        speed = speed_raw / 1000 if speed_raw and speed_raw > 20 else speed_raw
        effects = []
        for spell in piece.get("spells") or []:
            desc = spell.get("description")
            if desc:
                effects.append(desc)
        enchants = []
        for ench in piece.get("enchantments") or []:
            label = ench.get("display_string") or ""
            source = (ench.get("source_item") or {}).get("name")
            enchants.append(
                {
                    "enchantId": ench.get("enchantment_id"),
                    "name": source,
                    "label": label,
                }
            )
        subclass = (piece.get("item_subclass") or {}).get("name")
        item_class = (piece.get("item_class") or {}).get("name")
        gear.append(
            {
                "slot": slot,
                "armorySlot": key,
                "itemId": (piece.get("item") or {}).get("id") or piece.get("id"),
                "name": piece.get("name"),
                "quality": ((piece.get("quality") or {}).get("type") or "COMMON").lower(),
                "ilvl": int(num(piece.get("level")) or 0),
                "req": int(num((piece.get("requirements") or {}).get("level")))
                if num((piece.get("requirements") or {}).get("level")) is not None
                else None,
                "armorType": subclass.lower() if item_class == "Armor" and subclass else None,
                "weaponType": subclass.lower() if item_class == "Weapon" and subclass else None,
                "inventoryType": (piece.get("inventory_type") or {}).get("type"),
                "stats": stats,
                "dps": dps,
                "speed": speed,
                "effect": " ".join(effects) or None,
                "enchant": enchants[0] if enchants else None,
            }
        )

    display_stats = []
    for group in (character.get("stats") or {}).get("groups") or []:
        for stat in group.get("stats") or []:
            value = stat.get("value") or {}
            if value.get("type") == "RANGE":
                continue
            amount = value.get("value")
            if not isinstance(amount, (int, float)):
                continue
            display_stats.append(
                {
                    "key": stat.get("enum") or stat.get("slug"),
                    "value": amount,
                    "percent": value.get("type") == "PERCENTAGE",
                }
            )

    specs = []
    for spec in character.get("specs") or []:
        specs.append(
            {
                "id": spec.get("id"),
                "name": spec.get("name"),
                "spent": spec.get("spentPoints") or 0,
                "active": bool(spec.get("active")),
                "talents": [
                    {
                        "name": talent.get("name"),
                        "rank": talent.get("rank"),
                        "description": talent.get("description"),
                    }
                    for talent in spec.get("talents") or []
                ],
            }
        )

    professions = []
    prof_root = character.get("professions") or {}
    buckets = []
    if isinstance(prof_root, dict):
        buckets.extend(prof_root.get("primaries") or [])
        buckets.extend(prof_root.get("secondaries") or [])
    elif isinstance(prof_root, list):
        buckets = prof_root
    primaries = prof_root.get("primaries") if isinstance(prof_root, dict) else []
    for prof in buckets:
        tiers = prof.get("tiers") or []
        tier = tiers[0] if tiers else {}
        skill = prof.get("skill") or {}
        professions.append(
            {
                "name": (prof.get("profession") or {}).get("name") or prof.get("name"),
                "skill": tier.get("skillPoints")
                if tier
                else (skill.get("value") if isinstance(skill, dict) else prof.get("skill")),
                "max": tier.get("maxSkillPoints")
                if tier
                else (skill.get("max") if isinstance(skill, dict) else prof.get("max")),
                "primary": prof in primaries,
            }
        )

    updated = character.get("lastUpdatedTimestamp") or {}
    iso = updated.get("iso8601") if isinstance(updated, dict) else None
    cls = character.get("class") or {}
    race = character.get("race") or {}
    faction = character.get("faction") or {}
    ruleset = character.get("ruleset") or {}
    return {
        "name": character.get("name"),
        "surname": character.get("surname"),
        "level": character.get("level"),
        "classId": (cls.get("slug") or "").lower(),
        "className": cls.get("name"),
        "race": race.get("name"),
        "gender": (character.get("gender") or {}).get("name"),
        "faction": (faction.get("slug") or faction.get("name") or "").lower(),
        "ruleset": ruleset.get("name"),
        "rulesetId": ruleset.get("rulesetId"),
        "guild": (character.get("guild") or {}).get("name"),
        "ilvl": character.get("averageItemLevel"),
        "honorableKills": ((character.get("pvp") or {}).get("honorableKills") or {}).get("value"),
        "region": character.get("region"),
        "updatedAt": iso,
        "stats": display_stats,
        "specs": specs,
        "gear": gear,
        "professions": professions,
    }


def write_characters() -> None:
    seeds = {
        "daz-dingomon": {
            "mainSpec": "shaman-restoration",
            "offSpec": "shaman-enhancement",
        },
        "mrs-dingomon": {
            "mainSpec": "mage-arcane",
            "offSpec": "mage-frost-pvp",
        },
    }
    profiles = []
    for slug, meta in seeds.items():
        payload = json.loads(ARMORY[slug].read_text())
        character = snapshot_character(payload)
        profiles.append(
            {
                "slug": slug,
                "region": "us",
                "armoryUrl": f"https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/{slug}",
                "fetchedAt": character.get("updatedAt") or "2026-11-08T12:02:25Z",
                "source": "armory-snapshot",
                "sourceNote": "Official US Forever Armory embed, captured 8 Nov 2026. The Armory only returned the active spec; the off spec is the saved profile.",
                "mainSpec": meta["mainSpec"],
                "offSpec": meta["offSpec"],
                "character": character,
            }
        )
    CHARACTER_DATA.mkdir(parents=True, exist_ok=True)
    (CHARACTER_DATA / "characters.json").write_text(json.dumps(profiles, indent=2) + "\n")


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    raw_items = json.loads(CACHE.read_text())
    items = []
    seen = set()
    buckets = Counter()
    for raw in raw_items:
        item = parse_item(raw)
        if not item or item["id"] in seen:
            continue
        seen.add(item["id"])
        items.append(item)
        buckets[item["bucket"]] += 1
    items.sort(key=lambda i: (i["bucket"], i["req"], -i["quality"], i["name"]))
    (DATA / "items.json").write_text(json.dumps(items, separators=(",", ":")))
    enchants, unparsed = compile_enchants()
    (DATA / "enchants.json").write_text(json.dumps(enchants, indent=2) + "\n")
    write_characters()
    meta = {
        "items": len(items),
        "enchants": len(enchants),
        "buckets": dict(buckets),
        "itemSource": "Forever Wowhead tooltip cache (Napalmsteak/Classic-WoW-Item-Caches, Forever Cache.json), tooltips refreshed through 2026-11-07.",
        "enchantSource": "Warcraft Forever client data build 1.60.1.70862 (warcraftforever.com) with source notes from wowfdb.com enchanting recipes.",
        "characterSource": "Official Armory characterProfileInitialState for Daz Dingomon and Mrs Dingomon on US PvP, 2026-11-08.",
        "unparsedEnchants": unparsed,
    }
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("items", len(items), "buckets", dict(buckets))
    print("enchants", len(enchants), "unparsed", len(unparsed))
    for line in unparsed[:30]:
        print(" UNPARSED", line)


if __name__ == "__main__":
    main()
