# Flax Spinner (Seers Village) — Design

**Goal:** An AFK Seers-Village bot that spins a bank's worth of flax into bow
string: bank → withdraw flax → up to the spinning wheel → spin the whole pack →
back down to the bank → deposit → repeat, stopping cleanly when the bank runs out
of flax.

**Category:** Crafting. Registered `FlaxSpinner`. Start it at the Seers bank.

## Mechanic (verified in content)

`scripts/skill_crafting/scripts/spinning/spinning.rs2` + `spinning_wheels.loc`:

- The **Spinning wheel** loc (`spinningwheel`, name "Spinning wheel") has
  **`op2=Spin`** and **`forceapproach=south`**.
- `[oploc2,_spinning_wheel]` → `~skill_multi2_header("What would you like to
  spin?", wool…, flax…)` opens the generic **`skill_multi2`** chat make-menu
  (`if_openchat(skill_multi2)`), whose product buttons are labelled **"Make X" /
  "Make 10" / "Make 5" / "Make 1"** (`skill_multi2.if`, `option=Make X`). Flax is
  product B (`make1_b…makex_b`); wool is product A.
- Choosing Make-X opens a count dialog; the wheel then spins one item per tick
  via `weakqueue crafting_spinning` until the pack runs out. Flax → **bow string**
  (`bow_string`).

Because the menu uses "Make X", it is driven by the **existing**
`reader.makeProducts()` (regex already matches "make") + `ChatDialog.makeX('Flax',
n)` + `actions.answerCountDialog(n)` — the same path built for the smelter. **No
adapter/API changes are required.**

Because "Spin" is an OPLOC and the wheel is `forceapproach=south`, interacting
the wheel makes the **server** walk the player onto the correct approach tile —
so the (un-baked) upper floor needs no web-walking.

## Architecture

A `TaskBot` (SmelterBot/CookBot shape) with priority tasks keyed on two facts:
the player's **floor** (`Game.tile().level`, 0 = ground, 1 = up) and whether
**flax is in the pack**. Tasks are mutually exclusive by (level, hasFlax):

| Task | Runs when | Behaviour |
|---|---|---|
| **ContinueDialog** | a "click to continue" dialog is up | dismiss it (top priority) |
| **BankTrip** | level 0, flax = 0 | `walkOpening(bankStand)` (opens the house door on the way out) → `Bank.openBooth` → `depositInventory` → if the bank has no flax, log + `ScriptRunner.stop()`; else Withdraw-All flax to fill the pack |
| **Ascend** | level 0, flax > 0 | `walkOpening(ladderStand)` (opens the house door on the way in) → `climbLadder('Climb-up')` → wait for level 0→1 |
| **Spin** | level 1, flax > 0 | find the "Spinning wheel" loc → `interact('Spin')` (server walks us, south approach) → wait for the make-menu → `ChatDialog.makeX('Flax', flaxCount)` → wait until flax = 0 (or a dialog/menu) |
| **Descend** | level 1, flax = 0 | `climbLadder('Climb-down')` → wait for level 1→0 |

`Game.tile()` may be null mid-transition; every `validate()` guards for it.

## The one new primitive: `climbLadder(op)`

The only genuinely new mechanic (no existing bot changes floors). Bot-local
helper (promote to a shared api only if a 2nd consumer appears — YAGNI):

```
climbLadder(name, op, log): Promise<boolean>
  loc = Locs.query().name(name).action(op).nearest()   // nearest ladder offering the op
  if !loc: return false
  before = Game.tile()?.level
  await loc.interact(op)                                // OPLOC — server walks us to the ladder + climbs
  return await Execution.delayUntil(() => Game.tile() != null && Game.tile().level !== before, 8000)
```

Ladder loc name + ops are settings (default name "Ladder", ops "Climb-up" /
"Climb-down") since some buildings use "Staircase"/"Climb up" wording.

## Reuse vs new

- **Reused:** `walkOpening` (ground-floor web-walk + door opening — hardened this
  session), `ChatDialog.makeX` / `reader.makeProducts` / `actions.answerCountDialog`
  (spin-X), `Bank.openBooth` (today's OPLOC-first fix) + `depositInventory` +
  `withdraw`, the `TaskBot`/`Task` template.
- **New:** `src/bot/scripts/FlaxSpinner.ts` (the bot + `climbLadder` helper) and
  its registration in `scripts/index.ts`. No pure-logic module is needed (flax is
  a single item — count = `Inventory` filter; no recipe mix like the smelter).

## Settings (verified-live defaults, all configurable)

- `bankStand` (tile) — Seers bank booth-adjacent tile (found live)
- `bankBooth` (string, default "Bank booth"), booth op "Use-quickly"
- `ladderStand` (tile) — ground-floor tile INSIDE the house beside the ladder
  ((2714,3471) — not the ladder's own loc-blocked tile: an unwalkable dest lets
  the pathfinder "arrive" on the street outside the sealed house, the door never
  becomes a planned crossing, and the stall hunt once opened the NEIGHBOUR
  house's door; see the route note in FlaxSpinner.ts)
- `ladderName` (string, default "Ladder"), `climbUpOp` ("Climb-up"),
  `climbDownOp` ("Climb-down")
- `wheelName` (string, default "Spinning wheel"), `spinOp` ("Spin")
- `product` (string, default "Flax") — matched against the make-menu product name
- `obstacle` (string, default "door") — openable obstacle on the bank↔house route
- `leashRadius` (number) — wheel/ladder search radius

Exact coordinates (Seers bank stand, house door, ladder ground/up tiles, wheel
tile) are dumped live during implementation (teleport in, walk the route, read
`reader.locs()`), exactly as the furnace/anvil stands were.

## Error handling

- Out of flax in the bank → log the shortage, `ScriptRunner.stop()` (clean stop,
  like SmelterBot's out-of-ore).
- `climbLadder`/`interact` returns false or times out → the task returns; the
  loop re-validates and retries next tick (bounded waits, no infinite spin).
- A dialog interrupts (level-up, "You need a higher Crafting level") → the
  make-menu simply won't open / `makeX` returns false; ContinueDialog clears
  message dialogs; the Spin task retries or (if perpetually blocked) the pack
  never drains — acceptable (user picks a trainable level).

## Testing

`tools/flax-spinner-test.ts` (headless live, mirrors `tools/smelter-test.ts`):

1. Login off Tutorial Island, `::~bankitem flax N` (before `::~maxme`), `::~maxme`.
2. Teleport to the Seers bank.
3. Start `FlaxSpinner`, watch ~180s.
4. Assert: flax is withdrawn → `level` goes 0→1 → **bow string count climbs** →
   `level` returns to 0 → bank deposit happens. Seed exactly one pack's worth of
   flax (or a small surplus) to also exercise the out-of-flax **clean stop**.

## Out of scope (YAGNI)

- Wool spinning (product B is Flax only; wool is selectable but unused).
- Other spinning-wheel locations (Lumbridge, etc.) — the loc names/ops are
  settings, so a different wheel is a config change, not code.
- A shared multi-floor navigation subsystem — `climbLadder` stays bot-local until
  a second floor-changing bot exists.
