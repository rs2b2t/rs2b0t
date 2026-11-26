import { Execution } from '../execution/Execution.js';
import { Inventory, type InvItem } from '../inventory/Inventory.js';
import { Skills } from '../skills/Skills.js';
import { shouldEatFood } from './food.js';

export function shouldEatNow(food: string, count: number): boolean {
    return count > 0 && shouldEatFood(food, {
        hp: Skills.effective('hitpoints'),
        maxHp: Skills.level('hitpoints'),
        foodCount: count
    });
}

export async function eatSelectedFood(
    bot: { setStatus(status: string): void },
    food: InvItem | undefined,
    confirm: 'heal' | 'bite'
): Promise<boolean> {
    if (!food) return false;
    bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    const healed = () => Skills.effective('hitpoints') > before;
    if (confirm === 'heal') {
        await food.interact('Eat');
        return Execution.delayUntil(healed, 3000);
    }
    const id = food.id;
    const count = Inventory.countById(id);
    if (!(await food.interact('Eat'))) return false;
    return Execution.delayUntilTicks(() => Inventory.countById(id) < count || healed(), 2);
}
