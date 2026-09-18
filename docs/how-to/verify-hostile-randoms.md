# Verify hostile random damage handling

Run against a local engine with developer cheats enabled and a collision pack at
`out/collision.lcnav.gz`:

```sh
bun e2e/hostile-random-damage-live.ts http://localhost:8890
```

The harness deploys an isolated client and creates a fresh account. Set `ENGINE_DIR`
if the engine lives outside `~/code/rs2b2t-engine`. It is registered as
`hostile-random-damage-live` in the e2e manifest.

For Watchman, River troll, angry Strange plant, Swarm, Rock Golem, Zombie, Shade,
and Tree spirit, the harness uses `npcadd`, then server cheats `~hit 0` and
`~hit 2`. These fixtures deliberately have no target information. It checks that
the player stays put before damage and after a zero hit, then travels at least
eight tiles away and returns within three tiles after the NPC disappears.

A final scenario uses `~macro_event 1` to spawn an owned Swarm that attacks through
normal server combat. No damage cheat is used in that scenario. Every evasion must
start with a positive combat splat, and HP must fall during the observation.

The eight fixtures cover detection and navigation with controlled damage; their
unowned NPCs expire on server timers. The final Swarm covers server combat and escape.
Unit tests cover all 38 hostile NPC variants, hit expiry, poison, missing or stale
facing information, and the transition from picking a plant to evading it.

Proof JSON is written to `out/hostile-random-damage-proof.json`; screenshots go to
`screenshots/`. Set `PROOF_DIR` and `SCREENSHOT_DIR` to retain them elsewhere.
Failures exit nonzero and write a failure screenshot and JSON with the last game
state. `BOT_PAGE` can select an already deployed client for regression checks;
`BOT_REVISION` records that client's commit. Proof includes the deployed bundle's
SHA-256 hash.
