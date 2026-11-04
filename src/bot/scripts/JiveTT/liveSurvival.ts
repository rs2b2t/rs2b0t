import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Prayer } from '../../api/prayer/Prayer.js';
import { Skills } from '../../api/skills/Skills.js';
import type { Counters } from './types.js';
import type { PotionFamily, SurvivalPort } from './survival.js';

const LABELS: Record<PotionFamily, string> = { prayer: 'Prayer potion', attack: 'Super attack', strength: 'Super strength', defence: 'Super defence', antifire: 'Antifire potion', superantipoison: 'Superantipoison' };

function doses(family: PotionFamily): number {
    return Inventory.items().reduce((sum, item) => {
        if (item.noted) return sum;
        const match = new RegExp(`^${LABELS[family]}\\(([1-4])\\)$`, 'i').exec(item.name ?? '');
        return sum + (match ? Number(match[1]) * item.count : 0);
    }, 0);
}

export function survivalPort(counters: Counters): SurvivalPort {
    let poisonMark = GameMessages.mark();
    return {
        state: () => ({
            ready: Game.sceneReady() && !Bank.isOpen(), inCombat: Game.inCombat(), hp: Skills.effective('hitpoints'), maxHp: Skills.level('hitpoints'),
            prayer: Prayer.points(), maxPrayer: Prayer.max(), sharks: Inventory.items().filter(i => i.id === 385 && !i.noted).reduce((sum, i) => sum + i.count, 0),
            prayerDoses: doses('prayer'), shield: Equipment.items().some(i => i.id === 1540),
            poisoned: GameMessages.sawSince(poisonMark, /you have been poisoned/i), tick: Game.tick(),
            boosts: Object.fromEntries(['attack', 'strength', 'defence'].map(skill => [skill, Skills.effective(skill) - Skills.level(skill)])) as Record<'attack' | 'strength' | 'defence', number>
        }),
        eat: async () => {
            const food = Inventory.items().find(i => i.id === 385 && !i.noted);
            const before = Inventory.countById(385);
            if (!food || !(await food.interact('Eat')) || !(await Execution.delayUntilTicks(() => Inventory.countById(385) < before, 3))) return false;
            counters.sharksUsed++;
            return true;
        },
        drink: async family => {
            const before = doses(family);
            const potion = [1, 2, 3, 4].flatMap(dose => Inventory.items().filter(i => !i.noted && i.name?.toLowerCase() === `${LABELS[family]}(${dose})`.toLowerCase()))[0];
            if (!potion || !(await potion.interact('Drink')) || !(await Execution.delayUntilTicks(() => doses(family) === before - 1, 3))) return false;
            counters.dosesUsed++;
            if (family === 'superantipoison') poisonMark = GameMessages.mark();
            await Execution.delayTicks(2);
            return true;
        },
        prayerActive: name => Prayer.active(name),
        setPrayer: name => Prayer.set(name, true)
    };
}
