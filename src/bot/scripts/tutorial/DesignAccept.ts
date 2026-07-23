import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { StageTask } from './StageTask.js';

const DESIGN_MODAL = 3559;

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
