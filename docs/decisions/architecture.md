[Manual](../README.md) › Architecture

# Architecture

rs2b0t wraps a 2004-era game client and drives it from TypeScript for
[rs2b2t](https://rs2b2t.com).

Why the design looks like this: **a bot must be indistinguishable from a player at the
wire.** The bot forges no packets and synthesises no mouse events; every action goes
through the client's own action dispatch, so the bytes on the socket are the bytes a
human click would have produced.

## Layers

```
src/bot/scripts/     one directory per contribution             ─┐
src/bot/panel/       the bot's own control UI                     │
src/bot/runtime/     script lifecycle, ABI, settings, solvers    │  bot code
src/bot/api/         game-facing nouns, plus ai/ and ui/          │
src/bot/event/       long-running events — webwalk                │
src/bot/input|paint/ the input driver, canvas overlays            │
src/bot/data/        inert catalogs                              │
src/bot/geometry/    Tile, Area, distance                       ─┘
src/bot/adapter/     ClientAdapter — the ONLY place that names client internals
src/client/          the vendored era browser client
src/client/shell/    Client, GameShell, and the rest of the former src/client/*.ts
src/client/dash3d|io|config|graphics|mapview|sound|util|datastruct|wordfilter|3rdparty
```

The split follows OSBot's `org.osbot.rs07`. What belongs in each directory, and
where this departs from OSBot, is in [namespaces](../reference/namespaces.md).

[`src/bot/adapter/ClientAdapter.ts`](../../src/bot/adapter/ClientAdapter.ts) is the
boundary, and it has two halves:

- **`reader`** — typed snapshots out of the client: `worldTile()`, npc/player/loc/obj
  lists, inventory and stat state. Everything above reads the world through it.
- **`actions`** — input into the client: `login()`, `menuAction()`, `walkTo()`, `answerCountDialog()`.

`attach(client)` binds the adapter to a live client instance and returns whatever it
could not resolve, so a client-shape change surfaces as a list of missing members
rather than as scattered `undefined`s.

## From `interact()` to a packet

A script calls `npc.interact('Attack')`. What happens:

1. The entity wrapper resolves `'Attack'` to an **op number** by reading the client's
   own op list for that entity — the same strings the right-click menu shows.
2. It calls [`Input`](../../src/bot/input/Input.ts).
3. `Input` maps `(entity kind, op)` to a `MiniMenuAction` constant — for an NPC,
   op 2 becomes `OP_NPC2` — and calls `actions.menuAction(action, a, b, c)`.
4. The adapter writes those four values into the client's **own** `menuAction`,
   `menuParamA/B/C` arrays at a scratch slot and calls the client's
   `doAction(slot)`.

From step 4 onward the code path is the client's, unmodified. Movement is the same
shape: `walkTo(x, z)` calls the client's `tryMove(...)`.

Two consequences follow from that dispatch path:

- **Actions are fire-and-forget.** `menuAction` returns `false` only when there is no
  client or you are not in-game — never because the action failed. A bot must verify
  outcomes against game state, which is why
  [`Execution.delayUntil`](../reference/api-bots.md#execution) exists and why the API docs insist on
  it.
- There is no mouse. Nothing in the bot path moves a cursor or synthesises events.

## The ABI boundary

Scripts can be compiled outside this repo. [`src/bot/runtime/abi.ts`](../../src/bot/runtime/abi.ts)
assembles the public surface into one object and installs it:

```ts
(globalThis as Record<string, unknown>).__rs2b0t = abi;
```

[`packages/rs2b0t-api`](../../packages/rs2b0t-api/) is a thin shim that reads that global,
checks `apiVersion`, and re-exports the members. It throws immediately if the bundle
is loaded outside the client, or against a client whose ABI version it was not built
for.

This is why [`bot.bundle.ts`](../../bot.bundle.ts) runs **no terser pass and therefore no
property mangling**: `__rs2b0t`'s property names are a public contract that
externally-compiled bundles are linked against. Bun's own minifier shortens locals but
never renames properties, so a production build stays compatible.

See [the scripting API](../API.md) for the surface itself, and
[`docs/script-template/`](../script-template/) for a working
out-of-tree bot.

## Per-instance storage

Several bots can share one browser tab, so nothing may be stored under a bare key.
[`src/bot/runtime/box.ts`](../../src/bot/runtime/box.ts) namespaces credentials and
settings under a *box* id:

| Context | Box | Isolated by |
|---|---|---|
| A standalone `bot.html` tab | `''` | that tab's own `sessionStorage` |
| A MultiBox slot iframe | `<account>` | the box prefix |

The distinction matters because **same-origin iframes share one `sessionStorage`**.
Without the box prefix, every slot on the wall would overwrite the others'
credentials. The wall passes `?box=<account>` when it spawns each iframe.

## Frame-gap insurance

Bots sleep through [`Execution`](../reference/api-bots.md#execution), never `setTimeout`. Those waits
are settled by [`src/bot/runtime/Scheduler.ts`](../../src/bot/runtime/Scheduler.ts),
which is driven by the client's frame callback — so bot time is *game* time, and a
paused client cannot let a wait expire early.

It also compensates for time the process did not get. When a frame gap exceeds 1.5 s
— a throttled background tab, a system sleep, a long main-thread stall — every
pending deadline is pushed forward by the gap:

```ts
if (gap > FRAME_GAP_MS) {
    const shift = gap - NOMINAL_FRAME_MS;
    for (const waiter of ctx.waiters) { /* dueAt / timeoutAt += shift */ }
    ctx.nextLoopAt += shift;
}
```

Without this, a laptop lid closing for a minute would expire every outstanding
timeout at once and each bot would conclude its actions had failed.

A separate watchdog warns when `loop()` has made no scheduler progress for 10 s —
the signature of synchronous blocking, or of awaiting a promise that is not an
`Execution` wait.

## See also

- [Import fences](../reference/import-fences.md)
- [Scripting API](../API.md) — the surface built on this
- [World-walking](../NAV.md) — the largest subsystem built on the adapter
- [MultiBox](../reference/multibox.md#slots) — many clients in one tab
