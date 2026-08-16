import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { BOAT_FARE, cfg } from './config.js';
import {
    castsLeft,
    equippedProjectileCount,
    foodCount,
    keepNames,
    primaryFoodCount,
    rangeLoadout,
    rangeProjectile,
    equipPackProjectiles,
    walkToField,
    wieldedNames
} from './shared.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/** Withdraw up to `target` of `name` from the open bank. Returns how many were gained. */
export async function withdrawTo(name: string, target: number): Promise<number> {
    const start = Inventory.count(name);
    for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
        const before = Inventory.count(name);
        const need = target - before;
        if (need > 10 && (await Bank.withdrawX(name, need))) {
            if (Inventory.count(name) > before) {
                continue;
            }
            break;
        }
        await Bank.withdraw(name, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
            break;
        }
    }
    return Inventory.count(name) - start;
}

/** Pull weapon + style supplies (runes / projectiles) out of the bank. */
export async function withdrawStyleSupplies(bot: BrimhavenMossGiants): Promise<void> {
    // darts are the projectile stack (not a durable weapon) — restocked below
    const needWeapon =
        cfg.style !== 'melee' &&
        cfg.weapon !== '' &&
        !(cfg.style === 'range' && rangeLoadout().thrown) &&
        !Equipment.contains(cfg.weapon) &&
        Inventory.first(cfg.weapon) === null;
    if (needWeapon) {
        bot.setStatus(`withdrawing ${cfg.weapon}`);
        if ((await withdrawTo(cfg.weapon, 1)) > 0) {
            await Equipment.equip(cfg.weapon);
            bot.log(`withdrew and wielded ${cfg.weapon}`);
        } else {
            bot.log(`WARNING: no '${cfg.weapon}' in the bank — carrying on with current gear.`);
        }
    }
    if (cfg.style === 'mage') {
        bot.setStatus('withdrawing runes');
        for (const { rune, count } of runeWithdrawList(cfg.spell, wieldedNames(), cfg.runesWithdraw)) {
            if (Inventory.count(rune) < count) {
                const got = await withdrawTo(rune, count);
                bot.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${count})`);
            }
        }
        if (castsLeft() < 1) {
            bot.noteSupplyEmpty(true);
            bot.log(`WARNING: bank can't supply a single '${cfg.spell}' cast — deposit runes to resume.`);
        } else {
            bot.noteSupplyEmpty(false);
        }
    } else if (cfg.style === 'range') {
        const projectile = rangeProjectile();
        bot.setStatus(`withdrawing ${projectile}`);
        const got = await withdrawTo(projectile, cfg.ammoWithdraw);
        if (got > 0) {
            // bank modal blocks equip — same pattern as RockCrab dart restock
            if (!(await Bank.close()) || !(await equipPackProjectiles())) {
                bot.log(`WARNING: withdrew ${projectile}, but could not equip the stack — will retry from the pack`);
            }
            bot.log(`withdrew ${got} ${projectile} — ${equippedProjectileCount()} equipped`);
            bot.noteSupplyEmpty(false);
        } else if (equippedProjectileCount() === 0 && Inventory.count(projectile) === 0) {
            bot.noteSupplyEmpty(true);
            bot.log(`WARNING: no '${projectile}' in the bank — deposit projectiles to resume.`);
        }
    }
}

/** Walk to the bank, deposit loot, restock, grab boat coins, then sail back. */
export async function bankRoutine(bot: BrimhavenMossGiants, withdrawFood: boolean): Promise<void> {
    if (!(await Traversal.walkResilient(cfg.bankTile, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) }))) {
        bot.log('walk to the bank failed — will retry');
        return;
    }
    if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => bot.log(`  ${m}`)))) {
        bot.log('could not open the bank — will retry');
        return;
    }
    await Bank.depositAllMatching(depositAllExcept(keepNames()), m => bot.log(`  ${m}`));

    if (withdrawFood) {
        bot.setStatus(`withdrawing ${cfg.foodName}`);
        for (let guard = 0; guard < 12 && primaryFoodCount() < cfg.foodWithdraw && !Inventory.isFull(); guard++) {
            const need = cfg.foodWithdraw - primaryFoodCount();
            const before = primaryFoodCount();
            await Bank.withdraw(cfg.foodName, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
            if (!(await Execution.delayUntil(() => primaryFoodCount() > before, 2500))) {
                break;
            }
        }
        if (primaryFoodCount() === 0) {
            bot.noteBankEmpty(true);
            bot.log(`WARNING: no '${cfg.foodName}' in the bank — carrying on without food. Deposit food (or fix the name) to resume eating.`);
        } else {
            bot.noteBankEmpty(false);
        }
    }

    await withdrawStyleSupplies(bot);

    // Brimhaven always needs coins for the Ardougne<->Brimhaven boat (outbound + return).
    const fareTarget = BOAT_FARE * 2;
    if (Inventory.count('Coins') < fareTarget) {
        bot.setStatus('withdrawing coins for the boat');
        const got = await withdrawTo('Coins', fareTarget);
        bot.log(`withdrew ${got} coins (${Inventory.count('Coins')}) for the Ardougne↔Brimhaven boat`);
        if (Inventory.count('Coins') < BOAT_FARE) {
            bot.log('WARNING: not enough coins for the boat — deposit more coins to reach Brimhaven.');
        }
    }

    bot.countBankTrip();
    bot.setStatus('restocked — sailing back to Brimhaven');
    await walkToField(bot);
}

/** The BANK phase: walk to the bank, restock, then sail back to the field. */
export class Banking implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return getPhase() === Phase.Bank && !EventSignal.pending();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking — restocking');
        this.bot.log(
            `banking (food ${foodCount()}${cfg.style === 'mage' ? `, casts ${castsLeft()}` : ''}${cfg.style === 'range' ? `, projectiles ${equippedProjectileCount() + Inventory.count(rangeProjectile())}` : ''})`
        );
        await bankRoutine(this.bot, true);
    }
}
