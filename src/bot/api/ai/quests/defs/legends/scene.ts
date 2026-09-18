import { reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type { Npc } from '../../../../model/Npc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { pickPreferred } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import { legendsArea, type LegendsArea } from './areas.js';

export { clearBoxes, driveBoxes, driveChoice, driveUntil, heldId, locNear, promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';

// Why: Use-on does not approach the target, so move next to the NPC before sending it.

/** Offer an item to an npc, having first walked close enough for the offer to land. */
export async function offerTo(itemId: number, npc: Npc, log: (m: string) => void): Promise<boolean> {
    const item = Inventory.items().find(i => i.id === itemId);
    if (!item) {
        log(`nothing with id ${itemId} in the pack to offer`);
        return false;
    }
    if (!(await Traversal.walkResilient(npc.tile(), { radius: 1, attempts: 2, timeoutMs: 30_000, log }))) {
        return false;
    }
    await settleScene();
    return item.useOn(npc);
}

/** Which of the quest's areas you're standing in right now. */
export function here(): LegendsArea {
    return legendsArea(Game.tile());
}

// Why: `~mesbox` and `~objbox` are modal boxes, so `GameMessages` never sees them, and half this quest's confirmations arrive that way.
// Why: both the chat and the main modal are read, as the journal and the books use the main one and the boxes use the chat one.

// Why: several conversations here end themselves without landing an item or a tile, Ungadulu collapses, Gujuo walks off, so their only goal is "the chain ran to its end".
// Why: `driveUntil` with a goal that never becomes true burns its budget after the chat has closed, and `driveDialog` guesses the last option when nothing matches.

// Why: a chain can also run to the wrong end: Gujuo greets, chats and says goodbye without offering the rescue, and that ending looks identical to the right one.

// Why: the chat modal shuts for a tick or 2 between a page and the option list behind it, most of a 3-tick silence at 200ms ticks, so a short quiet counter reads Gujuo's chain as ended one option short of the rescue.
const ENDED_TICKS = 10;
const NEVER_OPENED_TICKS = 25;

/** Drive a self-terminating conversation, abandoning when no option matches. */
export async function driveToEnd(prefer: string[], log: (m: string) => void, ms = 45_000, required?: string): Promise<boolean> {
    const deadline = performance.now() + ms;
    let quiet = 0;
    // Why: a conversation that never opened hasn't happened, and reporting it as a win feeds the engine's no-progress watchdog a success every pass.
    let spoke = false;
    let took = false;
    while (performance.now() < deadline) {
        if (ChatDialog.canContinue()) {
            spoke = true;
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            quiet = 0;
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            spoke = true;
            const pick = pickPreferred(options, prefer);
            if (!pick) {
                log(`no preferred option in [${options.join(' | ')}]`);
                return false;
            }
            // Why: a chain that ends without moving the quest on is invisible otherwise, the driver reports the same success either way.
            log(`chose "${pick}" from [${options.join(' | ')}]`);
            took = took || pick === required;
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            quiet = 0;
            continue;
        }
        // Why: a `~mesbox` opens no chat widget, so the quiet counter would read a chain suspended on one as ended. `ungadulu_where` finishes on "The Shaman throws himself down on the floor and starts convulsing.", and that page left standing stops the next shaman opening his mouth.
        if (Modals.isOpen()) {
            spoke = true;
            if (!(await Modals.close())) {
                await Execution.delayTicks(1);
            }
            quiet = 0;
            continue;
        }
        if (!ChatDialog.isOpen()) {
            quiet += 1;
            if (quiet >= ENDED_TICKS && spoke) {
                if (required && !took) {
                    log(`the chain ended without ever offering "${required}"`);
                    return false;
                }
                return true;
            }
            if (quiet >= NEVER_OPENED_TICKS) {
                log('no dialogue ever opened');
                return false;
            }
        }
        await Execution.delayTicks(1);
    }
    return spoke && !ChatDialog.isOpen();
}

// Why: `~mesbox` renders in the main modal and the chat driver only clicks the chat one (`ChatDialog.canContinue()` reads `chatContinueComId`), so a box chain from a loc script is readable by `modalText` and dismissable by nothing. The trials are 7 such chains.

/** Whatever a modal box is currently showing, normalised for matching. */
export function modalText(): string {
    return [...reader.mainModalTexts(), ...ChatDialog.texts()]
        .join(' ')
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}
