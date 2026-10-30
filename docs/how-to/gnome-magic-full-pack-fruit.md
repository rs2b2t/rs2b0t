# GnomeMagicChopper full-pack Strange fruit

Run this local-only regression with an engine that permits account cheats.

## Prepare

Set `ENGINE_DIR` to the local revision-289 engine. Build the collision pack before the harness. The builder reads engine content. It writes `out/collision.lcnav` and `out/collision.lcnav.gz` in this repository.

```sh
export ENGINE_DIR=/path/to/engine
bun tools/nav/build-collision.ts --engine "$ENGINE_DIR"
```

## Run

The harness starts a fresh account with a Rune axe, 26 Knives, and one free backpack slot. After the first Magic log bank trip, it adds one Strange fruit to the account. The fruit fills the last slot, with no logs held.

The browser helper uses Google Chrome by default. Set `HARNESS_CHROMIUM_EXECUTABLE` if the host needs a different Chromium executable.

```sh
HARNESS_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
PROOF_DIR=./proof \
BOT_LIVE_NAME_PREFIX=gch \
bun e2e/gnome-fruit-bank-live.ts --base http://127.0.0.1:1080
```

The script must bank the fruit and resume chopping for woodcutting XP. The harness writes a receipt and screenshot. It removes its run-specific client files. It does not change or restart the engine.
