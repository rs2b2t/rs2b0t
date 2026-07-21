# Priest in Peril Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Priest in Peril as the 13th implemented quest in the AIO questbot, live-verified end-to-end (journal complete + Wolfbane).

**Architecture:** Approach A from the approved spec (`docs/superpowers/specs/2026-07-20-priest-in-peril-design.md`): a pure `decide()` router over journal colour + held-item names, with re-entrant custom legs doing obj-id reads and stage-oracle probes (door/gate openability). Two small primitives extensions (`LadderHop.open`, exported `driveDialog`) support the closed north trapdoor and the loc-initiated knock dialogue.

**Tech Stack:** TypeScript (browser bot runtime), bun:test for pure tests, Playwright smoke harness (`tools/aio-quest-test.ts`) against the local engine on :8890.

## Global Constraints

- Repo conventions: `bun test` for units; `npx tsc --noEmit -p tsconfig.json` (exit 0); `npx eslint <changed files>` clean.
- The user commits concurrently on this checkout: NEVER `git add -A`/`git add .` — always add exact file paths.
- Every server-content constant in the def carries a `file:line` citation against `~/code/rs2b2t-content` (fleet convention, see `demonslayer.ts`).
- Quest defs are self-contained modules; live I/O lives in custom legs; `decide()` stays pure (no client imports at decide time beyond types).
- Obj ids (pack/obj.pack): Golden key 2944, Iron key 2945, murky water 2953, blessed water 2954 (both murky+blessed DISPLAY "Bucket of water"), Wolfbane 2952. NPC config ids (pack/npc.pack): monk-with-key 1046, guard dog 1047. Display names: "King Roald", "Drezel" (×2 NPCs), "Monk of Zamorak" (×3 variants), "Temple guardian", "Rune essence".
- Never issue the Monument `Study` op (op1) — it randomizes the monument layout (`monuments.rs2:9-17`).

---

### Task 1: Primitives — `LadderHop.open` + exported `driveDialog`

**Files:**
- Modify: `src/bot/quests/exec/primitives.ts` (LadderHop interface ~line 48; `hopLadder` ~line 82; `talkThrough` ~line 254)
- Test: `src/bot/quests/exec/primitives.test.ts` (existing pure tests must stay green; no new unit tests — both changes are live-I/O, verified by typecheck + the Task 5 smoke, the `steps.ts` convention)

**Interfaces:**
- Consumes: existing `Locs`/`Execution`/`ChatDialog` APIs already imported by the file.
- Produces: `LadderHop` gains optional `open?: string`. New export `driveDialog(prefer: string[], log: (m: string) => void): Promise<boolean>` — drives an ALREADY-OPEN dialogue (continues + preferred options) to close; returns `!ChatDialog.isOpen()`. `talkThrough` behavior unchanged (it now delegates its loop to `driveDialog`).

- [ ] **Step 1: Extend the `LadderHop` interface**

In `src/bot/quests/exec/primitives.ts`, replace the `LadderHop` interface:

```ts
/** A scripted ladder/stair crossing the nav graph doesn't know. `stand` is a
 *  pack-walkable tile beside the loc on the NEAR side; `arrive` the scripted
 *  far-side landing (from the engine's ladders.rs2). */
export interface LadderHop {
    stand: Tile;
    locName: string;
    op: string;
    arrive: Tile;
    /** Opener for closed trapdoor-style locs: when no `locName` loc offers `op`
     *  at the stand (a closed Trapdoor has only 'Open'), interact this op on the
     *  same-named loc first, then re-query for `op` — trapdoors.rs2:2-12 swaps
     *  trapdoor -> trapdoor_open (Climb-down) via loc_change, and the open state
     *  reverts after ~500 ticks, so most arrivals find it closed again. */
    open?: string;
}
```

- [ ] **Step 2: Teach `hopLadder` to open first**

Replace the loc lookup at the top of `hopLadder` (keep the interact/delayUntil tail unchanged):

```ts
async function hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean> {
    const find = (op: string) => Locs.query().name(hop.locName).action(op).where(l => l.tile().distanceTo(hop.stand) <= 3).nearest();
    let ladder = find(hop.op);
    if (!ladder && hop.open !== undefined) {
        const closed = find(hop.open);
        if (closed && (await closed.interact(hop.open))) {
            // loc_change lands a tick or two later — re-query with one retry
            await Execution.delayTicks(2);
            ladder = find(hop.op);
            if (!ladder) {
                await Execution.delayTicks(2);
                ladder = find(hop.op);
            }
        }
    }
    if (!ladder) {
        log(`no '${hop.locName}' offering '${hop.op}' near (${hop.stand.x},${hop.stand.z})`);
        return false;
    }
    if (!(await ladder.interact(hop.op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === hop.arrive.level && hop.arrive.distanceTo(t) <= 5;
    }, 8000);
}
```

- [ ] **Step 3: Factor `talkThrough`'s loop into exported `driveDialog`**

The dialogue-driving loop (the `for (let i = 0; i < 120; i++)` block through `return !ChatDialog.isOpen();`) moves verbatim into a new exported function placed directly above `talkThrough`; `talkThrough` keeps its NPC-open preamble and ends with a delegation. Result:

```ts
/**
 * Drive an ALREADY-OPEN dialogue to completion: continue through pages, pick
 * preferred options (fallback = LAST option + a warning — the last option is
 * the safe decline everywhere in this era's dialogues), tolerating the ~1.5s
 * page-transition gaps server-scripted branches introduce. Exported for
 * loc-initiated dialogues (e.g. Priest in Peril's temple-door Knock-at), which
 * open a chat without any NPC Talk-to.
 */
export async function driveDialog(prefer: string[], log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false; // let the runtime clear the random event
        }
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 1500))) {
                break; // genuinely closed
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`WARN: no preferred option in [${opts.join(' | ')}] — taking the last`);
            }
            await ChatDialog.chooseOption(pick ?? opts[opts.length - 1]);
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}
```

and `talkThrough` becomes (docstring unchanged, body preamble unchanged):

```ts
export async function talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!ChatDialog.isOpen()) {
        const npc = Npcs.query().name(npcName).action('Talk-to').nearest();
        if (!npc) {
            log(`no '${npcName}' nearby to talk to`);
            return false;
        }
        if (!(await npc.interact('Talk-to'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 8000))) {
            log(`'${npcName}' never opened a dialogue`);
            return false;
        }
    }
    return driveDialog(prefer, log);
}
```

