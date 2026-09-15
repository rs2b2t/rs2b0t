# Private Jive clue scenarios

Authored offline. No private fixture has been applied, compiled, started or run by this change. No live pass is claimed. The parent must finish source integration and authorize runtime first. All commands below are future operator instructions, not completed actions.

## Private fixture preparation after authorization

Use this linked worktree and its sibling `../shilo-private/engine`, never the shared server. Stop the private engine and require no other accounts. Preserve byte-for-byte backups of the two content files below outside the content compiler's input directories. Record their SHA256 hashes in the run directory.

1. In `../shilo-private/content/scripts/minigames/game_trail/scripts/hard/trail_clue_hard_reward.rs2`, replace only the first `[proc,trail_clue_hard_reward]` section (ending before `[proc,trail_clue_hard_normal]`) with `e2e/jive-private-reward.rs2`. Preserve the remaining procedures. This private deterministic roll adds three each of real non-stackable Super attack(3)145, Super strength(3)157 and Super defence(3)163 to `trail_rewardinv`. It does not give items directly to the player or modify client reward state.
2. In `scripts/minigames/game_trail/scripts/trail_clue_helper.rs2` beneath that content root, change the single `queue(trail_give_reward, 0, 0)` in `trail_complete` to `queue(trail_give_reward, 3, 0)`. This preserves real manifest transmission and modal opening while delaying real delivery three ticks. Keep `inv_movefromslot` and overflow behavior unchanged. The engine's `InvOps.INV_MOVEFROMSLOT` creates individually owned ground objects for non-stackable overflow.
3. Only after the parent authorizes compilation, repack the private content using that engine's existing process. Record compiled-pack hashes and both changed source hashes. Set `JIVE_REWARD_FIXTURE_SHA256` to the SHA256 of the entire modified hard reward source, not the replacement snippet. The observer validates this file hash and records it in every frame. The runtime manifest still determines earned quantities; the hash alone is not proof the compiled server used the fixture.
4. Start the private engine through the authored observer, with the engine as working directory: `bun /absolute/path/to/rs2b0t-black-range/e2e/jive-private-observer.mjs`. It imports that engine's `src/app.ts`; do not start a second engine or also use `observe-black.ts`. Supply `ENGINE_DIR`, `BLACK_SERVER_TRACE` (fresh absolute JSONL path under the real worktree's `out/e2e`), `JIVE_REWARD_FIXTURE_SHA256`, `RUNTIME_AUTHORIZED=1`, `TARGET=local`, and `BASE=http://localhost:8891`. The observer rejects a different real cwd before engine imports and requires explicit `web.port=8891`, `node.port=43596`, and `web.managementPort=8899` in `data/config/world.json`; missing configuration never falls back to engine defaults. The trace parent must already exist without symlinks. An existing trace is rejected, and writes use the exclusively created descriptor rather than reopening its pathname. This observer reads guardian lifetimes, owner IDs, HP, inventory, bank and ground ownership; it never sets damage, XP, death flags or rewards.
5. Have the parent deploy the integrated candidate separately and supply `E2E_CLIENT_PAGE` and `BLACK_BUNDLE`. The harness independently compares served/local SHA256 hashes. No harness rebuilds or deploys anything.

## Run one case at a time

From the linked worktree, with the above environment plus `HEADED=1` and `SLOWMO=0`:

```sh
JIVE_SCENARIO=missing-dds RUN_TAG=JIVE-missing-dds-UNIQUE bun e2e/jive-private-live.ts
JIVE_SCENARIO=missing-superanti RUN_TAG=JIVE-missing-superanti-UNIQUE bun e2e/jive-private-live.ts
JIVE_SCENARIO=sharks14 RUN_TAG=JIVE-sharks14-UNIQUE bun e2e/jive-private-live.ts
JIVE_SCENARIO=guardian RUN_TAG=JIVE-guardian-UNIQUE bun e2e/jive-private-live.ts
JIVE_SCENARIO=reward RUN_TAG=JIVE-reward-UNIQUE bun e2e/jive-private-live.ts
```

Replace UNIQUE on every invocation. Each case creates a fresh account, empties only that account's inventories, seeds before observation and runs the actual registered JiveDragons script. Bank supply uses supported `~bankitem`, followed by a real bank open/read. There is no `givebank` dependency. A private observer with any other player present is rejected.

