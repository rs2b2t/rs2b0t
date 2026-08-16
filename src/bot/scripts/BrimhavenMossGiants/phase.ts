import { Inventory } from '../../api/inventory/Inventory.js';
import { BOAT_FARE, cfg } from './config.js';
import { atField, fieldGiants, findLoot, hasFood, hpFrac, needStyleSupplies } from './shared.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

export enum Phase {
    Travel = 'travel',
    Fight = 'fight',
    Loot = 'loot',
    Bury = 'bury',
    Bank = 'bank'
}

let phase: Phase = Phase.Travel;
export function getPhase(): Phase {
    return phase;
}
export function setPhase(p: Phase): void {
    phase = p;
}

/**
 * The single bank trigger (per design):
 *   (A) panic — out of food AND below the HP panic threshold, or
 *   (B) full haul — pack is full AND no food left to eat.
 * If the bank is known empty we don't keep re-banking on the panic path.
 */
export function shouldBank(bot: BrimhavenMossGiants): boolean {
    const panic = !hasFood() && hpFrac() < cfg.panicHp && !bot.bankKnownEmpty();
    const fullHaul = Inventory.isFull() && !hasFood();
    return panic || fullHaul;
}

/** Decide the phase for the next tick from observable state. */
export function decidePhase(bot: BrimhavenMossGiants): Phase {
    if (shouldBank(bot)) {
        return Phase.Bank;
    }
    switch (phase) {
        case Phase.Travel:
            if (atField()) {
                return fieldGiants().length > 0 ? Phase.Fight : findLoot() !== null ? Phase.Loot : Phase.Fight;
            }
            // Pre-conditions to sail to Brimhaven: must be able to fight on arrival.
            // Missing food, boat fare, supplies, or a full pack means go bank first.
            if (!hasFood() || Inventory.count('Coins') < BOAT_FARE || Inventory.isFull() || needStyleSupplies()) {
                return Phase.Bank;
            }
            return Phase.Travel;
        case Phase.Fight:
            // Drops on the ground (just killed one) -> go clear them.
            return findLoot() !== null ? Phase.Loot : Phase.Fight;
        case Phase.Loot:
            // Ground cleared -> bury bones (if any) then back to fighting.
            if (findLoot() !== null) {
                return Phase.Loot;
            }
            return cfg.buryBones && Inventory.contains('Big bones') ? Phase.Bury : Phase.Fight;
        case Phase.Bury:
            // Bones buried -> back to fighting.
            if (!cfg.buryBones || !Inventory.contains('Big bones')) {
                return Phase.Fight;
            }
            return Phase.Bury;
        case Phase.Bank:
            // Restocked and back on the island -> fight (idles if no giants).
            if (atField() && !shouldBank(bot)) {
                return Phase.Fight;
            }
            return Phase.Bank;
    }
}

/** Highest-priority task: flips the phase when the state says it should change. */
export class PhaseDirector implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return decidePhase(this.bot) !== phase;
    }
    async execute(): Promise<void> {
        const from = phase;
        const to = decidePhase(this.bot);
        if (from !== to) {
            this.bot.log(`phase end: ${from}`);
            this.bot.log(`phase start: ${to}`);
            this.bot.setStatus(to);
            setPhase(to);
        }
    }
}