Keep `talkThrough`'s original explanatory comment about page-transition gaps with `driveDialog` (it documents the loop, which now lives there).

- [ ] **Step 4: Verify — tests, typecheck, lint**

Run: `bun test src/bot/quests/exec/primitives.test.ts src/bot/quests/exec/gotoNpc.test.ts`
Expected: PASS (pure tests untouched by the refactor).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx eslint src/bot/quests/exec/primitives.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/bot/quests/exec/primitives.ts
git commit -m "feat(quests): LadderHop open-op for closed trapdoors + exported driveDialog"
```

---

### Task 2: The quest def — `priestperil.ts` + record edit + registration + decide() tests

**Files:**
- Create: `src/bot/quests/defs/priestperil.ts`
- Create: `src/bot/quests/defs/priestperil.test.ts`
- Modify: `src/bot/quests/data/quests.ts:551-561` (the existing `priestperil` record)
- Modify: `src/bot/quests/defs/index.ts` (import + append to `QUEST_DEFS`)

**Interfaces:**
- Consumes: Task 1's `driveDialog(prefer, log)` and `LadderHop.open`; `walkWithHops(dest, radius, hops, log)`, `gotoNpc(stop, hops, log)`, `talkThrough(name, prefer, log)`, `isUnderground({z})` from `../exec/primitives.js`; `executeStep(step, hops, log)` from `../exec/steps.js`; `gpShort(snap, estGp)` from `../engine/provisioning.js`; `inEssMine(x, z)` from `../../scripts/EssMinerLogic.js`.
- Produces: `export function decide(snap: QuestSnapshot): QuestStep` and `export const priestperil: QuestModule` consumed by `defs/index.ts`.

- [ ] **Step 1: Write the failing routing test**

Create `src/bot/quests/defs/priestperil.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';
import { decide } from './priestperil.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items.map(n => [n, 1])),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

const routed = (s: ReturnType<typeof decide>): string =>
    s.kind === 'talk' ? `talk:${s.stop.npc}` : s.kind === 'custom' ? `custom:${s.name}` : s.kind;

