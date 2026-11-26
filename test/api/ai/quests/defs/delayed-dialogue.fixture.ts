import { Execution } from '#/bot/api/execution/Execution.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

export class DelayedDialogue {
    pending = '';

    constructor(public page = '') {}

    stubExecution() {
        return stubProps(Execution, {
            delayTicks: async () => {},
            delayUntil: async check => {
                if (check()) return true;
                this.page = this.pending;
                this.pending = '';
                return check();
            }
        });
    }
}
