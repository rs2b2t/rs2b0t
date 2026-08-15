[Manual](../README.md) › [Dev and deploy](../DEV.md) › Maintainer infrastructure

# Maintainer infrastructure

Requires repositories not published alongside this one.

### The maintainer engine

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy the client
  with `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh` (or
  `./tools/deploy-local-key.sh ~/code/rs2b2t-engine` for a stock engine key).
- The engine uses a **rotated 1024-bit RSA login key** (not the upstream 512-bit default);
  the matching modulus is baked into the `local` target. A stock-key client gets login
  code 6 unless `LOCAL_RSAE` and `LOCAL_RSAN` are supplied to `deploy-local.sh`.
- Cheats/debugprocs (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. `::~maxme`'s
  level-up dialogs swallow the next typed command — do cheats on the clean post-relogin
  state, or clear dialogs first.
- Local player saves: harnesses leave `*.sav` under the engine `data/players/main/`.
  Wipe harness junk with `bash tools/cleanup-test-accounts.sh` (dry-run default;
  see [Testing](../how-to/write-a-harness.md)).

The headless harness ABI and the end-to-end smoke are documented in
[Testing](../how-to/write-a-harness.md).

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

### Which git commit is on the wall?

Every `bun run build:bot` bakes the current git SHA into the JS and writes
`out/version.json`. `pack-rs2b0t.sh` stages that file at **`/rs2b0t/version.json`**
(and `/rs2b0t/bot/version.json`).

```bash
curl -sS https://w1.rs2b2t.com/rs2b0t/version.json
# → { "commit": "…", "short": "e978193", "dirty": false, "builtAt": "…", "label": "e978193" }
```

The build stamp also appears here:

- **Wall** rail → resource card → **Build** row (hover for full SHA + builtAt)
- **Single client** panel under the `rs2b0t` title
- Console: `[rs2b0t] build e978193 @ 2026-…`
- JS: `rs2b0t.build` / `multibox.build` / `__rs2b0t.BUILD_INFO`

Override when the build tree has no `.git`: `RS2B0T_GIT_COMMIT=<sha>`
(or `GITHUB_SHA`). Mark dirty with `RS2B0T_GIT_DIRTY=1`.

Note: `botclient.js?v=…` is still a **content hash** of the file (cache-bust),
not the git SHA — use `version.json` or the Build row for the commit.

Verify locally without touching prod: run `pack-rs2b0t.sh` with the **local** modulus
against the local engine, then `bun e2e/hosted-proof-test.ts` (single client) and
`bun e2e/hosted-wall-test.ts` (the wall — two accounts ingame, slot iframes resolving
under `/rs2b0t/`, resource card honest). Neither uses a proxy. The `/rs2b0t/wall` rewrite
itself is not reproducible locally — there is no Caddy — so it is a post-deploy check.

The hosted wall runs every bot in one tab, so all of them hold full speed while that tab
is visible — a strict improvement on one tab per account, where every tab but the front
one is starved. It does **not** survive being backgrounded: the game loop is
`setTimeout`-driven and Chrome clamps hidden tabs to 1/sec, so minimising the wall starves
all of it. For unattended running use `bun run b0t`, whose Electron shell disables
background throttling.

## See also

- [GatheringBot smoke](gatheringbot-smoke.md)
- [Gathering seed data](../reference/gathering-seeds.md)