describe('priestperil decide', () => {
    test('journal drives the ends', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(routed(decide(snap('notStarted')))).toBe('talk:King Roald');
    });

    test('held items route the mid-quest legs (exact full-name keys)', () => {
        expect(routed(decide(snap('inProgress', ['golden key'])))).toBe('custom:monument key swap');
        expect(routed(decide(snap('inProgress', ['iron key'])))).toBe('custom:unlock the cell');
        // murky AND blessed water both display "Bucket of water" (priestperil.obj) —
        // the water leg disambiguates by obj id 2953/2954 at runtime
        expect(routed(decide(snap('inProgress', ['bucket of water'])))).toBe('custom:water chain');
        expect(routed(decide(snap('inProgress', ['rune essence'])))).toBe('custom:essence delivery');
    });

    test('key priority: a golden key outranks essence in the pack', () => {
        expect(routed(decide(snap('inProgress', ['rune essence', 'golden key'])))).toBe('custom:monument key swap');
    });

    test('a plain empty Bucket does NOT trigger the water chain (exact-key get)', () => {
        expect(routed(decide(snap('inProgress', ['bucket'])))).toBe('custom:locate phase');
    });

    test('empty-handed inProgress runs the stage-oracle spine', () => {
        expect(routed(decide(snap('inProgress')))).toBe('custom:locate phase');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bot/quests/defs/priestperil.test.ts`
Expected: FAIL — cannot resolve `./priestperil.js`.

- [ ] **Step 3: Create the def — header, imports, constants, helpers**

Create `src/bot/quests/defs/priestperil.ts` with this first chunk:

```ts
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import Tile from '../../api/Tile.js';
import { inEssMine } from '../../scripts/EssMinerLogic.js';
import { driveDialog, gotoNpc, isUnderground, talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Priest in Peril — content facts traced from ~/code/rs2b2t-content (cited
// inline as file:line): scripts/quests/quest_priestperil/*, scripts/areas/
// area_mausoleum/scripts/*, scripts/areas/area_varrock/scripts/king_roald.rs2.
// Coordinates are map-derived (maps/m53_54.jm2 + m53_154.jm2 NPC/LOC sections
// decoded to absolute tiles), ids from pack/{npc,obj}.pack.
//
// FLOW (varp `priestperil`, INVISIBLE to the snapshot — only journal colour +
// inventory + world probes reach decide()):
//   0  notStarted        -> talk King Roald, "Sure." starts it (king_roald.rs2:52-60)
//   1  started           -> Knock-at the temple door, agree to kill the dog
//                           (temple_doors.rs2:24-33 -> :92-97 sets 2)
//   2  agree_to_kill_dog -> kill the Temple guardian in the crypt — attackable
//                           ONLY at this stage (temple_guardian.rs2:16-24);
//                           the death hook sets 3 (:1-13)
//   3  killed_dog        -> talk Roald; his tirade SETS 4 (king_roald.rs2:76-88)
//   4  return_to_drezel  -> temple front door now opens (temple_doors.rs2:9-16);
//                           Talk-through the cell door, "Tell me anyway." + "Yes."
//                           sets 5 (trapped_drezel.rs2:76-142)
//   5  find_drezel_key   -> Gate 1 opens (gates.rs2:1-13); kill Monk of Zamorak
//                           id 1046 — the ONLY variant whose death drops the
//                           Golden key, and only while stage < 6 (evil_monks.rs2:44-49);
//                           swap it at a Monument for the Iron key (monuments.rs2:64-77)
//   6  unlocked_drezel   -> Iron key used on the cell door, key consumed
//                           (trapped_drezel.rs2:47-58); water chain: Bucket on the
//                           Well -> murky (well.rs2:9-16), murky on Drezel ->
//                           blessed (trapped_drezel.rs2:145-152)
//   7  poured            -> blessed on the Coffin (vampire_coffin.rs2:10-19);
//                           talk cell Drezel -> 8 (trapped_drezel.rs2:22-27)
//   8  meet_in_mausoleum -> Gate 2 opens (gates.rs2:4-13); talk mausoleum Drezel
//                           (a SECOND "Drezel" npc, id 1049) -> 10 (drezel.rs2:22-47)
//   10..59 bring_essence -> talking while holding UNNOTED Rune essence hands ALL
//                           of it, +1 varp each (drezel.rs2:96-118); noted rejected (:89-94)
//   60 complete          -> Wolfbane + 1406 Prayer xp (priestperil.rs2:8-11); one
//                           more talk with Wolfbane held sets 61 = holy-barrier
//                           access to Morytania (drezel.rs2:137-152)
//
// STAGE ORACLES (varps never reach the client): temple front door OPENS at >=4,
// Gate 1 at >=5, cell door at >=6, Gate 2 at >=8 — probed via tryOpen(). The
// murky/blessed name collision ("Bucket of water" for both, priestperil.obj)
// forces obj-id reads, the Demon Slayer key pattern.

// --- Obj/npc ids (pack/obj.pack, pack/npc.pack) --------------------------------
const GOLDEN_KEY_ID = 2944;  // pipkey_gold "Golden key"
const IRON_KEY_ID = 2945;    // pipkey_iron "Iron key"
const MURKY_ID = 2953;       // bucket_murkywater — displays "Bucket of water"
const BLESSED_ID = 2954;     // bucket_blessedwater — displays "Bucket of water"
const MONK3_NPC_ID = 1046;   // priestperilevilmonk3, the lvl-30 key-dropper

// --- NPC stops -----------------------------------------------------------------
// King Roald — Varrock palace ground floor, m50_54 "0 22 20: 648" -> (3222,3476,0).
// notStarted multi2's LAST option is "No, that sounds boring." (abandon), so the
// prefer MUST match "Sure." (king_roald.rs2:59); every other stage branch is
// option-free and just plays through.
const ROALD: NpcStop = { npc: 'King Roald', anchor: new Tile(3222, 3476, 0), leash: 6, prefer: ['Sure.'] };
// Cell Drezel (priestperiltrappedmonk) — temple LEVEL 2, m53_54 "2 25 33: 1048"
// -> (3417,3489,2), wanders the cell (range 5). Reached via the baked spiral
// stairs (3417,3484 L0->L1) + ladder (3410,3485 L1->L2); his talks are option-free.
const DREZEL_CELL: NpcStop = { npc: 'Drezel', anchor: new Tile(3416, 3489, 2), leash: 3, prefer: [] };
// Mausoleum Drezel (priestperiltrappedmonk2) — m53_154 "0 48 39: 1049" ->
// (3440,9895,0), behind Gate 2; wander range 1. Option-free dialogues.
const DREZEL_MAUS: NpcStop = { npc: 'Drezel', anchor: new Tile(3439, 9895, 0), leash: 4, prefer: [] };

// --- Tiles (map-derived) ---------------------------------------------------------
const TEMPLE_DOOR = new Tile(3408, 3488, 0);      // Large door leaves (3408,3488)+(3408,3489), west face
const TEMPLE_DOOR_OUT = new Tile(3406, 3488, 0);  // exterior stand west of the doors
const TEMPLE_LOBBY = new Tile(3412, 3487, 0);     // ground floor, monk-3 spawns (3411,3489)/(3415,3485)
const DOG_TILE = new Tile(3405, 9902, 0);         // Temple guardian spawn, m53_154 "0 13 46: 1047"
const GATE1 = new Tile(3405, 9895, 0);            // pip_underground_door1, opens at stage >= 5
const GATE2 = new Tile(3431, 9897, 0);            // pip_underground_door2, opens at stage >= 8
const WELL = new Tile(3423, 9890, 0);             // priestperil_well, monument-room centre (no ops — use-item only)
const CELL_DOOR = new Tile(3415, 3489, 2);        // pip_prisondoor, temple L2
const CELL_DOOR_STAND = new Tile(3414, 3489, 2);  // outside-the-cell stand beside the door
const COFFIN = new Tile(3413, 3486, 2);           // priestperil_coffin_noanim, L2
const AUBURY_TILE = new Tile(3253, 3402, 0);      // Aubury's rune shop (EssMiner.ts:45)
const VARROCK_EAST_BANK = new Tile(3253, 3420, 0); // essence-run bank (EssMiner's bank)
// Varrock general store (the Demon Slayer bucket shop, demonslayer.ts:147-149).
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

// The 7 Monuments (m53_154 LOC section; probe-verified 2026-07-20). Try order
// starts at grave_base3 (3428,9890): with the layout NEVER Studied the seed bits
// are 0 and content_id(grave) = (grave*17 % 7)+1 puts the Iron key (content 3,
// monument_graves_models) at grave 3. The full loop is seed-proof anyway —
// exactly one grave swaps for ANY seed (17 ≡ 3 mod 7, coprime), wrong graves
// no-op (monuments.rs2:64-77 falls through to displaymessage).
const MONUMENTS: Tile[] = [
    new Tile(3428, 9890, 0), // grave_base3 — the un-Studied-layout key grave
    new Tile(3416, 9890, 0), // grave_base1
    new Tile(3423, 9895, 0), // grave_base2
    new Tile(3423, 9884, 0), // grave_base4
    new Tile(3427, 9894, 0), // grave_base5
    new Tile(3427, 9885, 0), // grave_base6
    new Tile(3418, 9894, 0)  // grave_base7
];

// Surface <-> crypt crossings. The north trapdoor (3405,3507) is Open ->
// Climb-down (+6400 telejump, trapdoors.rs2:2-12) and re-closes ~500 ticks
// after opening — hence `open`. The exit is a plain cellar ladder
// (ladders.rs2:87-94, -6400).
const HOPS: LadderHop[] = [
    { stand: new Tile(3405, 3506, 0), locName: 'Trapdoor', op: 'Climb-down', open: 'Open', arrive: new Tile(3405, 9907, 0) },
    { stand: new Tile(3405, 9907, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3405, 3507, 0) }
];

// Knock-at chain (temple_doors.rs2:24-33): multi4 -> "Roald sent me to check on
// Drezel." -> multi2 -> "Sure." sets stage 2 (:92-97). Fallbacks are safe
// declines, but only the prefers advance.
const KNOCK_PREFER = ['Roald sent me to check on Drezel.', 'Sure.'];
// Cell-door Talk-through story (trapped_drezel.rs2:76-142): "Tell me anyway."
// then "Yes." set stage 5 via drezel_yes_of_course (:120-133).
const CELL_STORY_PREFER = ['Tell me anyway.', 'Yes.'];

const QUEST_NAME = 'Priest in Peril';
const ESSENCE_NEEDED = 50; // ^priestperil_end_bring_essence(60) - begin(10)

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
/** Live pack check by OBJ ID — the only way to tell murky from blessed water
 *  (name-collided) or confirm a specific key. Pack-only; none are wearable. */
const heldId = (id: number): boolean => Inventory.items().some(i => i.id === id);
const freeSlots = (): number => 28 - Inventory.items().length;
const journalComplete = (): boolean => Quests.status(QUEST_NAME) === 'complete';

/** walkWithHops with this quest's hops baked in. */
async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return walkWithHops(dest, radius, HOPS, log);
}

/**
 * Probe-and-open a stage-gated leaf near `near` (level-aware): walk up, and if a
 * closed leaf (one still offering 'Open') is there, open it and wait for the
 * closed leaf to vanish. TRUE = no closed leaf remains (either already open or
 * we just opened it) — i.e. the stage gate is PASSED. FALSE = still closed
 * after the attempt (the server printed its locked mes) or the walk failed.
 * Side-effect-free when locked, so it doubles as the stage oracle. Also needed
 * because the baked pack records these quest doors as walkable (no door edges),
 * so walkResilient alone would wedge on the live closed leaf.
 */
async function tryOpen(name: string, near: Tile, log: (m: string) => void): Promise<boolean> {
    const closed = () => Locs.query().name(name).action('Open')
        .where(l => l.tile().level === near.level && l.tile().distanceTo(near) <= 2).nearest();
    const here = Game.tile();
    if (here && here.level === near.level && near.distanceTo(here) <= 10 && closed() === null) {
        return true; // in view and no closed leaf — already open
    }
    if (!(await walkTo(near, 3, log))) {
        return false;
    }
    const leaf = closed();
    if (!leaf) {
        return true;
    }
    if (!(await leaf.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => closed() === null, 4000);
}

/** Attack a target npc and wait for its death (scene-slot despawn), the
 *  grindBones/Witch's House kill idiom. FALSE also covers "the server refused
 *  the attack" (stage-gated dog) — combat never started within 5s. */
async function killTarget(npc: { index: number; interact(op: string): Promise<boolean> }, name: RegExp, log: (m: string) => void): Promise<boolean> {
    const idx = npc.index;
    if (!(await npc.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat(), 5000))) {
        return false; // refused (stage gate) or click lost — caller re-decides
    }
    return Execution.delayUntil(() => !Npcs.all().some(n => n.index === idx && name.test(n.name ?? '')), 90_000);
}
```

- [ ] **Step 4: Append the early-phase + spine legs**

Append to `src/bot/quests/defs/priestperil.ts`:

```ts
// --- Legs (re-entrant customs; false = re-enter; all live reads inside) --------

/**
 * Stages 1-3, entered when the temple front door refuses to open. One pass
 * covers the whole early chain on a fresh start: knock+agree (1->2), kill the
 * dog (2->3), report to Roald (3->4). Every piece is idempotent at the other
 * stages (temple_doors.rs2 re-knock branches are flavour; Roald at 2 just
 * encourages), so a restart anywhere in 1..3 self-heals.
 */
async function earlyLeg(log: (m: string) => void): Promise<boolean> {
    // 1. Knock-at + drive the agree chain (loc-initiated dialog -> driveDialog).
    if (!(await walkTo(TEMPLE_DOOR_OUT, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Large door').action('Knock-at').within(6).nearest();
    if (door && (await door.interact('Knock-at'))) {
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000)) {
            await driveDialog(KNOCK_PREFER, log);
        }
    }
    // 2. The dog — attackable ONLY at stage 2 (temple_guardian.rs2:16-24); a
    //    refusal (no combat within 5s) just falls through to Roald.
    if (!(await walkTo(DOG_TILE, 8, log))) {
        return false;
    }
    const dog = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
    if (dog) {
        await killTarget(dog, /temple guardian/i, log);
    }
    // 3. Roald: at stage 3 his tirade SETS 4 (king_roald.rs2:76-88); harmless at 2.
    if (!(await gotoNpc(ROALD, HOPS, log))) {
        return false;
    }
    await talkThrough('King Roald', ROALD.prefer, log);
    return false; // re-probe the temple door next pass
}

/**
 * Stage 4->5: Talk-through the cell door and drive Drezel's story (the "Tell me
 * anyway." + "Yes." chain sets find_drezel_key, trapped_drezel.rs2:76-142). At
 * stage 5 the same op is a short idempotent hint (:60-74).
 */
async function cellStoryLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(CELL_DOOR_STAND, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Cell door').action('Talk-through').within(5).nearest();
    if (!door) {
        log('priestperil: no Cell door offering Talk-through at the cell');
        return false;
    }
    if (!(await door.interact('Talk-through'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000))) {
        return false;
    }
    return driveDialog(CELL_STORY_PREFER, log);
}

/**
 * Stage 5 monk hunt: only npc id 1046 drops the Golden key (evil_monks.rs2:44-49
 * — the other two "Monk of Zamorak" variants share the name but never drop it),
 * and only while stage < 6. Loot-first so a ~3-min floor despawn can't eat a
 * key we already earned.
 */
async function monkHuntLeg(log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().name('Golden key').within(16).nearest();
    if (drop) {
        if (!(await drop.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(GOLDEN_KEY_ID), 6000);
        return false; // decide() re-routes to the monument swap
    }
    if (!(await walkTo(TEMPLE_LOBBY, 3, log))) {
        return false;
    }
    const monk = Npcs.query().where(n => n.id === MONK3_NPC_ID).action('Attack').within(14).nearest();
    if (!monk) {
        log('priestperil: no key-dropping Monk of Zamorak (id 1046) in the temple — waiting on respawn');
        await Execution.delayTicks(4);
        return false;
    }
    await killTarget(monk, /monk of zamorak/i, log);
    return false; // next pass loots the drop
}

/**
 * The stage-locating spine (decide()'s default): probes the stage oracles from
 * wherever the bot is and drives the phase they reveal. Probe order is
 * position-aware so restarts don't ping-pong across the map.
 */
async function spineLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (isUnderground(here)) {
        // Dog first — it lives right at the crypt landing.
        const dog = Npcs.query().name('Temple guardian').action('Attack').within(20).nearest();
        if (dog) {
            if (!(await walkTo(DOG_TILE, 6, log))) {
                return false;
            }
            const d = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
            if (d && (await killTarget(d, /temple guardian/i, log))) {
                // Dead -> stage 3; report to Roald in the same pass (3->4).
                if (!(await gotoNpc(ROALD, HOPS, log))) {
                    return false;
                }
                await talkThrough('King Roald', ROALD.prefer, log);
                return false;
            }
            // refusal: not stage 2 — fall through to the gate probes
        }
        // Gate 1 (>=5) then Gate 2 (>=8) — Gate 1 MUST be probed first: the
        // baked pack walks straight through its wall, so a Gate-2 walk from
        // here would wedge on the live closed Gate 1.
        if (await tryOpen('Gate', GATE1, log)) {
            if (await tryOpen('Gate', GATE2, log)) {
                return essenceLeg(log);
            }
        }
        // Underground with no underground work left -> surface phases pending.
        await walkTo(TEMPLE_DOOR_OUT, 3, log);
        return false;
    }

    // Surface. Temple front door opening = stage >= 4 (temple_doors.rs2:9-16).
    if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
        return earlyLeg(log);
    }
    // Stage >= 4. Cell door opening = stage >= 6 -> water chain / essence.
    if (await tryOpen('Cell door', CELL_DOOR, log)) {
        return waterLeg(log);
    }
    // Stage 4..5: the story sets 5; then hunt the key monk.
    await cellStoryLeg(log);
    return monkHuntLeg(log);
}
```

- [ ] **Step 5: Append the monument, unlock, and water legs**

Append to `src/bot/quests/defs/priestperil.ts`:

```ts
/**
 * Golden key held: swap it for the Iron key at the one monument that takes it.
 * Guard: the key can drop at stage 4 (the drop gate is merely < 6,
 * evil_monks.rs2:45), but Gate 1 needs stage >= 5 — if it refuses, drive the
 * cell-door story first (4->5) and re-enter.
 */
async function monumentLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await tryOpen('Gate', GATE1, log))) {
        if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
            return false;
        }
        await cellStoryLeg(log);
        return false;
    }
    for (const t of MONUMENTS) {
        if (heldId(IRON_KEY_ID)) {
            break;
        }
        const key = Inventory.items().find(i => i.id === GOLDEN_KEY_ID);
        if (!key) {
            return false; // lost mid-loop (shouldn't happen) — re-decide
        }
        if (!(await walkTo(t, 2, log))) {
            return false;
        }
        const monument = Locs.query().name('Monument')
            .where(l => l.tile().distanceTo(t) <= 2).nearest();
        if (!monument) {
            log(`priestperil: no Monument at (${t.x},${t.z})`);
            continue;
        }
        // NEVER 'Study' (op1) — it randomizes the layout (monuments.rs2:9-17).
        // Wrong graves no-op; the right one swaps gold -> iron (:64-77).
        if (!(await key.useOn(monument))) {
            continue;
        }
        await Execution.delayTicks(3);
    }
    if (heldId(IRON_KEY_ID)) {
        log('priestperil: iron key obtained');
    } else {
        // Iron-key grave already swapped with the key since lost — the one
        // non-self-healing server edge (monuments.rs2:65-68). Loud, not silent:
        // the watchdog parks the quest on repeated no-progress.
        log('priestperil: golden key fit NO monument — iron key already claimed and lost?');
    }
    return false;
}

