# JiveKQ

Select `JiveKQ` under Combat on four clients. Enter the same four account names, separated by commas, in the same order on each client. Keep all four clients in the same browser profile and origin, including MultiBox frames. The first account places the ropes; accounts stand west, east, north and south in roster order.

Each bot banks at Shantay, uses a banked pass when available, and otherwise buys one. It banks the change and fills the last slot with a shark before waiting for all four supplied members. The group shares one rope at each entrance. After each kill, each account collects drops visible to it and stacks with the team in the northwest corner near the spawn. They turn every prayer off, ready their maces and refresh boosts while waiting. The corner is within sight of the spawn, so they restore magic protection and spread into the cross as soon as the queen appears. Each member continues until reaching a food, health, prayer or ammo reserve, then casts Camelot teleport, heals, uses a ring of dueling to reach the Duel Arena and walks south to Shantay bank. That member prepares the next kit while the others keep fighting. The next trip waits for all four at the bank. A paused or disconnected member sends the others home. Resuming or restarting a member allows it to join the next bank rendezvous.

## Coordination

The four clients use the browser's `BroadcastChannel` API to exchange one heartbeat per game tick. Each heartbeat contains the account, client session, trip number, position, stage and readiness, plus combat statistics for the paint. All clients must share the same origin and browser profile; separate browsers or computers cannot join this channel.

The leader releases the bank rendezvous when all four have prepared their kits. After the first rope, the bots sip super potions during the walk through the upper cavern. At each rope, they verify their supplies and stack on the entrance tile before reporting ready. A teammate still walking or drinking holds the release without aborting the trip. Once released, descent takes priority over routine potion refreshes, including a boost that decays while waiting. Emergency checks still take priority. The leader also verifies that the other characters are physically visible nearby. The release names the trip and all four client sessions, so an old message cannot release a restarted client. Each bot handles its own movement, potions and attacks. Combat starts after all four reach the chamber; each observes the queen's form and takes its assigned cross position. If a wall prevents a safe cross, that client broadcasts the blocked formation and all four pull the queen toward open ground before spreading out again.

A pause, unexpected failure or missing heartbeat for six seconds aborts the trip for the group. A member leaving combat to restock keeps publishing heartbeats marked as restocking; the remaining fighters keep their assigned positions. Restocking players cannot release an entrance or start the next trip alone. The bots regroup at Shantay before starting the next trip. Potion preparation waits for the server action delay after each sip and retries delayed clicks within the three-minute entrance rendezvous timeout. The client log shows readiness changes, entrance releases, pauses and retreat reasons with a `team:` prefix. The paint has a Team readiness view and a Team chat page showing the latest messages. Repeated heartbeats do not create log entries.

Random-event conversations, strange plants, lamps and strange boxes cannot pause eating or teleporting under the queen's attacks. A genie or mysterious old man targeting a fighter sends that member home to handle the event safely. An unexpected teleport also sends only the displaced player back through the Duel Arena to restock. Forced mime and maze events still use the client's normal recovery.

## Shared loadout

Every account needs Heroes' Quest completed, 60 Attack, 40 Defence, 70 Ranged, 70 Hitpoints, 37 Prayer and 45 Magic on the standard spellbook. Stock the following in each account's bank:

| Equipped | Inventory per trip |
|---|---|
| Dragon mace | Magic shortbow |
| Rune full helm | 14 sharks for the leader; 16 for each follower |
| Black dragonhide body, chaps and vambraces | Two ropes for the leader only |
| Amulet of power | Two Prayer potion(4) |
| Leather boots | One Superantipoison(4) |
| Ring of recoil | One spare Ring of recoil |
| 250 rune arrows | One Super attack(4), Super strength(4) and Super defence(4) |
| | One charged Ring of dueling and one Shantay pass |
| | Five air runes and one law rune |

Keep coins in the bank for passes, plus extra sharks and prayer potions for restoration. No coins or waterskin leave the bank. Only the leader carries two ropes; followers use those slots for food. Partially used dueling rings are reused until their last charge is consumed. The script uses exact item IDs to distinguish black dragonhide from the other colours, which share display names in this revision. All four protect from magic. Players eat at or below the greater of 62 HP and their base HP minus 20, keeping a larger reserve on lower-level accounts. The initial approach prioritizes reaching the assigned position before enabling attack prayers. The mace uses aggressive crush; the bow uses rapid. Melee uses Ultimate Strength and Incredible Reflexes. Both weapons use their special attacks when energy is available. Each member sips the three super potions while walking between the ropes, with a final boost check at the chamber rendezvous. A bonus that falls to 10% of the base level or less gets refreshed: defence in either form, attack and strength in melee. The melee cross is three tiles from the queen's centre. The ranged cross prefers six tiles and adjusts each arm around blocked tiles while keeping every pair of players beyond her five-tile splash radius.

