# JiveKQ local validation results

[Harness setup and checklist](jivekq-validation.md).

## Moving potions and public loot

Level-70 probe `kq4rv34b` passed all ten checks at normal 600 ms ticks in 11m 54s including setup and cleanup. A separate donor dropped a dragon chainbody, rune chainbody, amulet of power and 137 rune arrows after a verified kill, then logged out. After 59.462 seconds of private visibility, all four fighters saw the items during the next fight with the queen at 252/255 HP. West collected all three valuables, resumed combat, then banked each extra copy at Shantay. The previously banked fixture copies were excluded by the baseline. No Rune-arrow Take inputs occurred, and the arrows remained after collection.

West ate from 39 to 59 HP while the dragon-chain pickup was pending. All four fighters and the donor survived and were observed logged out, with no cleanup rescues. Minimum fighter HP was 26/25/26/29. The seeded drops are separate from natural-loot and soak evidence. Artifacts are in `out/e2e/jivekq/kq4rv34b/`; bundle SHA-256 is `943d05fe2e3f1454edb14c2c13cb26e404a2e4504c317512a52d144633c61709`.

All sixteen initial potion doses were consumed after observed upper-floor movement and before the upper gate. Own kit preparation took 32–35 seconds; the first three then waited roughly 40 seconds for the deliberately delayed fourth member. Upper travel took 71–83 seconds over 163 observed tiles, with no stationary span of 1.8 seconds or longer. The faster member waited 11 seconds at the second rope. These measurements exclude existing-account setup and do not identify run energy as the cause of speed differences.

The earlier probe `kq4rajgh` collected and banked every valuable but revealed the drops between kills. It remains a failed active-fight test. The donor timing was corrected without changing production code or weakening that assertion.

Final offline verification passed 10,091 tests with one existing skip and no failures, plus typecheck against the current-main merge snapshot, lint and prose gates. Fresh three-team normal-speed soaks are running; their final results are pending.

## Twelve-client Electron channel isolation

Twelve same-origin Electron MultiBox frames using three distinct four-name rosters each received three teammate messages and no foreign-roster messages. This checks channel isolation without logging accounts in; it does not establish twelve-client combat performance. The artifact and reproducer are `out/e2e/jivekq/three-teams-normal-speed/electron-twelve-channel.{json,ts}`.

## Normal-speed prayer failure and bank benchmark

The first three-team run at 600 ms per tick exposed an attack-prayer confirmation failure. Teams `kq4nlnzu`, `kq4nlxvw` and `kq4nmicz` aborted their first fights after 13–17 seconds with food remaining. Strength and Reflexes activated after the two-second API timeout, but the script had already broadcast a group retreat. These runs were interrupted after returning; all twelve clients logged out and no players died. C required two cleanup rescue teleports. All three results remain failures.

Combat prayer updates now run without blocking food actions. A pending toggle is not sent again, and a timed-out toggle gets ten ticks from its request for the actual state to arrive. Attack-prayer failures cannot cause retreat. Missing magic protection gets a retry; repeated failure sends only the affected player to restock after the second grace period. Regression tests cover late first and second confirmations, continued eating and delayed prayer removal between kills.

Exact-ID bank withdrawals now use the existing Withdraw-1/5/10 actions when the requested available quantity matches. Other quantities keep Withdraw-X, and every path still confirms inventory arrival. Three local 600 ms rounds per build withdrew and verified the same thirteen-request leader inventory. Median time fell from 23.387 to 17.375 seconds, saving 6.012 seconds (25.7%). This measures withdrawals only, excluding deposits, opening the bank, equipping and healing. Both benchmark clients were observed logged out.

Artifacts are in `out/e2e/jivekq/three-teams-normal-speed/`: `bank-benchmark.json`, `baseline-timing.md` and `run.json`. The baseline timing report separates the deliberate fourth-player wait from each bot's own preparation. Normal travel took 35–38 seconds from bank release to the surface entrance and 59–64 seconds through the upper cavern. The failed prayer check then caused a 127–150 second escape and restock cycle.