/** Iron key held: unlock the cell (stage -> 6, key consumed,
 *  trapped_drezel.rs2:47-58). The golden key does NOT fit (:59-62). */
async function unlockLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here !== null && !isUnderground(here)) {
        // Entering the temple crosses the front door — open the leaf first
        // (baked-walkable, live-locked).
        if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
            return false;
        }
    }
    if (!(await walkTo(CELL_DOOR_STAND, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Cell door')
        .where(l => l.tile().level === 2 && l.tile().distanceTo(CELL_DOOR) <= 2).nearest();
    const key = Inventory.items().find(i => i.id === IRON_KEY_ID);
    if (!door || !key) {
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    await Execution.delayUntil(() => !heldId(IRON_KEY_ID), 8000);
    return false; // cell now openable — the spine hands off to waterLeg
}

/**
 * The stage 6->8 water chain, obj-id-driven (murky 2953 / blessed 2954 both
 * display "Bucket of water"). Order matters: pour, bless, fill, then the
 * probe-talk — so a restart holding any water state resumes mid-chain, and the
 * stage-7 "empty Bucket back in the pack" state goes through the TALK (7->8)
 * before any re-fill can loop the chain.
 */
async function waterLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    const enterTemple = async (): Promise<boolean> => {
        if (!isUnderground(here)) {
            if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
                return false;
            }
        }
        return true;
    };

    // 1. Blessed -> pour on the Coffin (stage -> 7, vampire_coffin.rs2:10-19),
    //    then talk Drezel in the same pass (7 -> 8, trapped_drezel.rs2:22-27).
    if (heldId(BLESSED_ID)) {
        if (!(await enterTemple())) {
            return false;
        }
        if (!(await walkTo(COFFIN, 3, log))) {
            return false;
        }
        const coffin = Locs.query().name('Coffin')
            .where(l => l.tile().level === 2).within(8).nearest();
        const water = Inventory.items().find(i => i.id === BLESSED_ID);
        if (!coffin || !water) {
            return false;
        }
        if (!(await water.useOn(coffin))) {
            return false;
        }
        await Execution.delayUntil(() => !heldId(BLESSED_ID), 8000);
        if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
            return false;
        }
        if (await gotoNpc(DREZEL_CELL, HOPS, log)) {
            await talkThrough('Drezel', [], log); // 7 -> 8
        }
        return false;
    }

    // 2. Murky -> blessed: use it on the cell Drezel (opnpcu,
    //    trapped_drezel.rs2:56-58 -> drezel_bless_water :145-152).
    if (heldId(MURKY_ID)) {
        if (!(await enterTemple())) {
            return false;
        }
        if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
            return false;
        }
        if (!(await walkTo(DREZEL_CELL.anchor, 2, log))) {
            return false;
        }
        const drezel = Npcs.query().name('Drezel').within(8).nearest();
        const water = Inventory.items().find(i => i.id === MURKY_ID);
        if (!drezel || !water) {
            return false;
        }
        if (!(await water.useOn(drezel))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(BLESSED_ID), 10_000);
        return false;
    }

    // 3. No water held. Talk the cell Drezel FIRST: at 6 it's a hint, at 7 it
    //    SETS 8, at >=8 it's harmless — this is what disambiguates "empty
    //    Bucket because not filled yet" from "empty Bucket because poured".
    if (!(await enterTemple())) {
        return false;
    }
    if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
        return false;
    }
    if (await gotoNpc(DREZEL_CELL, HOPS, log)) {
        await talkThrough('Drezel', [], log);
    }
    // Stage >= 8? Both gates open -> essence phase (Gate 1 first — see spine).
    if ((await tryOpen('Gate', GATE1, log)) && (await tryOpen('Gate', GATE2, log))) {
        return essenceLeg(log);
    }
    // Still stage 6 -> we need murky water: fill the Bucket at the Well.
    if (Inventory.contains('Bucket')) {
        if (!(await tryOpen('Gate', GATE1, log))) {
            return false;
        }
        if (!(await walkTo(WELL, 2, log))) {
            return false;
        }
        const well = Locs.query().name('Well').within(6).nearest();
        const bucket = Inventory.first('Bucket');
        if (!well || !bucket) {
            return false;
        }
        if (!(await bucket.useOn(well))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(MURKY_ID), 8000);
        return false;
    }
    // Bucket lost mid-quest: bank first, shop fallback (the Demon Slayer
    // buyOrWait idiom — Varrock general store sells them for ~15 gp).
    if (!(await executeStep({ kind: 'withdraw', items: [{ name: 'Bucket', qty: 1 }] }, HOPS, log)) || !Inventory.contains('Bucket')) {
        await executeStep({ kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 }, HOPS, log);
    }
    return false;
}
```

- [ ] **Step 6: Append the essence leg, decide(), and the module export**

Append to `src/bot/quests/defs/priestperil.ts`:

```ts
/**
 * Stages 8-60 (+61): deliver 50 unnoted Rune essence to the mausoleum Drezel.
 * Unstackable — two ~25-slot trips; "how many are left" is server-side only,
 * so the loop just repeats withdraw -> deliver until the journal flips. Bank
 * dry -> mine the shortfall via Aubury's teleport (user decision: the AIO
 * stays fresh-account self-sufficient).
 */
