// docs/reference/quest-primitives.md
import { reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Reach } from '../../../walking/Reach.js';
import type Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { pickPreferred } from './primitives.js';
import { prayerUpkeep } from '../prayer.js';

export function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

export function locNear(name: string, op: string, within = 12): Loc | null {
    return Locs.query().name(name).action(op).within(within).nearest();
}

// Why: loc queries come back empty for about a tick after a level or region change, so an empty scene proves nothing.

/**
 * Wait out the loc-query blackout after a level or region change.
 * @see docs/decisions/level-change-lag.md
 */
export async function settleScene(): Promise<void> {
    await Execution.delayTicks(2);
}

// Why: loc prompts often list the refusal first ("I don't think so, it might animate and attack me!"), so an unmatched list stops here instead of falling through.

/**
 * Like `driveDialog`, but stops on an unmatched option list.
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

// Why: a scripted chain has gaps with nothing open yet, and `driveChoice` returns at the first one.
// Why: `driveChoice` runs a chain to its end, so the goal is only tested between chains and a goal on one box's text never sees it. Want `GameMessages.sawSince` here; transient `modalText` wants `driveBoxes`.

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
        await prayerUpkeep();
        await Execution.delayTicks(1);
    }
    return expect();
}

// Why: `driveChoice` only clicks the chat modal and a loc script's `~mesbox` chain lands in the main one, so `driveUntil` would never click it away.
// Why: the goal is tested before each dismissal so the box carrying the answer is still readable, and it eats between boxes since `Sustain` is call-driven.

/**
 * Drive a message-box chain to its goal, clicking each box away as it comes.
 * @see docs/reference/quest-primitives.md
 */
export async function driveBoxes(
    expect: () => boolean,
    ms: number,
    prefer: string[] = [],
    log: (m: string) => void = () => {}
): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (expect()) {
            return true;
        }
        // Why: one click per pass, since `driveChoice` runs a chain to the end without re-testing the goal and a goal on the last box's text ("manage to force the doors open") gets clicked away unread.
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            // Why: a list nothing matches can't move, so waiting on it only burns the budget (Gujuo's 4 dead-end topics cost 2 minutes each).
            // Why: logged, because the option list is the only record of what the script wanted and the module didn't offer.
            if (!pick) {
                log(`no preferred option in [${opts.join(' | ')}]`);
                return expect();
            }
            // Why: `driveToEnd` logs every choice it takes, and without this a wrong topic and a right topic that led nowhere look the same in the log.
            log(`chose "${pick}" from [${opts.join(' | ')}]`);
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (Modals.isOpen()) {
            // Why: a modal root with no close button returns without changing anything, so a bare retry would spin without yielding a tick.
            if (!(await Modals.close())) {
                await Execution.delayTicks(1);
            }
            continue;
        }
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    return expect();
}

// Why: `~mesbox` can land in either widget, and the server script stays suspended until the box is clicked.

/** Dismiss every standing message box in either widget. */
export async function clearBoxes(max = 8): Promise<void> {
    for (let i = 0; i < max; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (Modals.isOpen()) {
            if (!(await Modals.close())) {
                return;
            }
            continue;
        }
        return;
    }
}

export interface DoorCrossing {
    /** Exact loc id of the shut door. */
    id: number;
    /** Tile to click from, on the side you're leaving. */
    stand: Tile;
    /** True once you stand past the door. Test one coordinate. */
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
    /** How far off the stand counts as arrived. 0 for an axis-tested door. */
    standRadius?: number;
    log: (m: string) => void;
}

// Why: `open_and_close_door` teleports in the click's own script run with at most one `p_delay(1)` between its two teleports, so a crossing lands within a couple of ticks or never.
const DOOR_MS = 3_000;
// Why: the server runs the door's script a tick after the click, so the dialogue check needs a window.
const DIALOG_MS = 2_000;
// Why: the Brimhaven crossings are reached from Varrock by ferry, and a 2-minute budget times out mid-ocean and reports the door as missing.
const DOOR_WALK_MS = 300_000;

