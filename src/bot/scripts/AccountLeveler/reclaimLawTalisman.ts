import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { talkStrict } from '../../api/ai/quests/exec/primitives.js';

export default class ReclaimLawTalisman extends TaskBot {
    override onStart(): void {
        this.add({ validate: () => true, execute: async () => {
            if (!Inventory.contains('Law talisman')) {
                await talkStrict('Dunstan', ['Can I have another law talisman?', 'Nothing, thanks.'], message => this.log(message));
                if (!(await Execution.delayUntil(() => Inventory.contains('Law talisman'), 5000))) throw new Error('Dunstan did not return the Law talisman');
            }
            this.requestFinish('Reclaimed Law talisman');
        } });
    }
}
