// docs/reference/quest-primitives.md
import { reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Reach } from '../../../walking/Reach.js';
import type Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { pickPreferred } from './primitives.js';

export function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

export function locNear(name: string, op: string, within = 12): Loc | null {
    return Locs.query().name(name).action(op).within(within).nearest();
}

// Why: every loc query is empty for about a tick after a level or region change, so a blank scene is not evidence that a loc is absent.

/**
 * Wait out the window after a level or region change before trusting a loc query.
 * @see docs/decisions/level-change-lag.md
 */
export async function settleScene(): Promise<void> {
    await Execution.delayTicks(2);
}

// Why: loc prompts routinely put the refusal first — "I don't think so, it might animate and attack me!" — so falling through to an unmatched option is worse than stopping.

/**
 * Like `driveDialog`, but abandons rather than guessing.
 * @see docs/reference/quest-primitives.md
 */
export async function driveChoice(prefer: string[], log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`no preferred option in [${opts.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}

// Why: a scripted chain leaves gaps where nothing is open yet, and `driveChoice` alone returns at the first of them, leaving the rest of the chain unrun.

/**
 * Keep answering prompts until the goal lands.
 * @see docs/reference/quest-primitives.md
 */
export async function driveUntil(
    expect: () => boolean,
    prefer: string[],
    log: (m: string) => void,
    ms = 30_000
): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (expect()) {
            return true;
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            if (!(await driveChoice(prefer, log))) {
                return expect();
            }
        }
        await Execution.delayTicks(1);
    }
    return expect();
}

export interface DoorCrossing {
    /** Exact loc id of the shut door. */
    id: number;
    /** The tile to click it from, on the side being left. */
    stand: Tile;
    /** True once the character stands past the door — a component test, never a distance one. */
    isFar: () => boolean;
    /** Options to take when the door raises a dialogue instead of opening. */
    prefer?: readonly string[];
    /** Display name of the loc, when it is not a Door. */
    name?: string;
    /** Op the loc advertises, when it is not Open. */
    op?: string;
    /** Id of the key to use on the loc, for a door whose Open answers "This door is locked". */
    useItem?: number;
    // Why: `~check_axis` reads your side off one coordinate, so an axis door is clicked from its own tile.
    /** How far off the stand counts as arrived. Zero for an axis-tested door. */
    standRadius?: number;
    log: (m: string) => void;
}

const DOOR_MS = 12_000;
// Why: the server runs the door's script a tick after the click, so the dialogue check needs a window.
const DIALOG_MS = 5_000;
// Why: a quest door can be a kingdom away — the Brimhaven crossings are reached from Varrock by ferry,
// and a two-minute budget times out mid-ocean and reports the door as missing.
const DOOR_WALK_MS = 300_000;

// Why: `~open_and_close_door` teleports the actor through and re-shuts in three ticks, so the far side
// is the only proof a crossing landed — and no door can ever be held open for a partner.

/**
 * Cross a quest door that teleports rather than opening.
 * @see docs/reference/quest-primitives.md
 */
export async function crossTeleportDoor(door: DoorCrossing): Promise<boolean> {
    const { id, stand, isFar, log } = door;
    if (isFar()) {
        return true;
    }
    // Why: a `~mesbox` left over from the door's own challenge — "You hear the door being unbarred from
    // inside." — swallows the next Open click with no refusal to say why.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    const radius = door.standRadius ?? 1;
    if (!(await Traversal.walkResilient(stand, { radius, attempts: 3, timeoutMs: DOOR_WALK_MS, log }))) {
        return false;
    }
    const op = door.op ?? 'Open';
    const name = door.name ?? 'Door';
    // Why: `~door_open` swings the loc onto a different tile and id, so the shut id is not what stands
    // there after anyone has opened it — and a sealed pocket has one door, so the actioned neighbour is it.
    const loc = Locs.query().action(op).within(4).where(l => l.id === id).nearest()
        ?? Locs.query().action(op).within(2).where(l => l.name === name).nearest();
    if (!loc) {
        log(`no ${name.toLowerCase()} ${id} offering '${op}' within four tiles of (${stand.x},${stand.z})`);
        return false;
    }
    // Why: a key door's `oploc1` answers "This <name> is locked" and only its `oplocu` opens, so the
    // crossing is a use-item on the leaf rather than a click on its op.
    if (door.useItem !== undefined) {
        const key = Inventory.items().find(item => item.id === door.useItem);
        if (!key) {
            log(`no key ${door.useItem} in the pack for ${name.toLowerCase()} ${id}`);
            return false;
        }
        if (!(await key.useOn(loc))) {
            log(`${name.toLowerCase()} ${id} refused the key`);
            return false;
        }
    } else if (!(await loc.interact(op))) {
        log(`${name.toLowerCase()} ${id} refused the ${op} click`);
        return false;
    }
    // Why: the server runs the door's script a tick after the click lands, so a dialogue check taken
    // straight off `interact` sees nothing and the challenge goes unanswered.
    if (door.prefer) {
        await Execution.delayUntil(() => isFar() || ChatDialog.isOpen() || ChatDialog.canContinue(), DIALOG_MS);
        if (!isFar() && (ChatDialog.isOpen() || ChatDialog.canContinue())) {
            await driveChoice([...door.prefer], log);
        }
    }
    await Execution.delayUntil(isFar, DOOR_MS);
    if (!isFar()) {
        return false;
    }
    await settleScene();
    return true;
}

export interface LocPrompt {
    name: string;
    op: string;
    near: Tile;
    /** Options to take, in order, once the loc opens a prompt. */
    prefer?: string[];
    expect: () => boolean;
    expectMs?: number;
    within?: number;
    /** Exact loc id, when the display name is shared with something else in range. */
    id?: number;
}

/**
 * Walk to a stand, act on a loc, then answer whatever prompt it raised.
 * @see docs/reference/quest-primitives.md
 */
export async function promptLoc(step: LocPrompt, log: (m: string) => void): Promise<boolean> {
    if (step.expect()) {
        return true;
    }
    const status = await Reach.locOp({
        name: step.name,
        op: step.op,
        near: step.near,
        within: step.within,
        id: step.id,
        expect: () => step.expect() || ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    });
    if (status !== 'done') {
        return false;
    }
    return driveUntil(step.expect, step.prefer ?? [], log, step.expectMs ?? 20_000);
}

// Why: quest item chains run through `oplocu`, which no op-based step can express.

/**
 * Use a carried item on a loc, then answer whatever prompt it raised.
 * @see docs/reference/quest-primitives.md
 */
export async function useOnLoc(
    itemId: number,
    loc: { name: string; near: Tile; within?: number; id?: number },
    prefer: string[],
    expect: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(loc.near, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: same-named locs a tile apart are the rule inside a quest area, and `nearest` picks the decoy.
    const target = Locs.query()
        .name(loc.name)
        .where(l => loc.id === undefined || l.id === loc.id)
        .within(loc.within ?? 12)
        .nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!target || !item) {
        log(`no '${loc.name}'${loc.id === undefined ? '' : ` id ${loc.id}`} or no item ${itemId} to use on it near (${loc.near.x},${loc.near.z})`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntil(expect, prefer, log);
}