The bank and prayer changes passed 10,032 offline tests with one existing skip and zero failures. Typecheck, lint and both changed documentation files' prose checks passed.

## Normal-speed weapon confirmation failure

Teams `kq4oao32`, `kq4oaxrz` and `kq4obg0e` each completed a five-kill first trip and passed all 24 gameplay checks, including the excluded pause trip. On the third visit, all three leaders triggered `phase weapon unavailable`. Each still carried its bow; the bow became equipped 1.777–1.850 seconds after the retreat. The 2.5-second equip confirmation timeout had been treated as missing gear and escalated to a group retreat. B also missed an eating opportunity while that awaited confirmation blocked the loop.

B failed the contribution assertion because the premature retreat ended a member's fight before it gained XP on that visit. A and C were interrupted before another fight. These runs lasted 26–29 minutes and are failures, not completed soaks. All twelve survived and were observed logged out without cleanup rescue teleports. The first trips lasted 624–661 seconds from chamber entry until all four returned to Shantay; their early returners waited for the remaining members.

Weapon switches now track the pending request without blocking eating. Actual equipment state confirms success, and a failed request gets ten ticks before retrying. A missing weapon causes personal restocking. Regression tests cover delayed confirmation, rejected input, continued eating, and a phase change while an earlier equip is still pending. The failed runs and equip traces remain under `out/e2e/jivekq/three-teams-normal-speed/` and the individual run directories.

The weapon fix passed 10,036 offline tests with one existing skip and zero failures, plus typecheck, focused lint and prose checks.

## Normal-speed weapon-fix checkpoint

The next weapon-fixed runs, `kq4pfsci`, `kq4pg1du` and `kq4pgck8`, each completed one four-kill trip at normal speed. All twelve survived and logged out without rescue. They were deliberately interrupted at Shantay to apply the requested moving-potion and leftover-loot changes, so their results remain incomplete soaks. Across 90 observed equip waits, confirmations arrived in 619–842 ms; these runs did not exercise a late equip confirmation. The delayed-confirmation eating regression remains covered by the offline tests.

## Previous concurrent level-70 soaks

Both four-player teams passed all 25 runtime checks and the full-stream replay against the corrected harness assertions at approximately 200 ms per server tick. Each completed ten counted trips plus one excluded pause-test trip, with zero deaths, zero browser errors and no cleanup rescue teleports. All eight clients were observed logged out safely. Durations include setup and cleanup. These runs predate the bank and prayer changes above.

| Team | Counted trips | Kills on counted trips | Duration | Minimum HP, west/east/north/south |
|---|---|---|---|---|
| `kq4l71qd` | 10 | 21 | 43m 00s | 13/21/20/3 |
| `kq4kx90f` | 10 | 23 | 44m 37s | 22/19/14/12 |

After the controlled probes finished, the teams spent 591 seconds fighting in the chamber together, including 246 seconds with all eight fighting and 66 seconds with both cardinal crosses sharing tiles. No foreign-roster team messages were observed. Across both full runs, 45 verified team observations represent 32 distinct queen deaths; thirteen were witnessed by both teams. These totals include one kill on A's excluded pause trip and early periods shared with the controlled probes.

The original A report counted one extra death after its only witness had teleported away. The harness now requires an original zero-HP witness to remain continuously in the chamber through disappearance and records entry IDs at death time. Replaying both complete raw streams discarded that unconfirmed death: A has 22 verified kills overall, 21 on counted trips; B remains at 23. Original proofs and raw observations are preserved. Both independent audits pass all fourteen checks, including every rope departure, physical returns and safe logout. This post-run change affects harness accounting only; the production files still match the run manifest.

All scenario retreats were the one-shark reserve, owned Mysterious Old Man encounters or the announced pause fixtures. Low HP alone did not trigger a retreat. The escape fix was exercised directly: B's West ate from 26 to 46 HP, waited through the food cooldown, ate its last shark to reach 66 HP, then cast Camelot and reached the Arena at 66 HP. South later followed the same sequence from 12 to 32 to 52 HP before casting. All four B accounts dropped the Shantay disclaimer, confirmed by inventory loss and the ground item.

