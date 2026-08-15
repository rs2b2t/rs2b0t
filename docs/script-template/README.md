[Manual](../README.md) › Script template

# Build a bot in its own repository

Compiles against [`@rs2b0t/api`](../../packages/rs2b0t-api/) and loads into the client by
URL. Forking rs2b0t is not required.

## Build it

1. Copy this directory somewhere and rename it.
2. Repoint the `@rs2b0t/api` dependency in `package.json` — it is a `file:` link to
   `packages/rs2b0t-api/` and resolves only inside this repo.
3. Edit `src/ExampleBot.ts`.
4. Run `bun install`.
5. Run `bun run build` to produce `dist/bot.js`. Use `bun run watch` to rebuild on change.

## Load it

1. Serve `dist/bot.js` over HTTP.
2. Open the client's script panel.
3. Choose **Load URL** and give it the address of `dist/bot.js`.

Default-export a `defineBot({...})` call from the bundle. The registry loads that export
and nothing else.

## Read the example

`src/ExampleBot.ts` is `BoneBurier`: it picks up bones near its start tile and buries
them. It shows how to extend `LoopingBot`, wait for the world with
`Execution.delayUntil(() => Game.ingame(), 0)`, query with
`GroundItems.query().name('Bones').within(10).nearest()`, confirm an action landed by
watching game state instead of assuming a click worked, and subscribe to `skill.xp` and
`inventory.changed` in `onStart`.

The shim wraps the ABI the client installs at `globalThis.__rs2b0t`. It throws when
loaded outside the bot client, and when the client's ABI version disagrees with the
shim's.

## See also

- [Write a bot](../how-to/write-a-bot.md) — the same example annotated
- [Scripting API](../API.md) — the complete surface
- [Running locally](../RUNNING.md) — getting a client up to load this into
- [Manual index](../README.md)