The [team guide](https://lostcity.rs/t/solo-kq-infodump-a-companion-thread/18495/4) informs the splash spacing and shared ropes. The local content supplies the actual NPC forms, object IDs and route coordinates.

## Run against the local 289 server

Use a running members server with local account creation and debug cheats enabled, Bun dependencies installed, and Google Chrome available. The default engine is `~/code/rs2b2t-engine`, served at `http://localhost:8890`. Set `ENGINE_DIR` when using another checkout. Run one KQ harness at a time with no other players fighting the queen.

From the rs2b0t checkout:

```sh
bun install --frozen-lockfile
# Build navigation data once if out/collision.lcnav.gz is missing.
bun tools/nav/build-collision.ts --engine "$HOME/code/rs2b2t-engine"
# Watch four independent clients in Chrome.
HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60
# Or run without a visible browser.
bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60
# Run the same soak with every enabled skill starting at level 70.
HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60 --level 70
```

`--trips` defaults to 10 completed trips and `--minutes` defaults to 60. `--level` defaults to 99 and accepts integers from 70 to 99. The timeout bounds the scenario after account setup. Allow extra time for the first cache download, tutorial bootstrap and bank seeding. The harness builds and serves an isolated client, reads the engine's login key, creates four fresh accounts, grants Heroes' Quest completion, and seeds their banks. It sets every enabled skill to the requested level and verifies base and effective levels before starting the scripts. `starting-stats.json` records each account's initial levels and XP. Two accounts receive banked passes and two must buy them. All travel, purchases, banking and combat after setup run through JiveKQ. The harness leaves server tick speed and queen health, damage and drops unchanged.

For a faster rerun, use the four names printed by a completed run:

```sh
KQ_ACCOUNTS=a,b,c,d HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60
```

These must be disposable test accounts previously seeded by this harness; reused accounts retain their existing supplies, with three passes added to the first and third accounts. Their skills are reset to `--level`, including XP and current HP/prayer. Refill depleted banks before reusing them. Fresh accounts are the default reproducibility check. On a different local port, set both `ENGINE_DIR` and `--base` to the matching engine.

## What must pass

A live checklist appears over each browser and prints at startup. The harness exits nonzero for a failed check, missing evidence, death, stopped or crashed script, or browser error.

| Check | Required observation |
|---|---|
| Four-player readiness | Three supplied bots remain at the bank for three seconds before the fourth starts |
| Identical kit | Every equipment item and inventory quantity, including arrows, super potions, a charged dueling ring, and the role-specific rope/food counts |
| Desert access | Every client carries a pass; observe both withdrawal from bank and a purchase followed by banking the 95-coin change |
| Both rope gates | Physical tile transitions within three seconds for all four at each gate |
| Rope use | Leader consumes each missing rope; existing shared ropes are allowed |
| Both combat forms | Four cardinal melee positions, a wider ranged cross, Protect from Magic, rapid shortbows, boss HP loss and Strength/Ranged XP for every account across the run |
| Kill | A flying queen with observed positive HP reaches zero and disappears while at least one observer remains in the chamber |
| Boss loot | A new nearby ground stack becomes inventory, then increases the bank balance; recovered player arrows do not qualify |
| Corner wait | All remaining fighters occupy the same northwest corner tile near the spawn with maces ready and every prayer off after a kill |
| Repeated fights | Damage the respawned queen within six seconds of seeing her, in the same chamber visit before banking |
| Potions | Every account has boosted attack, strength and defence with consumed doses |
| Escape | Every account reaches Camelot after consuming five air runes and one law rune, then reaches the Duel Arena with one ring charge consumed |
| Independent restocking | One member banks while another remains in the chamber and continues combat |
| Next trip | All four restore the full kit at Shantay and descend again |
| Soak | At least 10 completed chamber visits followed by all four returning to Shantay, plus at least 10 observed kills; zero-kill trips remain visible in the report |
| Group recovery | Pausing one client sends the other three home; resuming it sends that client home within a 20-second total deadline |

Empty boss drops are possible. The group keeps taking trips until all checks and the trip/kill targets pass, within the timeout. Pause recovery is tested on a later visit after all four are fighting and have gained combat XP on that visit. The checklist and console announce the deliberate pause before it happens; that interrupted trip is excluded from the ten-trip target. The group then continues the soak under the same deadline. A repeated fight must begin before banking, but two completed kills in one trip are not required. Noted drops are checked against their unnoted bank item. Each completed kill trip requires combat XP from each member unless an observed emergency return ended that member's fight early. The report records those exceptions; remaining in the chamber without contributing still fails. The assertions use observed tiles, HP, XP and items; script counters are retained only for diagnosis.

## Inspect the evidence

Each run prints its directory under `out/e2e/jivekq/<run>/`. Open `report.md` for the checklist, per-trip kills, duration, minimum HP, remaining food and combat screenshots. `observations.jsonl` contains the full sample stream. `proof.json` contains the last 600 observations, trip results, respawn-to-damage timings and per-player XP deltas, entry timestamps, rope counts, XP gains, loot movements, minimum HP and the SHA-256 of the served client bundle. Checkpoint screenshots cover readiness, entry, both forms, loot, restocking and recovery. `current.json` and `progress.json` update every ten seconds while the test runs. `out/jivekq-proof.json` points to the latest result.

Offline checks:

```sh
bun test test/scripts/jivekq*.test.ts test/e2e/kqEvidence.test.ts test/e2e/kqOptions.test.ts
bun run typecheck
bun run lint
```

The Jive paint has Overview, Combat, Team, Supplies, Levels and Loot sections, plus a Team chat page. It shows per-trip kills, kill rate, last kill time, each member's HP/prayer/food, loot totals, and estimated personal and team DPS. Damage comes from combat XP at normal XP rates; recoil is excluded and delayed ranged hits can overcount finishing damage. DPS measures active encounter time, including eating and repositioning, while excluding banking and respawn waits.

The evidence tests reject incomplete kits, inherited zero HP during transformation, a queen disappearing alive, a passive party member, recovered arrows and late arrivals. They also cover existing ropes and noted loot deposits.

## Local validation result

Fresh level-70 run `kq4ce21k` **passed all 23 checks**: eleven completed soak trips, ten observed kills, zero deaths and no browser errors in 38m 08s including setup. All four accounts had all 19 enabled skills verified at base/effective level 70. One visit completed two kills. The run continued beyond ten trips to reach the ten-kill target; the final kill occurred on the next visit, which is excluded from the completed-trip count.

All thirteen chamber entries stayed synchronized, with a maximum arrival spread of 0.459 seconds; the surface maximum was 0.248 seconds. All four consumed their initial super attack, strength and defence doses near the first rope, before reaching the second. Observed respawns took damage within 1.66–4.35 seconds, with a 3.32-second median. Forty-eight complete Camelot-to-Arena escapes covered all four accounts. Trip 4 was the announced pause probe, recovered in 3.80 seconds and was excluded from the target.

Minimum HP in west/east/north/south order was `32/31/13/34`. North survived a burst to 13 HP, healed to 53 HP before casting Camelot, then returned to Shantay. The run passed, but those low values leave little margin at level 70.

Artifacts are in `out/e2e/jivekq/kq4ce21k/`, including the report, raw observations, starting stats, screenshots and bundle hash. The served bundle SHA-256 was `683b6fa9d3dd7afa01bfe7ff01c6fffc4d50fb4e72e6ad9cfc811aab2637f128`. The fixture used engine `2135d3a2`, content `8e96792ea` and the running server's approximately 200 ms ticks, with no server or boss changes.

The full offline suite passed 9,903 tests with one skip and no failures. All 138 focused KQ tests, typecheck and lint passed. Both prose gates exited successfully; the repository-wide prose check reported 15 existing warnings outside these changes.

The Electron 33.4.11 messaging check passed: each of four same-origin client frames received messages from the other three. Its artifact is `out/e2e/jivekq/kq3k23u6/electron-channel.json`. This checks coordination transport; the combat soak runs in Chrome.

### Earlier escape failure

Before the final health recheck, level-70 run `kq4ay3iu` failed after nine counted trips and seven kills. East ate at 22 HP, but damage during that action left 16 HP before the teleport cast. The player reached Camelot at 16 HP and then died to a queued hit. Escape now rechecks HP after healing and retries food while HP remains at or below 31 and sharks remain. A deterministic regression reproduces that sequence. The failed run's evidence remains in `out/e2e/jivekq/kq4ay3iu/`.

An earlier max-stat build, before independent restocking and Camelot escapes, passed run `kq3k23u6`: ten counted trips, 17 kills, zero deaths and 22/22 checks in 35m 35s. That result applies to the earlier build.