All three guarded runners require the actual candidate worktree as cwd, `TARGET=local`, and an explicit safe `RUN_TAG`. They install context-wide HTTP/navigation and WebSocket restrictions before creating a page: only `http://localhost:8891` and `ws://localhost:8891` are allowed, redirects are aborted, and service workers are blocked. A live-baked WebSocket destination cannot connect. Before tutorial cheats, cadence changes, fixture seeding, and script start, a fresh complete observer frame must attest this engine/worktree and contain only the new account. Older observer streams without that attestation are rejected.

The guardian case uses dry coordinate clue3548 (`trail_clue_hard_sextant025`), casket3549, at `(2581,3030,0)` with Saradomin Wizard. The missing-kit and reward cases use clue3544 (`trail_clue_hard_sextant023`), casket3545, at `(3441,3419,0)`. These IDs and coordinates match the generated clue database. The dry guardian route needs no Priest in Peril or Nature Spirit fixture state. `trail_status=133` means five completed legs (bits0–3), guardian undefeated (bit4 clear), chart miniquest complete (4 in bits5–8). `progress_clue_hard` increments progress when opening the real casket; six is the hard maximum. Only a real wizard death sets bit4 and permits the subsequent dig. No harness sets this bit, increments trail progress during observation or substitutes a completed client state.

Guardian profile: Attack75/Strength75/Defence75/HP77/Prayer70, Lost City (`zanaris=6`), original Magic shortbow861, DDS1231, one Superanti2448 and exactly15 total Sharks, none banked. Fifteen deliberately exercises the first bite to14. There is no HP refill during observation. The missing cases independently omit DDS or Superanti, or have exactly14 total Sharks. They require a completed solver preparation refusal, clue retention and no dig/spawn, not a quiet timeout.

The reward case has Attack1/Strength1/Defence1, Lost City incomplete, no dagger or Superanti, a ranged host weapon, casket3545 plus27 Sharks at full HP. Seven preexisting attack potions are banked before the run. Those seven are recorded in the baseline and cannot pay off the nine-unit reward manifest. Guardian gear is not a collection prerequisite.

## Evidence and cleanup

Each run writes fixture/bundle attestation, initial/final/manifest screenshots, complete client event JSON, authoritative server frames, scored captures, and disconnect evidence under `out/e2e/RUN_TAG`. Client events retain initial holdings, every manifest slot/quantity from6963 while6960 is open, inventory/ground/bank quantities, cumulative confirmed Shark consumption, solved and host-resume order. Ground is never credited as collected. Walk, bank, teleport and host-resume requests are evaluated at their action boundary. Unknown ownership, stale/truncated streams, missing phases or an early solved/departure fail closed.

The observer records the real guardian owner/lifetime and HP0; client disappearance never supplies the kill. DDS, antidote-before-spawn, special energy,15-Shark start, healing/upkeep, survival, post-kill dig and ranged restoration before host resume must all be observed. Natural RNG can leave a run without a required bite/special; that is incomplete coverage, never permission to fake damage.

Cleanup independently attempts script stop, trace collection, browser close, closure evidence, and authoritative disconnect confirmation. Stop/evaluate/write/close exceptions cannot skip the disconnect attempt. `confirmPrivateDisconnect` takes the account directly rather than reading `closed.json`, and requires an observer frame produced after confirmation began; `closed.json` records a close attempt, not proof of disconnect. Missing disconnect confirmation is a failure. After the last run, stop the private observer/engine, restore both backed-up content files byte-for-byte, and have the parent authorize rebuilding the restored content before reusing that engine. Preserve account saves and evidence until inspection, then remove only the fresh `jc...` test accounts offline. Never restore a backup over a concurrent content change.

Offline boundary regressions: `bun test test/e2e/jive-private-boundary.test.ts`. These use temporary files and narrow network-operation fakes, never a browser or server. They do not constitute live proof or authorize runtime.

## Still pending live profiles

Blue second stand `(2904,9808,0)` needs its own updated observer mirror and natural-kill proof. Per-pile Rune-arrow1/2/3 ignored and4/5 taken remains separate, not a nearby-total assertion. Baby-dragon risk needs below96,96 and97 combat profiles; the adult-safe tile is not universally safe. JiveChests stand `(2914,3451,0)` still needs actual interaction and route-head return proof. None is claimed by these clue runs. Wrong dagger, Attack59, incomplete Lost City, ordinary antipoison and bank-unavailable hard-kit cases remain additional live matrix entries.
