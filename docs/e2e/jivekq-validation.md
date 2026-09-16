# JiveKQ

Select `JiveKQ` under Combat on four clients. Enter the same four account names, separated by commas, in the same order on each client. Keep all four clients in the same browser profile and origin, including MultiBox frames. The first account places the ropes; accounts stand west, east, north and south in roster order.

Each bot banks at Shantay, uses a banked pass when available, and otherwise buys one. It banks the change and fills the last slot with a shark before waiting for all four supplied members. The group shares one rope at each entrance. After each kill, each account collects drops visible to it and stacks with the team in the northwest corner near the spawn. They turn every prayer off, ready their maces and refresh boosts while waiting. The corner is within sight of the spawn, so they restore magic protection and spread into the cross as soon as the queen appears. The group continues until a member reaches a food, health, prayer or ammo reserve, then uses rings of dueling to teleport to the Duel Arena and walks south to Shantay bank. A paused, disconnected or retreating member sends the others home. Resuming or restarting a member allows it to join the next bank rendezvous.

## Coordination

The four clients use the browser's `BroadcastChannel` API to exchange one heartbeat per game tick. Each heartbeat contains the account, client session, trip number, position, stage and readiness, plus combat statistics for the paint. All clients must share the same origin and browser profile; separate browsers or computers cannot join this channel.

The leader releases the bank rendezvous when all four have prepared their kits. At each rope, the bots finish their potions and stack on the entrance tile before reporting ready. The leader also verifies that the other characters are physically visible nearby. The release names the trip and all four client sessions, so an old message cannot release a restarted client. Each bot handles its own movement, potions and attacks. Combat starts after all four reach the chamber; each observes the queen's form and takes its assigned cross position. If a wall prevents a safe cross, that client broadcasts the blocked formation and all four pull the queen toward open ground before spreading out again.

A pause, retreat or missing heartbeat for six seconds aborts the trip for the group. The bots regroup at Shantay before starting the next trip. Potion preparation waits for the server action delay after each sip and retries delayed clicks within the three-minute entrance rendezvous timeout. The client log shows readiness changes, entrance releases, pauses and retreat reasons with a `team:` prefix. The paint has a Team readiness view and a Team chat page showing the latest messages. Repeated heartbeats do not create log entries.

## Shared loadout

Every account needs Heroes' Quest completed, 60 Attack, 40 Defence, 70 Ranged, 70 Hitpoints, 37 Prayer. Stock the following in each account's bank:

| Equipped | Inventory per trip |
|---|---|
| Dragon mace | Magic shortbow |
| Rune full helm | 16 sharks for the leader; 18 for each follower |
| Black dragonhide body, chaps and vambraces | Two ropes for the leader only |
| Amulet of power | Two Prayer potion(4) |
| Leather boots | One Superantipoison(4) |
| Ring of recoil | One spare Ring of recoil |
| 250 rune arrows | One Super attack(4), Super strength(4) and Super defence(4) |
| | One charged Ring of dueling and one Shantay pass |

