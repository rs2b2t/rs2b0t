#!/usr/bin/env python3
"""Derive every placed LostCity ladder interaction into rs2b0t edges.

The LostCity map tells us which loc is clicked and the RuneScript handler tells
us where that interaction moves the player.  Deterministic destinations are
active.  Broken, dialogue-only, choice-driven, and state-dependent handlers are
kept as disabled rows so the inventory stays complete without inventing a route.

Access requirements (levels, quests, tickets, minigame rank, and similar) are
intentionally not modelled yet.  A deterministic edge can therefore still fail
at execution time when the player does not meet its handler's requirements.
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import re
import struct
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


def load_enrichment_module():
    path = Path(__file__).with_name("enrich-transports.py")
    spec = importlib.util.spec_from_file_location("transport_enrichment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


enrichment = load_enrichment_module()


@dataclass(frozen=True)
class EffectivePlacement:
    loc_id: int
    x: int
    z: int
    level: int
    shape: int
    angle: int


@dataclass(frozen=True)
class Target:
    x: int
    z: int
    level: int


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def g1(self) -> int:
        value = self.data[self.pos]
        self.pos += 1
        return value

    def gsmart(self) -> int:
        return self.g1() if self.data[self.pos] < 0x80 else (self.g1() << 8 | self.g1()) - 0x8000


def packed_index(x: int, z: int, level: int) -> int:
    return (z & 0x3F) | ((x & 0x3F) << 6) | ((level & 3) << 12)


def parse_land(data: bytes) -> bytearray:
    reader = Reader(data)
    flags = bytearray(64 * 64 * 4)
    for level in range(4):
        for x in range(64):
            for z in range(64):
                while True:
                    opcode = reader.g1()
                    if opcode == 0:
                        break
                    if opcode == 1:
                        reader.g1()
                        break
                    if opcode <= 49:
                        reader.g1()
                    elif opcode <= 81:
                        flags[packed_index(x, z, level)] = opcode - 49
    return flags


def parse_locs(data: bytes) -> Iterable[tuple[int, int, int, int, int, int]]:
    reader = Reader(data)
    loc_id = -1
    loc_delta = reader.gsmart()
    while loc_delta:
        loc_id += loc_delta
        coord = 0
        coord_delta = reader.gsmart()
        while coord_delta:
            coord += coord_delta - 1
            z = coord & 0x3F
            x = (coord >> 6) & 0x3F
            level = (coord >> 12) & 3
            info = reader.g1()
            yield loc_id, x, z, level, info >> 2, info & 3
            coord_delta = reader.gsmart()
        loc_delta = reader.gsmart()


def load_effective_placements(engine: Path) -> list[EffectivePlacement]:
    archive_path = engine / "data" / "pack" / ".cache" / "maps-server.zip"
    if not archive_path.exists():
        raise SystemExit(f"Missing {archive_path}; build the LostCity engine maps first")
    placements: list[EffectivePlacement] = []
    with zipfile.ZipFile(archive_path) as archive:
        map_names = sorted(name for name in archive.namelist() if re.fullmatch(r"m\d+_\d+", name))
        for map_name in map_names:
            mx, mz = map(int, map_name[1:].split("_"))
            land = parse_land(archive.read(map_name))
            for loc_id, local_x, local_z, raw_level, shape, angle in parse_locs(archive.read(f"l{mx}_{mz}")):
                linked_below = land[packed_index(local_x, local_z, 1)] & 2
                level = raw_level - 1 if linked_below else raw_level
                if level < 0:
                    continue
                placements.append(EffectivePlacement(loc_id, mx * 64 + local_x, mz * 64 + local_z, level, shape, angle))
    return placements


class CollisionPack:
    def __init__(self, path: Path):
        raw = path.read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        if raw[:4] != b"LCNV" or raw[4] not in (1, 2):
            raise SystemExit(f"Unsupported collision pack: {path}")
        version = raw[4]
        count = struct.unpack_from("<H", raw, 8)[0]
        self.walk: dict[tuple[int, int, int], bytes] = {}
        pos = 10
        for _ in range(count):
            mx, mz, mask = raw[pos : pos + 3]
            pos += 3
            for level in range(4):
                if not mask & (1 << level):
                    continue
                pos += 4096
                self.walk[(mx, mz, level)] = raw[pos : pos + 512]
                pos += 512
                if version >= 2:
                    pos += 2048
        if pos != len(raw):
            raise SystemExit(f"Collision pack is truncated or has trailing bytes: read {pos} of {len(raw)}")

    def walkable(self, x: int, z: int, level: int) -> bool:
        walk = self.walk.get((x >> 6, z >> 6, level))
        if walk is None:
            return False
        index = (x & 0x3F) * 64 + (z & 0x3F)
        return bool(walk[index >> 3] & (1 << (index & 7)))


def offsets(radius: int) -> list[tuple[int, int]]:
    values = [(dx, dz) for dx in range(-radius, radius + 1) for dz in range(-radius, radius + 1)]
    return sorted(values, key=lambda p: (max(abs(p[0]), abs(p[1])), abs(p[0]) + abs(p[1]), -p[1], p[0]))


SNAP_OFFSETS = offsets(2)


def snap(pack: CollisionPack, target: Target) -> Target | None:
    for dx, dz in SNAP_OFFSETS:
        if pack.walkable(target.x + dx, target.z + dz, target.level):
            return Target(target.x + dx, target.z + dz, target.level)
    return None


COORD_RE = re.compile(r"^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$")


def parse_coord(value: str) -> Target | None:
    match = COORD_RE.fullmatch(value.strip())
    if not match:
        return None
    level, mx, mz, lx, lz = map(int, match.groups())
    return Target(mx * 64 + lx, mz * 64 + lz, level)


def coord_text(target: EffectivePlacement | Target) -> str:
    return f"{target.level}_{target.x >> 6}_{target.z >> 6}_{target.x & 63}_{target.z & 63}"


HEADER_RE = re.compile(r"^\[([^\]]+)][ \t]*(.*)$", re.MULTILINE)


def load_handlers(content: Path) -> tuple[dict[tuple[str, int], str], dict[str, str]]:
    handlers: dict[tuple[str, int], str] = {}
    aliases: dict[tuple[str, int], str] = {}
    labels: dict[str, str] = {}
    for path in (content / "scripts").rglob("*.rs2"):
        text = path.read_text(encoding="utf-8")
        matches = list(HEADER_RE.finditer(text))
        for index, match in enumerate(matches):
            header = match.group(1)
            trailer = (match.group(2) or "").strip()
            body = text[match.end() : matches[index + 1].start() if index + 1 < len(matches) else len(text)]
            oploc = re.fullmatch(r"oploc([1-5]),([^,]+)", header)
            label = re.fullmatch(r"label,([^,]+)", header)
            if oploc:
                key = (oploc.group(2), int(oploc.group(1)))
                handlers[key] = body
                alias = re.fullmatch(r"@([a-zA-Z0-9_]+);?", trailer)
                if alias:
                    aliases[key] = alias.group(1)
            elif label:
                labels[label.group(1)] = body
    for key, alias in aliases.items():
        if alias in labels:
            handlers[key] = labels[alias]
    return handlers, labels


def matching_brace(text: str, opening: int) -> int:
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    return len(text) - 1


def select_switch(body: str, placement: EffectivePlacement, switch_type: str) -> str:
    expression = r"\s*loc_angle\s*" if switch_type == "int" else r"[^)]*"
    match = re.search(rf"switch_{switch_type}\s*\({expression}\)\s*{{", body)
    if not match:
        return body
    opening = body.find("{", match.start())
    closing = matching_brace(body, opening)
    switch_body = body[opening + 1 : closing]
    cases = list(re.finditer(r"\bcase\s+([^:]+)\s*:", switch_body))
    selected = ""
    fallback = ""
    for index, case in enumerate(cases):
        value = case.group(1).strip()
        segment = switch_body[case.end() : cases[index + 1].start() if index + 1 < len(cases) else len(switch_body)]
        if value == "default":
            fallback = segment
        elif switch_type == "int" and value.isdigit() and int(value) == placement.angle:
            selected = segment
        elif switch_type == "coord" and value == coord_text(placement):
            selected = segment
    return body[: match.start()] + (selected or fallback) + body[closing + 1 :]


def call_arguments(text: str, names: tuple[str, ...]) -> list[str]:
    calls: list[str] = []
    token = re.compile(r"(?<![a-zA-Z0-9_])(" + "|".join(re.escape(name) for name in names) + r")\s*\(")
    for match in token.finditer(text):
        opening = text.find("(", match.start())
        depth = 0
        quote = False
        argument_end = -1
        for index in range(opening + 1, len(text)):
            char = text[index]
            if char == '"' and (index == 0 or text[index - 1] != "\\"):
                quote = not quote
            if quote:
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                if depth == 0:
                    argument_end = index
                    break
                depth -= 1
            elif char == "," and depth == 0:
                argument_end = index
                break
        if argument_end != -1:
            calls.append(text[opening + 1 : argument_end].strip())
    return calls


def split_args(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
    parts.append(value[start:].strip())
    return parts


def resolve_expression(expression: str, placement: EffectivePlacement, stand: Target, body: str) -> Target | None:
    expression = expression.strip()
    direct = parse_coord(expression)
    if direct:
        return direct
    map_square = re.fullmatch(r"map_findsquare\s*\((.+)\)", expression, re.DOTALL)
    if map_square:
        return parse_coord(split_args(map_square.group(1))[0])
    move = re.fullmatch(r"movecoord\s*\((.+)\)", expression, re.DOTALL)
    if move:
        args = split_args(move.group(1))
        if len(args) != 4 or not all(re.fullmatch(r"-?\d+", value) for value in args[1:]):
            return None
        base_name = re.sub(r"\s+", "", args[0])
        base = Target(placement.x, placement.z, placement.level) if base_name in {"loc_coord", "loc_coord()"} else stand if base_name in {"coord", "coord()"} else None
        if base is None:
            return None
        dx, dl, dz = map(int, args[1:])
        return Target(base.x + dx, base.z + dz, base.level + dl)
    if re.fullmatch(r"\$[a-zA-Z0-9_]+", expression):
        variable = re.escape(expression)
        assignments = re.findall(rf"{variable}\s*=\s*([^;]+);", body)
        if len(assignments) == 1:
            return resolve_expression(assignments[0], placement, stand, body)
    return None


def destinations(debug_name: str, body: str, placement: EffectivePlacement, stand: Target) -> tuple[list[Target], str | None]:
    body = select_switch(select_switch(body, placement, "int"), placement, "coord")

    # ladder_from_cellar's Zanaris placement returns somewhere other than the
    # usual z-6400 counterpart; its source-specific branch returns early.
    if debug_name == "ladder_from_cellar":
        if coord_text(placement) == "0_50_149_22_52":
            return [Target(3201, 3169, 0)], None
        return [Target(stand.x, stand.z - 6400, stand.level)], None

    expressions = call_arguments(body, ("~climb_ladder", "p_teleport", "p_telejump"))
    resolved = [target for expression in expressions if (target := resolve_expression(expression, placement, stand, body))]

    # dragonshipladdertop2 calculates the normal destination in a variable and
    # substitutes a fixed landing only when that square is blocked.
    if not resolved and "$coord" in expressions:
        assignments = re.findall(r"\$coord\s*=\s*([^;]+);", body)
        normal = resolve_expression(assignments[0], placement, stand, body) if assignments else None
        fallback_match = re.search(r"\$coord\s*=\s*(\d+_\d+_\d+_\d+_\d+)\s*;", body)
        fallback = parse_coord(fallback_match.group(1)) if fallback_match else None
        if normal:
            resolved.append(normal)
        if fallback:
            resolved.append(fallback)

    unique = list(dict.fromkeys(resolved))
    if len(unique) > 1:
        if "p_choice" in body:
            return unique, "This action opens an up/down choice; use a direct Climb-up or Climb-down option instead."
        return unique, "Destination depends on player or world state; state-aware transports are deferred."
    if unique:
        # Single tele still gated by quest/skill/inv checks must not be active edges.
        # (Watchtower ups, Horror ladders, etc. — see review on #267.)
        if has_runtime_destination_guard(body) and debug_name not in ALWAYS_ACTIVE_LADDER_DEBUGS:
            return unique, (
                "Destination is behind a runtime quest/skill/inv guard; "
                "state-aware transports are deferred."
            )
        return unique, None
    if "@ladder_options" in body:
        return [], "This action opens an up/down choice; use a direct Climb-up or Climb-down option instead."
    if "broken" in body.lower() or "not going to climb" in body.lower() or "don't trust that ladder" in body.lower():
        return [], "LostCity implements this as a non-traversable ladder."
    if re.search(r"(?:chat|mes|npc_find)", body):
        return [], "This ladder starts dialogue but LostCity has no movement destination on the loc action."
    return [], "LostCity has no statically identifiable movement destination for this ladder action."


# Ladders whose single tele is always safe despite nearby script noise.
ALWAYS_ACTIVE_LADDER_DEBUGS = frozenset(
    {
        "ladder",
        "laddertop",
        "laddermiddle",
        "ladder_directional",
        "laddertop_directional",
        "ladder_from_cellar",
        "ladder_cellar",
        "miningguildladder",
        "wizards_tower_ladder",
        "wizards_tower_laddertop",
    }
)


def has_runtime_destination_guard(body: str) -> bool:
    """True when movement is wrapped in quest/skill/inv/var conditions.

    Plain `if (map_blocked(...))` fallbacks are OK (still deterministic).
    """
    # Strip map_blocked / coord occupancy style checks — those are collision, not quest state.
    stripped = re.sub(r"if\s*\(\s*map_blocked\s*\([^)]*\)\s*\)\s*\{[^}]*\}", "", body, flags=re.I)
    stripped = re.sub(r"if\s*\(\s*~\w*blocked\w*\s*\([^)]*\)\s*\)\s*\{[^}]*\}", "", stripped, flags=re.I)
    return bool(
        re.search(r"if\s*\(\s*%[a-zA-Z0-9_]+", stripped)  # player varp
        or re.search(r"if\s*\(\s*stat\s*\(", stripped)  # skill gate
        or re.search(r"if\s*\(\s*inv_(?:total|count)\s*\(", stripped)
        or re.search(r"if\s*\(\s*testbit\s*\(\s*%", stripped)
        or re.search(r"if\s*\(\s*~\w*quest\w*\s*\(", stripped, re.I)
    )


def is_ladder_config(config) -> bool:
    return bool(
        (enrichment.normalized(config.display_name) == "ladder" or "ladder" in config.debug_name.lower())
        and any(option and "climb" in option.lower() for option in config.options)
    )


def point(target: Target) -> dict[str, int]:
    return {"x": target.x, "z": target.z, "level": target.level}


def make_edge(config, placement: EffectivePlacement, action: str, source: Target, target: Target, disabled_reason: str | None) -> dict:
    kind = "stair" if source.level != target.level else "dungeon"
    edge = {
        "from": point(source),
        "to": point(target),
        "locName": config.display_name or "Ladder",
        "action": action,
        "kind": kind,
        "locId": config.loc_id,
        "locX": placement.x,
        "locZ": placement.z,
        "debugName": config.debug_name,
        "options": enrichment.option_values(config) or [action],
    }
    if disabled_reason:
        edge["disabledReason"] = disabled_reason
    return edge


def edge_sort_key(edge: dict) -> tuple:
    source, target = edge["from"], edge["to"]
    return (
        source["level"], source["x"], source["z"], edge.get("locId", -1), edge.get("action", ""),
        target["level"], target["x"], target["z"], edge.get("disabledReason", ""),
    )


def legacy_ladder_edge(edge: dict, ladder_ids: set[int], ladder_debugs: set[str]) -> bool:
    if edge.get("locId") in ladder_ids or edge.get("debugName") in ladder_debugs:
        return True
    # Preserve disabled non-ladder rows such as the Castle Wars auto-reverse
    # audit records. They look ladder-like because the rejected edge inherited
    # its forward loc name/action, but the actual destination loc is a trapdoor.
    if edge.get("disabledReason"):
        return False
    name = enrichment.normalized(edge.get("locName"))
    action = enrichment.normalized(edge.get("action"))
    return "climb" in action and ("ladder" in name or name in {"rope", "escaperope"})


def write_json(path: Path, edges: list[dict], check: bool) -> None:
    text = "[\n" + ",\n".join("    " + json.dumps(edge, separators=(",", ":")) for edge in edges) + "\n]\n"
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            raise SystemExit(f"STALE: {path} — run {Path(__file__).name}")
    else:
        path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--pack", type=Path, default=Path("out/collision.lcnav.gz"))
    parser.add_argument("--rs2b0t", type=Path, default=Path("."))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    configs = enrichment.load_loc_configs(args.content)
    placements = load_effective_placements(args.engine)
    handlers, _ = load_handlers(args.content)
    collision = CollisionPack(args.pack)

    placed_by_id: dict[int, list[EffectivePlacement]] = {}
    for placement in placements:
        placed_by_id.setdefault(placement.loc_id, []).append(placement)
    ladder_configs = {loc_id: config for loc_id, config in configs.items() if loc_id in placed_by_id and is_ladder_config(config)}
    ladder_ids = set(ladder_configs)
    ladder_debugs = {config.debug_name for config in ladder_configs.values()}

    generated: list[dict] = []
    interactions = 0
    unsnappable_sources = 0
    unsnappable = 0
    for loc_id, config in sorted(ladder_configs.items()):
        for placement in placed_by_id[loc_id]:
            source_raw = Target(placement.x, placement.z, placement.level)
            snapped_source = snap(collision, source_raw)
            source = snapped_source or source_raw
            source_reason = None
            if snapped_source is None:
                unsnappable_sources += 1
                source_reason = "The ladder has no walkable interaction tile within two squares in this collision pack."
            for op, action in enumerate(config.options, start=1):
                if not action or "climb" not in action.lower():
                    continue
                interactions += 1
                body = handlers.get((config.debug_name, op), "")
                raw_targets, disabled_reason = destinations(config.debug_name, body, placement, source)
                if config.debug_name == "dragonshipladdertop2" and len(raw_targets) == 2:
                    normal, fallback = raw_targets
                    raw_targets = [normal if collision.walkable(normal.x, normal.z, normal.level) else fallback]
                    disabled_reason = None
                disabled_reason = disabled_reason or source_reason
                if not raw_targets:
                    generated.append(make_edge(config, placement, action, source, source, disabled_reason))
                    continue
                for raw_target in raw_targets:
                    target = snap(collision, raw_target)
                    reason = disabled_reason
                    if target is None:
                        unsnappable += 1
                        target = raw_target
                        reason = reason or "The scripted destination has no walkable tile within two squares in this collision pack."
                    generated.append(make_edge(config, placement, action, source, target, reason))

    data_dir = args.rs2b0t / "src" / "bot" / "nav" / "data"
    transport_path = data_dir / "transports.json"
    stair_path = data_dir / "stairEdges.json"
    transports = [edge for edge in json.loads(transport_path.read_text(encoding="utf-8")) if not legacy_ladder_edge(edge, ladder_ids, ladder_debugs)]
    stairs = [edge for edge in json.loads(stair_path.read_text(encoding="utf-8")) if not legacy_ladder_edge(edge, ladder_ids, ladder_debugs)]

    generated.sort(key=edge_sort_key)
    generated_transports = [edge for edge in generated if edge["kind"] == "dungeon"]
    generated_stairs = [edge for edge in generated if edge["kind"] == "stair"]
    output_transports = transports + generated_transports
    output_stairs = stairs + generated_stairs
    write_json(transport_path, output_transports, args.check)
    write_json(stair_path, output_stairs, args.check)

    active = sum("disabledReason" not in edge for edge in generated)
    disabled = len(generated) - active
    print(json.dumps({
        "ladderLocTypes": len(ladder_configs),
        "placements": sum(len(placed_by_id[loc_id]) for loc_id in ladder_ids),
        "interactions": interactions,
        "generatedRows": len(generated),
        "active": active,
        "disabled": disabled,
        "sameLevelTransports": len(generated_transports),
        "levelChangeStairs": len(generated_stairs),
        "unsnappableSources": unsnappable_sources,
        "unsnappableDestinations": unsnappable,
        "requirementsModelled": False,
    }, indent=2))


if __name__ == "__main__":
    main()
