[Manual](../../docs/README.md) › Script template

# rs2b0t script template

A starting point for a bot that lives in **its own repository**, compiled against
[`@rs2b0t/api`](../../packages/rs2b0t-api/) and loaded into the client by URL. No fork
of rs2b0t is needed.

Copy this directory somewhere, rename it, and edit `src/ExampleBot.ts`.

## Build

```sh
bun install
bun run build      # -> dist/bot.js
bun run watch      # rebuild on change
```

The `@rs2b0t/api` dependency is a `file:` link to `packages/rs2b0t-api/` in this
repo. If you copy the template outside the repo, repoint it at a published version or
a path that resolves.

## Load it

Serve `dist/bot.js` over HTTP, then use **Load URL** in the client's script panel.
The bundle's default export must be a `defineBot({...})` call — that is what the
registry looks for.

`@rs2b0t/api` is a thin shim over the ABI the client installs at
`globalThis.__rs2b0t`. It throws if the bundle is loaded anywhere other than inside
the bot client, or if the client's ABI version does not match the one the shim was
built for.

## What the example does

`BoneBurier` picks up bones near where it starts and buries them. It is small on
purpose, but it demonstrates the parts most bots need:

- extending `LoopingBot` and implementing `loop()`;
- waiting for the world with `Execution.delayUntil(() => Game.ingame(), 0)`;
- querying the world — `GroundItems.query().name('Bones').within(10).nearest()`;
- **verifying an action landed** by watching game state, rather than assuming a click
  worked;
- subscribing to events (`skill.xp`, `inventory.changed`) in `onStart`.

## See also

- [Scripting API](../../docs/API.md) — the complete surface
- [Running locally](../../docs/RUNNING.md) — getting a client up to load this into
- [Manual index](../../docs/README.md)
