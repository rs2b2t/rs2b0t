import { Bank } from '../../api/bank/Bank.js';
import { plannedPotions, potionToSip, SUPER_SET, type PotionPlan } from '../../api/combat/boostPotions.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import type { CarryEntry } from '../../api/loadout/loadouts.js';
import { Skills } from '../../api/skills/Skills.js';
import type { SettingsBag } from '../../runtime/Settings.js';

export function fighterPotionPlans(settings: SettingsBag, style: string, carry: readonly CarryEntry[]): PotionPlan[] {
    const keys = ['useSuperAttack', 'useSuperStrength', 'useSuperDefence'];
    const countKeys: Record<string, string> = { attack: 'superAttackCount', strength: 'superStrengthCount', defence: 'superDefenceCount' };
    return plannedPotions(carry, SUPER_SET.filter((potion, index) => settings.bool(keys[index], false)
        && (style === 'melee' || potion.skill === 'defence')))
        .map(plan => ({ ...plan, want: Math.max(0, Math.min(27, Math.floor(settings.num(countKeys[plan.potion.skill], plan.want)))) }))
        .filter(plan => plan.want > 0);
}

export class FighterPotions {
    private retryAt = -1;
    private busy = false;
    private warned = new Set<string>();

    constructor(readonly plans: readonly PotionPlan[], private log: (message: string) => void) {}

    private held(plan: PotionPlan): number {
        return Inventory.items().filter(item => !item.noted && plan.potion.doses.includes(item.name ?? '')).reduce((sum, item) => sum + item.count, 0);
    }

    keepNames(): string[] { return this.plans.flatMap(plan => [...plan.potion.doses]); }

    due(): PotionPlan | null {
        if (this.busy || Game.tick() < this.retryAt || Bank.isOpen() || EventSignal.pending()) return null;
        return potionToSip({ plans: this.plans, held: plan => this.held(plan),
            levels: skill => ({ base: Skills.level(skill), effective: Skills.effective(skill) }) });
    }

    async sip(): Promise<boolean> {
        const plan = this.due();
        if (!plan) return false;
        const dose = Inventory.items().find(item => !item.noted && plan.potion.doses.includes(item.name ?? '') && item.actions().includes('Drink'));
        if (!dose) { this.retryAt = Game.tick() + 5; return false; }
        this.busy = true;
        const before = Skills.effective(plan.potion.skill);
        const count = () => Inventory.items().filter(item => !item.noted && item.name === dose.name).reduce((sum, item) => sum + item.count, 0);
        const bottles = count();
        try {
            if (!(await dose.interact('Drink'))) return false;
            const changed = () => Skills.effective(plan.potion.skill) > before && count() < bottles;
            await Execution.delayUntil(() => changed() || EventSignal.pending(), 3000);
            if (!changed()) return false;
            this.log(`Drank ${dose.name}`);
            return true;
        } finally {
            this.retryAt = Game.tick() + 5;
            this.busy = false;
        }
    }

    async restock(reserveSlots = 0): Promise<void> {
        if (!this.plans.length || EventSignal.pending()) return;
        await Bank.setNoteMode(false);
        for (const plan of this.plans) {
            for (const name of new Set([plan.flask, ...plan.potion.doses])) {
                if (EventSignal.pending()) return;
                const qty = Math.min(plan.want - this.held(plan), Bank.count(name), 28 - Inventory.items().length - Math.max(0, Math.ceil(reserveSlots)));
                if (qty <= 0) continue;
                const before = this.held(plan);
                if (!(await Bank.withdrawX(name, qty))) break;
                await Execution.delayUntil(() => this.held(plan) > before || EventSignal.pending(), 3000);
                if (this.held(plan) <= before) break;
            }
            if (this.held(plan) > 0) this.warned.delete(plan.potion.skill);
            else if (!this.warned.has(plan.potion.skill) && plan.potion.doses.every(name => Bank.count(name) === 0)) {
                this.warned.add(plan.potion.skill);
                this.log(`No ${plan.flask} in the bank; continuing unboosted`);
            }
        }
    }
}