Keep coins in the bank for passes, plus extra sharks and prayer potions for restoration. No coins or waterskin leave the bank. Only the leader carries two ropes; followers use those slots for food. Partially used dueling rings are reused until their last charge is consumed. The script uses exact item IDs to distinguish black dragonhide from the other colours, which share display names in this revision. All four protect from magic. The mace uses aggressive crush; the bow uses rapid. Melee uses Ultimate Strength and Incredible Reflexes. Both weapons use their special attacks when energy is available. Each member sips the three super potions before the chamber rendezvous. A bonus that falls to 10% of the base level or less gets refreshed: defence in either form, attack and strength in melee. The melee cross is three tiles from the queen's centre. The ranged cross prefers six tiles and adjusts each arm around blocked tiles while keeping every pair of players beyond her five-tile splash radius.

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
```

`--trips` defaults to 10 completed trips and `--minutes` defaults to 60. The timeout bounds the scenario after account setup. Allow extra time for the first cache download, tutorial bootstrap and bank seeding. The harness builds and serves an isolated client, reads the engine's login key, creates four fresh accounts, grants max stats and Heroes' Quest completion, and seeds their banks. Two accounts receive banked passes and two must buy them. All travel, purchases, banking and combat after setup run through JiveKQ. The harness leaves server tick speed and queen health, damage and drops unchanged.

For a faster rerun, use the four names printed by a completed run:

```sh
KQ_ACCOUNTS=a,b,c,d HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60
```

These must be disposable test accounts previously seeded by this harness; reused accounts retain their existing supplies, with three passes added to the first and third accounts. Refill depleted banks before reusing them. Fresh accounts are the default reproducibility check. On a different local port, set both `ENGINE_DIR` and `--base` to the matching engine.

## What must pass

A live checklist appears over each browser and prints at startup. The harness exits nonzero for a failed check, missing evidence, death, stopped or crashed script, or browser error.

| Check | Required observation |
|---|---|
| Four-player readiness | Three supplied bots remain at the bank for three seconds before the fourth starts |
| Identical kit | Every equipment item and inventory quantity, including arrows, super potions, a charged dueling ring, and the role-specific rope/food counts |
| Desert access | Every client carries a pass; observe both withdrawal from bank and a purchase followed by banking the 95-coin change |
| Both rope gates | Physical tile transitions within three seconds for all four at each gate |
| Rope use | Leader consumes each missing rope; existing shared ropes are allowed |
| Both combat forms | Four cardinal melee positions, a wider ranged cross, Protect from Magic, rapid shortbows, boss HP loss and Strength/Ranged XP for every account |
| Kill | A flying queen with observed positive HP reaches zero and disappears while all four remain in the chamber |
| Boss loot | A new nearby ground stack becomes inventory, then increases the bank balance; recovered player arrows do not qualify |
| Corner wait | All four occupy the same northwest corner tile near the spawn with maces ready and every prayer off after a kill |
| Repeated fights | Damage the respawned queen within six seconds of seeing her, in the same chamber visit before banking |
| Potions | Every account has boosted attack, strength and defence with consumed doses |
| Escape | Every account arrives at the Duel Arena with one ring charge consumed |
| Next trip | All four restore the full kit at Shantay and descend again |
| Soak | At least 10 completed chamber visits followed by all four returning to Shantay, plus at least 10 observed kills; zero-kill trips remain visible in the report |
| Group recovery | Pausing one client sends the other three home; resuming it sends that client home within a 20-second total deadline |

Empty boss drops are possible. The group keeps taking trips until all checks and the trip/kill targets pass, within the timeout. Pause recovery is tested after the first successful re-entry; that interrupted trip is excluded from the ten-trip target. The group then continues the soak under the same deadline. A repeated fight must begin before banking, but two completed kills in one trip are not required. Noted drops are checked against their unnoted bank item. The assertions use observed tiles, HP, XP and items; script counters are retained only for diagnosis.

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

The Electron 33.4.11 messaging check passed: each of four same-origin client frames received messages from the other three. This checks coordination transport; the combat soak runs in Chrome.

Run `kq3k23u6` passed all 22 checks: ten completed soak trips, 17 observed kills, zero deaths and no browser errors in 35m 35s including setup. The separate pause probe was trip 3 and recovered in 3.14 seconds. Counted trip kills were `0, 2, 1, 3, 2, 2, 2, 2, 2, 1`; the first trip retreated when the queen did not follow out of a blocked position.

Across 17 respawns, observed damage began after 1.45–5.00 seconds, with a 2.91-second median. The largest arrival spread was 0.415 seconds at the surface rope and 1.043 seconds at the chamber rope. Minimum HP in west/east/north/south order was `28/44/37/52`; the final trip triggered the health retreat. The closer waiting corner took occasional 1–3 HP hits while prayers were off.

Artifacts are in `out/e2e/jivekq/kq3k23u6/`, including `report.md`, `proof.json`, the full observations, Team chat screenshots and `electron-channel.json`. The served bundle SHA-256 was `f768f5b10014cd3a86bd01c51444c26958a7c09a9e3b7a33255c526ac4607b7b`.

The fixture used four max-stat accounts, engine `2135d3a2`, content `8e96792ea` and the running server's approximately 200 ms ticks. Minimum supported combat levels have not been validated live. The full offline suite passed 9,849 tests with one skip and no failures; typecheck, lint and both prose gates passed.
