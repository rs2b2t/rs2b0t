[Manual](../README.md) › [Dev and deploy](../DEV.md) › Gathering seed data

# Gathering seed data

### Gathering location seed coords

Fisher / Miner / Woodcutter camps live in `src/bot/data/*Locations.ts` (public
`@rs2b0t/api` catalogs). Most
entries ship with `verified: false` seed tiles from the gathering CSV. After a
local engine is up:

```bash
bun run verify:gather-locs                 # all skills
bun run verify:gather-locs -- fishing      # one skill
HEADED=1 bun run verify:gather-locs -- fishing   # visible Chrome window
HEADED=1 SLOWMO=400 bun e2e/verify-gathering-locations.ts mining
```

`HEADED=1` is read by `e2e/lib/harness.ts` (`launchBrowser`) and opens a live
Chrome window (default `SLOWMO=200`). Headless is the default. Prefer the **small**
Playwright viewport (**1280×720** / omit `setViewportSize`) so the game stage
matches GatheringBot harnesses — not a forced 1500×1000 window (see
`HARNESS_VIEWPORT` and [TESTING.md](../how-to/write-a-harness.md)).

The helper teles to each camp, waits until `me` is near the seed tile, samples
rocks/trees/fish in scene, and prints PASS/FAIL only — it never edits the
tables. A camp only PASSes if arrival succeeded **and** the expected resource
is in scene (avoids false PASS from leftover fish after a stalled tele). Flip
`verified: true` by hand once the spot and bank stand look right.

### GatheringBot tick manip (#160)

Optional tick-manip methods live under each gather script’s **Tick manip**
dropdown (forced **Off** under Location **None**). Delays match this revision /
rs2b2t content (not OSRS wiki):

| Skill | Method | Notes |
| --- | --- | --- |
| Fisher | 4t fly reclick | Re-click fly spots on the +4 cycle |
| Fisher | Knife delay (+2) | Keep **Knife + 1 fletchable log**; **Make-1 only** (never Make-X). t1 knife+confirm → t2 reclick → t3 roll window |
| Fisher | Tannerfishing | Auto Retaliate ON, **may die**; cook/eat on a nearby Fire/Range (power-train drop); Gnome Stronghold camp |
| Miner | Iron cadence (pick-aware) | Re-click on pickaxe `mining_rate` (mith=4t … rune=2t); Legends Guild Iron camps |
| Woodcutter | Knife delay (+2) | Same knife+log kit as Fisher (Make-1; product finish incidental) |
| Woodcutter | 2t retaliate oaks | Auto Retaliate ON, **may die**; S Falador Oaks + chickens |
| Woodcutter | 3t farmer willows | 6-tick tree / knife / drop machine; Knife required; Lumbridge Farmer Willows |
| Woodcutter | 3t willows shortbow rapid | Empty shortbow + rapid style; Lumbridge Castle Willows |

Unit coverage: `bun test test/scripts/TickManipLogic.test.ts test/scripts/GatheringBotLogic.test.ts`.
New camps ship `verified: false` — run `bun run verify:gather-locs` after deploy, then flip
flags by hand. Live method checks need a **fresh client deploy** (see smoke below); there
is no automated tick-manip scenario yet — use headed manual runs with the matching camp.

## See also

- [GatheringBot smoke](../how-to/gatheringbot-smoke.md)