async function essenceLeg(log: (m: string) => void): Promise<boolean> {
    if (journalComplete()) {
        // Final flourish: one more talk with Wolfbane held sets stage 61 —
        // holy-barrier access (drezel.rs2:137-152). decide() returns done on
        // the next loop, so this MUST happen before we report success.
        if (Inventory.contains('Wolfbane') && (await gotoNpc(DREZEL_MAUS, HOPS, log))) {
            await talkThrough('Drezel', [], log);
        }
        return true;
    }

    if (Inventory.count('Rune essence') > 0) {
        // Deliver: Gate 1 then Gate 2 (both baked-walkable/live-locked), then
        // talk. At stage 8 the first talk is the damage-assessment chain (-> 10,
        // drezel.rs2:22-47); with essence held at >=10 the talk hands ALL of it
        // (:60-77 -> :96-118). Two talks on a stage-8 entry — the re-entry loop
        // covers it.
        if (!(await tryOpen('Gate', GATE1, log))) {
            log('priestperil: Gate 1 refused during essence phase — mis-signalled essence in pack?');
            return false;
        }
        if (!(await tryOpen('Gate', GATE2, log))) {
            return false;
        }
        if (!(await gotoNpc(DREZEL_MAUS, HOPS, log))) {
            return false;
        }
        const before = Inventory.count('Rune essence');
        await talkThrough('Drezel', [], log);
        await Execution.delayUntil(() => Inventory.count('Rune essence') < before || journalComplete(), 10_000);
        if (journalComplete()) {
            await Execution.delayTicks(2); // let the Wolfbane inv_add land
            if (Inventory.contains('Wolfbane') && (await gotoNpc(DREZEL_MAUS, HOPS, log))) {
                await talkThrough('Drezel', [], log); // stage 61
            }
            return true;
        }
        return false;
    }

    // Restock. Surface first — the withdraw executor's walk has no hops.
    if (!(await walkTo(TEMPLE_DOOR_OUT, 3, log))) {
        return false;
    }
    const want = Math.min(Math.max(freeSlots() - 1, 1), ESSENCE_NEEDED); // keep a slot free for the Wolfbane hand-in
    if (await executeStep({ kind: 'withdraw', items: [{ name: 'Rune essence', qty: want }], bank: VARROCK_EAST_BANK }, HOPS, log)) {
        if (Inventory.count('Rune essence') > 0) {
            return false; // loaded — next pass delivers
        }
    }
    return mineEssence(log);
}

