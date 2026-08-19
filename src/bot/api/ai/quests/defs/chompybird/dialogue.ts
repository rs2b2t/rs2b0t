import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';

import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { openDialogue, pickByLine, pickPreferred, type LineRule } from '../../exec/primitives.js';

const CONTINUE_LABEL = 'Click here to continue';

// Why: `~objbox` and `~mesbox` build a MAIN modal and suspend the script on `p_pausebutton`, and neither ChatDialog nor driveUntil can see one.
// Why: Rantz answers half of this quest with them, so a driver that only knows the chat modal stops on the first box and waits out its timeout.

/** Click through an objbox sitting on main. False when nothing was up. */
export async function clearBox(): Promise<boolean> {
    if (reader.modals().main === -1) {
        return false;
    }
    const cont = reader.mainModalButtonNearText(CONTINUE_LABEL);
    if (cont > 0 && !actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, cont)) {
        actions.ifButton(cont);
    } else if (cont <= 0) {
        actions.closeModal();
    }
    await Execution.delayTicks(1);
    return true;
}

/** The text the main modal is showing, flattened and lower-cased. */
export function boxText(): string {
    return reader.mainModalTexts().join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface BoxDrive {
    /** What proves the leg landed. Absent drives the chain to its end. */
    expect?: () => boolean;
    prefer?: readonly string[];
    /** Options chosen by the NPC's last line, taking precedence over `prefer`. */
    rules?: readonly LineRule[];
    // Why: Rantz's toady menu re-offers the same five options after every answer, so a plain preference list picks the first one forever.
    /** Preferences that may be taken once, then fall through to the next. */
    once?: readonly string[];
    ms?: number;
    /** Stop instead of guessing when nothing matches. Default true. */
    strict?: boolean;
}

// Why: several of Rantz's option lists offer a refusal first ("Er, make you're own 'stabbers'!"), so an unmatched fall-through is worse than stopping.
// Why: a scripted chain leaves silent gaps, so quiet is only the end after several polls of it.

const QUIET_POLLS = 6;

/** Drive a chain of chat pages, option lists and objboxes until the goal lands. */
async function driveBoxes(drive: BoxDrive, log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + (drive.ms ?? 30_000);
    const done = drive.expect ?? ((): boolean => false);
    const spent = new Set<string>();
    const available = (): string[] => (drive.prefer ?? []).filter(p => !spent.has(p));
    let spoken: string[] = [];
    let acted = false;
    let quiet = 0;
    while (performance.now() < deadline) {
        if (done()) {
            return true;
        }
        // Why: a random event or a death has to end the conversation, or the step sits out its window before the host can act.
        if (EventSignal.pending()) {
            return done();
        }
        const opts = ChatDialog.options();
        if (opts.length === 0 && ChatDialog.isOpen()) {
            const texts = ChatDialog.texts();
            if (texts.length > 0) {
                spoken = texts;
            }
        }
        if (opts.length > 0) {
            const pick = pickByLine(spoken, opts, drive.rules ?? []) ?? pickPreferred(opts, available());
            if (!pick) {
                if (drive.strict !== false) {
                    log(`no rule or preference matched [${opts.join(' | ')}] after "${spoken.join(' ')}"`);
                    return done();
                }
                await ChatDialog.chooseOption(opts[opts.length - 1]);
            } else {
                const oneShot = (drive.once ?? []).find(p => pick.toLowerCase().includes(p.toLowerCase()));
                if (oneShot !== undefined) {
                    spent.add(oneShot);
                }
                await ChatDialog.chooseOption(pick);
            }
            // Why: an option that opens an objbox needs the box seen before the next page is read.
            spoken = [];
            acted = true;
            quiet = 0;
            await Execution.delayTicks(2);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            acted = true;
            quiet = 0;
            await Execution.delayTicks(1);
            continue;
        }
        if (await clearBox()) {
            acted = true;
            quiet = 0;
            continue;
        }
        if (acted && ++quiet >= QUIET_POLLS) {
            return drive.expect ? done() : true;
        }
        await Execution.delayTicks(1);
    }
    return drive.expect ? done() : acted;
}

/** Open a conversation, then drive it to a goal through whatever boxes it raises. */
export async function talkBoxes(npc: string, drive: BoxDrive, log: (m: string) => void): Promise<boolean> {
    if (drive.expect?.()) {
        return true;
    }
    // Why: a box left up by the last step swallows the talk click outright.
    await clearBox();
    if (!(await openDialogue(npc, log))) {
        return false;
    }
    return driveBoxes(drive, log);
}
