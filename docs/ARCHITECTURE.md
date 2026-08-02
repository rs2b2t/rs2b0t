[Manual](README.md) › Architecture

# Architecture

rs2b0t wraps a real era (~2004) game client and drives it from TypeScript for
**[rs2b2t](https://rs2b2t.com)**. It is not aimed at the pure Lost City or 2004scape
projects. The design constraint that shapes everything else: **a bot must be
indistinguishable from a player at the wire.** No forged packets, no synthetic mouse
events — bot actions go through the client's own action dispatch, so the bytes on the
socket are the bytes a human click would have produced.

## Contents

- [Layers](#layers)
- [The fences](#the-fences)
- [From `interact()` to a packet](#from-interact-to-a-packet)
- [The ABI boundary](#the-abi-boundary)
- [Per-instance storage](#per-instance-storage)
- [Frame-gap insurance](#frame-gap-insurance)

## Layers

```
src/bot/scripts/     the bots themselves            ─┐
src/bot/api/         Game, entities, hud, queries    │  bot code
src/bot/nav|quests|  subsystems                      │
    clues|shops                                      │
src/bot/runtime/     script lifecycle, ABI, settings ─┘
src/bot/adapter/     ClientAdapter — the ONLY place that names client internals
src/client/ …        the vendored era browser client
```

[`src/bot/adapter/ClientAdapter.ts`](../src/bot/adapter/ClientAdapter.ts) is the whole
boundary, and it has exactly two halves:

- **`reader`** — typed snapshots out of the client: `worldTile()`, npc/player/loc/obj
  lists, inventory and stat state. Everything above reads the world through it.
- **`actions`** — input into the client: `login()`, `menuAction()`, `walkTo()`,
  `answerCountDialog()`.

`attach(client)` binds the adapter to a live client instance and returns whatever it
could not resolve, so a client-shape change surfaces as a list of missing members
rather than as scattered `undefined`s.

## The fences

Two rules in [`eslint.config.ts`](../eslint.config.ts) keep the layering honest. They
are lint errors, not conventions.

**Only `src/bot/adapter/` may touch client internals.** Everything else in
`src/bot/` imports the adapter:

> `Only src/bot/adapter/ may touch client internals.`

The exceptions are the protocol const-enums (`ServerProt`, `ClientProt`,
`CollisionFlag`), which are inlined at build time and carry no runtime coupling.

**The DOM is reachable only from the UI layer and the entrypoints** — `src/bot/ui/`,
`src/bot/main.ts`, and the MultiBox view modules:

> `DOM only in src/bot/ui/, main.ts, and src/bot/multibox/{DomSlotOps,ProfileChooser,VaultPrompt,main}.ts.`

This is what keeps the bot logic headless, and therefore unit-testable: the 1303-test
suite imports subsystem modules directly without a browser.

## From `interact()` to a packet

A script calls `npc.interact('Attack')`. What happens:

1. The entity wrapper resolves `'Attack'` to an **op number** by reading the client's
   own op list for that entity — the same strings the right-click menu shows.
2. It calls [`ActionRouter.driver`](../src/bot/input/ActionRouter.ts), which is a
   [`DirectInputDriver`](../src/bot/input/DirectInputDriver.ts) implementing the
   [`InputDriver`](../src/bot/input/InputDriver.ts) interface.
3. The driver maps `(entity kind, op)` to a `MiniMenuAction` constant — for an NPC,
   op 2 becomes `OP_NPC2` — and calls `actions.menuAction(action, a, b, c)`.
4. The adapter writes those four values into the client's **own** `menuAction`,
   `menuParamA/B/C` arrays at a scratch slot and calls the client's
   `doAction(slot)`.

From step 4 onward the code path is the client's, unmodified. Movement is the same
shape: `walkTo(x, z)` calls the client's `tryMove(...)`.

Two consequences worth knowing:

- **Actions are fire-and-forget.** `menuAction` returns `false` only when there is no
  client or you are not in-game — never because the action failed. A bot must verify
  outcomes against game state, which is why
  [`Execution.delayUntil`](API.md#execution) exists and why the API docs insist on
  it.
- There is no mouse. Nothing in the bot path moves a cursor or synthesises events.

## The ABI boundary

Scripts can be compiled outside this repo. [`src/bot/runtime/abi.ts`](../src/bot/runtime/abi.ts)
assembles the public surface into one object and installs it:

```ts
(globalThis as Record<string, unknown>).__rs2b0t = abi;
```

[`packages/rs2b0t-api`](../packages/rs2b0t-api/) is a thin shim that reads that global,
checks `apiVersion`, and re-exports the members. It throws immediately if the bundle
is loaded outside the client, or against a client whose ABI version it was not built
for.

This is why [`bot.bundle.ts`](../bot.bundle.ts) runs **no terser pass and therefore no
property mangling**: `__rs2b0t`'s property names are a public contract that
externally-compiled bundles are linked against. Bun's own minifier shortens locals but
never renames properties, so a production build stays compatible.

See [the scripting API](API.md) for the surface itself, and
[`templates/script-template/`](../templates/script-template/) for a working
out-of-tree bot.

## Per-instance storage

Several bots can share one browser tab, so nothing may be stored under a bare key.
[`src/bot/runtime/box.ts`](../src/bot/runtime/box.ts) namespaces credentials and
settings under a *box* id:

| Context | Box | Isolated by |
|---|---|---|
| A standalone `bot.html` tab | `''` | that tab's own `sessionStorage` |
| A MultiBox slot iframe | `<account>` | the box prefix |

The distinction matters because **same-origin iframes share one `sessionStorage`**.
Without the box prefix, every slot on the wall would overwrite the others'
credentials. The wall passes `?box=<account>` when it spawns each iframe.

## Frame-gap insurance

Bots sleep through [`Execution`](API.md#execution), never `setTimeout`. Those waits
are settled by [`src/bot/runtime/Scheduler.ts`](../src/bot/runtime/Scheduler.ts),
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

- [Manual index](README.md)
- [Scripting API](API.md) — the surface built on this
- [Running locally](RUNNING.md) — building and deploying it
- [World-walking](NAV.md) — the largest subsystem built on the adapter
- [MultiBox](MULTIBOX.md#slots-and-iframes) — many clients in one tab
- [Dev and deploy](DEV.md) — build targets and how the client resolves its server