/**
 * Bank had no essence: mine it. Aubury op 'Teleport' (quest-gated on Rune
 * Mysteries, which the AIO run order guarantees) -> one Mine click auto-repeats
 * until the pack fills (EssMiner.ts:216-242) -> Portal out (lands at Aubury's).
 * Needs a pickaxe: pack/worn first, then a small bank cascade.
 */
async function mineEssence(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    if (!inEssMine(here.x, here.z)) {
        if (!/pickaxe/i.test(Inventory.items().map(i => i.name ?? '').join(' '))) {
            for (const pick of ['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']) {
                if (await executeStep({ kind: 'withdraw', items: [{ name: pick, qty: 1 }], bank: VARROCK_EAST_BANK }, HOPS, log)) {
                    if (Inventory.items().some(i => /pickaxe/i.test(i.name ?? ''))) {
                        break;
                    }
                }
            }
            if (!Inventory.items().some(i => /pickaxe/i.test(i.name ?? ''))) {
                log('priestperil: no pickaxe held or banked — cannot mine essence (park)');
                return false;
            }
        }
        if (!(await walkTo(AUBURY_TILE, 4, log))) {
            return false;
        }
        const aubury = Npcs.query().name('Aubury').action('Teleport').within(10).nearest();
        if (!aubury) {
            log('priestperil: no Aubury offering Teleport near his shop');
            return false;
        }
        if (!(await aubury.interact('Teleport'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && inEssMine(t.x, t.z);
        }, 12_000))) {
            return false;
        }
    }
    if (freeSlots() > 0) {
        const rock = Locs.query().name('Rune Essence').action('Mine').nearest();
        if (!rock) {
            log('priestperil: no Rune Essence crystal visible in the mine');
            return false;
        }
        if (!(await rock.interact('Mine'))) {
            return false;
        }
        // One click auto-repeats server-side; wait for a full pack, tolerating
        // a stall (re-enter re-clicks — EssMiner's STALL_MS idiom).
        await Execution.delayUntil(() => freeSlots() === 0, 180_000);
        return false;
    }
    const portal = Locs.query().name('Portal').action('Use').nearest();
    if (!portal) {
        return false;
    }
    await portal.interact('Use');
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && !inEssMine(t.x, t.z);
    }, 12_000);
    return false; // pack full of essence — next pass delivers
}

