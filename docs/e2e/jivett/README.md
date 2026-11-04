# JiveTT local acceptance

`e2e/jivett-live.ts` exercises JiveTT against a local revision 289 server. It refuses non-local URLs and non-local build targets. It creates a disposable `jtt...` mainland account. Audit and audit-stop modes need no stats or equipment; banked-easy seeds only its clue. Hard-clue and hunting modes set stats, unlock Lost City, and seed a melee kit, consumables, escape runes and a Dusty key. These commands are test fixtures, not JiveTT account training or equipment buying.

The client builds into `out/jivett-acceptance` and deploys under a unique local page. It does not overwrite another harness's client bundle. `--server-tick-ms` records the server's configured tick interval; it does not change that interval. Record accelerated probes separately from subsequent longer soak runs.

```sh
ENGINE_DIR=/Users/elliottriplett/code/rs2b2t-slot-patch/engine \
  bun e2e/jivett-live.ts --base http://localhost:8891 --mode audit
```

The local server uses its existing HTTP/WebSocket route at port 8891 and game port 43596. Set `ENGINE_DIR` to the engine actually serving that origin; the harness bakes its login key. `HEADED=1` opens a visible browser. `--user` accepts only disposable names beginning with `jtt` and at most 12 characters.

During the gameplay observation loop, `SIGUSR1` requests a clean interrupted result, screenshots, Stop and browser teardown.

| Mode | Required observation |
| --- | --- |
| `audit` | Easy and medium report their explicit unsupported messages without changing inventory, moving, opening a bank or fighting. Stop prevents restart. |
| `banked-easy` | The existing banked easy clue parks the account before a kill and remains retained. |
| `banked-hard` | The banked hard clue enters preparation/solving before a kill. This does not prove a completed trail. |
| `stop` | Stop during the configured phase tears down the controller and prevents automatic restart. `--stop-phase` defaults to `audit`; it also accepts `travel`, `hunt`, `solve` and `market`. |
| `cycle` | A real kill, real clue drop, verified completed trail, verified rewards banked and a return to hunting all occur. No clue is seeded in this mode. |
| `hunt-probe` | Protected melee, a real kill, server-confirmed antifire, buried bones, collected blue hide and a fresh bank snapshot containing that hide after surface escape. An isolated local bundle temporarily admits Taverley for validation. |

```sh
ENGINE_DIR=/Users/elliottriplett/code/rs2b2t-slot-patch/engine \
  bun e2e/jivett-live.ts --base http://localhost:8891 --mode banked-easy
ENGINE_DIR=/Users/elliottriplett/code/rs2b2t-slot-patch/engine \
  bun e2e/jivett-live.ts --base http://localhost:8891 --mode banked-hard
ENGINE_DIR=/Users/elliottriplett/code/rs2b2t-slot-patch/engine \
  bun e2e/jivett-live.ts --base http://localhost:8891 --mode cycle --minutes 180
```

The cycle uses Taverley blue dragons and existing bank stock, with market buying disabled. Its site must first have recorded entry, melee, protection, loot and exit evidence in the catalog. A rare clue drop may not occur within the deadline; a timeout is incomplete acceptance, not a passing cycle.

`hunt-probe` builds a temporary localhost-only entry that exposes a validation function for Taverley. Before starting JiveTT, the harness applies the explicit marker `validation probe, not release evidence`. The temporary entry is deleted after building; the production catalog remains gated. Probe results must be reviewed before adding release evidence to the catalog. Other modes use the normal bundle and catalog gate.

Each run writes `result.json` and `final.png` under `out/jivett-acceptance-evidence/<run-tag>/`. The JSON includes the mode, account, duration, outcome, failures, bundle/content/map hashes, sampled inventory/bank/equipment, HP/prayer, controller counters and logs. The served bundle hash must match the isolated build. Capture the artifact path when recording results.

## Pinned source evidence

