[Manual](README.md) › Running locally

# Running rs2b0t locally

rs2b0t is a **client**. It has no server of its own: it renders the real era game
client and drives it through a scripting API. **Production target is
[rs2b2t](https://rs2b2t.com) only** — not the pure Lost City or 2004scape projects.

For local development you need two things — a compatible game engine, and this
client deployed into that engine's `public/` directory.

Everything below uses only public resources. The maintainer's own engine is a
private mirror; see [Maintainer appendix](#maintainer-appendix) if you have access
to it.

## Contents

- [Prerequisites](#prerequisites)
- [Getting an engine](#getting-an-engine)
- [Deploying the client](#deploying-the-client)
- [The login key](#the-login-key)
- [Running a bot](#running-a-bot)
- [The MultiBox wall](#the-multibox-wall)
- [Desktop shell](#desktop-shell)
- [Running against live](#running-against-live)
- [Tests](#tests)
- [Lint and format](#lint-and-format)
- [Smoke harnesses](#smoke-harnesses)
- [Troubleshooting](#troubleshooting)
- [Maintainer appendix](#maintainer-appendix)

## Prerequisites

| Need | Why |
|---|---|
| [Bun](https://bun.sh) | builds and tests this repo |
| Node 24+ | the engine runs on it, as do the Electron/Playwright harnesses |
| `git submodule update --init` | `src/3rdparty/` holds the MIDI and bzip2 helpers |

## Getting an engine

Local dev often uses a public **rs2-274-compatible** open engine and content pack
(revision branch **274**). Engine and content are separate repos on matching
branches, and they **must be siblings** — the engine resolves content as
`../content` (its own `WorldConfig.ts`, `srcDir`).

This is only for local testing. **rs2b0t is built and supported for rs2b2t**, not
as a general client for those upstream pure projects.

```sh
git clone https://github.com/LostCityRS/Engine-TS -b 274 --single-branch engine
git clone https://github.com/LostCityRS/Content   -b 274 --single-branch content
cd engine
npm install
npx tsx src/app.ts        # or: npm start  (= npm install && tsx src/app.ts)
```

First boot packs the cache. It logs a few `WARN missing model …` lines — those are
harmless — and then:

```
INFO  World ready: Visit http://localhost:8899/rs2.cgi
```

**Wait for `World ready`.** Confirm with `curl -o /dev/null -w '%{http_code}\n'
http://localhost:<web>/rs2.cgi`, which should print `200`.

### Ports

| Service | Default | Notes |
|---|---|---|
| Web | **80** on macOS and Windows, **8888** on Linux | serves `rs2.cgi` and, once deployed, `bot.html` |
| Management (`/setup`) | 8898 | reads and writes `data/config/world.json` |
| Game (node) | 43594 | the client's WebSocket target |

If you already run another game engine on the same ports, these collide. Note that the engine
reaches `World ready` **before** it binds the game port, so a successful-looking log
line does not mean it is up — check for `EADDRINUSE` after it:

```
INFO  World ready: Visit http://localhost/rs2.cgi
Error: listen EADDRINUSE: address already in use 0.0.0.0:43594
```

### Changing ports

Configuration comes from a **`.env` file, not shell environment variables.** The
engine reads `.env` resolved against its working directory; `WEB_PORT=… npx tsx
src/app.ts` is silently ignored.

```sh
cat > .env <<'EOF'
WEB_PORT=8899
WEB_MANAGEMENT_PORT=8896
NODE_PORT=43596
EOF
```

Precedence is `data/config/world.json` → `.env` → built-in defaults. The `.env` is
migrated into `world.json` on the next boot and **`world.json` wins from then on** —
later `.env` edits do nothing. Edit `world.json` directly, or use the management
server's `/setup` page.

## Deploying the client

> **Not yet executed.** The steps in this section and in
> [The login key](#the-login-key) are derived from `tools/deploy-local.sh` and
> `bot.bundle.ts` rather than from an observed run against an upstream engine.
> Everything above this line was executed and behaved as described. Please open an
> issue if this path does not work.

```sh
bun install
ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh
```

`tools/deploy-local.sh` requires `$ENGINE_DIR/public` to exist (a fresh engine has
it), and then:

1. builds the stock client (`bun run build`) and the bot client (`bun run build:bot`);
2. builds the baked navigation collision pack from **that engine's** map data on
   first run, if `out/collision.lcnav.gz` is absent — see [World-walking](NAV.md#the-collision-pack);
3. copies the client bundles into `public/client/` and `public/bot/`;
4. installs `public-bot/bot.html` as `public/bot.html` and `public-bot/multibox.html`
   as `public/multibox.html`.

Both output artifacts live in the repo's `out/` directory, which is shared across
the whole checkout — see [the launcher lock](#troubleshooting).

## The login key

An engine generates its RSA login key on first boot, into `data/config/private.pem`.
The client must encrypt logins with **that** engine's public parameters.

rs2b0t's `local` build target bakes rs2b2t's own rotated **1024-bit** modulus (see
`bot.bundle.ts`). A stock upstream engine generates a **512-bit** key with a **large
random public exponent — not 65537**. So against an upstream engine you must supply
both values, or every login fails with response code 6.

Node's and Bun's crypto reject these keys outright (`ERR_OSSL_BAD_E_VALUE`) because
the exponent is not a small standard value, so derive them with `openssl` and convert
to decimal:

```sh
# modulus
HEX=$(openssl rsa -in data/config/private.pem -noout -modulus | sed 's/^Modulus=//')
bun -e "console.log(BigInt('0x$HEX').toString())"

# public exponent
openssl rsa -in data/config/private.pem -noout -text \
  | awk '/^publicExponent:/{g=1;next} /^[a-zA-Z]/{g=0} g{gsub(/[: ]/,"");printf "%s",$0}' > /tmp/e.hex
bun -e "console.log(BigInt('0x' + require('fs').readFileSync('/tmp/e.hex','utf8').trim()).toString())"
```

Pass both when deploying:

```sh
LOCAL_RSAE=<exponent> LOCAL_RSAN=<modulus> ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh
```

## Running a bot

Open `http://localhost:<web>/bot.html`, register an account (a fresh engine has
`website.registration` enabled), and log in. Then open the panel, pick a script from
the library, set any parameters, and start it.

The bundled scripts are worked examples of the API — see [the catalog](SCRIPTS.md)
and [the scripting API](API.md).

## The MultiBox wall

`http://localhost:<web>/multibox.html` runs several accounts in one tab. Keep the tab
visible: a backgrounded browser tab is throttled to roughly 1 fps and every bot in it
starves. See [MultiBox](MULTIBOX.md).

## Desktop shell

For unattended running, the Electron shell disables background throttling — see
[`desktop/README.md`](../desktop/README.md).

## Running against live

`bun run b0t` runs the wall against production through a local reverse proxy, rather
than against a local engine. See [build targets and run
modes](DEV.md#build-targets-botbundlets-srcconfigtargetts).

## Tests

```sh
bun test                      # everything
bun test test/nav             # one directory
bun test test/docs            # the manual's own link integrity
```

`bunfig.toml` preloads `test/setup-dom.ts`, which registers happy-dom globally — that
is what lets DOM-touching modules be imported in unit tests.

The suite is 1303 tests across 139 files, and passes clean.

See [Testing](TESTING.md) for the layout and for the live harnesses.

## Lint and format

```sh
bun run lint                             # eslint across the repo
bun run format src/bot/nav/Navigator.ts  # prettier, on paths you name
```

Two honest caveats:

- `bun run lint` currently reports **61 pre-existing problems** — 10 in
  `src/bot`, `tools`, and `test`, and 51 in the vendored client under `src/client`,
  `src/dash3d`, `src/graphics`, `src/io`, and `src/mapview`. The bar is *don't add
  new ones*, not *get to zero*.
- `format` deliberately takes explicit paths. The repo is **not** globally
  prettier-formatted (310 files differ), so `prettier --write .` would produce an
  enormous unrelated diff.

`eslint.config.ts` also enforces two architectural fences — only `src/bot/adapter/`
may name client internals, and the DOM is reachable only from `src/bot/ui/` and the
entrypoints. See [Architecture](ARCHITECTURE.md#the-fences).

## Smoke harnesses

```sh
bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

`bun run smoke` drives one browser through boot, login, and a full start / pause /
resume / stop cycle of `QuestDashboard`, writing screenshots to `out/`. It does not
deploy — deploy first, or it loads a stale client. Nine further per-subsystem
harnesses live in `tools/` and are run individually. See
[Testing](TESTING.md#the-end-to-end-smoke).

## Troubleshooting

| Symptom | Cause |
|---|---|
| Login response code 6 | the baked modulus does not match the engine's key — see [The login key](#the-login-key) |
| `EADDRINUSE 0.0.0.0:43594` after `World ready` | another engine holds the game port; change ports via `.env` before first boot |
| Port changes ignored | you used shell environment variables, or `world.json` already exists and wins |
| `bot.html` returns 404 | the client has not been deployed into that engine yet |
| A second `bun run b0t` refuses to start | an atomic checkout-wide lock is held from before the build through shutdown, so a second launcher cannot rebuild the shared `out/` |
| Bots stall when the window is hidden | browser background throttling; use the [desktop shell](#desktop-shell) |

Source edits are **not** hot-loaded into an already-open wall. Activate them at the
next planned launch rather than refreshing active bots.

## Maintainer appendix

These require repositories that are not published alongside this one.

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy with
  `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`. Its committed key is a
  rotated 1024-bit one, and its public half is what the `local` target bakes — so no
  `LOCAL_RSAE`/`LOCAL_RSAN` is needed there.
- Cheats and debugprocs (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. The level-up
  dialogs raised by `::~maxme` swallow the next typed command — clear dialogs first.
- Production hosting and the deploy pipeline: see
  [Dev and deploy](DEV.md#maintainer--private-infrastructure).

## See also

- [Manual index](README.md)
- [Scripting API](API.md) — writing bots
- [Testing](TESTING.md) — unit tests and the live harnesses
- [Dev and deploy](DEV.md) — build targets, run modes, hosting
- [`desktop/README.md`](../desktop/README.md) — the Electron shell