// --- Provisioning gather (bank-first; called when the bank lacks the Bucket) ---

/** Buy the Bucket at the Varrock general store, or park with a named wait when
 *  even the bank can't cover ~15 gp (the Prince Ali buyOrWait invariant). */
function gatherBucket(snap: QuestSnapshot): QuestStep {
    if (gpShort(snap, 15) > 0) {
        return { kind: 'wait', reason: 'need ~15 gp for a Bucket' };
    }
    return { kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 };
}

// --- Pure quest brain ----------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: ROALD };
    }
    // Held-item routing (exact lowercased full-name keys). Keys outrank water
    // outrank essence: each earlier item is consumed producing the later state.
    if (has(snap, 'golden key')) {
        return { kind: 'custom', name: 'monument key swap', run: monumentLeg };
    }
    if (has(snap, 'iron key')) {
        return { kind: 'custom', name: 'unlock the cell', run: unlockLeg };
    }
    if (has(snap, 'bucket of water')) {
        return { kind: 'custom', name: 'water chain', run: waterLeg };
    }
    if (has(snap, 'rune essence')) {
        return { kind: 'custom', name: 'essence delivery', run: essenceLeg };
    }
    return { kind: 'custom', name: 'locate phase', run: spineLeg };
}

export const priestperil: QuestModule = {
    record: QUESTS.find(r => r.id === 'priestperil')!,
    // Two lvl-30 fights (dog 45 HP, monk 25 HP) + aggressive lvl-17/22/30 monks
    // in the temple lobby — carried food + the AIOQuester eat hook cover it.
    food: 12,
    grind: ['temple guardian', 'monk of zamorak'],
    // Between-quest deposit KEEP list: quest-internal items a mid-quest restart
    // may hold. 'bucket' substring-covers empty/murky/blessed; 'pickaxe' keeps
    // the essence-mining tool; keys and Wolfbane are quest-critical.
    tools: ['golden key', 'iron key', 'bucket', 'wolfbane', 'rune essence', 'pickaxe', 'coins'],
    gather: {
        'bucket': gatherBucket
    },
    hops: HOPS,
    decide
};
```

- [ ] **Step 7: Edit the quest record**

In `src/bot/quests/data/quests.ts`, replace the existing `priestperil` record (lines 551-561):

```ts
    {
        // source: priestperil_journal.rs2:6-7 no skill/qp gate (only "defeat a level 30 enemy" combat note);
        // NO quest gate server-side (king_roald.rs2:38-40 — F2P can even start it), but essence mining
        // rides Aubury's Rune Mysteries-gated teleport, satisfied by AIO run order. quest.constant:109 QP.
        // 50 Rune essence is deliberately NOT a record item: unstackable, it can never fit the 28-slot
        // pack at provisioning time — the def's essence phase banks/mines it in ~25-per-trip legs.
        id: 'priestperil',
        name: 'Priest in Peril',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Bucket', qty: 1, kind: 'acquirable' }
        ]
    },
```

- [ ] **Step 8: Register the module**

In `src/bot/quests/defs/index.ts`, add the import and append to the run order (PiP is the longest quest — run order is cheapest/most-certain first):

```ts
import { priestperil } from './priestperil.js';
```

```ts
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, sheepshearer, restlessghost, cooksassistant, romeojuliet, princeali, waterfall, goblindiplomacy, demonslayer, witchshouse, merlinscrystal, priestperil];
```

- [ ] **Step 9: Run the tests**

Run: `bun test src/bot/quests/defs/priestperil.test.ts`
Expected: PASS (5 tests).

Run: `bun test`
Expected: full suite green (no regressions — the record edit changes only the priestperil entry).

- [ ] **Step 10: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx eslint src/bot/quests/defs/priestperil.ts src/bot/quests/defs/priestperil.test.ts src/bot/quests/defs/index.ts src/bot/quests/data/quests.ts`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src/bot/quests/defs/priestperil.ts src/bot/quests/defs/priestperil.test.ts src/bot/quests/defs/index.ts src/bot/quests/data/quests.ts
git commit -m "feat(quests): Priest in Peril module — stage-oracle spine, id-aware water chain, essence delivery"
```

---

### Task 3: Offline verification — nav probe + static audit

**Files:**
- Modify: `tools/nav/pip-probe.ts` (exists, untracked — add the crypt↔bank leg, then commit)

**Interfaces:**
- Consumes: `PathFinder` + baked `out/collision.lcnav.gz` + doors/transports/stairs JSON (as `tools/nav/route-probe.ts` does).
- Produces: a committed one-shot probe documenting PiP route coverage.

- [ ] **Step 1: Add the essence-run leg to the probe**

In `tools/nav/pip-probe.ts`, append to the `legs` array:

```ts
    { name: 'crypt landing -> Varrock East bank (essence-run exit, graph-only)', from: { x: 3405, z: 9907, level: 0 }, to: { x: 3253, z: 3420, level: 0 } }
