// docs/QUESTS.md
import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { heldId, settleScene, useOnLoc } from '../../exec/prompts.js';
import {
    BONES_OBJ,
    FEED_OBJ,
    FURNACE_LOC,
    FURNACE_STAND,
    GATE_INSIDE,
    GATE_LOC,
    GATE_OUTSIDE,
    PEN,
    PROD,
    PROD_OBJ,
    PROD_SPAWN,
    inBox,
    sheepName,
    type SheepIndex
} from './areas.js';
import { clearRefusal, herdToPen, sheepInPen } from './herd.js';

const CROSS_MS = 8000;

const insidePen = (): boolean => inBox(PEN, Game.tile());

function gateLoc(): Loc | null {
    return Locs.query().where(loc => GATE_LOC.includes(loc.id)).action('Open').within(4).nearest();
}

// Why: the gate is a `p_teleport`, not a walk — the character lands on the far side and the loc reverts three ticks later, so where it is standing is the only oracle.
async function crossGate(stand: Tile, want: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (want()) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    if (want()) {
        return true;
    }
    const gate = gateLoc();
    if (!gate) {
        log(`sheepherder: no enclosure gate at (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await gate.interact('Open'))) {
        return false;
    }
    const crossed = await Execution.delayUntil(want, CROSS_MS);
    await clearRefusal();
    if (crossed) {
        await settleScene();
    }
    return crossed;
}

export const enterPen = (log: (m: string) => void): Promise<boolean> =>
    crossGate(GATE_OUTSIDE, insidePen, log);

export const leavePen = (log: (m: string) => void): Promise<boolean> =>
    crossGate(GATE_INSIDE, () => !insidePen(), log);

/** The barn prod, which sits inside the enclosure and so is fetched wearing the suit. */
export async function fetchProd(log: (m: string) => void): Promise<boolean> {
    if (heldId(PROD_OBJ) === 0) {
        if (!(await enterPen(log))) {
            return false;
        }
        if (!(await Traversal.walkResilient(PROD_SPAWN, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const prod = GroundItems.query().where(item => item.id === PROD_OBJ).within(8).nearest();
        if (!prod) {
            log(`sheepherder: no ${PROD} on the barn floor at (${PROD_SPAWN.x},${PROD_SPAWN.z})`);
            return false;
        }
        if (!(await prod.interact('Take'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => heldId(PROD_OBJ) > 0, 8000))) {
            return false;
        }
    }
    return Equipment.equip(PROD);
}

async function takeBones(n: SheepIndex, log: (m: string) => void): Promise<boolean> {
    const id = BONES_OBJ[n];
    for (let attempt = 0; attempt < 4; attempt++) {
        if (heldId(id) > 0) {
            return true;
        }
        const bones = GroundItems.query().where(item => item.id === id).within(12).nearest();
        if (!bones) {
            await Execution.delayTicks(2);
            continue;
        }
        const at = bones.tile();
        if (!(await Traversal.walkResilient(at, { radius: 1, attempts: 2, timeoutMs: 30_000, log }))) {
            continue;
        }
        const still = GroundItems.query().where(item => item.id === id).within(12).nearest();
        if (still && (await still.interact('Take'))) {
            await Execution.delayUntil(() => heldId(id) > 0, 6000);
        }
    }
    if (heldId(id) > 0) {
        return true;
    }
    log(`sheepherder: no remains from ${sheepName(n)} to pick up`);
    return false;
}

// Why: the sheep in the enclosure is a 150-tick `npc_add`, so the kill runs in the same leg as the herd — a decide() round trip in between loses the sheep and buys another forty pushes.
async function poison(n: SheepIndex, log: (m: string) => void): Promise<boolean> {
    if (heldId(BONES_OBJ[n]) > 0) {
        return true;
    }
    if (!(await enterPen(log))) {
        return false;
    }
    const sheep = sheepInPen(n);
    if (!sheep) {
        return takeBones(n, log);
    }
    if (!(await Traversal.walkResilient(sheep.tile(), { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const feed = Inventory.items().find(item => item.id === FEED_OBJ);
    const target = sheepInPen(n);
    if (!feed || !target) {
        log(`sheepherder: no feed in the pack or ${sheepName(n)} gone from the enclosure`);
        return false;
    }
    log(`sheepherder: feeding the poison to ${sheepName(n)}`);
    if (!(await feed.useOn(target))) {
        return false;
    }
    await Execution.delayUntil(
        () => GroundItems.query().where(item => item.id === BONES_OBJ[n]).within(12).nearest() !== null,
        10_000
    );
    await clearRefusal();
    return takeBones(n, log);
}

/** Herd this sheep in, kill it, and leave holding its remains. */
export async function penAndKill(n: SheepIndex, log: (m: string) => void): Promise<boolean> {
    if (heldId(BONES_OBJ[n]) > 0) {
        return true;
    }
    if (GroundItems.query().where(item => item.id === BONES_OBJ[n]).within(12).nearest()) {
        return takeBones(n, log);
    }
    if (sheepInPen(n)) {
        return poison(n, log);
    }
    if (insidePen() && !(await leavePen(log))) {
        return false;
    }
    if (!(await herdToPen(n, log))) {
        return false;
    }
    return poison(n, log);
}

// Why: `incinerate_bones` deletes the remains, waits three ticks and only then sets the quest bits, so a leg that stops when the pack empties hands `decide()` a journal that still reads "now I must kill it" — and the queue herds the same sheep again.

/** The chat line `incinerate_bones` prints once the bits are set. */
const BURNT = /remains burn to dust/i;

export async function incinerate(n: SheepIndex, log: (m: string) => void): Promise<boolean> {
    if (!(await enterPen(log))) {
        return false;
    }
    log(`sheepherder: burning the remains of ${sheepName(n)}`);
    const mark = GameMessages.mark();
    const burnt = await useOnLoc(
        BONES_OBJ[n],
        { name: 'Furnace', near: FURNACE_STAND, id: FURNACE_LOC, within: 6 },
        [],
        () => heldId(BONES_OBJ[n]) === 0,
        log
    );
    if (!burnt) {
        return false;
    }
    return Execution.delayUntil(() => GameMessages.sawSince(mark, BURNT), 8000);
}
