import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { stealCakes } from '../../api/thieving/CakeStall.js';
import { FLEE_TILE, STAND } from '../../api/thieving/cakeStallData.js';
import { Traversal } from '../../api/walking/Traversal.js';
import type { ScriptMeta } from '../../runtime/ScriptRegistry.js';
import { gatherCakes } from './cakeSupply.js';

export function cakeSupplyActivity(count: () => number, bank: () => Promise<void>): ScriptMeta {
    return { name: 'QuestCakeSupply', description: 'Gather whole cakes for a quest', create: () => new class extends LoopingBot {
        private stopped = false;
        override loopDelay = 600;
        override onStop() { this.stopped = true; }
        async loop() {
            const food = () => Inventory.items().filter(item => !item.noted && item.actions().includes('Eat')
                && ['cake', '2/3 cake', 'slice of cake', 'bread', 'chocolate slice'].includes(item.name?.toLowerCase() ?? ''))
                .sort((a, b) => Number(a.name?.toLowerCase() === 'cake') - Number(b.name?.toLowerCase() === 'cake'))[0];
            const hungry = () => Skills.hpFraction() <= 0.65 && !!food();
            await gatherCakes({
                count, full: () => Inventory.isFull(), combat: () => Game.inCombat(), hungry,
                stopped: () => this.stopped,
                eat: async () => { await food()?.interact('Eat'); await Execution.delayTicks(1); },
                flee: async () => {
                    await Traversal.walkResilient(FLEE_TILE, { radius: 1, attempts: 3, timeoutMs: 30000 });
                    await Execution.delayUntil(() => !Game.inCombat(), 10000);
                },
                bank: async () => {
                    await bank();
                    if (!(await Traversal.walkResilient(STAND, { radius: 2, attempts: 3, timeoutMs: 120000 }))) throw new Error('Cannot return to the cake stall');
                },
                steal: async abort => {
                    await stealCakes({ abort, shouldEat: hungry, setStatus: () => {}, log: message => this.log(message) });
                }
            }, this.settings.num('count', 8));
        }
    }() };
}
