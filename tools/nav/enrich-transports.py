#!/usr/bin/env python3
"""Match curated transports and generated stairs to LostCity map placements.

Add locId, locX/locZ (the clickable tile), debugName and options, and resolve
locName. NPC transports keep their original fields. Run last in
derive-transports.sh so earlier generators do not overwrite the enrichment."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


@dataclass
class LocConfig:
    loc_id: int
    debug_name: str
    display_name: str | None = None
    options: list[str | None] = field(default_factory=lambda: [None] * 5)
    width: int = 1
    length: int = 1
    force_approach: str | None = None


@dataclass(frozen=True)
class Placement:
    loc_id: int
    x: int
    z: int
    level: int
    shape: int
    angle: int


SECTION_RE = re.compile(r"^\[([^\]]+)]\s*$")
MAP_FILE_RE = re.compile(r"^m(\d+)_(\d+)\.jm2$")
LEVEL_ONE_FLAGS_RE = re.compile(r"^1\s+(\d+)\s+(\d+):.*\bf(\d+)\b")
LOC_LINE_RE = re.compile(
    r"^(\d+)\s+(\d+)\s+(\d+):\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s*$"
)


def clean_value(value: str) -> str:
    return value.split("//", 1)[0].strip()


def load_loc_configs(content: Path) -> dict[int, LocConfig]:
    id_to_debug: dict[int, str] = {}
    for raw in (content / "pack" / "loc.pack").read_text(encoding="utf-8").splitlines():
        if "=" not in raw:
            continue
        raw_id, debug_name = raw.split("=", 1)
        id_to_debug[int(raw_id)] = debug_name.strip()

    configs = {
        loc_id: LocConfig(loc_id=loc_id, debug_name=debug_name)
        for loc_id, debug_name in id_to_debug.items()
    }
    debug_to_id = {debug_name: loc_id for loc_id, debug_name in id_to_debug.items()}

    # Historical unpacked definitions are cumulative. Apply them by revision,
    # then authored definitions as the final overrides.
    unpacked = sorted(
        (content / "scripts" / "_unpack").glob("*/all.loc"),
        key=lambda path: int(path.parent.name),
    )
    authored = sorted(
        path
        for path in (content / "scripts").rglob("*.loc")
        if "_unpack" not in path.parts
    )

    for path in unpacked + authored:
        current: LocConfig | None = None
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            section = SECTION_RE.match(line)
            if section:
                current = configs.get(debug_to_id.get(section.group(1), -1))
                continue
            if current is None or "=" not in line or line.startswith("//"):
                continue
            key, value = line.split("=", 1)
            key = key.strip().lower()
            value = clean_value(value)
            if key == "name":
                current.display_name = value
            elif key == "width":
                current.width = int(value)
            elif key == "length":
                current.length = int(value)
            elif key == "forceapproach":
                current.force_approach = value
            elif len(key) == 3 and key.startswith("op") and key[2].isdigit():
                index = int(key[2]) - 1
                if 0 <= index < 5:
                    current.options[index] = value

    return configs


def load_placements(content: Path) -> tuple[list[Placement], dict[tuple[int, int, int], list[Placement]]]:
    placements: list[Placement] = []
    spatial: dict[tuple[int, int, int], list[Placement]] = defaultdict(list)
    for path in sorted((content / "maps").glob("m*_*.jm2")):
        match = MAP_FILE_RE.match(path.name)
        if not match:
            continue
        mx, mz = map(int, match.groups())
        bridged_tiles: set[tuple[int, int]] = set()
        loc_lines: list[str] = []
        section = ""
        for raw in path.read_text(encoding="utf-8").splitlines():
            if raw.startswith("==== "):
                section = raw
            elif section == "==== MAP ====":
                flags = LEVEL_ONE_FLAGS_RE.match(raw)
                if flags:
                    x, z, value = map(int, flags.groups())
                    if value & 2:
                        bridged_tiles.add((x, z))
            elif section == "==== LOC ====":
                loc_lines.append(raw)
        for raw in loc_lines:
            loc = LOC_LINE_RE.match(raw)
            if not loc:
                continue
            raw_level, local_x, local_z, loc_id, shape, angle = loc.groups()
            x, z = int(local_x), int(local_z)
            level = int(raw_level) - 1 if (x, z) in bridged_tiles else int(raw_level)
            if level < 0:
                continue
            placement = Placement(
                loc_id=int(loc_id),
                x=mx * 64 + x,
                z=mz * 64 + z,
                level=level,
                shape=int(shape),
                angle=int(angle or 0),
            )
            placements.append(placement)
            spatial[(placement.x, placement.z, placement.level)].append(placement)
    return placements, spatial


def normalized(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def option_values(config: LocConfig) -> list[str]:
    return [option for option in config.options if option]


def candidates_near(
    spatial: dict[tuple[int, int, int], list[Placement]],
    point: dict[str, int],
    levels: Iterable[int],
    radius: int = 4,
) -> Iterable[tuple[int, Placement]]:
    for level in levels:
        for dx in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                distance = max(abs(dx), abs(dz))
                for placement in spatial.get((point["x"] + dx, point["z"] + dz, level), []):
                    yield distance, placement


def can_operate(source: dict, walls: int, placement: Placement, config: LocConfig) -> bool:
    width, length = config.width, config.length
    if placement.angle & 1:
        width, length = length, width
    x, z = source["x"] - placement.x, source["z"] - placement.z
    if 0 <= x < width and 0 <= z < length:
        return True
    if 0 <= x < width and z == length:
        side = 0
    elif x == width and 0 <= z < length:
        side = 1
    elif 0 <= x < width and z == -1:
        side = 2
    elif x == -1 and 0 <= z < length:
        side = 3
    else:
        return False
    if walls & (1 << ((side + 2) % 4)):
        return False
    directions = ("north", "east", "south", "west")
    return not config.force_approach or config.force_approach == directions[(side - placement.angle) % 4]


def resolve_source_loc(
    edge: dict,
    configs: dict[int, LocConfig],
    candidates: Iterable[tuple[int, Placement]],
    allowed_stair_debugs: set[str],
    *,
    generated_stair: bool,
    reverse_walls: int | None = None,
) -> tuple[LocConfig, Placement] | None:
    wanted_name = normalized(edge.get("locName"))
    wanted_action = normalized(edge.get("action"))
    kind = normalized(edge.get("kind"))
    ranked: list[tuple[bool, float, float, int, int, LocConfig, Placement]] = []

    source = edge["from"]
    destination = edge["to"]
    span = max(abs(destination["x"] - source["x"]), abs(destination["z"] - source["z"]))
    # Why: local crossings use the midpoint, but long transports need a loc near the source.
    use_midpoint = kind in {"door", "gate", "stair"} and span <= 8
    midpoint_x = (source["x"] + destination["x"]) / 2
    midpoint_z = (source["z"] + destination["z"]) / 2

    for distance, placement in candidates:
        placed_config = configs.get(placement.loc_id)
        if not placed_config:
            continue
        variants = [placed_config]
        # Why: the map places the closed trapdoor; resolve its open config for the climb action.
        if wanted_action not in {normalized(option) for option in option_values(placed_config)}:
            open_debug = placed_config.debug_name + "_open"
            variants.extend(config for config in configs.values() if config.debug_name == open_debug)

        for config in variants:
            if kind == "stair" and config.debug_name not in allowed_stair_debugs:
                continue
            display = normalized(config.display_name)
            debug = normalized(config.debug_name)
            options = option_values(config)
            normalized_options = {normalized(option) for option in options}

            name_match = bool(wanted_name and display == wanted_name)
            action_match = bool(wanted_action and wanted_action in normalized_options)
            fuzzy_action = bool(
                wanted_action
                and any(
                    wanted_action in option or option in wanted_action
                    for option in normalized_options
                    if option
                )
            )
            kind_hint = (
                (kind == "stair" and any(token in debug for token in ("stair", "ladder")))
                or (kind in {"door", "gate"} and any(token in display for token in ("door", "gate")))
                or (kind == "gangplank" and "gangplank" in debug)
                or (kind in {"dungeon", "shortcut"} and action_match)
            )

            if not action_match and (generated_stair or kind == "stair" or not name_match):
                continue
            score = 0
            if name_match:
                score += 100
            if action_match:
                score += 120
            elif fuzzy_action:
                score += 25
            if kind_hint:
                score += 20
            if placement.level == edge["from"]["level"]:
                score += 8
            corridor_distance = max(abs(placement.x - midpoint_x), abs(placement.z - midpoint_z))
            proximity = corridor_distance if use_midpoint else distance
            score -= proximity * 6
            if score >= 70:
                operable = reverse_walls is None or can_operate(source, reverse_walls, placement, placed_config)
                ranked.append((operable, score, -proximity, -distance, -placement.loc_id, config, placement))

    if not ranked:
        return None
    best = max(ranked, key=lambda item: item[:5])
    return best[-2], best[-1]


def edge_key(edge: dict) -> tuple[int, int, int, int, int, int, str, str]:
    source, destination = edge["from"], edge["to"]
    return (
        source["x"],
        source["z"],
        source["level"],
        destination["x"],
        destination["z"],
        destination["level"],
        edge.get("action", ""),
        edge.get("kind", ""),
    )


def stair_placements(
    edge: dict,
    configs_by_debug: dict[str, LocConfig],
    spatial: dict[tuple[int, int, int], list[Placement]],
    allowed_stair_debugs: set[str],
) -> dict[tuple[int, int, int, str, str], tuple[LocConfig, Placement]]:
    locs = edge.get("scriptedLocs", [])
    if not locs and all(field in edge for field in ("locX", "locZ", "debugName")):
        locs = [{
            "x": edge["locX"], "z": edge["locZ"], "level": edge["from"]["level"],
            "debugName": edge["debugName"], "action": edge["action"],
        }]
    matches = {}
    for loc in locs:
        debug = loc["debugName"]
        if edge.get("kind") == "stair" and debug not in allowed_stair_debugs:
            continue
        config = configs_by_debug.get(debug)
        if not config or loc["action"] not in config.options:
            continue
        closed = configs_by_debug.get(debug.removesuffix("_open")) if debug.endswith("_open") else None
        tile = (loc["x"], loc["z"], loc["level"])
        for placement in spatial.get(tile, []):
            if placement.loc_id == config.loc_id or (closed and placement.loc_id == closed.loc_id):
                matches[(*tile, debug, loc["action"])] = (config, placement)
                break
    # Why: alternate handlers can describe the same action on the same tile.
    matched_actions = {(x, z, level, action) for x, z, level, _, action in matches}
    for loc in edge.get("scriptedLocs", []):
        tile = (loc["x"], loc["z"], loc["level"])
        if (*tile, loc["action"]) not in matched_actions:
            raise SystemExit(f"Missing scripted placement for {loc['debugName']} ({loc['action']}) at {tile}")
    return matches


def closed_open_loc_ids(
    configs: dict[int, LocConfig],
    placement_loc_id: int,
    action_config: LocConfig,
) -> tuple:
    """Find the closed placement ID and open interaction ID for trapdoors.

    Use the closed variant as locId, even when the map places the open variant.
    openLocId identifies the variant with the climb or use action."""
    placed = configs.get(placement_loc_id)
    open_id: int | None = None
    closed_id = placement_loc_id

    if action_config.loc_id != placement_loc_id:
        # Ranked open config against closed placement.
        open_id = action_config.loc_id
        closed_id = placement_loc_id
        return closed_id, open_id

    # Placement and action config share an id; it may already be the open form.
    debug = (placed.debug_name if placed else action_config.debug_name) or ""
    if debug.endswith("_open"):
        open_id = placement_loc_id
        base = debug[: -len("_open")]
        for cfg in configs.values():
            if cfg.debug_name == base:
                closed_id = cfg.loc_id
                break
        return closed_id, open_id

    # Closed placement; look for conventional open partner.
    open_debug = debug + "_open"
    for cfg in configs.values():
        if cfg.debug_name == open_debug:
            open_id = cfg.loc_id
            break
    return closed_id, open_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, required=True)
    parser.add_argument("--rs2b0t", type=Path, default=Path("."))
    parser.add_argument("--transports-output", type=Path, default=Path("src/bot/event/webwalk/data/transports.json"))
    parser.add_argument("--stairs-output", type=Path, default=Path("src/bot/event/webwalk/data/stairEdges.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    configs = load_loc_configs(args.content)
    configs_by_debug = {cfg.debug_name: cfg for cfg in configs.values()}
    _, spatial = load_placements(args.content)
    # Include quest ladders with oploc handlers, but exclude decorative ladders.
    allowed_stair_debugs: set[str] = set()
    oploc_re = re.compile(r"^\[oploc\d+,([a-z0-9_]+)]", re.MULTILINE)
    for script in (args.content / "scripts").rglob("*.rs2"):
        allowed_stair_debugs.update(oploc_re.findall(script.read_text(encoding="utf-8")))
    allowed_stair_debugs.update({"laddertop", "ladder", "laddermiddle", "laddertop_directional", "ladder_directional"})
    data_dir = args.rs2b0t / "src" / "bot" / "event" / "webwalk" / "data"
    curated = json.loads((data_dir / "transports.json").read_text(encoding="utf-8"))
    stairs = json.loads((data_dir / "stairEdges.json").read_text(encoding="utf-8"))

    scripted_edges = defaultdict(list)
    stair_rows = []
    for raw in stairs:
        placements = stair_placements(raw, configs_by_debug, spatial, allowed_stair_debugs)
        if not placements:
            stair_rows.append((raw, None))
        for key, resolved in placements.items():
            edge = {**raw, "action": key[-1]}
            stair_rows.append((edge, resolved))
            if raw.get("scriptedLocs"):
                scripted_edges[(*key[:-1], normalized(edge["action"]))].append(edge)

    def enrich(rows: Iterable[tuple[dict, tuple[LocConfig, Placement] | None]], *, generated_stairs: bool) -> list[dict]:
        enriched: list[dict] = []
        for raw, resolved in rows:
            edge = dict(raw)
            scripted_locs = edge.pop("scriptedLocs", [])
            auto_reverse = edge.pop("autoReverse", False)
            walls = edge.pop("fromWalls", 0)
            existing = configs.get(edge.get("locId", -1))
            source_backed_ladder = existing is not None and (
                normalized(existing.display_name) == "ladder"
                or "ladder" in existing.debug_name.lower()
            )
            # Keep ladder placements derived from handlers; refresh metadata for all other edges.
            if source_backed_ladder and all(field in edge for field in ("locId", "locX", "locZ", "debugName", "options")):
                enriched.append(edge)
                continue
            if resolved is None and not scripted_locs:
                levels = (edge["from"]["level"],) if generated_stairs else range(4)
                candidates = candidates_near(spatial, edge["from"], levels)
                resolved = resolve_source_loc(
                    edge, configs, candidates, allowed_stair_debugs,
                    generated_stair=generated_stairs, reverse_walls=walls if auto_reverse else None,
                )
            if resolved:
                config, placement = resolved
                if auto_reverse and not edge.get("disabledReason"):
                    key = (placement.x, placement.z, placement.level, config.debug_name, normalized(edge["action"]))
                    matches = scripted_edges.get(key, [])
                    if not can_operate(edge["from"], walls, placement, configs[placement.loc_id]):
                        edge["disabledReason"] = "Generated reverse cannot operate the staircase from its starting tile."
                    elif matches and all(e["to"] == matches[0]["to"] for e in matches):
                        if any(e["from"] == edge["from"] for e in matches):
                            continue
                        edge["to"] = matches[0]["to"]
                    elif matches and all(e["to"] != edge["to"] for e in matches):
                        edge["disabledReason"] = "Generated reverse conflicts with the landing in stairs.rs2."
                edge["locX"] = placement.x
                edge["locZ"] = placement.z
                edge["debugName"] = config.debug_name
                edge["options"] = option_values(config) or [edge["action"]]
                closed_id, open_id = closed_open_loc_ids(configs, placement.loc_id, config)
                edge["locId"] = closed_id
                if open_id is not None and open_id != closed_id:
                    edge["openLocId"] = open_id
                else:
                    edge.pop("openLocId", None)
            else:
                if auto_reverse and not edge.get("disabledReason"):
                    edge["disabledReason"] = "Generated reverse has no matching staircase on its source floor."
                edge["options"] = [edge["action"]]
            enriched.append(edge)
        return enriched

    enriched_curated = enrich(((edge, None) for edge in curated), generated_stairs=False)
    enriched_stairs = enrich(stair_rows, generated_stairs=True)

    def write_json(path: Path, edges: list[dict]) -> None:
        text = "[\n" + ",\n".join("    " + json.dumps(edge, separators=(",", ":")) for edge in edges) + "\n]\n"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                raise SystemExit(f"STALE: {path} — run {Path(__file__).name} --content <LostCity Content checkout>")
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    write_json(args.transports_output, enriched_curated)
    write_json(args.stairs_output, enriched_stairs)

    combined = [*enriched_curated, *enriched_stairs]
    resolved_count = sum("locId" in edge for edge in combined)
    cross_file_keys = {edge_key(edge) for edge in enriched_curated} & {edge_key(edge) for edge in enriched_stairs}
    kinds: dict[str, int] = defaultdict(int)
    for edge in combined:
        kinds[edge.get("kind", "unknown")] += 1
    print(
        json.dumps(
            {
                "outputs": [str(args.transports_output), str(args.stairs_output)],
                "edges": len(combined),
                "curatedEdges": len(enriched_curated),
                "stairEdges": len(enriched_stairs),
                "locMetadataResolved": resolved_count,
                "unresolved": len(combined) - resolved_count,
                "disabled": sum(bool(edge.get("disabledReason")) for edge in combined),
                "crossFileDuplicateEdges": len(cross_file_keys),
                "kinds": dict(sorted(kinds.items())),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
