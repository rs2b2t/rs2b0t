[Manual](../README.md) › [Running locally](../RUNNING.md) › Run locally

# Run rs2b0t locally

rs2b0t is a client with no server of its own. Local development needs a compatible game
engine and this client deployed into that engine's `public/` directory.

Production target is [rs2b2t](https://rs2b2t.com) only.

## Prerequisites

| Need | Why |
|---|---|
| [Bun](https://bun.sh) | builds and tests this repo |
| Node 24+ | the engine runs on it, as do the Electron and Playwright harnesses |
| `git submodule update --init` | `src/client/3rdparty/` holds the MIDI and bzip2 helpers |

## Get an engine

Engine and content are separate repos on matching branches and **must be siblings** —
the engine resolves content as `../content`.

1. Clone both at revision 274:

   ```sh
   git clone https://github.com/LostCityRS/Engine-TS -b 274 --single-branch engine
   git clone https://github.com/LostCityRS/Content   -b 274 --single-branch content
   ```

2. Install and start:

   ```sh
   cd engine
   npm install
   npx tsx src/app.ts
   ```

3. Wait for `World ready`. First boot packs the cache and logs harmless
   `WARN missing model …` lines.

4. Confirm with `curl -o /dev/null -w '%{http_code}\n' http://localhost:<web>/rs2.cgi`, which prints `200`.

See [ports](../reference/ports.md) for defaults, changing them, and why `World ready`
does not mean the game port is bound.

## Derive the login key

An engine generates its RSA login key on first boot into `data/config/private.pem`, and
the client must encrypt logins with that engine's public parameters.

rs2b0t's `local` target bakes rs2b2t's own rotated 1024-bit modulus. A stock upstream
engine generates a 512-bit key with a **large random public exponent, not 65537**, so
against one you must supply both values or every login fails with response code 6.

Node's and Bun's crypto reject these keys outright (`ERR_OSSL_BAD_E_VALUE`) because the
exponent is not a small standard value, so use `openssl`:

```sh
# modulus
HEX=$(openssl rsa -in data/config/private.pem -noout -modulus | sed 's/^Modulus=//')
bun -e "console.log(BigInt('0x$HEX').toString())"

# public exponent (handles OpenSSL 3.x single-line and older multi-line formats)
openssl rsa -in data/config/private.pem -noout -text \
  | sed -n 's/^publicExponent: \([0-9][0-9]*\).*/\1/p'
```

`./tools/deploy-local-key.sh /path/to/engine` derives both automatically.

## Deploy the client

1. `bun install`
2. Deploy:

   ```sh
   LOCAL_RSAE=<exponent> LOCAL_RSAN=<modulus> ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh
   ```

   Against the maintainer engine, omit both RSA values.

`tools/deploy-local.sh` requires `$ENGINE_DIR/public` to exist, then builds the stock
and bot clients, builds the collision pack from that engine's map data if
`out/collision.lcnav.gz` is absent, builds the worldmap basemap if its manifest is
absent, copies the bundles into `public/client/` and `public/bot/`, and installs
`bot.html` and `multibox.html`.

Both outputs live in the repo's `out/`, shared across the checkout.

Not yet executed against an upstream engine: this section and the login key above are
derived from `tools/deploy-local.sh` and `bot.bundle.ts` rather than an observed run.
Open an issue if it does not work.

## Run a bot

1. Open `http://localhost:<web>/bot.html`.
2. Register an account — a fresh engine has `website.registration` enabled.
3. Log in, open the panel, pick a script, set parameters, start it.

For several accounts in one tab open `multibox.html` and keep the tab visible; a
backgrounded tab is throttled to roughly 1 fps and every bot in it starves. For
unattended running use the [Electron shell](../../desktop/README.md).

`bun run b0t` runs the wall against production through a local reverse proxy instead of
a local engine.

## Test, lint and smoke

```sh
bun test                      # everything
bun test test/event/webwalk             # one directory
bun test test/docs            # the manual's own link integrity

bun run lint                             # eslint across the repo
bun run format src/bot/event/webwalk/Navigator.ts  # prettier, on paths you name

bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

`bunfig.toml` preloads `test/setup-dom.ts`, which registers happy-dom globally — that is
what lets DOM-touching modules be imported in unit tests.

`bun run lint` reports pre-existing problems in the vendored client. The bar is not
adding new ones, not reaching zero.

`format` deliberately takes explicit paths. The repo is not globally prettier-formatted,
so `prettier --write .` produces an enormous unrelated diff.

`bun run smoke` does **not** deploy — deploy first or it loads a stale client.

## Maintainer appendix

Requires repositories not published alongside this one.

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy with
  `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`. Its committed key is a
  rotated 1024-bit one whose public half the `local` target bakes, so no
  `LOCAL_RSAE`/`LOCAL_RSAN` is needed.
- Cheats (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. The level-up
  dialogs raised by `::~maxme` swallow the next typed command — clear dialogs first.

## See also

- [Ports and troubleshooting](../reference/ports.md)
- [Testing](../TESTING.md) — unit tests and the live harnesses
- [Dev and deploy](../DEV.md) — build targets, run modes, hosting
