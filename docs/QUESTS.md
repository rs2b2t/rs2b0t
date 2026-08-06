[Manual](README.md) › Quests

# Quests

A quest is **data**, not a script. Each one is a `QuestModule` whose `decide()`
inspects a snapshot of the world and returns the single next step; a shared engine
executes that step and asks again. Adding a quest means adding a module, not writing
another bot.

## Contents

- [The shape of a quest](#the-shape-of-a-quest)
- [Quest state](#quest-state)
  - [What the client can see](#what-the-client-can-see)
  - [Why not varps](#why-not-varps)
  - [How modules should read progress](#how-modules-should-read-progress)
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
    warnReadiness?: () => string | null;      // soft: untested combat / power level
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

**State is read from the quest list colour, the opened journal text, and held
items. Never from untransmitted quest varps.**

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
    journal: QuestStatus;        // notStarted | inProgress | complete | unknown
    inv: Map<string, number>;
    invIds?: ReadonlyMap<number, number>;
    worn: Set<string>;
    wornIds?: ReadonlySet<number>;
    noProgress: number;
    bankCoins: number;
    stage?: number;              // exact journal stage from module.readStage()
    progress?: QuestProgress;    // stage + flags from readProgress()
    bank?: ReadonlyMap<string, number>;
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}
```

### What the client can see

The era protocol does **not** stream mid-quest stage numbers or bitfields to
the client for almost every quest. What actually lands in the bot process:

| Signal | API | On the wire | Granularity |
|---|---|---|---|
| List colour | `Quests.status(name)` | `IF_SETCOLOUR` on the quest-tab name (red / yellow / green) | **three-way only**: not started / in progress / complete |
| Quest points | `Quests.points()` | transmitted varp `qp` (index 101) | total QP |
| Journal body | `Quests.journal(name)` | server builds text and **`if_openmain`** the scroll when you click the name | full stage narrative — **opens the log (the flash)** |
| Inventory / worn | snapshot `inv` / `worn` | normal inv sync | item oracles |
| Game messages | `GameMessages` | chat lines | last-action confirmation (ephemeral) |
| Scene | locs / npcs | usual scene | doors, levers, rocks, NPCs |

Server-side, `send_quest_progress` only recolours the quest-list entry and may
focus the tab. `update_questlist` (login) recomputes colours from **server**
`%varp`s. Neither pushes stage integers or journal lines into a persistent
client field.

Journal text is built only when the player opens a quest: the engine runs
`if_button,questlist:…`, fills `questjournal_scroll` with `if_settext`, and
opens that main modal. There is no side-tab mirror of that body. That is why
`readStage` / `readProgress` flash the log — they are reading the only durable
client view of mid-progress.

### Why not varps

`reader.varp(i)` / `Game` var access reflect `client.var[]`, filled only by
`VARP_SMALL` / `VARP_LARGE` / `VARP_SYNC`. Content marks those with
`transmit=yes`. **Typical quest progress varps do not:**

| Example | Content | Transmitted? |
|---|---|---|
| `cookquest`, `zanaris`, `waterfall_quest` | `scope=perm` only | **no** |
| `elemental_workshop_bits` (id 299), watchtower bits | `scope=perm` only | **no** |
| `prince_keystatus` | `scope=perm`, no transmit | **no** (docs: do not branch on it) |
| `qp` | `transmit=yes` | **yes** — total points only |
| Rare UI/progress (e.g. some TBWT / still vars) | `transmit=yes` | **yes** — exceptions, not the rule |

A non-transmitted index reads as **0**, which is indistinguishable from “never
started.” Branching on it is not “cheating the journal” — it is reading silence.
That is why the rule is absolute for normal quest progress: **never treat
`reader.varp` as stage.**

A clean `Quests.bits()`-style API would need **Content** to set `transmit=yes`
on the progress varp(s), then a thin client wrapper. Client-only code cannot
invent server-only state.

### How modules should read progress

Prefer oracles that do not open the log:

1. **Held / worn / bank items** (ids when names collide).
2. **Game messages** after an action (“water wheel starting up”, “already fixed”).
3. **Scene behaviour** (valve locked ⇒ water already running; do not re-pull).
4. **`Quests.status`** for coarse gates (started vs done).
5. **`Quests.journal` via `readStage` / `readProgress`** only when nothing else
   distinguishes the branch.

When the stage number alone cannot say where a quest is — which of three tribes
are satisfied, which words have been learned, how many monsters remain — a module
implements `readProgress()` instead of `readStage()` and returns named flags
alongside the stage. They arrive on the snapshot as `snap.progress`, so
`decide()` stays a pure function; `hasFlag` and `flagValue` in
[`engine/types.ts`](../src/bot/quests/engine/types.ts) read them.
[`defs/watchtower/journal.ts`](../src/bot/quests/defs/watchtower/journal.ts) is
the worked example. Opening the journal every decide tick is correct but
expensive; cache or re-read only when inventory / coarse status / a confirmed
message changes if you need fewer flashes.

The name maps remain convenient for ordinary items. Use the ID maps for objects
whose display names collide. A `withdraw` item can include `id`, and a `deposit`
step can include `keepIds`; ID keeps are combined with, rather than replacing,
the step's name-based `keep` list.

Two consequences worth stating plainly:

- **`'unknown'` is not `'notStarted'`.** The quest list is not loaded for the
  first moments after login, and treating that as "not started" restarts a
  finished quest. Every module returns `wait` for it.
- Progress *within* a started quest is inferred from its rendered journal stage
  and what the player is carrying. A held quest item is part of the state
  machine's memory, which is why a step that hands an item over and a step that
  acquires it must never both be reachable from the same snapshot.

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

### Official reqs vs bot-proven floors (polish goal)

`data/quests.ts` lists **server / wiki gates** only (e.g. Elemental Workshop mining
20). Many quests still need combat, food, or gear the server does not gate.

**Polish iteration goal for every quest with non-required combat (or similar):**

1. Green mid-quest loop (often max stats + ideal kit) — proves the script path.
2. Realistic bank-seed + **official skill mins**, then probe **bare-minimum** for
   non-required stats (combat, etc.) via headed harness — lower until red, keep
   the lowest green profile in module constants.
3. Record failed floors too (so we do not re-probe known deaths forever).
4. Later: **power-level tactics** (safespot / kite / skip-fight vs melee) chosen
   from the same snapshot skills, so low accounts still clear without grinding.

Optional `warnReadiness(): string | null` runs **once** when a quest becomes the
active runner. Soft advisory if the account is below a proven floor (or if no
low floor is proven yet) — not a queue block.

Elemental Workshop reference constants
([`supplies.ts`](../src/bot/quests/defs/elementalworkshop/supplies.ts)):

| Constant | Role |
|---|---|
| `EW_OFFICIAL_SKILLS` | Server gates (20 mining / smithing / crafting) |
| `EW_PROVEN_COMBAT_FLOOR` | Lowest green headed combat (**50/50/40/50**, bank seed) |
| `EW_FAILED_COMBAT` | Known red (40/40/25/40 died on Water elemental) |
| `EW_PROBE_COMBAT` | Next lower search (45/45/30/45) |

Harness recipes and bank seeding: [Testing](TESTING.md#seeding-inventory-vs-bank).

## Adding a quest

1. Add the record to [`data/quests.ts`](../src/bot/quests/data/quests.ts) — id, name,
   quest points, requirements, items.
2. Write `defs/<quest>.ts`: anchors as `Tile` constants, `NpcStop`s with `prefer`
   lists, `gather` functions for anything the bot must fetch, and a `decide()` that
   reads only the snapshot.
3. Register it in [`defs/index.ts`](../src/bot/quests/defs/index.ts).
4. Add a unit test for `decide()` — it is a pure function, so every branch is
   testable without a client. See [`test/quests/`](../test/quests/).
5. Polish non-required stats: ideal smoke first, then realistic bank-seed, then
   **lower combat (etc.) until red** — store proven floor + failed floor + next
   probe in the module; wire `warnReadiness`; update [Testing](TESTING.md) when
   a headed run moves the floor. Later add power-level tactics (safespots, …).
6. Prefer bank-first realistic harnesses (`givebank` / `bank:` seeds) before
   claiming the quest is done — inv+max only proves the mid-quest loop.

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

Prince Ali Rescue added four more, and each is a class of bug rather than a one-off:

- **A quest-internal varp the client cannot read is not state you may branch on.**
  `prince_keystatus` decides whether Osman forges the key or refuses, and it is
  `scope=perm` with no `transmit`. The durable answer is a step that *acts and then reads
  the result*: talk to Osman, and treat a print still in the pack as proof the key was
  already forged, so the same step goes on to collect it from Leela. Counters and
  `noProgress` tie-breaks are not a substitute — they turn a crash window into a wedge
  that holds an unusable print forever.
- **Display names collide, and the collisions are exactly the quest items.** `plainwig`
  and `blondwig` both render `Wig`, and only the blond one satisfies any check. `Beer`,
  `Pot of flour`, `Logs` and `Coins` each have a twin too. Wherever two objects share a
  name, `snap.invIds` is the only correct lookup — `snap.inv` silently accepts the wrong
  one and every downstream check passes for the wrong reason.
- **An NPC you delete can come back inside the window you needed.** Lady Keli respawns
  100 ticks after `npc_del`, five tiles from the cell door, and the door refuses the key
  while she is within ten. Anything whose respawn timer is shorter than the work it
  unblocks has to run as one step, and its stage has to be re-entrant with the
  consumable needed to redo it — hence two ropes.
- **A stage the quest can only reach one way is an oracle.** Leela promotes to stage 30
  only while the key is in the pack, so from 30 on the key provably existed: forging is
  impossible, a missing key is unambiguously a loss to be re-issued, and every clay leg
  can go quiet. Reading a stage for what it *proves* replaces the varp you cannot see.

Dragon Slayer added four, all of which came from reading the engine rather than a guide:

- **A locked door baked as an ordinary edge is worse than no edge at all.** Every one of
  Melzar's seven coloured doors advertises `op1=Open` and answers "This door is securely
  locked", so `derive-doors` baked all seven. The navigator then routed straight at them
  and the walker looped forever a tile short. They belong in `SCRIPT_REFUSED`, with the
  quest driving them by key — as do the Oracle's magic door, Elvarg's gates and Crandor's
  secret wall.
- **A key is not a door opener.** `open_and_close_door` `p_teleport`s the player through
  and deletes the key in the same script. "Open it, then walk through" never happens, so
  a leg is done when the key is *gone* and the player has *landed on the far side* —
  neither test alone is enough.
- **Derive the route from the collision pack, not from a guide.** Melzar's Maze is eleven
  unclimbable ladders, four floors and three decoy doors per colour. BFSing the baked
  exit masks with each colour as a gate produced the exact chain in seconds, and it is
  not the route any wiki describes.
- **Same-named monsters are the rule inside a quest area, not the exception.** Six
  ordinary `giantrat1` share the display name "Giant rat" with the one
  `dragonslayer_giantrat` that drops the red key, and every other floor is stocked the
  same way. Worse, they are aggressive: `Game.inCombat()` reads *our* health bar, so a
  decoy landing one hit parks a "wait until out of combat" guard indefinitely. Target by
  npc id, and wait only on being locked onto the right one.

Two habits about verification, both of which cost live runs here:

- **A live harness runs the built bundle, not your source.** The page loads
  `botclient.js`; until it is rebuilt and copied into the engine's `public/bot/`, every
  run silently exercises the old code. A `--stage 100` jump that kept buying redberries
  looked like a journal-parsing bug for three runs and was a stale bundle. Harnesses
  should build and deploy themselves rather than trust the operator.
- **Before believing a "this is broken server-side" note, check its date against the nav
  fixes.** `sheepshearer` avoided the Lumbridge spinning wheel for a fortnight on the
  strength of a probe taken six days before the multi-level loc-snapshot settle landed.
  A level-1 loc queried in the tick after a climb reads back empty, and blank is not
  absent — the wheel works.

Family Crest added four more, and the first two generalise past this quest:

- **A door whose lock is a lever is still a locked door.** The perfect-gold mine's four
  doors each advertise `op1=Open` and answer "This door is locked" unless their own
  combination of three levers is set — and the combination that opens one shuts another.
  They belong in `SCRIPT_REFUSED` alongside Melzar's, with the module driving the chain.
  BFS over the collision pack with `(tile, lever-bits)` as the node produced the exact
  thirteen-leg route; a flood with the doors removed then named the four rooms they cut
  the mine into, which is what makes the walk between legs a plain walk.
- **A lever's model is not its state.** `loc_change(loc, 500)` reverts the lever to its
  down model after five minutes and leaves the varp bit set, so a lever that *looks* down
  may well be up. Reading the loc is reading a lie; the "The lever is now up." line is
  emitted exactly when the bit changes. Set levers by pulling until the message confirms
  the state you want, rather than reading and deciding.
- **An unread bank is not an empty bank.** `snap.bankIds` is empty until something opens
  a booth, so "is the pickaxe banked?" answers *no* on the first decide tick and the
  fallback shop wins. The bot walked from Ardougne to Nurmof in the Dwarven Mine for a
  pickaxe that was in the bank. Any bank-then-shop chain has to check `snap.bankKnown`
  and scan first — `fromBank` does; a bare `banked(...) > 0` test does not.
- **`Sustain` only runs where a step calls it.** The hook the host installs is pumped by
  `Sustain.run()`, not by the tick loop, so a custom step that fights for two minutes —
  the hellhounds by the gold rocks, or Chronozon — never eats unless it pumps the hook
  itself. Every long loop in a `custom` step needs one.
- **A stage past a hand-over is a claim the item exists; when it does not, look for the
  re-issue path before writing a `wait`.** Holding one fragment at stage 10 and none of
  the others parked forever on "waiting to combine". Both brothers have a "I have lost
  the piece you gave me." branch that hands theirs over again — gated on *neither* the
  pack nor the bank holding it, which is also why nothing in the module ever banks one.
- **A safespot is derivable, and "walkable" is not enough.** For a size-N melee NPC:
  BFS the placements it can slide between, take every tile those placements touch, and
  the walkable remainder is the safespot set — *intersected with the component you can
  actually reach*, because the passage that looks ideal on the map is often a sealed
  island, and `exitMask` does not cross door edges, so a flood seeded outside a gate
  never sees the room behind it. Whether a shut gate blocks the cast is not something
  the configs answer, so the module proves the spot at runtime — three casts that do
  not land, or the demon's body coming within two tiles, and it drops back to the fight
  it already knows works. **Not** "did my hitpoints drop": that cannot tell the demon
  from something else hitting you, and using it as the signal made the bot abandon a
  spot that was working.
- **Geometry is necessary, not sufficient — check what else patrols there.** Chronozon's
  search returns several tiles the demon provably cannot reach. The east alcove is one,
  and it sits three tiles from poison spiders with `wanderrange=10`, so the bot is safe
  from the demon and chewed on the whole fight. The south end of the chamber is eleven
  away, past their limit. Read the neighbours' `wanderrange` / `maxrange`, not just the
  target's footprint.
- **Auto-retaliate is what breaks a safespot.** Anything that hits you — a spider,
  a stray skeleton — draws a swing back, and the swing walks the character off the
  tile the whole plan depends on. `Game.setAutoRetaliate(false)` for the duration,
  restored in a `finally` so a thrown step does not leave it off.
- **Preparation must stop at the door.** A `decide()` that tops up food or potions
  re-runs every tick, so eating three sharks mid-fight drops the pack under the
  threshold and the bot walks out of the dungeon to re-bank. Gate the whole
  provisioning block on being outside the fight area; once through, the fight owns
  what it is carrying.
- **Poison is invisible to the client.** `%poison` is `scope=perm` with no transmit, so
  it reads 0 whether or not you are dying of it. The oracle is the "You have been
  poisoned!" line, and antipoison sets `%poison = min(%poison, -5)` — a cure *and*
  about ninety seconds of immunity, so drinking on arrival is worth a dose.
- **Bank the coin float before the wilderness.** Nothing past the last shop needs coin,
  and a death there drops it. The top-up has to be conditional on something still being
  unbought, or it and the deposit take turns undoing each other.

## See also

- [Manual index](README.md)
- [World-walking](NAV.md) — how quest steps get anywhere
- [Clue scrolls](CLUES.md) — the same snapshot-driven pattern, applied to trails
- [Scripting API](API.md) — the surface quest modules are written against
