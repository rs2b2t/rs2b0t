[Manual](../README.md) › [Testing](../TESTING.md) › Harness ABI

# The live-harness ABI

`e2e/*-test.ts` and `e2e/*-live.ts` drive a live browser against a live engine with Playwright. They
attach to the client through the harness ABI the client installs at
`globalThis.rs2b0t`:

```ts
rs2b0t.client     // ingame, sceneState, login(), loginUser/loginPass
rs2b0t.host       // tickCount
rs2b0t.runner     // state, ctx.log, bot, start(), stop()
rs2b0t.reader     // inventory(), npcs(), locs(), worldTile(), stat(), chat(), varp()
rs2b0t.registry   // the script registry
rs2b0t.actions
```

Read arguments through `parseArgs` or `positionalArgs`, never `process.argv[N]` directly.
Why: `e2e/runner.ts` appends `--no-deploy` to every harness, so raw indexing reads a flag as
the engine base and the harness dies before it reaches the engine.

[`e2e/lib/harness.ts`](../../e2e/lib/harness.ts) holds the shared parts:

| Helper | Job |
|---|---|
| `parseArgs(argv, defaults)` | `--base`, `--minutes`, positional rest (unknown flags dropped) |
| `positionalArgs(argv, fallbackBase)` | flag-stripped positionals; index 0 is always the engine base |
| `launchBrowser({ swiftshader })` | a configured Playwright browser |
| `HARNESS_VIEWPORT` | preferred page size **1280×720** (Playwright default) |
| `boot(page)` | wait until `client.constructor.loopCycle > 10` |
| `login(page, user, pass)` | log in and wait for `ingame && sceneState === 2` |
| `type(page, text)` | click the canvas, then type — cheats go through this |
| `bringUpOffIsland(page, opts)` | new account, teleported off tutorial island |
| `logout(page)` | clean **IF_BUTTON 2458** logout (`ClientProt.IF_BUTTON=9` / `logout:try_logout`) |
| `startFromLibrary(page, category, script)` | pick and start a script from the panel |

**Mainland bootstrap (fast path).** Prefer `mainlandAccount` in
[`e2e/tutorial/harness.ts`](../../e2e/tutorial/harness.ts): tele off-island →
`setvar tutorial 1000` → **IF_BUTTON logout** (com 2458) → login again so side
icons unlock. Clean logout ends the session promptly (often ~9s total after boot)
instead of an unclean disconnect that holds “already logged in” for ~60s. Packet
path: `actions.ifButton(2458)` → `ClientProt.IF_BUTTON` (opcode 9) with component
id → content `logout:try_logout` → `p_logout`.

**Map picker (basemap + walkable dots).** Product docs:
[Map tile picker](../MAP-PICKER.md). Bake once with `bun run gen:basemap` (writes
`out/worldmap-basemap.<fp>.png` + manifest; deploy copies them next to
`collision.lcnav.gz`, plus `worldmap.jag` when available for optional rebuild).
Smoke:

| Command | Proves |
|---|---|
| `bun run verify:map-picker -- <base>` | UI pick → Confirm → tile fields (`e2e/map-picker-basemap-live.ts`); asserts `data-basemap` settled |
| `bun run verify:map-picker-e2e -- <base>` | login + pick + WalkTo arrives (`e2e/map-picker-walkto-e2e-live.ts`; needs a loggable world / cheats for short hops) |

Unit: `test/panel/worldMapBasemap.test.ts`, `test/panel/mapPickerTheme.test.ts`,
`test/panel/worldMapPicker.test.ts` (collision pack for snap tests).

**Viewport (local preference).** Headed Chrome should use the **smaller** client scale
used by GatheringBot / `verify-gather-locs` / plain `browser.newPage()` — Playwright’s
default **1280×720**, exported as `HARNESS_VIEWPORT`. Do **not** set
`{ width: 1500, height: 1000 }` (or similar). `bot.html` scales the fixed **765×503**
game stage to fill the page; a large viewport makes the game look blown up and
flip-flops between harness prototypes. Prefer omitting `setViewportSize` /
`viewport` entirely so the default applies.

These details are not obvious from the code:

- **Logging in auto-creates the account** on a local engine, so harnesses generate a
  fresh username per run rather than sharing state. With an always-on engine those
  become `.sav` files under `Server/engine/data/players/main/` and never go away on
  restart. Wipe harness junk (dry-run first):

  ```bash
  bash tools/cleanup-test-accounts.sh              # list
  bash tools/cleanup-test-accounts.sh --apply      # delete matched prefixes
  ```

  Defaults target common tool prefixes (`nvtr`, `nv2r`, `gbs`, `vgl`, …). Override
  with `--prefix`, or `--all-saves` (respects a small KEEP list). Prefer logout /
  idle suites before `--apply`. Stagger multi-suite boots (`sleep 45` between
  launches) so logins do not thrash the same title loop.

- **`type()` clicks the canvas first.** Keystrokes sent without focusing the canvas are dropped.
- **Cheats need a clean dialog state.** `::~maxme` raises level-up dialogs that
  swallow the *next* typed command.
- **Prove the bot worked, don't assume it.** Assert on game state — XP gained, items
  held, tiles reached — not on log lines.
- Software rendering (SwiftShader) is unreliable for some harnesses; several need a
  a physical GPU. Parallel browsers also perturb door timing, so validate a door fix solo.
- **`~maxme` grants stats and never gear.** A quest with a fight in it needs
  the harness to give and equip a kit, or the "max stats" account is punching a
  level-93 boss. `Equipment.equip()` awaits `Execution.delayUntil`, which needs a
  running script context and throws from `page.evaluate` — drive the Wield/Wear
  held-op yourself; the direct input driver's is synchronous.
- **`::give` → inventory; `::givebank` → bank.** Local engine cheats (no busy-guard).
  Content debugprocs `~item` / `~bankitem` do the same but need `p_finduid` (seed after
  dialogs, not mid-`~maxme`). Prefer engine cheats from Playwright; verify bank counts
  with a booth open when the seed matters.
- **`::bank_f2p` stocks a bulk bank** (coins, food, pickaxes, scimitars, …) with no
  dialog. Prefer it to `::bank_preset`, which first asks "This clears your bank.
  Continue?" and needs the choice answered before it does anything. It is a blunt
  fixture, not a realistic kit for a low-level quest.
- **Seeding the bank for realistic quest tests** is documented below.

## See also

- [Write a harness](harness-shape.md)
- [Seeding test accounts](../reference/seeding-test-accounts.md)
