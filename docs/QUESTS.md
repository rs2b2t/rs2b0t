[Manual](README.md) › Quests

# Quests

A quest is **data**, not a script. Each one is a `QuestModule` whose `decide()`
inspects a snapshot of the world and returns the single next step; a shared engine
executes that step and asks again. Adding a quest means adding a module, not writing
another bot.

## Contents

- [The shape of a quest](#the-shape-of-a-quest)
- [Quest state](#quest-state)
- [Exec primitives](#exec-primitives)
- [Provisioning](#provisioning)
- [The queue and the watchdog](#the-queue-and-the-watchdog)
- [Eligibility](#eligibility)
- [Adding a quest](#adding-a-quest)

## The shape of a quest

Three directories, three jobs:

| Directory | Job |
|---|---|
| [`src/bot/quests/engine/`](../src/bot/quests/engine/) | runs quests: queue, snapshot, provisioning, watchdog |
| [`src/bot/quests/defs/`](../src/bot/quests/defs/) | one module per quest — the decisions |
| [`src/bot/quests/exec/`](../src/bot/quests/exec/) | the primitives a step is built from |

A module declares what it needs and how to decide:

```ts
export interface QuestSustain {
    foods: readonly string[];
    eatBelowHp: number;
}

export interface QuestModule {
    record: QuestRecord;                       // id, name, QP, requirements, items
    hops?: LadderHop[];                        // level changes this quest needs
    bank?: Tile;
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap, need) => QuestStep>;
    tools?: string[];
    ownsInventory?: boolean;                  // module manages every loadout itself
    readStage?: () => number | undefined | Promise<number | undefined>;
    sustain?: QuestSustain;                   // quest-specific food and eat threshold
    decide(snap: QuestSnapshot): QuestStep;
}
```

`decide()` returns one of a closed set of steps — `talk`, `grabGround`, `pickLoc`,
`interactLoc`, `useOn`, `equip`, `withdraw`, `deposit`, `mineRock`, `buy`, `custom`,
`wait`, `done` (see [`engine/types.ts`](../src/bot/quests/engine/types.ts)) — and
[`executeStep`](../src/bot/quests/exec/steps.ts) knows how to perform each kind.

Because `decide()` is a pure function of the snapshot, a quest is restartable from
any point. Kill the bot mid-quest, start it again, and it re-derives where it is.

## Quest state

**State is read from the quest journal and from held items. Never from varps.**

```ts
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete')    { return { kind: 'done' }; }
    if (snap.journal === 'unknown')     { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted')  { return { kind: 'talk', stop: COOK }; }
    if (!snap.inv.has('egg'))           { return gatherEgg(); }
    if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
    if (!snap.inv.has('pot of flour'))  { return gatherFlour(snap); }
    return { kind: 'talk', stop: COOK };
}
```

That is the whole of Cook's Assistant. The snapshot the engine hands it:

```ts
export interface QuestSnapshot {
    journal: QuestStatus;        // notStarted | started | complete | unknown
    inv: Map<string, number>;
    invIds?: ReadonlyMap<number, number>;
    worn: Set<string>;
    wornIds?: ReadonlySet<number>;
    noProgress: number;
    bankCoins: number;
    stage?: number;              // exact journal stage from module.readStage()
    bank?: ReadonlyMap<string, number>;
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}
```

The name maps remain convenient for ordinary items. Use the ID maps for objects
whose display names collide. A `withdraw` item can include `id`, and a `deposit`
step can include `keepIds`; ID keeps are combined with, rather than replacing,
the step's name-based `keep` list.

When the stage number alone cannot say where a quest is — which of three tribes are
satisfied, which words have been learned, how many monsters remain — a module implements
`readProgress()` instead of `readStage()` and returns named flags alongside the stage.
They arrive on the snapshot as `snap.progress`, so `decide()` stays a pure function;
`hasFlag` and `flagValue` in [`engine/types.ts`](../src/bot/quests/engine/types.ts) read
them. [`defs/watchtower/journal.ts`](../src/bot/quests/defs/watchtower/journal.ts) is the
worked example.

Two consequences worth stating plainly:

- **`'unknown'` is not `'notStarted'`.** The journal is not loaded for the first
  moments after login, and treating that as "not started" restarts a finished quest.
  Every module returns `wait` for it.
- Progress *within* a started quest is inferred from its rendered journal stage and
  what the player is carrying. A held quest item is part of the state machine's
  memory, which is why a step that hands an item over and a step that acquires it
  must never both be reachable from the same snapshot.

A held item can also route the bot into a wedge: carrying an item whose delivery is
gated behind something else loops forever at the gate. When an oracle refuses, the
holding must be *undone* — bank it — not retried.

## Exec primitives

[`exec/primitives.ts`](../src/bot/quests/exec/primitives.ts) is the shared vocabulary
that quest steps are built from:

| Primitive | What it handles |
|---|---|
| `walkWithHops(dest, radius, hops, log)` | walking that may need to change level |
| `gotoNpc(stop, hops, log)` | walking to an NPC's anchor within its leash |
| `driveDialog(prefer, log)` | driving a dialogue, choosing by preference list |
| `talkThrough(npc, prefer, log)` | the two combined |
| `talkOp(actions)` / `pickPreferred(options, prefer)` | choosing an op or an option |
| `isUnderground(t)` / `needsHop(here, anchor)` | whether a level change is required |

[`exec/prompts.ts`](../src/bot/quests/exec/prompts.ts) covers the other half — the
world, rather than a conversation:

| Primitive | What it handles |
|---|---|
| `promptLoc(step, log)` | walk to a stand, act on a loc, answer the prompt it raised |
| `useOnLoc(itemId, loc, prefer, expect, log)` | the same for `oplocu`, which no op-based step can express |
| `driveChoice(prefer, log)` | `driveDialog` that abandons rather than guessing |
| `locNear(name, op, within)` / `heldId(id)` / `settleScene()` | the small repeated lookups |

`driveChoice` exists because loc prompts routinely put the refusal first — the
gallows offers *"I don't think so, it might animate and attack me!"* as option one.
Falling through to an unmatched option is worse than stopping.

Dialogue is driven by **preference lists** rather than indices, so option reordering
does not break a quest:

```ts
const COOK: NpcStop = {
    npc: 'Cook',
    anchor: new Tile(3209, 3215, 0),
    leash: 6,
    prefer: ["What's wrong?", "Yes, I'll help you."]
};
```

Server-driven dialogue chains must be *driven to completion* — stopping at the first
continue leaves the conversation half-finished and the quest un-advanced.

`gotoNpc` is leash-limited by design. For an NPC that patrols, that is the wrong
tool: it wanders out of leash and the step is abandoned. Use
[`Reach.npcDialog`](NAV.md#the-reach-primitive), which searches the whole scene and
lets the server chase.

Opening the dialogue itself goes through [`Reach`](NAV.md#the-reach-primitive), so an
NPC who has wandered behind a shut door is reached rather than abandoned. Being inside
the leash does not mean being reachable: Fred the Farmer paces into his bedroom, the
one interior door re-shuts, and every talk from the anchor is silently dropped.

## Provisioning

[`engine/provisioning.ts`](../src/bot/quests/engine/provisioning.ts) assembles what a
quest needs **before** it starts, bank-first:

| Function | Job |
|---|---|
| `planProvisioning(...)` | what to withdraw, given the record's items and what is held |
| `depositPlan(inv, keep)` | what to drop before starting |
| `gpShort(snap, estGp)` | how much coin is missing for a purchase |
| `floatWithdraw(...)`, `coinFloatWithdraw(...)` | withdrawing with headroom |

Two rules that are easy to get wrong:

- **A quest that buys anything must keep `coins` in its `tools`.** Omit it and the
  provisioner does not carry coin, so every purchase step parks with "need gp".
- Quest-internal consumables are not `record.items`. The record lists what the quest
  *requires*; things consumed along the way are the module's own business.

The engine carries a coin float (`COIN_FLOAT`) and provisions from a fixed bank
(`PROVISION_BANK`) — both in [`QuestEngine.ts`](../src/bot/quests/engine/QuestEngine.ts).

## The queue and the watchdog

[`QuestEngine`](../src/bot/quests/engine/QuestEngine.ts) runs quests in order,
tracking `parked`, `parkCounts`, and `parkedReasons`. A quest that stops making
progress is **parked with a reason** and the queue moves on, rather than looping on a
step that cannot advance. `ProgressWatchdog` ([`engine/watchdog.ts`](../src/bot/quests/engine/watchdog.ts))
is what notices.

A step that keeps failing must eventually park. A failing step that never parks is
the worst outcome available: the bot looks busy forever.

## Eligibility

[`EligibilityEvaluator`](../src/bot/quests/EligibilityEvaluator.ts) reports each quest
as `DONE`, `READY`, or `BLOCKED` **with reasons**, combining
[`RequirementChecker`](../src/bot/quests/RequirementChecker.ts) (quest points, skill
levels, prerequisite quests) and [`ItemChecker`](../src/bot/quests/ItemChecker.ts)
(inventory and bank).

Items are `mustHave` or `acquirable` — the difference between "you cannot start this"
and "the bot will go and get it". `QuestDashboard` renders the result; `AIOQuester`
consumes it to choose what to run.

## Adding a quest

1. Add the record to [`data/quests.ts`](../src/bot/quests/data/quests.ts) — id, name,
   quest points, requirements, items.
2. Write `defs/<quest>.ts`: anchors as `Tile` constants, `NpcStop`s with `prefer`
   lists, `gather` functions for anything the bot must fetch, and a `decide()` that
   reads only the snapshot.
3. Register it in [`defs/index.ts`](../src/bot/quests/defs/index.ts).
4. Add a unit test for `decide()` — it is a pure function, so every branch is
   testable without a client. See [`test/quests/`](../test/quests/).

Start from [`defs/cooksassistant.ts`](../src/bot/quests/defs/cooksassistant.ts) for
the simple shape, [`defs/priestperil.ts`](../src/bot/quests/defs/priestperil.ts)
for one with level changes, gated doors, and a long item chain, or
[`defs/watchtower/`](../src/bot/quests/defs/watchtower/) for one large enough to need a
directory.

Watch Tower is also the reference for a quest whose map is **sealed pockets**. Nine
areas — Grew's island, Toban's camp, the lower city, the city-guard pocket, each skavid
cave, the shaman enclave, the wizard's floor — are reachable only through a scripted
crossing that teleports the player, so nothing routes into them by walking. Two rules
fall out of that, and both were found the hard way:

- **Every branch escapes the current pocket before it acts.** A step that assumes it is
  standing on the mainland will send the walker at a tile on the wrong side of a one-way
  cave, and it will spend three passes proving it unreachable.
- **A stand tile next to an unwalkable loc is not automatically reachable.**
  [`tools/nav/probe-tile.ts`](../tools/nav/probe-tile.ts) pathfinds to every tile a quest
  module names, from each of its regions, and is worth running before any live attempt.
  Note that `findPath` snapping to within five tiles is a weaker claim than
  `walkResilient(radius: 2)` actually arriving — a wide blocker whose only open side faces
  away satisfies the first and never the second.
- **A flood over the baked graph merges components the player cannot really connect.**
  Any door edge the walker can click but not *pay* — a guarded gate, a toll — makes two
  regions look like one. Watch Tower's design concluded a gold bar was unnecessary for
  exactly this reason, and the opposite was true.

Three engine behaviours bit this quest hard enough to be worth stating once:

- **An op that opens a dialogue does so a tick later.** Driving it immediately makes
  `talkThrough` find nothing open and start a *fresh* conversation with the same NPC —
  which lands in a dead-end line, or at an aggressive NPC gets you attacked. Wait for
  `ChatDialog.isOpen()` first, then drive what is already there.
- **Colour tags displace punctuation.** Stripping `@dbl@` leaves a space where it stood,
  so `"potion@dbl@."` normalises to `"potion ."`. Journal needles must not span a tag
  boundary next to a mark.
- **`ownsInventory: true` opts the quest out of the engine's food provisioning**, so a
  `sustain` block declares foods that nothing ever withdraws. Source food yourself.
- **Nobody is called `Shop keeper`.** A shop belongs to a named NPC through
  `param=owned_shop` in the engine's `.npc` config, and `Shop.open()` matches the display
  name. Read the owner out of the configs; a guide will not tell you.
- **A tool that is merely absent produces no refusal.** Mining without a pickaxe is not
  an error — the rock simply does not respond, and the step retries until the watchdog
  parks it. Anything a step needs but does not consume has to be sourced explicitly.

Shilo Village added three more, each of which cost a live run:

- **A region the walker cannot reach is a nav-data problem, not a walker one.** The
  Ah Za Rhoon mound and Rashiliyia's tomb sit in a 6,193-tile jungle whose only links
  to the mainland are two Agility shortcuts that `derive-doors` cannot see. Four
  curated `transports.json` edges fixed what no amount of quest code could.
- **A journal that renders nothing is not a journal that says "not started".** At
  `found_snake_weed` while the unidentified herb is held, Jungle Potion's journal
  writes no line at all, and every other `found_` stage writes the *previous* stage's
  "go and pick it" line. When a held item is unambiguous evidence of progress, let it
  outrank the journal instead of trying to parse a state that was never written.
- **A door that refuses the key that opens it is a `useOn`, not an `Open`.** Rashiliyia's
  tomb exit answers "The door seems to be locked!" to anyone *carrying* the bone key.
  Read the `oplocu` handler before assuming an op exists for what you want.
- **Not every box is a chat box.** A scroll body built with `if_settext` is a *main*
  modal: dialogue drivers cannot see it, and while it is up every journal read comes back
  empty — which reads as "stage unavailable" and parks the quest one step later. Close it
  with `actions.closeModal()`, the same way `readProgress` does.

Two habits fall out of the tool lesson, and both cost hours here:

- **Seed a stage test with only what that stage produces, never with its tools.** Every
  Watch Tower stage-10 test handed the bot a pickaxe, so all of them passed and the
  quest still could not mine. Only the uncheated run found it.
- **Guarding a requirement by location inverts it.** "Skip the pickaxe check inside the
  enclave, because one cannot be fetched from there" describes exactly the state that
  must walk back out. Source before entering, and let the pocket-escape handle the rest.

## See also

- [Manual index](README.md)
- [World-walking](NAV.md) — how quest steps get anywhere
- [Clue scrolls](CLUES.md) — the same snapshot-driven pattern, applied to trails
- [Scripting API](API.md) — the surface quest modules are written against