- rs2b0t baseline: `d4640686a8f32518dd3535699c903719b97de2a9`.
- Loot source fingerprint: `d7e19682d2a7fc98f6481ae85933f48b97f7de2ab46639547266ea13ce19e0de`.
- Weapon source fingerprint: `08d4d446c605d35095aa88ef055a2d5b0608db5dbc00937d08af23419df54840`.
- Compiled map archive SHA-256: `297e8d14d502fee965ed0d7e522ff2f3f7892d18ff48587c003d76d961ae11f9`.
- Drop catalog verification: `CONTENT_DIR=/path/to/content bun tools/combat/gen-jivett-catalog.ts --check`.
- Weapon stats verification: `CONTENT_DIR=/path/to/content bun tools/combat/gen-jivett-equipment.ts --check`.

## Coverage boundaries

The harness records observations for one local account. It does not prove market purchases, world-switch interruption recovery, mixed Gu'Tanoth targets, concurrent fleet assignments or every guardian/puzzle/route. Those need separate runs with their own evidence. One-second samples can expose protection failures but cannot prove that every tick was protected.

Wider rollout still requires the design's multi-trip, multi-trail soak with zero observed deaths, no unexplained protection lapses, no lost rewards and no unbounded retries.

## Recorded runs

The 2026-11-02 `audit` run passed on one local account (`jttmvzsz8a1`). Both reserved difficulties produced their exact refusal messages with unchanged inventory and tile, no bank access or combat, and no restart after Stop. Duration including fixture setup was 157.376 seconds. There were no page errors. The artifact is `out/jivett-acceptance-evidence/jivett-audit-mvzsz8a1/result.json`; bundle SHA-256 is `50ea7472cecfd9507a5a1fddb533be95b3b9a575a3eba739b422dd59d1c4596f`.

This audit does not exercise hunting, supplies, guardians or rewards. Concurrent local browser load slowed setup; later runs are serialized and disable drawing after login. Every run pins its own served bundle because controller changes continued between builds.

Two banked-easy attempts stopped during fixture setup before JiveTT started. `jivett-banked-easy-mvzt4adx/result.json` records a 30-second navigation load-event timeout while interfaces were downloading. `jivett-banked-easy-mvzt8rkr/result.json` reached a mainland account after 240 seconds but its immediate attack-level fixture assertion failed. The harness now uses the existing 180-second boot budget for navigation, waits for observed stat updates, and omits stats/equipment entirely from banked-easy. These attempts provide no evidence about JiveTT's banked-clue behavior.

`jivett-hunt-probe-mvzu2x3f/result.json` was deliberately interrupted before combat to rebuild with the corrected post-kill looting behavior. It records 107 samples over 145.276 seconds and zero deaths, but proves no hunting milestone. Its browser-close failure is operator interruption, not a controller failure. Bundle SHA-256: `b96191977bfad99c46f6c672c4df6f709b8ea4b136402964a854298a713f21fc`.

`jivett-hunt-probe-mvzu67cj/result.json` reached Taverley and issued an adult blue-dragon attack, then detected 90 seconds without target-health progress and escaped to the surface. It recorded zero kills and cannot validate loot or banking. All 104 hunting samples retained 99 HP, positive prayer and Protect from Melee; the equipped shield and repeated server antifire messages confirmed observed protection. The browser was deliberately closed after the bounded stall recovery to inspect the samples. This revision was not used to enable the site. The local server used 300 ms ticks. Bundle SHA-256: `3fb0aaef2cf02056841994e3a2c8b4109fac83e6f0b41330ae4de5a53e5abd40`.

The stalled probe exposed cancelled outgoing attacks after drinking. Exact engine `src/network/game/client/handler/OpHeldHandler.ts` calls `clearPendingAction()`; `src/engine/entity/Player.ts` clears the player's interaction. Incoming dragon hits keep the combat flag active, so that flag cannot establish an ongoing outgoing attack. Hunting now reissues after six seconds without target-health progress, at most once per six seconds, while preserving the 90-second stall deadline. The successful probe below verified the fix; this failed run remains recorded as zero kills and a safe surface escape.