// Why: `~open_and_close_door` teleports you through and re-shuts in 3 ticks, so the far side is the only proof of a crossing and no door can be held open for a partner.

/**
 * Cross a quest door whose Open teleports you through.
 * @see docs/reference/quest-primitives.md
 */
export async function crossTeleportDoor(door: DoorCrossing): Promise<boolean> {
    const { id, stand, isFar, log } = door;
    if (isFar()) {
        return true;
    }
    // Why: a leftover `~mesbox` from the door's own challenge ("You hear the door being unbarred from inside.") swallows the next Open click silently.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    const radius = door.standRadius ?? 1;
    if (!(await Traversal.walkResilient(stand, { radius, attempts: 3, timeoutMs: DOOR_WALK_MS, log }))) {
        return false;
    }
    const op = door.op ?? 'Open';
    const name = door.name ?? 'Door';
    // Why: `~door_open` swings the loc onto a different tile and id once anyone opens it, and a sealed pocket has one door, so the actioned neighbour is it.
    const loc = Locs.query().action(op).within(4).where(l => l.id === id).nearest()
        ?? Locs.query().action(op).within(2).where(l => l.name === name).nearest();
    if (!loc) {
        log(`no ${name.toLowerCase()} ${id} offering '${op}' within four tiles of (${stand.x},${stand.z})`);
        return false;
    }
    // Why: a crossing prints nothing (`open_and_close_door` is two teleports, a `loc_change` and a synth), so any game message after the click is a refusal. Marked before the click since the refusal can be its immediate answer.
    const said = GameMessages.mark();
    // Why: a key door's `oploc1` answers "This <name> is locked" and only its `oplocu` opens, so the crossing is a use-item on the loc.
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
    // Why: the door's script runs a tick after the click, so a check straight off `interact` sees nothing, and a door talks in either modal (challenge in chat, flavour in a box).
    // Why: a refusal ends the wait too, so a door that says no doesn't cost the full cap.
    const talked = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen();
    await Execution.delayUntil(() => isFar() || talked() || GameMessages.since(said).length > 0, DIALOG_MS);
    if (!isFar() && talked()) {
        await driveBoxes(isFar, DIALOG_MS, [...(door.prefer ?? [])]);
    }
    await Execution.delayUntil(() => isFar() || GameMessages.since(said).length > 0, DOOR_MS);
    if (!isFar() && GameMessages.since(said).length > 0) {
        // Why: a door that narrates its own crossing would otherwise be abandoned a tick early, and that costs a retry.
        await Execution.delayTicks(2);
    }
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
    /** Game-message pattern the loc's script answers with when the op cannot work yet. */
    refused?: RegExp;
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
        // Why: a box counts as the loc answering, otherwise `Reach` treats a talking loc as one that did nothing and re-sends the op to its cap.
        expect: () => step.expect() || ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen(),
        refused: step.refused,
        log
    });
    if (status !== 'done') {
        // Why: a loc that couldn't be clicked and a click that led nowhere want different fixes, so the log says which.
        log(`prompt: '${step.op}' on '${step.name}' never reached the loc (${status})`);
        return false;
    }
    const answered = await driveBoxes(step.expect, step.expectMs ?? 20_000, step.prefer ?? [], log);
    if (!answered) {
        log(`prompt: '${step.op}' on '${step.name}' was sent and the goal never came`);
    }
    // Why: a satisfied goal owns the screen: Tribal Totem's lock waits for `Modals.main() === DOOR_UI`, and clearing after a success shut that panel.
    // Why: a failure is cleared because its next step is a retry, and a retry can't click through a standing box.
    if (!answered) {
        await clearBoxes();
    }
    return answered;
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
    // Why: quest areas have same-named locs a tile apart, and `nearest` picks the decoy.
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
