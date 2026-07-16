# Waterfall Quest — offline nav audit (2026-07-16)

Pure pack analysis, no live runs. Probes ran the baked collision pack
(`out/collision.lcnav.gz`) WITH the edge packs loaded (doors.json + transports.json
+ stairEdges.json) — the sheep-pen lesson: the bare grid lies about connectivity.

Method: `PathFinder.findPath(from, to, undefined, 200_000)` per leg. `findPath`
`snapWalkable`s the start (radius 2) and searches cardinal-adjacent goals for an
unwalkable target, so BLOCKED loc tiles (crates, coffins, pillars, statue, chalice,
tombstone) resolve to their standing tile — that is the real walker's behaviour.
`addEdges` DROPS any transport whose endpoints are not walkable, so curated edges
must sit on walkable standing tiles, not on the loc square.

## Data change

**TGV dungeon telejump pair** (transports.json, Edgeville `kind:'dungeon'` idiom):
- `(2533,3156,0) <-> (2533,9556,0)`, locName "Ladder", Climb-down / Climb-up.
- Loc names/ops derived from `~/code/content`: loc 1754 `ladder_cellar`
  (name "Ladder", op1 Climb-down) surface; loc 1757 `ladder_from_cellar_directional`
  (name "Ladder", op1 Climb-up) dungeon side.
- **Coord correction vs the brief:** the brief's `(2533,3155)`/`(2533,9555)` are the
  ladder LOC squares and both read BLOCKED in the pack, so an edge on them is dropped
  by `addEdges`. Moved each endpoint to the walkable tile immediately north of its
  ladder (`z+1`), preserving the +6400 z jump. Verified: a full cross-region path
  surface→Golrie now resolves (cost 54) via "Ladder Climb-down @ (2533,9556)".

No other edges were needed — every walking leg below resolved out of the box.

## Post-review corrections (verified by the Task-5 reviewer against client + content)

- **forceapproach=north on the dungeon-side ladder (loc 1757):** the north stand
  tile (2533,9556) is not merely the walkable choice — it is the ONLY side from
  which the Climb-up interaction fires (LocConfig forceapproach -> reachedLoc).
  The def/nav must deliver the bot to the NORTH tile. The surface loc 1754 has
  no such constraint (asymmetric).
- **Landing tile is deterministic, not an assumption:** ladder_cellar scripts
  p_telejump(playerTile ± 6400) (ladders.rs2:83-98,154-161), so standing on the
  edge's from tile lands EXACTLY on the to tile (chebyshev 0). Risk #4 below is
  downgraded accordingly.

## Per-leg results

### Region 149 (Golrie / TGV dungeon)  — all RESOLVED, no curation
- ladder-land (2533,9556) → crate (2548,9565): OK cost 22.
- crate (2548,9565) → gate SOUTH side (2515,9574): OK cost 53.
- gate NORTH side (2515,9576) → Golrie (2515,9581): OK cost 5.
- (ladder → gate-south direct: OK cost 33.)
- golrie_gate itself is DEF-DRIVEN (iron gate, needs `golrie_key`) — probed connectivity
  up to EACH side only; both sides reachable, so the key door is the only barrier.

### Region 153 (Glarial's tomb) — all RESOLVED, no curation
- landing (2554,9844) → coffin (2542,9811): OK cost 40.
- coffin → chest (2530,9844): OK cost 46.
- landing → chest direct: OK cost 23.

### Region 154 (waterfall dungeon finale) — all walking RESOLVED, no curation
- entry (2575,9861) → crate (2589,9888): OK cost 36.
- crate → baxtorian_door_2 leaf A (2566,9901): OK cost 63.
- crate → leaf B (2568,9893): OK cost 52.
- leaf A → pillar1 (2562,9910): OK cost 12; entry → pillar1: OK cost 63 (pillar room
  is walkably open on the original-room side — no collision seal to curate).
- pillars pillar1↔pillar6 (2562-2569, 9910-9914): OK cost 8.
- pillar → statue-adjacent (2565,9915, cardinal to statue 2565,9916): OK cost 3-7.
- post-tele room (2603,9914) → chalice (2603,9910): OK cost 4.
- raised-room leaves C (2604,9900) / D (2606,9892) ↔ postTele ↔ chalice: all OK.
- **DEF-DRIVEN, skipped:** crate → leaf C (2604,9900) is UNREACHABLE by walking
  (`reason=unreachable`). This is expected — the x>2600 baxtorian_door_2 leaves TELEPORT
  raised↔original rooms (content facts §"Dungeon finale"). The two rooms are separate
  walkable islands bridged only by the scripted door; each island is internally connected
  (crate↔leaf A/B on one side, postTele↔chalice↔leaf C/D on the other). Not a collision
  gap — no edge curated.

### Surface — approach RESOLVED; scripted-entry tiles are def-driven (walkability only)
- Ardougne approach → Almera (2522,3498): reachable (Almera tile WALKABLE).
- TGV surface entrance → Almera: OK cost 535 (surface network intact).
- Hadley's upstairs bookcase (2520,3426,1): stairs edge PRESENT — Almera → bookcase-up
  resolves (cost 124, crosses to level 1). No curation needed.
- Scripted-entry standing tiles read BLOCKED (they are loc/def squares, entered by DEF
  script, not walked onto): tombstone (2558,3444), rope-rock zone (2510-2514,3476-3481),
  raft (2509,3493), waterfall ledge door (2511,3464). Correct — the DEF task drives these
  via loc interaction + forced teleport; nav only needs to deliver the bot to the
  reachable tiles NEAR them, which the surface network already provides.

## Unresolved risks (hand-off to the DEF task)

1. **Tomb exit ladder unpinned.** Content facts note the landing "bottom of ladder"
   (2554,9844) implies a climb-up back to surface, but the exit loc/coords weren't in
   research. No transport edge was added for it — the tomb is entered/exited by the
   def-driven tombstone teleport in, and the exit path must be pinned live before any
   walk-out edge is curated. Region 153 is otherwise a self-contained walkable island.
2. **golrie_gate & baxtorian_door_2 are def gates, not nav edges.** Both sides are
   walkably reachable, but crossing needs the key-door DEF logic (golrie_key /
   baxtorian_key). Do NOT add transport edges through them — nav must stop at each side
   and hand off to the interact-with-key def step.
3. **Raised-room reach depends on the scripted door.** The chalice/statue-tele room
   (x>2600) is a separate walkable island; the bot only lands there via the statue
   teleport (stage 8) or the x>2600 leaf teleport. Nav cannot path there cold — the DEF
   sequence must have delivered the bot before any postTele→chalice walk is requested.
4. **TGV landing tile is a controller-derived assumption.** The (2533,3156)↔(2533,9556)
   pair and its +6400 jump are derived from loc configs + the ladder idiom, not observed
   live. First live descent should confirm the actual landing tile matches (2533,9556).
