import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { StageTask } from './StageTask.js';

/**
 * The `player_kit` character-design interface, opened as the main modal. A
 * fresh account spawns with it forced open while `tutorial == 0`
 * (content: `tutorial.rs2` `[label,start_tutorial]` → `if_openmain(player_kit)`).
 *
 * Cache interface id on the current 274 content build — re-verify in
 * the tutorial interface pack after a Content upgrade. `validate()` only acts while
 * this is the open main modal, so a stale id just makes this stage a no-op
 * rather than misfiring on some other screen.
 */
const DESIGN_MODAL = 3559;

/**
 * Tutorial stage 0 → 1: accept the character design to leave the design
 * screen. Clicking `player_kit`'s Accept button (`player_kit:accept`) closes
 * the interface, and the content turns that close into the first progress
 * write (`[if_close,player_kit]` → `queue(tutorial_designed_character)` →
 * `%tutorial = 1`). First state-driven stage (ADR-0007).
 *
 * The Accept button is found at runtime by its caption (`buttonByText`) rather
 * than a hardcoded child id, so a content rebuild that renumbers components
 * needs no code change.
 */
export class DesignAccept extends StageTask {
    validate(): boolean {
        return reader.modals().main === DESIGN_MODAL;
    }

    async execute(): Promise<void> {
        const accept = reader.buttonByText(DESIGN_MODAL, 'Accept');
        if (accept === -1) {
            this.bot.log('DesignAccept: no "Accept" button under the design modal — component renumbered?');
            return;
        }

        actions.ifButton(accept);
        await Execution.delayUntil(() => reader.modals().main !== DESIGN_MODAL, 3000);
    }
}
