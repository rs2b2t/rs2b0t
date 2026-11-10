import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import type { ScriptMeta } from '../../runtime/ScriptRegistry.js';

export const groundSupplyActivity: ScriptMeta = {
    name: 'QuestGroundSupply', description: 'Collect a quest supply from a known ground spawn',
    create: () => new class extends LoopingBot {
        override loopDelay = 600;
        async loop() {
            const name = this.settings.str('item');
            const item = GroundItems.query().name(name).within(8).nearest();
            if (!item) { await Execution.delayTicks(2); return; }
            const before = Inventory.count(name);
            if (await item.interact('Take')) await Execution.delayUntil(() => Inventory.count(name) > before, 4000);
        }
    }()
};
