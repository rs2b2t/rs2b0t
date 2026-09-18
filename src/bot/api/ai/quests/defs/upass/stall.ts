import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { UPASS } from './journal.js';

// Why: An open journal blocks normal timer traps through `canAccess()`; soft timers still run.
// Why: the walk has to be an op-click. `MoveClickHandler` calls `clearPendingAction()`, which closes the modal, for every move except `opClick`.

const POLL_TICKS = 2;

// Why: The journal blocks op scripts through `canAccess()`; three stable polls confirm the player has stopped beneath it.
const IDLE_POLLS = 3;

function tileNow(): { x: number; z: number; level: number } | null {
    return reader.worldTile();
}

function modalOpen(): boolean {
    return reader.modals().main !== -1;
}

function journalComId(): number {
    return reader.questStatuses().find(q => q.name.toLowerCase() === UPASS.toLowerCase())?.comId ?? -1;
}

/** Send the journal button without waiting; the caller manages timing. */
function pressJournal(): boolean {
    const comId = journalComId();
    return comId !== -1 && actions.ifButton(comId);
}

export async function releaseJournal(): Promise<void> {
    if (modalOpen()) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export interface StalledApproach {
    /** Sends the op-click whose walk carries you across the traps. Any `op*` packet will do. */
    send: () => Promise<boolean>;
    /** What was clicked, for the log. */
    what: string;
    /** True once the walk has carried far enough for the caller's purposes. */
    arrived: () => boolean;
    /** True once the attempt is lost, polled so a fall does not sit the timeout out. */
    abort?: () => boolean;
    /**
     * Leave the modal up on the way out.
     * Why: a chain of these ends each leg on the next stepping stone, which down here is a trap tile, so closing the journal to reopen it a tick later is the only exposure. The next leg's op-click closes it anyway.
     */
    hold?: boolean;
    log: (m: string) => void;
    timeoutMs?: number;
}

export interface StalledWalk extends Omit<StalledApproach, 'send' | 'what'> {
    /** The loc to op-click; walking to it carries you across the traps. */
    find: () => Loc | null;
    op: string;
}

/**
 * Cross timer-trapped ground on an op-click, holding the quest journal open for every step of the walk.
 * Leaves the modal closed; whether the op itself then ran is the caller's `arrived` to decide.
 */
export async function stalledApproach(opts: StalledApproach): Promise<boolean> {
    const { send, what, arrived, log } = opts;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    if (arrived()) {
        return true;
    }
    const from = tileNow();
    if (!(await send())) {
        log(`stall: ${what} would not send`);
        return false;
    }
    // Why: the journal must land in its own tick: a modal opened in the tick `moveClickRequest` settles latches it true and `updateMovement` freezes at the first 8x8 zone boundary because the engine queue can't drain while busy. The press waits on the first step, so the caller stages far enough back to still be on safe ground then.
    const moved = await Execution.delayUntilTicks(() => {
        const now = tileNow();
        return now !== null && from !== null && (now.x !== from.x || now.z !== from.z);
    }, 8);
    if (!moved) {
        // Why: already on the target means no walk and no trap tiles, so wait the op out; a journal here would only hide the script.
        return Execution.delayUntilTicks(arrived, Math.ceil(timeoutMs / 600));
    }
    if (!pressJournal()) {
        log('stall: the quest journal button never sent — traps are live');
        return false;
    }
    try {
        const deadline = performance.now() + timeoutMs;
        let opened = false;
        let last = tileNow();
        let idle = 0;
        while (performance.now() < deadline) {
            if (arrived()) {
                return true;
            }
            if (opts.abort?.() === true) {
                const at = tileNow();
                log(`stall: attempt lost at (${at?.x},${at?.z})`);
                return false;
            }
            const at = tileNow();
            idle = at !== null && last !== null && at.x === last.x && at.z === last.z ? idle + 1 : 0;
            last = at;
            if (idle >= IDLE_POLLS && modalOpen()) {
                log(`stall: the walk stopped at (${at?.x},${at?.z}) and the journal is up — whatever was clicked cannot run until it comes down`);
                return false;
            }
            if (modalOpen()) {
                opened = true;
            } else if (opened && !arrived()) {
                // Why: anything the server pushes closes the modal and re-arms the traps, so it goes straight back up.
                pressJournal();
            }
            await Execution.delayTicks(POLL_TICKS);
        }
        const here = tileNow();
        log(`stall: timed out at (${here?.x},${here?.z}) — never reached the far side`);
        return false;
    } finally {
        if (opts.hold !== true) {
            await releaseJournal();
        }
    }
}

/** One op-click that can carry a leg of a journey, and where its target sits. */
export interface Stone {
    send: () => Promise<boolean>;
    arrived: () => boolean;
    what: string;
}

export interface StalledJourney {
    /** The last op-click, once its target is in range. */
    goal: Stone & { inRange: () => boolean };
    /** The next stepping stone toward the goal, or null when nothing in range makes progress. */
    nextStone: () => Stone | null;
    log: (m: string) => void;
    legs?: number;
}

/**
 * Finish the last click with the journal down.
 * Why: a goal keyed on what its script did can't come true while the journal is up, because `tryInteract` is gated on `canAccess()`. The stones have already carried you onto the goal, and a goal tile is never a trap tile, so the modal comes down and the op gets its own ticks.
 */
async function finishGoal(goal: Stone & { inRange: () => boolean }, log: (m: string) => void): Promise<boolean> {
    await releaseJournal();
    if (await Execution.delayUntilTicks(goal.arrived, 8)) {
        return true;
    }
    if (!(await goal.send())) {
        log(`stall: ${goal.what} would not send with the journal down`);
        return false;
    }
    const ran = await Execution.delayUntilTicks(goal.arrived, 15);
    // Why: the journey walks on over trap tiles and only re-presses the journal after its next op-click has moved you, so put the modal back up before the walk.
    if (!ran) {
        pressJournal();
    }
    return ran;
}

/**
 * Reach `goal` over a chain of stalled op-clicks, holding the journal across every leg of the journey.
 * Why: an op-click can only name a loc in the client's build area, which lags you, so the reach is far shorter than the corridor.
 */
export async function stalledJourney(opts: StalledJourney): Promise<boolean> {
    const { goal, nextStone, log } = opts;
    const legs = opts.legs ?? 14;
    try {
        for (let leg = 0; leg < legs; leg++) {
            if (goal.arrived()) {
                return true;
            }
            if (goal.inRange()) {
                if (await stalledApproach({ ...goal, hold: true, log })) {
                    return true;
                }
                if (await finishGoal(goal, log)) {
                    return true;
                }
            }
            const stone = nextStone();
            if (!stone) {
                const at = tileNow();
                log(`stall: nothing at (${at?.x},${at?.z}) steps toward ${goal.what}`);
                return false;
            }
            await stalledApproach({ ...stone, hold: true, log });
        }
        log(`stall: ${legs} legs without reaching ${goal.what}`);
        return goal.arrived();
    } finally {
        await releaseJournal();
    }
}

/** `stalledApproach` where the op-click is an op on a loc found on the far side. */
export function stalledWalk(opts: StalledWalk): Promise<boolean> {
    const { find, op } = opts;
    return stalledApproach({
        ...opts,
        what: `'${op}' on the far side`,
        send: async () => {
            const target = find();
            return target !== null && target.interact(op);
        }
    });
}

/** `stalledWalk` against a loc looked up by id. */
export function stalledWalkToLoc(
    locId: number,
    op: string,
    arrived: () => boolean,
    log: (m: string) => void,
    within = 24
): Promise<boolean> {
    return stalledWalk({
        find: () => Locs.query().where(loc => loc.id === locId).action(op).within(within).nearest(),
        op,
        arrived,
        log
    });
}

export interface StalledCrossing extends StalledWalk {
    /** Put you back on the approach tile after a failed attempt; false if it can't. */
    recover: () => Promise<boolean>;
    attempts?: number;
}

// Why: whether the modal beats you onto the trapped ground is a 1-tick race, since the press can't go out until the op-click has moved you or the walk freezes at the first zone boundary. A short approach can't win every time, so a lost attempt recovers to the lip and goes again.
export async function stalledCrossing(opts: StalledCrossing): Promise<boolean> {
    const attempts = opts.attempts ?? 4;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        // Why: the crossing can land after `stalledWalk` has given up on its oracle, so ask again before recovering or you walk back east to re-approach a grid you're already west of.
        if (opts.arrived()) {
            return true;
        }
        if (await stalledWalk(opts)) {
            return true;
        }
        if (opts.arrived()) {
            return true;
        }
        if (attempt === attempts) {
            break;
        }
        opts.log(`stall: attempt ${attempt} did not carry the crossing — recovering`);
        if (!(await opts.recover())) {
            opts.log('stall: could not get back to the approach tile');
            return false;
        }
    }
    return opts.arrived();
}
