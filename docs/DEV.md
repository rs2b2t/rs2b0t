# rs2b0t — Dev & Deploy

The rs2b0t bot client has **three canonical run modes**, one command each.

| Mode | Command | Client | Serving / origin |
|---|---|---|---|
| **Local dev** | `sh tools/deploy-local.sh` | single (`/bot.html`) or wall (`/multibox.html`) | local engine at `localhost:8890` |
| **Wall vs live** | `bun run b0t` | multibox wall | local client + reverse proxy → `w1.rs2b2t.com` |
| **Hosted (prod)** | `make deploy` *(in `~/code/rs2b2t`)* | single instance (`/rs2b0t`) | **same-origin** at `w1.rs2b2t.com/rs2b0t` |

## Build targets (`bot.bundle.ts`, `src/config/target.ts`)

The bundle bakes a server target (`TARGET=…`) that fixes how the client resolves the
game WebSocket host and which RSA login modulus it uses:

- **`local`** (default) — **same-origin**: `wsHost = window.location.host`. Local dev key.
- **`live`** — hardcodes `w1.rs2b2t.com` + `wss`. Used with the local reverse proxy
  (`tools/live-proxy.ts`) for running a local client against production. Key via
  `LIVE_RSAN`.
- **`prod`** — **same-origin** like `local`, but bakes the **production** modulus via
  `PROD_RSAN`. This is the client hosted *on* the game server (`w1.rs2b2t.com/rs2b0t`);
  because it is served from the game origin, `/crc` + the cache/game WebSockets are all
  same-origin and **no proxy is involved**. The build aborts if `PROD_RSAN` is unset.

## Hosting the single client (prod)

The single-instance client is served same-origin from the engine at
`w1.rs2b2t.com/rs2b0t`. It is baked into the **engine image** at build time (in
`~/code/rs2b2t`), not deployed separately:

1. `tools/pack-rs2b0t.sh` builds `TARGET=prod` and stages a **self-contained** subtree
   into a target engine's `public/rs2b0t/` (`index.html` + `bot/` assets; single instance
   — no multibox). Because `bot.html` loads assets relatively (`./bot/…`), the subtree
   works under `/rs2b0t/` with no path rewrites.
2. `~/code/rs2b2t` `ops/scripts/build.sh` extracts the prod login modulus from the staged
   engine's `public/client/client.js` (the ≥250-digit run), runs `pack-rs2b0t.sh` with it,
   and guards that the client staged + the baked modulus matches the engine's.
3. `ops/Caddyfile.game` rewrites the clean `/rs2b0t` URL to `/rs2b0t/index.html` (the engine
   serves nested public files by exact path but does **not** directory-index).
4. `make build → push → deploy` ships it. Rollback: `make deploy TAG=<prev>`.

Verify locally without touching prod: run `pack-rs2b0t.sh` with the **local** modulus
against the local engine, then `bun tools/hosted-proof-test.ts` — it proves the `prod`
target resolves same-origin and logs in with no proxy.

## Local-engine test tricks

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy the client
  with `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`.
- The engine uses a **rotated 1024-bit RSA login key** (not the upstream 512-bit default);
  the matching modulus is baked into the `local` target. A stock-key client gets login
  code 6.
- Cheats/debugprocs (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. `::~maxme`'s
  level-up dialogs swallow the next typed command — do cheats on the clean post-relogin
  state, or clear dialogs first.
- Headless harness ABI: `globalThis.rs2b0t` (`.client`, `.runner`, `.reader`, `.registry`,
  `.actions`). Boot when `rs2b0t.client.constructor.loopCycle > 10`; login auto-creates a
  local account. See `tools/*-test.ts` for the pattern.
- `bun run smoke` — the full live smoke fleet against the local engine (deploys once,
  then every `tools/*-test.ts` sequentially, hours; per-smoke logs in `out/smoke-logs/`).
  `--list` / `--only <substr>` / `--skip <substr>` subset it; SPECIAL-environment smokes
  (desktop/hosted/multibox/e2e/rendergate + dev harnesses) are excluded automatically.
