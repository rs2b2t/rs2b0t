[Manual](README.md) › Dev & deploy

# rs2b0t — Dev & Deploy

The rs2b0t bot client has **three canonical run modes**, one command each.

| Mode | Command | Client | Serving / origin | Detail |
|---|---|---|---|---|
| **Local dev** | `sh tools/deploy-local.sh` | single (`/bot.html`) or wall (`/multibox.html`) | a local engine | [Running locally](RUNNING.md) |
| **Wall vs live** | `bun run b0t` | multibox wall | local client + reverse proxy → `w1.rs2b2t.com` | [MultiBox](MULTIBOX.md) |
| **Hosted (prod)** | `make deploy` | single (`/rs2b0t`) + wall (`/rs2b0t/wall`) | **same-origin** at `w1.rs2b2t.com/rs2b0t` | [below](#maintainer--private-infrastructure) |

## Contents

- [Live wall viewers and the launcher](#live-wall-viewers-and-the-launcher)
- [Build targets](#build-targets-botbundlets-srcconfigtargetts)
- [Maintainer / private infrastructure](#maintainer--private-infrastructure)
  - [The maintainer engine](#the-maintainer-engine)
  - [Hosting the single client (prod)](#hosting-the-single-client-prod)

## Live wall viewers and the launcher

The multibox rail reports bot count, CPU, RAM, and bot traffic. What those readings
mean — and the rule that no missing metric is ever replaced by a guess or a zero —
is documented in [MultiBox](MULTIBOX.md#resource-telemetry). This section covers the
viewers that produce them and the launcher that supervises both.

```bash
bun run b0t                         # dedicated Electron viewer (default)
B0T_VIEWER=chrome bun run b0t       # dedicated Chrome; CDP listens on :9223
B0T_VIEWER=firefox bun run b0t      # dedicated Firefox profile
B0T_VIEWER=none bun run b0t         # proxy only; CPU/RAM unavailable
```

For Chrome DevTools MCP, launch the managed Chrome viewer and configure MCP with
`--browser-url=http://127.0.0.1:9223`. Set `B0T_CDP_PORT` to choose another loopback
port. A dedicated profile is intentional: an ordinary shared browser process includes
unrelated tabs and cannot provide honest bot-only CPU/RAM attribution.

Firefox automation must likewise use a dedicated profile. Do not attach an automation
agent to an everyday Firefox profile: it exposes that profile's cookies and sessions,
and its other tabs/extensions would contaminate capacity numbers.

For an externally managed *dedicated* browser, use
`B0T_RESOURCE_PID=<browser-root-pid> B0T_VIEWER=none bun run b0t`. On Linux that browser
must already be in a dedicated `rs2b0t-viewer-*` cgroup;
otherwise CPU/RAM are explicitly unavailable instead of silently including the terminal
or unrelated tabs.

The managed viewer and local proxy have separate lifecycle states:

- While the Electron/Chrome/Firefox viewer is running, its PID is registered and the
  CPU/RAM rows become live after the first sampling interval.
- If that viewer closes or crashes, the launcher immediately unregisters its PID and
  reports CPU/RAM as unavailable. The proxy deliberately remains available on `PORT`, so
  another already-loaded wall is not cut off merely because the managed window exited.
  The launcher continues supervising the proxy until the proxy exits or you explicitly
  stop it with Ctrl-C/TERM.
- If the proxy exits while a managed viewer is still open, the launcher reports the
  failure, closes and reaps only that owned viewer, and exits nonzero.
- `B0T_VIEWER=none` remains proxy-only. With `B0T_RESOURCE_PID`, it observes that
  externally managed dedicated browser; without one, CPU/RAM stay unavailable. The
  launcher never owns or kills an external PID.

Shutdown cleanup signals only the exact managed viewer and proxy child PIDs launched by
that invocation; it never searches for or kills a shared Firefox/Chrome process.

An atomic checkout-wide launcher lock is held from before the build through shutdown, so
a second `b0t` cannot rebuild the shared `out/` even on a different port. A healthy HTTP
responder on the requested port also aborts startup regardless of its response status.
Source edits are not hot-loaded into an already-open wall; activate them at the next
planned launch rather than refreshing active bots.

## Build targets (`bot.bundle.ts`, `src/config/target.ts`)

The bundle bakes a server target (`TARGET=…`) that fixes how the client resolves the
game WebSocket host and which RSA login modulus it uses:

- **`local`** (default) — **same-origin**: `wsHost = window.location.host`. Local dev key;
  set the public `LOCAL_RSAE` and `LOCAL_RSAN` values when using a stock engine key.
- **`live`** — hardcodes `w1.rs2b2t.com` + `wss`. Used with the local reverse proxy
  (`tools/live-proxy.ts`) for running a local client against production. Key via
  `LIVE_RSAN`.
- **`prod`** — **same-origin** like `local`, but bakes the **production** modulus via
  `PROD_RSAN`. This is the client hosted *on* the game server (`w1.rs2b2t.com/rs2b0t`);
  because it is served from the game origin, `/crc` + the cache/game WebSockets are all
  same-origin and **no proxy is involved**. The build aborts if `PROD_RSAN` is unset.

## Maintainer / private infrastructure

Everything in this section depends on repositories that are **not published**
alongside this one — the rs2b2t engine mirror (`~/code/rs2b2t-engine`) and the ops
repo (`~/code/rs2b2t`). If you are working from a public clone, the equivalent
public path is [Running locally](RUNNING.md).

### The maintainer engine

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy the client
  with `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`.
- The engine uses a **rotated 1024-bit RSA login key** (not the upstream 512-bit default);
  the matching modulus is baked into the `local` target. A stock-key client gets login
  code 6 unless `LOCAL_RSAE` and `LOCAL_RSAN` are supplied to `deploy-local.sh`.
- Cheats/debugprocs (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. `::~maxme`'s
  level-up dialogs swallow the next typed command — do cheats on the clean post-relogin
  state, or clear dialogs first.

The headless harness ABI and the end-to-end smoke are documented in
[Testing](TESTING.md#live-harnesses).

### Gathering location seed coords

Fisher / Miner / Woodcutter camps live in `src/bot/api/*Locations.ts` (public
`@rs2b0t/api` catalogs). Most
entries ship with `verified: false` seed tiles from the gathering CSV. After a
local engine is up:

```bash
bun run verify:gather-locs                 # all skills
bun run verify:gather-locs -- fishing      # one skill
HEADED=1 bun run verify:gather-locs -- fishing   # visible Chrome window
HEADED=1 SLOWMO=400 bun tools/verify-gathering-locations.ts mining
```

`HEADED=1` is read by `tools/lib/harness.ts` (`launchBrowser`) and opens a real
Chrome window (default `SLOWMO=200`). Headless is the default.

The helper teles to each camp, waits until `me` is near the seed tile, samples
rocks/trees/fish in scene, and prints PASS/FAIL only — it never edits the
tables. A camp only PASSes if arrival succeeded **and** the expected resource
is in scene (avoids false PASS from leftover fish after a stalled tele). Flip
`verified: true` by hand once the spot and bank stand look right.

### GatheringBot tick manip (#160)

Optional Lost City–style methods live under each gather script’s **Tick manip**
dropdown (forced **Off** under Location **None**). Server delays (not OSRS wiki):

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

### GatheringBot behaviour smoke

After camps look right, run the live script harness (needs a **fresh deploy** so
`out/botclient.js` matches `GatheringBot` / location tables):

```bash
bun run verify:gatheringbot                 # all scenarios
bun run verify:gatheringbot -- mining       # mine-bank + mine-power + buy-pick + …
bun run verify:gatheringbot -- fish-cook-bank
bun run verify:gatheringbot -- fish-bank-raw-cook
BUDGET_S=180 bun run verify:gatheringbot -- mine-bank
HEADED=1 bun tools/gatheringbot-test.ts acquire
HEADED=1 BUDGET_S=180 bun tools/gatheringbot-test.ts   # headed full suite
```

Scenarios (filter by id or tag: `mining` / `fishing` / `wc` / `acquire` / `path` /
`endgame`):

| id | what it proves |
| --- | --- |
| `mine-bank` / `mine-power` | SW Varrock tin bank loop vs drop mode |
| `fish-bank` / `fish-cook-bank` / `fish-bank-raw-cook` | Draynor net bank; Catherby cook-then-bank (seed cooked); Catherby bank-raw-then-cook (`cert_raw_lobster` 973 → bank, pot+26 raw, N=1000 → catch→bank→cook batch) |
| `wc-bank` / `wc-burn` | Draynor chop+bank; chop-then-burn |
| `mine-path-runite` / `fish-path-shark` | long path into Lava Maze / Fishing Guild |
| `buy-pick` / `buy-axe` / `buy-net` | Buy/repair with **coins only** (no pre-granted tools) |
| `repair-axe-bob` | Seed broken steel axe → Bob item-on-NPC repair (`macro_broken_steel_hatchet`) |
| `repair-pick-nurmof` | Seed broken steel pick → Nurmof repair (`macro_broken_steel_pickaxe`) |
| `restock-fly-barb` | Gerrant multi-buy fly rod + feathers from Draynor bank |
| `auto-freeform-wc-willows-cg` | Auto outside every WC camp chunk → start-tile freeform |
| `auto-freeform-mine-skel` | Auto freeform at wilderness skeleton mine |
| `auto-freeform-fish-ardy-river` | Auto freeform at Ardougne river fly |
| `smith-rune-axe` | Buy/repair smith path (bars + hammer → rune axe) |

**Location / leash (product behaviour, not just the harness):**

- **Named camps** pin the **home** tile to the camp spot and floor **membership**
  (ReturnToAnchor / rock disk) to **64** (overridable per camp via `campRadius`).
  The UI `leashRadius` is ignored below that floor for membership. **Fishing spots**
  chase from the **player** inside camp (`chaseRadius`, default 24) with a hunt pad
  past chase — not a single pin disk for hops. Spots outside membership are rejected
  so chase cannot leave the coastline.
- **Location Auto** alone keeps the raw `leashRadius`. Auto snaps only when the start
  tile shares a preset’s **64×64 map square**; otherwise freeform (null location,
  start-tile leash, nearest bank, player-relative fish). Auto is expert / may-die:
  **no mob flee** (spiders, dark wizards) — random events still run.
- **None** is power/drop mode (also floors membership to 64 from the start tile).
- **Named/None mob flee** kites *away* from the attacker (east-biased), not back onto
  the camp anchor while multi-combat pests sit on it.
- **Post-bank home** uses the soft arrive disk (8 tiles), not full membership (#154
  Catherby bank ≈ 36 from pier).

Asserts XP / held products / acquired tools / bank proximity. Exit nonzero on any FAIL.

Seeds use engine `give <obj> <qty>` (this Server tree has no `~item`/`~bankitem`).
`~clearinv` still works as a content debugproc. Redeploy the bot client yourself
when script code changes — the harness does not own engine `public/`.

Mainland setup always teles off Tutorial Island + `setvar tutorial 1000` then
**relogs** (side icons only unlock from the login payload). Engine-TS holds the old
session after unclean logout — harness probes from ~20s (`RELOG_COOLDOWN_MS` /
`RELOG_PROBE_MS` / `RELOG_RETRY_MS` override).


### Hosting the single client (prod)

The single-instance client is served same-origin from the engine at
`w1.rs2b2t.com/rs2b0t`. It is baked into the **engine image** at build time (in
`~/code/rs2b2t`), not deployed separately:

1. `tools/pack-rs2b0t.sh` builds `TARGET=prod` and stages a **self-contained** subtree
   into a target engine's `public/rs2b0t/`: `index.html` (single client), `multibox.html`
   (the wall), `bot.html`, and `bot/` assets. Because every page loads assets relatively
   (`./bot/…`), the subtree works under `/rs2b0t/` with no path rewrites. `bot.html` is
   staged under its own name as well as `index.html` because `DomSlotOps` resolves each
   wall slot to `bot.html` relative to `baseURI` — without it the single client looks
   healthy while every slot 404s.
2. `~/code/rs2b2t` `ops/scripts/build.sh` derives the prod login modulus from the SSM key
   (authoritative; ADR-0016), runs `pack-rs2b0t.sh` with it, and guards that every page and
   bundle staged and that `botclient.js` baked that modulus.
3. `ops/Caddyfile.game` rewrites the clean `/rs2b0t` URL to `/rs2b0t/index.html` and
   `/rs2b0t/wall` to `/rs2b0t/multibox.html` (the engine serves nested public files by exact
   path but does **not** directory-index). `/rs2b0t/wall` takes **no trailing slash**: both
   the wall's own assets and its slot iframes resolve against the browser-visible URL, so a
   trailing slash would push every one of them a directory deeper.
4. `make build → push → deploy` ships it. Rollback: `make deploy TAG=<prev>`.

Verify locally without touching prod: run `pack-rs2b0t.sh` with the **local** modulus
against the local engine, then `bun tools/hosted-proof-test.ts` (single client) and
`bun tools/hosted-wall-test.ts` (the wall — two accounts ingame, slot iframes resolving
under `/rs2b0t/`, resource card honest). Neither uses a proxy. The `/rs2b0t/wall` rewrite
itself is not reproducible locally — there is no Caddy — so it is a post-deploy check.

The hosted wall runs every bot in one tab, so all of them hold full speed while that tab
is visible — a strict improvement on one tab per account, where every tab but the front
one is starved. It does **not** survive being backgrounded: the game loop is
`setTimeout`-driven and Chrome clamps hidden tabs to 1/sec, so minimising the wall starves
all of it. For unattended running use `bun run b0t`, whose Electron shell disables
background throttling.

## See also

- [Manual index](README.md)
- [Running locally](RUNNING.md) — the from-scratch local setup
- [Scripting API](API.md)
- [Testing](TESTING.md) — unit tests and live harnesses
- [MultiBox](MULTIBOX.md) — the wall itself, and what the telemetry readings mean