A's South briefly fell to 3 HP after a prayer-potion action, submitted Eat and Attack immediately, and healed through 23, 43 and 64 HP before later returning safely. The potion action delay still leaves little margin against burst damage at level 70. The zero-death result does not establish that every such burst is survivable.

Artifacts are under `out/e2e/jivekq/kq4l71qd/`, `out/e2e/jivekq/kq4kx90f/` and `out/e2e/jivekq/concurrent-kq4l71qd-kq4kx90f/`. Each run includes raw scenario and cleanup observations, independent audits and escape traces. Bundle SHA-256 values are `c2c260a5590e8470a27330f474e403eac27db8dc4c56f3f841607eccb6422846` and `1dd32d3dde0912d933c83bd6b9439264db61c31f07be7b5db59f07d7d1d9d8d4`; the bundles contain the same production code after excluding build timestamps and debug IDs.

The final offline suite passed 10,023 tests with one skip and no failures. Typecheck and lint passed. Both prose gates passed, with fifteen existing warnings outside these changes.

## Final-build gate delay and death recovery

Fresh level-70 probe `kq4ldeo5` passed all 13 checks in 5m 35s including setup and cleanup. South remained at Shantay with heartbeats active while the other three waited at the surface for 225 game ticks. The leader kept both ropes throughout. Both synchronized descents belonged to that same departure, with arrival spreads of 208 ms at the surface and 207 ms at the chamber.

The announced command then killed South once. Raw observations show its bow on the death tile, West's bow ownership increasing from one to two, and West depositing both bows at Shantay. South returned and waited without its missing bow. The other three survived; all four were observed logged out at Shantay with no cleanup rescue. Artifacts and the independent raw audit are in `out/e2e/jivekq/kq4ldeo5/`. Bundle SHA-256: `de58704a4a7ff2f6cda27b3501b6fa95f08cd9c89b2636247cd655554eaa0187`.

The preceding combined probe `kq4l2els` passed the recovery checks, but its gate assertion incorrectly combined crossings from two departures separated by an owned Mysterious Old Man event. Its report now records the post-run gate failure. The corrected assertion rejects that raw trace at the original retreat; the fresh probe above passes without mixing departures.

## Controlled death recovery

Fresh level-70 probe `kq4jb44s` passed all 12 checks in 4m 42s including setup and cleanup. South died once from the announced fixture command. West recovered its bow, 250 arrows, boots, amulet, dragonhide chaps and vambraces, recoil rings and potions; East then collected more supplies. The probe independently observed the bow on the death tile, West's ownership increasing from one to two, and the extra bow deposited at Shantay. South respawned, walked back to Shantay and waited for replacement gear. All four were observed logged out, with no additional deaths or fixture rescue teleports.

Artifacts: `out/e2e/jivekq/kq4jb44s/`. Bundle SHA-256: `deca88802f89abf61d37cd2872d3d54f8c98604a64fb9127a861b85e22ca90c6`. This deliberate-death probe does not count toward the survival soak. The raw audit also confirms every collected gear item reached the bank. Some supplies and the dueling ring remained on the floor when the recovery window ended; recovery does not guarantee complete pile clearance.

## Previous single-team baseline

Fresh level-70 run `kq4ce21k` **passed all 23 checks**: eleven completed soak trips, ten observed kills, zero deaths and no browser errors in 38m 08s including setup. All four accounts had all 19 enabled skills verified at base/effective level 70. One visit completed two kills. The run continued beyond ten trips to reach the ten-kill target; the final kill occurred on the next visit, which is excluded from the completed-trip count.

All thirteen chamber entries stayed synchronized, with a maximum arrival spread of 0.459 seconds; the surface maximum was 0.248 seconds. All four consumed their initial super attack, strength and defence doses near the first rope, before reaching the second. Observed respawns took damage within 1.66–4.35 seconds, with a 3.32-second median. Forty-eight complete Camelot-to-Arena escapes covered all four accounts. Trip 4 was the announced pause probe, recovered in 3.80 seconds and was excluded from the target.

