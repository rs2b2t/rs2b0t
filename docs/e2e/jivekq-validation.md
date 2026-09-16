# JiveKQ

Select `JiveKQ` under Combat on four clients. Enter the same four account names, separated by commas, in the same order on each client. Keep all four clients in the same browser profile and origin, including MultiBox frames. The first account places the ropes; accounts stand west, east, north and south in roster order.

Each bot banks at Shantay, uses a banked pass when available, and otherwise buys one. It banks the change and fills the last slot with a shark before waiting for all four supplied members. After crossing Shantay, it drops the disclaimer and confirms the inventory slot is free before continuing. The group shares one rope at each entrance. After each kill, each account collects drops visible to it and stacks with the team in the northwest corner near the spawn. They turn every prayer off, ready their maces and refresh boosts while waiting. The corner is within sight of the spawn, so they restore magic protection and spread into the cross as soon as the queen appears. Each member continues until reaching a food, prayer or ammo reserve, then casts Camelot teleport, heals, uses a ring of dueling to reach the Duel Arena and walks south to Shantay bank. That member prepares the next kit while the others keep fighting. The next trip waits for all four at the bank. A paused or disconnected member sends the others home. Resuming or restarting a member allows it to join the next bank rendezvous.

## Coordination

The four clients use the browser's `BroadcastChannel` API to exchange one heartbeat per game tick. Each heartbeat contains the account, client session, trip number, position, stage and readiness, plus combat statistics and recent queen sightings. Sightings retain their observation time and expire after eight seconds. All clients must share the same origin and browser profile; separate browsers or computers cannot join this channel.

The leader releases the bank rendezvous when all four have prepared their kits. After the first rope, the bots sip super potions during the walk through the upper cavern. At each rope, they verify their supplies and stack on the entrance tile before reporting ready. A teammate still walking or drinking holds the release without aborting the trip. The leader waits until all four are ready and physically visible before attaching a rope, then rechecks readiness before releasing the entrance. Ropes expire after 200 server ticks, so attaching one while a teammate is delayed can waste both ropes at the same entrance. Once released, descent takes priority over routine potion refreshes, including a boost that decays while waiting. Emergency checks still take priority. The release names the trip and all four client sessions, so an old message cannot release a restarted client. Each bot handles its own movement, potions and attacks. Combat starts after all four reach the chamber; each observes the queen's form and takes its assigned cross position. If a wall prevents a safe cross, that client broadcasts the blocked formation and all four pull the queen toward open ground before spreading out again.

A pause, unexpected failure or missing heartbeat for six seconds aborts the trip for the group, except for a teammate whose death was already reported. A member leaving combat to restock keeps publishing heartbeats marked as restocking; the remaining fighters keep their assigned positions. Restocking players cannot release an entrance or start the next trip alone. The bots regroup at Shantay before starting the next trip. Potion preparation waits for the server action delay after each sip and retries delayed clicks within the three-minute entrance rendezvous timeout. The client log shows readiness changes, entrance releases, pauses and retreat reasons with a `team:` prefix. The paint has a Team readiness view and a Team chat page showing the latest messages. Repeated heartbeats do not create log entries.

Having food does not prevent every retreat. One shark is reserved for escape; depleted prayer without a restore dose, missing teleport supplies, exhausted arrows, owned random-event visitors and group failures can also end a visit. Escape preserves the last combat eat cooldown and retries needed healing until a shark is consumed. It does not cast while food remains and HP is still at the eating threshold. If no food remains, it attempts the teleport immediately.

Prayer updates run without blocking eating. Each toggle gets ten game ticks for its state to arrive before another request can be sent. Failed attack prayers never trigger retreat. A player with missing magic protection keeps eating while retrying; two failed requests followed by that grace period send only that player back to restock. The other three continue fighting.

Weapon switches also leave eating available while confirmation is pending. The bot waits for the required weapon to appear in its equipment before attacking, and retries a delayed switch after ten ticks. An equip timeout cannot abort the trip. A weapon missing from both inventory and equipment sends only its owner back to restock.

If the queen is out of view, each bot approaches the latest team sighting, then searches six locations around the chamber. Reaching an empty location or making no progress for eight seconds advances the search. A blocked cross triggers a coordinated pull: bots first approach and attack until the queen targets a team member, then follow the route chosen by the first active roster member. The route checks room for the queen's five-by-five body and ends beyond her attack range. A stalled pull tries another direction and reacquires her position. Searching or a stalled pull never causes a retreat by itself; the normal supply and team safety checks still apply.

A dying client broadcasts its server tile, carried items and the items already on that tile. For deaths in the queen chamber, survivors attempt to recover new matching drops at that exact tile. The first available survivor collects while the others continue fighting; a full collector returns to bank and the next takes over. Gear takes priority. Collectors keep eating and protecting from magic, may discard empty vials, and keep their food and escape supplies. Recovery ends after the pile clears, inventory fills or sixty game ticks pass. Recovered items are deposited at Shantay and listed by owner in the Loot paint and Team chat. The dead character returns to Shantay and waits if its bank lacks replacement gear. Items stay in the collector's bank for manual redistribution. The client has no ground-item owner field, so an identical item dropped onto the same tile at the same time cannot be distinguished.

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