`jivett-banked-easy-mvzudisy/result.json` passed in 24.391 seconds including setup. JiveTT reported `Existing easy clue or casket 2677 prevents hard clue drops`, retained the banked clue, recorded zero kills and stayed stopped after Stop. Six samples and no page errors were recorded at 300 ms server ticks. Bundle SHA-256: `583e6b62c0ed2f0de42d526a16517820c8f1e9c2e4ca010806c012d5be008ece`.

`jivett-hunt-probe-mvzugyz3/result.json` passed in 291.15 seconds including setup at 300 ms server ticks. It recorded three adult blue-dragon kills, a 72-point prayer XP increase from burying a dragon bone, a collected blue dragonhide and a fresh Falador bank snapshot containing that hide after surface escape. All 110 hunting samples retained 99 HP; every sampled combat had positive prayer, Protect from Melee and the dragonfire shield. Server antifire messages confirmed potion protection. There were zero deaths, zero page errors and no restart after Stop. The final screenshot was visually checked. Bundle SHA-256: `1c89329b9ca7a9dc2a377d47ad98d5d4adf042ae4a305a47d3ac30f1e4d20a7a`.

The trip escaped after a prayer-dose confirmation failed near supply exhaustion, reaching the surface with 15 prayer points and banking the collected hide. This verifies one protected hunting trip and its safe recovery, not a clue-solving cycle or soak. A subsequent change resets the hunt idle timer after arrival; it does not change the successful combat sequence captured here. The durable [proof summary](taverley-blue.json) pins hashes and exact milestone samples. This evidence enables only `taverley-blue` by default. The other ten sites remain disabled pending their own local validation.

`jivett-banked-hard-mvzuoe6a/result.json` passed in 50.093 seconds including setup at 300 ms server ticks. The stored hard clue entered `solve` before any kill, and Stop prevented restart. Ten samples and no page errors were recorded; the final screenshot was visually checked. This establishes stored-clue prioritization and solver handoff, not a completed trail. Bundle SHA-256: `72b9d737e845127ffbf955fd6296ab00aa92c403b0180f5bbd6edd2cac0ff31d`.

The separate local market adapter probe passed all three verified purchases with the actual `Seers Market` account and buyer `Jtmbzuthbo` on resolved World 1. It bought two noted sharks, two noted Prayer potion(3) and two complete noted Super sets. Coins changed from 100,000 to 97,998, 95,996 and 89,990, matching the verified 10,010 total. Raw noted receipts were 386, 140, 158, 146 and 164; canonical identity preserved the three-dose potion variants. Both trade screens and inventory receipts passed verification. Bundle SHA-256: `1c56945a67e742e5eb6ca281d9dd066074a0cc6671d43c9349f1754a6be79d54`.

An earlier probe correctly rejected a live 1,001-coin quote against a 1,000-coin ceiling with all 100,000 coins retained. Stock fetching also exposed an unanswered request while the merchant was busy. The buyer now retries only before an offer exists, every five seconds within the existing bounded trade wait; the successful probe exercised that recovery. The [market proof](market-receipts.json) contains exact receipt snapshots and the price-rejection result. Full logs are in `out/jivett-acceptance-evidence/market/live.log`. This fixture exercised the live buyer adapter with MarketMaker, not controller-driven restocking or a multi-world roundtrip. Both isolated browsers were closed after the run.

## Code checks

The clue/controller/runtime integration run passed 581 tests across 52 files. After the live fixes and site enablement, the focused JiveTT, world-resume, runner, multibox and reward-adapter run passed 144 tests across 12 files. Scoped TypeScript (all `src` and `test` files plus the new harness and generators), changed-code ESLint, bot build, API-contract check and both catalog generator checks passed.

The baseline full `bun test` run crashed in Bun 1.3.14 with a segmentation fault. The broad repository typecheck includes unrelated local documentation import errors. Neither is reported as passing.

Remaining runtime coverage includes a naturally acquired clue through verified rewards and resumed hunting, a multi-world purchase round trip with interruption, mixed Gu'Tanoth combat, competing accounts, and the multi-trip/multi-trail soak. Unvalidated sites remain unavailable.