Minimum HP in west/east/north/south order was `32/31/13/34`. North survived a burst to 13 HP, healed to 53 HP before casting Camelot, then returned to Shantay. The run passed, but those low values leave little margin at level 70.

Artifacts are in `out/e2e/jivekq/kq4ce21k/`, including the report, raw observations, starting stats, screenshots and bundle hash. The served bundle SHA-256 was `683b6fa9d3dd7afa01bfe7ff01c6fffc4d50fb4e72e6ad9cfc811aab2637f128`. The fixture used engine `2135d3a2`, content `8e96792ea` and the running server's approximately 200 ms ticks, with no server or boss changes.

The full offline suite passed 9,903 tests with one skip and no failures. All 138 focused KQ tests, typecheck and lint passed. Both prose gates exited successfully; the repository-wide prose check reported 15 existing warnings outside these changes.

The Electron 33.4.11 messaging check passed: each of four same-origin client frames received messages from the other three. Its artifact is `out/e2e/jivekq/kq3k23u6/electron-channel.json`. This checks coordination transport; the combat soak runs in Chrome.

## Failed concurrent run before harness cleanup repair

Level-70 teams `kq4gsmxs` and `kq4gxwc8` each completed seven counted trips, with 19 and 20 observed kills respectively. These runs failed. The respawn assertion incorrectly required a successful hit within six seconds despite timely Attack inputs. The old teardown then stopped scripts before combat logout succeeded: three characters died after scenario recording had ended. The server-save audit is recorded in `out/e2e/jivekq/concurrent-kq4gsmxs-kq4gxwc8/run.json`.

Cleanup now requests retreat with scripts active and keeps sampling until every client is observed logged out. It records deaths separately and marks any emergency fixture teleport as a failure. A rejected logout keeps the client under observation. Screenshot capture happens only after fighters reach safety. The respawn check measures timely Attack input separately from later successful-hit confirmation.

## Concurrent escape and rope failures

Level-70 team `kq4ji02e` failed on its seventh chamber visit after five counted trips and twelve observed kills. South ate from 26 to 46 HP, leaving one shark and triggering the normal food-reserve retreat. The next eat was rejected during the food cooldown, but the old escape path cast Camelot anyway. A hit reduced HP to 23 during teleport and a queued hit killed South one tick after arrival. The unconsumed shark remained in inventory. `out/e2e/jivekq/kq4ji02e/escape-death-audit.json` records the final ticks.

The new escape checks preserve the cooldown across the stage change and retry healing before casting while food remains and HP is at the eating threshold. Regression tests cover the rejected eat, damage during healing and the last-shark escape. This changes escape handling after a retreat has already started; low HP alone still does not end a fight.

The concurrent team `kq4jhhd5` completed ten counted trips and eighteen observed kills in 46m 43s, with no deaths or cleanup rescues and all four clients verified logged out. Its original harness recorded PASS, but replay with the new rope assertion rejects the sixth departure. South was in a maze random event while the leader attached ropes prematurely. The leader consumed both ropes at the surface as the first expired, leaving none for the chamber entrance. The new readiness check delays attachment until all four are present. These two running bundles predate that fix, the escape fix and disclaimer dropping.

## Earlier escape failure

Before the health recheck, level-70 run `kq4ay3iu` failed after nine counted trips and seven kills. East ate at 22 HP, but damage during that action left 16 HP before the teleport cast. The player reached Camelot at 16 HP and then died to a queued hit. The first fix retried healing at 31 HP or below; the later concurrent failure above showed why a rejected heal also needs to block casting above that threshold. The failed run's evidence remains in `out/e2e/jivekq/kq4ay3iu/`.

An earlier max-stat build, before independent restocking and Camelot escapes, passed run `kq3k23u6`: ten counted trips, 17 kills, zero deaths and 22/22 checks in 35m 35s. That result applies to the earlier build.
