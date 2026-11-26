import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import { DragonSupplies } from '#/bot/api/ai/quests/defs/dragonslayer/supplies.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { HeroConfig } from '#/bot/api/ai/quests/defs/heroquest/config.js';
import { LegendsConfig } from '#/bot/api/ai/quests/defs/legends/config.js';

export function snapshotQuestConfig(): () => void {
    const food = QuestFood.name;
    const loadout = QuestLoadout.current;
    const planks = DragonSupplies.wildernessPlanks;
    const arrav = { ...ArravConfig };
    const hero = { ...HeroConfig };
    const legends = { ...LegendsConfig };
    return () => {
        QuestFood.name = food;
        QuestLoadout.current = loadout;
        DragonSupplies.wildernessPlanks = planks;
        Object.assign(ArravConfig, arrav);
        Object.assign(HeroConfig, hero);
        Object.assign(LegendsConfig, legends);
    };
}
