#!/usr/bin/env python3
"""Build an enriched rs2b0t-compatible transport list from LostCity data.

This combines rs2b0t's curated transports and generated stair edges, then
matches each location-backed source edge to the 2004scape Content maps and
location definitions.  Existing fields remain compatible; metadata fields are
additive:

  locId      Numeric cache location id.
  locX/locZ  Actual clickable location tile (not the player's stand tile).
  locName    In-game display name (already present in rs2b0t data).
  debugName  LostCity internal/symbolic location name.
  options    All non-empty interaction options on the source location.

NPC-backed transports retain their original shape because they have no loc id.

Run this as the final stage of tools/nav/derive-transports.sh.  Running an
earlier generator afterward can replace enriched rows with bare source edges.
"""

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
        in_locs = False
        for raw in path.read_text(encoding="utf-8").splitlines():
            if raw == "==== LOC ====":
                in_locs = True
                continue
            if in_locs and raw.startswith("==== "):
                break
            if not in_locs:
                continue
            loc = LOC_LINE_RE.match(raw)
            if not loc:
                continue
            level, local_x, local_z, loc_id, shape, angle = loc.groups()
            placement = Placement(
                loc_id=int(loc_id),
                x=mx * 64 + int(local_x),
                z=mz * 64 + int(local_z),
                level=int(level),
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
    radius: int = 4,
) -> Iterable[tuple[int, Placement]]:
    # Map bridge flags can move a location down more than one effective level
    # in stacked/instanced map areas, so inspect every raw map level.
    levels = range(4)
    for level in levels:
        for dx in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                distance = max(abs(dx), abs(dz))
                for placement in spatial.get((point["x"] + dx, point["z"] + dz, level), []):
                    yield distance, placement


def resolve_source_loc(
    edge: dict,
    configs: dict[int, LocConfig],
    spatial: dict[tuple[int, int, int], list[Placement]],
    allowed_stair_debugs: set[str],
) -> tuple[LocConfig, Placement] | None:
    wanted_name = normalized(edge.get("locName"))
    wanted_action = normalized(edge.get("action"))
    kind = normalized(edge.get("kind"))
    ranked: list[tuple[float, float, int, int, LocConfig, Placement]] = []

    source = edge["from"]
    destination = edge["to"]
    span = max(abs(destination["x"] - source["x"]), abs(destination["z"] - source["z"]))
    # Local barrier/stair edges generally put the clickable loc between their
    # two stand tiles. Long dungeon/teleport edges instead put it by the source,
    # so applying midpoint scoring to those would send the search thousands of
    # tiles away from the actual interaction.
    use_midpoint = kind in {"door", "gate", "stair"} and span <= 8
    midpoint_x = (source["x"] + destination["x"]) / 2
    midpoint_z = (source["z"] + destination["z"]) / 2

    for distance, placement in candidates_near(spatial, edge["from"]):
        placed_config = configs.get(placement.loc_id)
        if not placed_config:
            continue
        variants = [placed_config]
        # Closed trapdoors are the static map placement, but the action edge is
        # executed against the temporary open loc after the executor opens it.
        # Resolve that exact action-bearing config when it follows LostCity's
        # conventional *_open debug-name pairing.
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

            # Stairs must expose the exact action; otherwise an auto-generated
            # reverse edge can be incorrectly attached to an up-only ladder.
            if kind == "stair" and not action_match:
                continue
            if kind != "stair" and not (name_match or action_match):
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
            ranked.append((score, -proximity, -distance, -placement.loc_id, config, placement))

    if not ranked:
        return None
    ranked.sort(key=lambda item: item[:4], reverse=True)
    best = ranked[0]
    # Name-only matches far from the source are too ambiguous for common names
    # such as Door, Gate, Ladder, and Staircase.
    if best[0] < 70:
        return None
    return best[4], best[5]


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


def closed_open_loc_ids(
    configs: dict[int, LocConfig],
    placement_loc_id: int,
    action_config: LocConfig,
) -> tuple:
    """Map placement id + optional open-state id for trapdoor-style transforms.

    Prefer closed id as locId (runtime default is usually closed). openLocId is the
    climb/use-bearing open variant. Handles both:
    - map places closed, action resolved via *_open config
    - map places open (some content dumps), still pair to closed base debug name
    """
    placed = configs.get(placement_loc_id)
    open_id: int | None = None
    closed_id = placement_loc_id

    if action_config.loc_id != placement_loc_id:
        # Ranked open config against closed placement.
        open_id = action_config.loc_id
        closed_id = placement_loc_id
        return closed_id, open_id

    # Placement and action config share an id — may already be the open form.
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
    _, spatial = load_placements(args.content)
    # A reverse edge derived from a generic ladder may land beside a special
    # quest/area ladder top. Include every loc that actually has an oploc
    # handler, while still excluding decorative ladder-like scenery.
    allowed_stair_debugs: set[str] = set()
    oploc_re = re.compile(r"^\[oploc\d+,([a-z0-9_]+)]", re.MULTILINE)
    for script in (args.content / "scripts").rglob("*.rs2"):
        allowed_stair_debugs.update(oploc_re.findall(script.read_text(encoding="utf-8")))
    allowed_stair_debugs.update({"laddertop", "ladder", "laddermiddle", "laddertop_directional", "ladder_directional"})
    data_dir = args.rs2b0t / "src" / "bot" / "nav" / "data"
    curated = json.loads((data_dir / "transports.json").read_text(encoding="utf-8"))
    stairs = json.loads((data_dir / "stairEdges.json").read_text(encoding="utf-8"))

    def enrich(edges: list[dict]) -> list[dict]:
        enriched: list[dict] = []
        for raw in edges:
            edge = dict(raw)
            existing = configs.get(edge.get("locId", -1))
            source_backed_ladder = existing is not None and (
                normalized(existing.display_name) == "ladder"
                or "ladder" in existing.debug_name.lower()
            )
            # derive-ladders.py resolves its clickable placement directly from
            # the handler source. Preserve those exact rows; refresh all other
            # metadata so a ranking fix can repair previously mis-bound data.
            if source_backed_ladder and all(field in edge for field in ("locId", "locX", "locZ", "debugName", "options")):
                enriched.append(edge)
                continue
            resolved = resolve_source_loc(edge, configs, spatial, allowed_stair_debugs)
            if resolved:
                config, placement = resolved
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
                edge["options"] = [edge["action"]]
            enriched.append(edge)
        return enriched

    enriched_curated = enrich(curated)
    enriched_stairs = enrich(stairs)

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
    cross_file_keys = {edge_key(edge) for edge in curated} & {edge_key(edge) for edge in stairs}
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