```

- [ ] **Step 2: Run the probe**

Run: `bun tools/nav/pip-probe.ts`
Expected: the eight previously-verified legs print `OK` (Varrock→temple, temple→north trapdoor, temple L0→L2, crypt→dog, crypt→monuments, monuments→Drezel, exterior→interior, bank→temple). `temple INTERIOR -> east trapdoor` prints `FAIL` (documented: unreachable in the pack; essence runs route through the crypt). The new crypt→bank leg is INFORMATIONAL: `OK` means the baked graph carries a crypt exit edge; `FAIL` is acceptable because `essenceLeg` walks to the surface via the hops BEFORE issuing any withdraw step — record the result in the tool's comment either way.

- [ ] **Step 3: Static audit of the def against server content**

For each constant in `priestperil.ts`, re-open the cited source and confirm verbatim (this is a read-only checklist, no tooling):
- Stage numbers ↔ `quest_priestperil/configs/priestperil.constant`
- Dialogue prefers ↔ `temple_doors.rs2:24-33,92-97` ("Roald sent me to check on Drezel." / "Sure."), `trapped_drezel.rs2:76-142` ("Tell me anyway." / "Yes."), `king_roald.rs2:52-60` ("Sure.")
- Ids ↔ `pack/obj.pack` (2944/2945/2953/2954), `pack/npc.pack` (1046/1047/1048/1049)
- Tiles ↔ `maps/m53_54.jm2`, `maps/m53_154.jm2`, `maps/m50_54.jm2` decodes (probe outputs recorded in the spec)
- Loc names/ops ↔ `quest_priestperil/configs/priestperil.loc` ('Large door' Open/Knock-at, 'Cell door' Open/Talk-through, 'Gate' Open, 'Coffin' Open, 'Well' op-less, 'Monument' Study/Take-from, 'Trapdoor' Open→Climb-down)

Expected: zero drift. Any mismatch is a def bug — fix the def, not the citation.

- [ ] **Step 4: Commit the probe**

```bash
git add tools/nav/pip-probe.ts
git commit -m "test(nav): Priest in Peril offline route-coverage probe"
```

---

### Task 4: Live smoke — end-to-end PASS (the done bar)

**Files:**
- None expected beyond fixes to Task 1-2 files discovered live (each fix gets its own commit).

**Interfaces:**
- Consumes: `tools/aio-quest-test.ts` (generic AIO smoke: fresh mainland account, injected quest queue, per-quest journal-complete polling), local engine on :8890, `tools/deploy-local.sh`.
- Produces: a live PASS log — `runemysteries` then `priestperil` complete, QP +2, Wolfbane obtained.

- [ ] **Step 1: Deploy the local build**

Run from the MAIN checkout (the smoke deploy clobbers the live build, and a pack-less worktree kills the navigator silently — both prior live-wall lessons):

```bash
sh tools/deploy-local.sh
```

Engine must be up on :8890 (`bun run b0t` context). Expected: deploy completes without error.

- [ ] **Step 2: Leg-debug pass (cheat-assisted, NOT the acceptance run)**

Debug individual legs by fast-forwarding a throwaway account — the harness accepts cheats via its give/stats CSVs, and stage jumps use the engine's dev cheats from the browser console (`::setvar priestperil N`, `::~item pipkey_gold 1`, `::tele 3406 3488 0` — after ::tele, relog or walk a screen to rebuild the scene; headless ::tele leaves it stale). Suggested checkpoints:

```bash
# early phase (stages 0-4): fresh account, watch knock/dog/Roald
bun tools/aio-quest-test.ts http://localhost:8890 aqpipA priestperil 40 trout:30 attack:45,strength:45,defence:45,hitpoints:45
```

Then stage-jump checks (run the same command against accounts prepped via console cheats): `::setvar priestperil 5` + `::~item pipkey_gold 1` exercises monumentLeg→unlockLeg; `::setvar priestperil 6` exercises the water chain; `::setvar priestperil 8` + banked essence exercises delivery; `::setvar priestperil 10` + empty bank + `bronze_pickaxe:1` in give-csv exercises the mining fallback.

Expected: each leg drives its stage transition; fix and commit anything that wedges (exact-path adds only).

- [ ] **Step 3: The acceptance run — uncheated, start to finish**

```bash
bun tools/aio-quest-test.ts http://localhost:8890 aqpip1 runemysteries,priestperil 120 trout:30,bronze_pickaxe:1 attack:45,strength:45,defence:45,hitpoints:45
```

`runemysteries` rides along because the essence-mine teleport requires it and a fresh smoke account has an empty bank (this also exercises the mining fallback — the full fresh-account path). The give/stats CSVs are ACCOUNT PREP (the mainland cheat skips the tutorial starter kit), not bot cheats.

Expected output: the harness reports each quest's journal reaching `complete`, quest points +2 total, and the run finishing inside the 120-min budget. Verify Wolfbane: the post-run inventory/bank dump (or a `::getvar priestperil` console check showing 61) confirms the barrier talk landed.

- [ ] **Step 4: Iterate to green**

Any live wedge: diagnose against the leg logs (`priestperil:` prefixed), fix, `git add <exact files>`, commit with a `fix(quests):` message naming the wedge, redeploy (Step 1), re-run. The done bar is one clean uncheated acceptance pass.

- [ ] **Step 5: Final verification + commit any straggler docs**

Run: `bun test` → green; `npx tsc --noEmit -p tsconfig.json` → exit 0.

```bash
git log --oneline -5   # confirm the feat/fix commits are in place
```

Expected: working tree clean of OUR files (the user's concurrent work untouched).

---

## Self-Review (performed at plan time)

**Spec coverage:** decide() router + four legs (Task 2 steps 3-6) ↔ spec Architecture; hop `open` + driveDialog (Task 1) ↔ spec primitives change; record edit (Task 2 step 7) ↔ spec record edit; monument no-Study invariant ↔ Global Constraints + monumentLeg comment; essence two-trip delivery + mining fallback (essenceLeg/mineEssence) ↔ spec user decisions; stage-61 barrier talk ↔ essenceLeg completion path; locked-leaf opening ↔ tryOpen used before every gated crossing; nav probe ↔ Task 3; live done bar ↔ Task 4. Gap check: spec's `tools` list lacked 'pickaxe' — the plan adds it (mining tool must survive the between-quest deposit); spec updated implicitly, noted here.

**Placeholder scan:** none — every step carries complete code or exact commands.

**Type consistency:** `driveDialog(prefer, log)` (Task 1) matches its Task 2 call sites; `LadderHop.open` optional field matches HOPS usage; `gatherBucket` returns `QuestStep` matching `QuestModule.gather`; leg signatures all `(log) => Promise<boolean>` matching `{ kind: 'custom' }` steps; `killTarget`'s structural param matches what `Npcs.query().nearest()` returns (`index` + `interact`).
