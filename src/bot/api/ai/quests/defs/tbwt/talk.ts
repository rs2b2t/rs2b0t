import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { openDialogue, pickPreferred } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';

export type Log = (msg: string) => void;

/** Long enough to sit out `if_close; p_delay(10)` in Tiadeche's catch. */
export const LONG_GAP = 16;
/** The Shaikahan hunt runs six camera moves with nothing on the chat interface. */
export const CUTSCENE_GAP = 34;

export function walkTo(dest: Tile, radius: number, log: Log): Promise<boolean> {
    return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: 240_000, log });
}

// Why: these conversations close the chat interface mid-chain (`if_close; p_delay(N)`) and re-open it several ticks later, and `driveDialog` treats the first of those gaps as the end.

/**
 * Drive a conversation past the scripted gaps to where it stops re-opening.
 * Abandons rather than guessing when no preferred option matches.
 */
export async function driveFully(prefer: readonly string[], log: Log, quietTicks = 6): Promise<boolean> {
    let quiet = 0;
    for (let i = 0; i < 300 && quiet < quietTicks; i++) {
        await Sustain.run();
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            quiet = 0;
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const pick = pickPreferred(options, [...prefer]);
            if (!pick) {
                log(`no preferred option in [${options.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            quiet = 0;
            await Execution.delayTicks(1);
            continue;
        }
        quiet++;
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}

// Why: every one of these NPCs wanders five tiles, and the first Talk-to after an eleven-click walk
// lands on a tile they have already left — a settle and a second try cost less than another step.

/** Walk to the NPC, open the dialogue, and drive it to the end. */
export async function talkFully(
    npc: string,
    anchor: Tile,
    prefer: readonly string[],
    log: Log,
    quietTicks = 6
): Promise<boolean> {
    if (!(await walkTo(anchor, 4, log))) {
        return false;
    }
    await settleScene();
    if (!(await openDialogue(npc, log))) {
        await Execution.delayTicks(3);
        if (!(await openDialogue(npc, log))) {
            return false;
        }
    }
    return driveFully(prefer, log, quietTicks);
}

/** Walk to the NPC, use a carried item on them, and drive whatever that raised. */
export async function useOnNpc(
    itemId: number,
    npc: string,
    anchor: Tile,
    prefer: readonly string[],
    log: Log,
    quietTicks = LONG_GAP
): Promise<boolean> {
    if (!(await walkTo(anchor, 4, log))) {
        return false;
    }
    await settleScene();
    // Why: the same wander that swallows a first Talk-to swallows a first use-on, so the click is re-aimed once.
    for (let attempt = 0; attempt < 2; attempt++) {
        const target = Npcs.query().name(npc).within(12).nearest();
        const item = Inventory.items().find(entry => entry.id === itemId);
        if (!target || !item) {
            log(`no '${npc}' in reach, or no item ${itemId} in the pack`);
            return false;
        }
        if (!(await item.useOn(target))) {
            return false;
        }
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 6000)) {
            return driveFully(prefer, log, quietTicks);
        }
        await Execution.delayTicks(3);
    }
    log(`'${npc}' did not answer item ${itemId}`);
    return false;
}
