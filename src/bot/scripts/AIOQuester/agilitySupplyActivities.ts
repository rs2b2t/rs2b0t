import { actions } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import type { ScriptMeta } from '../../runtime/ScriptRegistry.js';
import BrimhavenAgility, { BRIMHAVEN_AGILITY_SETTINGS } from '../BrimhavenAgility/BrimhavenAgility.js';
import { inArena, TICKET_NAME } from '../BrimhavenAgility/BrimhavenAgilityLogic.js';

export function inQuestArena(): boolean {
    const tile = Game.tile();
    return tile !== null && inArena(tile.x, tile.z);
}

export async function exitQuestArena(log: (message: string) => void): Promise<void> {
    if (!inQuestArena()) return;
    const bot = new BrimhavenAgility();
    bot.bindLog(log);
    const deadline = Date.now() + 180000;
    while (bot.inArenaNow()) {
        if (Date.now() >= deadline) throw new Error('Could not leave Brimhaven Agility Arena');
        await bot.leaveArena();
        await Execution.delayTicks(1);
    }
}

export function ticketSupplyActivity(total: () => number): ScriptMeta {
    return {
        name: 'QuestArenaTickets', description: 'Earn Brimhaven tickets for quest supplies', settingsSchema: BRIMHAVEN_AGILITY_SETTINGS,
        create: () => new class extends BrimhavenAgility {
            override async loop(): Promise<void> {
                if (total() >= this.settings.num('count', 6)) {
                    if (this.inArenaNow()) await this.leaveArena();
                    return;
                }
                await super.loop();
            }
        }()
    };
}

export const toadflaxSupplyActivity: ScriptMeta = {
    name: 'QuestToadflax', description: 'Exchange three Brimhaven tickets for each Toadflax',
    create: () => new class extends LoopingBot {
        override loopDelay = 600;
        async loop(): Promise<void> {
            if (Inventory.count(TICKET_NAME) < 3) { this.requestFinish('No tickets left for Toadflax'); return; }
            if (Modals.main() !== 8292) {
                if (Modals.isOpen() && !(await Modals.close())) return;
                const trader = Npcs.query().where(npc => npc.id === 1055).nearest();
                if (trader && await trader.interact('Trade')) await Execution.delayUntil(() => Modals.main() === 8292, 5000);
                return;
            }
            const before = Inventory.countById(2998);
            const tickets = Inventory.count(TICKET_NAME);
            if (actions.ifButton(8382)) await Execution.delayUntil(() =>
                Inventory.countById(2998) > before && Inventory.count(TICKET_NAME) <= tickets - 3, 5000);
        }
    }()
};
