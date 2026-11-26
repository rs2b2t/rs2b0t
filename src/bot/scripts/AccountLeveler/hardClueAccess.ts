import { TaskBot } from '../../api/bot/Bot.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Execution } from '../../api/execution/Execution.js';
import { Reach } from '../../api/walking/Reach.js';
import { talkThrough } from '../../api/ai/quests/exec/primitives.js';
import { fetchDustyKey } from '../../api/ai/quests/defs/scorpcatcher/dungeon.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { talkOziach } from '../../api/ai/quests/defs/dragonslayer/index.js';
import { DS_NPC } from '../../api/ai/quests/defs/dragonslayer/areas.js';

export default class HardClueAccess extends TaskBot {
    override onStart(): void {
        Sustain.set(async () => {
            if (Skills.hpFraction() >= 0.7) return;
            const food = Inventory.first('Shark');
            if (food) await food.interact('Eat');
        });
        this.add({
            validate: () => true,
            execute: async () => {
                const item = this.settings.str('item');
                const log = (message: string) => this.log(message);
                if (!Inventory.first(item)) {
                    if (item === 'Dusty key') {
                        if (!(await fetchDustyKey(log))) throw new Error('Could not fetch Dusty key from Velrak');
                    } else if (item === 'Dragonfire shield') {
                        if (Quests.status('Dragon Slayer') !== 'complete') {
                            if (await Reach.npcDialog({ name: 'Guild master', near: DS_NPC.GUILDMASTER, log }) !== 'done'
                                || !(await talkThrough('Guild master', ['Do you know where I could get a Rune Plate mail body?'], log))
                                || !(await talkOziach(log))) throw new Error('Could not unlock Dragonfire shield');
                        }
                        if (await Reach.npcDialog({ name: 'Duke Horacio', near: DS_NPC.DUKE, log }) !== 'done'
                            || !(await talkThrough('Duke Horacio', ["I seek a shield that will protect me from the dragon's breath."], log))
                            || !(await Execution.delayUntil(() => Inventory.first(item) !== null, 5000))) throw new Error('Could not replace Dragonfire shield');
                    } else throw new Error(`Unsupported hard clue access item: ${item}`);
                }
                this.requestFinish(`Acquired ${item}`);
            }
        });
    }
}