Keep coins in the bank for passes, plus extra sharks and prayer potions for restoration. No coins or waterskin leave the bank. Only the leader carries two ropes; followers use those slots for food. Partially used dueling rings are reused until their last charge is consumed. The script uses exact item IDs to distinguish black dragonhide from the other colours, which share display names in this revision. All four protect from magic. Players eat when a shark can heal its full 20 HP, or immediately at 31 HP or below. At level 70 the normal threshold is 50 HP. Low HP alone does not trigger retreat. During combat, Eat and Attack are submitted in the same tick without waiting for inventory confirmation. Food consumption is checked on subsequent loops; confirmed food respects the three-tick cooldown, and an unconfirmed request retries after four ticks. The server still applies its normal attack delay for eating. The initial approach prioritizes reaching the assigned position before enabling attack prayers. The mace uses aggressive crush; the bow uses rapid. Melee uses Ultimate Strength and Incredible Reflexes. Both weapons use their special attacks when energy is available. Each member sips the three super potions while walking between the ropes, with a final boost check at the chamber rendezvous. A bonus that falls to 10% of the base level or less gets refreshed: defence in either form, attack and strength in melee. The melee cross is three tiles from the queen's centre. The ranged cross prefers six tiles and adjusts each arm around blocked tiles while keeping every pair of players beyond her five-tile splash radius.

