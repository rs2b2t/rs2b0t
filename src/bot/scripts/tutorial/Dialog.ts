import type { Task } from '../../api/Bot.js';
import { Execution } from '../../api/Execution.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';

/**
 * Options that DECLINE a "skip / leave" offer. The RuneScape Guide's first
 * conversation opens with a dev-only prompt — `if (map_live = false)` in
 * `runescape_guide.rs2`, true on any non-production Engine-TS — asking "Do you
 * want to skip the tutorial?" whose "Yes please." jumps straight to complete
 * (`tutorial = 1000`). We must always take "No, thank you." to keep playing;
 * declining advances the tutorial normally (1 → 4). Checked before any
 * progressing pick so we can never skip.
 *
 * Scoped to that prompt's EXACT label (Task 12): a looser 'no thanks' used to
 * live here too and matched the Banker's decline ("Yes." / "No thanks.",
 * `tut_banker.rs2`) ahead of MOVE_ON's "Yes." — which would refuse the bank
 * forever at stage 500. The only other "No thanks." in the tutorial content
 * is the Financial Advisor's recap terminator, which the last-option default
 * still picks.
 */
const DECLINE_SKIP = ['no, thank you'];

/**
 * Progressing choices seen in the 274 tutorial dialogs (case-insensitive
 * substring match): Brace's recap terminator, the Banker's / mainland "Yes."
 * (the trailing dot keeps the skip prompt's "Yes please." from matching),
 * and the guides' "Nothing, thanks" recap exits.
 */
const MOVE_ON = ['ready to move on', 'yes.', 'nothing, thanks'];

/**
 * Clicks through any open tutorial dialogue: presses continue while a
 * "click to continue" page is up, otherwise chooses an option — declining a
 * skip-tutorial offer first (we never skip), then a progressing option, then
 * the last option as a fallback. Wired first in `TutorialBot.onStart` so every
 * stage task runs against a cleared dialog.
 */
export class AdvanceDialog implements Task {
    validate(): boolean {
        return ChatDialog.isOpen();
    }

    async execute(): Promise<void> {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return;
        }

        const opts = ChatDialog.options();
        if (opts.length === 0) {
            return;
        }

        const lowered = opts.map(o => o.toLowerCase());
        let pick = lowered.findIndex(o => DECLINE_SKIP.some(d => o.includes(d)));
        if (pick === -1) {
            pick = lowered.findIndex(o => MOVE_ON.some(m => o.includes(m)));
        }
        if (pick === -1) {
            pick = opts.length - 1; // default: last option (usually "move on")
        }

        await ChatDialog.chooseOption(opts[pick]);
        await Execution.delayTicks(1);
    }
}
