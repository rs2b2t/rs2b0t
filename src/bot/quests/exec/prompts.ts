// docs/QUESTS.md#exec-primitives
import { Execution } from '../../api/Execution.js';
import { Reach } from '../../api/Reach.js';
import type Tile from '../../api/Tile.js';
import { Traversal } from '../../api/Traversal.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs, type Loc } from '../../api/queries/Locs.js';
import { pickPreferred } from './primitives.js';

export function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

export function locNear(name: string, op: string, within = 12): Loc | null {
    return Locs.query().name(name).action(op).within(within).nearest();
}

/**
 * Every loc query is empty for about a tick after a level or region change, so a
 * blank scene is not evidence that a loc is absent.
 * @see docs/NAV.md#level-change-loc-lag
 */
export async function settleScene(): Promise<void> {
    await Execution.delayTicks(2);
}

/**
 * Like `driveDialog`, but abandons rather than guessing. Loc prompts routinely put
 * the refusal first — "I don't think so, it might animate and attack me!" — so
 * falling through to an unmatched option is worse than stopping.
 * @see docs/QUESTS.md#exec-primitives
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

/**
 * Keep answering prompts until the goal lands. A scripted chain leaves gaps where
 * nothing is open yet — `driveChoice` alone returns at the first of them and the
 * rest of the chain never runs.
 * @see docs/QUESTS.md#exec-primitives
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

export interface LocPrompt {
    name: string;
    op: string;
    near: Tile;
    /** Options to take, in order, once the loc opens a prompt. */
    prefer?: string[];
    expect: () => boolean;
    expectMs?: number;
    within?: number;
}

/**
 * Walk to a stand, act on a loc, then answer whatever prompt it raised — the shape
 * of nearly every world interaction in a jungle quest.
 * @see docs/QUESTS.md#exec-primitives
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
        expect: () => step.expect() || ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    });
    if (status !== 'done') {
        return false;
    }
    return driveUntil(step.expect, step.prefer ?? [], log, step.expectMs ?? 20_000);
}

/**
 * Use a carried item on a loc, then answer whatever prompt it raised. Quest item
 * chains run through `oplocu`, which no op-based step can express.
 * @see docs/QUESTS.md#exec-primitives
 */
export async function useOnLoc(
    itemId: number,
    loc: { name: string; near: Tile; within?: number },
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
    const target = Locs.query().name(loc.name).within(loc.within ?? 12).nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!target || !item) {
        log(`no '${loc.name}' or no item ${itemId} to use on it near (${loc.near.x},${loc.near.z})`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntil(expect, prefer, log);
}