The [team guide](https://lostcity.rs/t/solo-kq-infodump-a-companion-thread/18495/4) informs the splash spacing and shared ropes. The local content supplies the actual NPC forms, object IDs and route coordinates.

## Run against the local 289 server

Use a running members server with local account creation and debug cheats enabled, Bun dependencies installed, and Google Chrome available. The default engine is `~/code/rs2b2t-engine`, served at `http://localhost:8890`. Set `ENGINE_DIR` when using another checkout. For a single-team baseline, keep other fighters out of the chamber. To test multiple teams, start each additional harness after the preceding one prints its isolated client path. Three harnesses create twelve independent bots across three rosters and result directories. They share the queen and any existing ropes, and their cardinal positions can overlap. Shared queen deaths must be deduplicated when comparing the reports.

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
# Separately cause one death on disposable accounts and verify gear recovery.
HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --recovery-probe --minutes 15 --level 70
# Also delay the fourth member longer than a rope's lifetime.
HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --recovery-probe --gate-delay-probe --minutes 15 --level 70
```

`--trips` defaults to 10 completed trips and `--minutes` defaults to 60. `--level` defaults to 99 and accepts integers from 70 to 99. The timeout bounds the scenario after account setup. Allow extra time for the first cache download, tutorial bootstrap and bank seeding. The harness builds and serves an isolated client, reads the engine's login key, creates four fresh accounts, grants Heroes' Quest completion, and seeds their banks. It sets every enabled skill to the requested level and verifies base and effective levels before starting the scripts. `starting-stats.json` records each account's initial levels and XP. Two accounts receive banked passes and two must buy them. All travel, purchases, banking and combat after setup run through JiveKQ. The harness leaves server tick speed and queen health, damage and drops unchanged.

Normal server speed is 600 ms per tick. On a local debug server previously accelerated with `::speed`, restore it with `::speed 600` before starting. `SLOWMO=0` disables browser automation delays; it does not set game speed. A normal-speed soak may reach the sixty-minute deadline before completing ten trips.

For a faster rerun, use the four names printed by a completed run:

```sh
KQ_ACCOUNTS=a,b,c,d HEADED=1 SLOWMO=0 bun run verify:kq --base http://localhost:8890 --trips 10 --minutes 60
```

These must be disposable test accounts previously seeded by this harness; reused accounts retain their existing supplies, with three passes added to the first and third accounts. Their skills are reset to `--level`, including XP and current HP/prayer. Refill depleted banks before reusing them. Fresh accounts are the default reproducibility check. On a different local port, set both `ENGINE_DIR` and `--base` to the matching engine.

`--recovery-probe` has a separate checklist and result. After the team enters and fights, the harness announces one local `~hit 999` command against South. This runs the server's normal death and item-drop sequence. The probe requires the actual death and Lumbridge respawn, a new bow on the death tile, a surviving teammate gaining that bow, and its deposit at Shantay. Depositing the collector's original bow cannot pass. The dead member must reach Shantay and wait for replacement gear. Any additional death fails. This probe is not a survival soak.

`--gate-delay-probe` holds South's first departure at Shantay while its runner and heartbeats remain active. Once the other three reach the surface entrance, the harness waits 225 game ticks and requires the leader to retain both ropes throughout. It then releases South and requires synchronized passage through both entrances. The optional fixture has its own checklist entry and timestamps in the report and proof.

## What must pass

A live checklist appears over each browser and prints at startup. The harness exits nonzero for a failed check, missing evidence, death, stopped or crashed script, or browser error.

| Check | Required observation |
|---|---|
| Four-player readiness | Three supplied bots remain at the bank for three seconds before the fourth starts |
| Identical kit | Every equipment item and inventory quantity, including arrows, super potions, a charged dueling ring, and the role-specific rope/food counts |
| Desert access | Every client carries a pass; observe both withdrawal from bank and a purchase followed by banking the 95-coin change |
| Both rope gates | Physical tile transitions within three seconds for all four at each gate |
| Rope use | Every prepared departure is checked continuously; the leader uses at most one rope per entrance and followers carry none. Unchanged counts require observed usable-rope evidence for that visit |
| Both combat forms | Four cardinal melee positions, a wider ranged cross, Protect from Magic, rapid shortbows, boss HP loss and Strength/Ranged XP for every account across the run |
| Queen search | Enter without seeing the queen, move at least four tiles, find her and gain combat XP before leaving |
| Kill | A flying queen with observed positive HP reaches zero and disappears; an original zero-HP witness stays continuously in the chamber, verified against its server tile, on the same entry |
| Boss loot | A new nearby ground stack becomes inventory, then increases the bank balance; recovered player arrows do not qualify |
| Corner wait | All remaining fighters occupy the same northwest corner tile near the spawn with maces ready and every prayer off after a kill |
| Repeated fights | Submit an own Attack within six seconds of seeing the respawn, then observe combat XP from that same attacker before it leaves or dies |
| Eating and attacking | Every account submits Eat and Attack in the same game tick, consumes a shark and subsequently gains combat XP |
| Potions | Every account has boosted attack, strength and defence with consumed doses |
| Escape | Every account reaches Camelot after consuming five air runes and one law rune, then reaches the Duel Arena with one ring charge consumed |
| Independent restocking | One member banks while another remains in the chamber and continues combat |
| Next trip | All four restore the full kit at Shantay and descend again |
| Soak | At least 10 completed chamber visits followed by all four returning to Shantay, plus at least 10 observed kills; zero-kill trips remain visible in the report |
| Group recovery | Pausing one client sends the other three home; resuming it sends that client home within a 20-second total deadline |

Empty boss drops are possible. The group keeps taking trips until all checks and the trip/kill targets pass, within the timeout. Pause recovery is tested on a later visit after all four are fighting and have gained combat XP on that visit. The checklist and console announce the deliberate pause before it happens; that interrupted trip is excluded from the ten-trip target. The group then continues the soak under the same deadline. A repeated fight must begin before banking, but two completed kills in one trip are not required. Noted drops are checked against their unnoted bank item. Each completed kill trip requires combat XP from each member unless observed depleted food or an owned random-event visitor ended that member's fight early. Low HP alone does not excuse an early departure. The report records those exceptions; remaining in the chamber without contributing still fails. The assertions use observed tiles, HP, XP and items; script counters are retained only for diagnosis.

## Inspect the evidence

Each run prints its directory under `out/e2e/jivekq/<run>/`. Open `report.md` for the checklist, per-trip kills, duration, minimum HP, remaining food and combat screenshots. `observations.jsonl` contains the full scenario sample stream; `cleanup-observations.jsonl` continues recording through escape and logout. `proof.json` contains the last 600 observations, trip results, queen search movement and subsequent combat XP, verified Eat/Attack input pairs and consumption times, respawn-to-Attack and later XP-confirmation timings, entry timestamps, rope counts, XP gains, loot movements, minimum HP and the SHA-256 of the served client bundle. Checkpoint screenshots cover readiness, entry, both forms, loot, restocking and recovery. `current.json` and `progress.json` update every ten seconds while the test runs. `out/jivekq-proof.json` points to the latest result. Use each run's own directory when comparing simultaneous harnesses.

Offline checks:

```sh
bun test test/scripts/jivekq*.test.ts test/e2e/kq*.test.ts
bun run typecheck
bun run lint
```

The Jive paint has Overview, Combat, Team, Supplies, Levels and Loot sections, plus a Team chat page. It shows per-trip kills, kill rate, last kill time, each member's HP/prayer/food, loot totals, and estimated personal and team DPS. Damage comes from combat XP at normal XP rates; recoil is excluded and delayed ranged hits can overcount finishing damage. DPS measures active encounter time, including eating and repositioning, while excluding banking and respawn waits.

The evidence tests reject incomplete kits, inherited zero HP during transformation, a queen disappearing alive, a passive party member, recovered arrows and late arrivals. They also cover existing ropes and noted loot deposits.

## Local validation results

See the [run results and failure audits](jivekq-results.md) for build hashes, artifact directories and the limits of each run.
