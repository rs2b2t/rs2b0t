import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import type { DangerZoneRect } from '../../event/webwalk/data/dangerZones.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { foodForms } from '../../api/combat/food.js';
import { BOAT_FARE, cfg, PIER_TILE } from './config.js';
import {
    castsLeft,
    equippedProjectileCount,
    foodCount,
    hpFrac,
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

/** Top the food stack up to cfg.foodWithdraw (the "correct amount" for a trip). */
export async function topUpFood(bot: BrimhavenMossGiants): Promise<void> {
    bot.setStatus(`withdrawing ${cfg.foodName}`);
    for (let guard = 0; guard < 12 && primaryFoodCount() < cfg.foodWithdraw && !Inventory.isFull(); guard++) {
        const need = cfg.foodWithdraw - primaryFoodCount();
        const before = primaryFoodCount();
        await Bank.withdraw(cfg.foodName, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => primaryFoodCount() > before, 2500))) {
            break;
        }
    }
}

/** Food we can eat at the bank; mirrors the API foodForms but also accepts partial cake/pizza/pie forms so healing never stalls mid-cake. */
function edibleAtBank(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    if (foodForms(cfg.foodName).includes(n)) {
        return true;
    }
    return /\b\d\/\d (cake|pizza|pie)\b/.test(n) || n === 'slice of cake' || n === 'chocolate slice';
}

/** Eat food at the bank (safe) to recover HP so we return to the field healthy. */
export async function healAtBank(bot: BrimhavenMossGiants): Promise<void> {
    const maxHp = Skills.level('hitpoints');
    bot.log(`[healAtBank] start — hp=${Skills.effective('hitpoints')}/${maxHp}, foodName='${cfg.foodName}', invUsed=${Inventory.used()}, free=${Inventory.free()}`);
    // Spam-eat until full, out of food, or the 1-minute budget is up. We don't check
    // per-bite progress — eating is reliable and the eat cooldown is handled by the delay.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const hp = Skills.effective('hitpoints');
        if (hp >= maxHp) {
            bot.log(`[healAtBank] at full hp (${hp}/${maxHp}) — stopping`);
            break;
        }
        if (Inventory.isFull()) {
            bot.log('[healAtBank] inventory full — stopping');
            break;
        }
        // Prefer the configured food, then fall back to any edible item.
        const food =
            Inventory.items().find(i => foodForms(cfg.foodName).includes((i.name ?? '').toLowerCase())) ??
            Inventory.items().find(i => edibleAtBank(i.name));
        if (!food) {
            bot.log(`[healAtBank] no edible food found (inv=${Inventory.items().map(i => i.name).join(', ')}) — stopping`);
            break;
        }
        const foodName = food.name ?? '?';
        bot.setStatus(`healing at bank (${Math.round(hpFrac() * 100)}% hp)`);
        bot.log(`[healAtBank] eating '${foodName}' (hp ${hp}/${maxHp})`);
        await food.interact('Eat');
        // Wait out the eat cooldown (~3 ticks) before the next bite so clicks aren't dropped.
        await Execution.delayTicks(3);
    }
    bot.log(`[healAtBank] done — hp=${Skills.effective('hitpoints')}/${maxHp}`);
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
    // The bank's item list fills a beat after it opens — withdrawals before that read 0.
    if (!(await Execution.delayUntil(() => Bank.loaded(), 5000))) {
        bot.log('bank item list never loaded — will retry next bank trip');
        return;
    }

    if (withdrawFood) {
        // 1) grab a stack we can eat from + carry.
        await topUpFood(bot);
        // 2) the bank must be closed to eat — close, heal up (so we don't arrive low and burn
        //    the whole stack at once), then reopen to top off again.
        if (Skills.effective('hitpoints') < Skills.level('hitpoints') && (await Bank.close())) {
            await healAtBank(bot);
            if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => bot.log(`  ${m}`)))) {
                bot.log('could not reopen the bank to top off food — carrying what we have');
            }
        }
        // 3) top back up to the correct amount for the trip back to Brimhaven.
        await topUpFood(bot);

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
    await sailToField(bot);
}

/** Corridor (x>=2780, west of Captain Barnaby) to avoid so walkResilient repaths can never drift to the Port Sarim / Musa / Thresnor boat. */
const WRONG_BOAT_ZONE: DangerZoneRect = { minX: 2780, maxX: 3040, minZ: 3130, maxZ: 3330 };

function routeUsesWrongBoat(hops: readonly { locName?: string }[]): boolean {
    return hops.some(h => {
        const n = (h.locName ?? '').toLowerCase();
        return n.includes('thresnor') || n.includes('musa') || n.includes('port sarim');
    });
}

function routeUsesBarnaby(hops: readonly { locName?: string }[]): boolean {
    return hops.some(h => (h.locName ?? '').toLowerCase().includes('barnaby'));
}

/** Sail back to the field via Captain Barnaby, rejecting any route that uses the wrong boat (Thresnor / Musa / Port Sarim) instead. */
export async function sailToField(bot: BrimhavenMossGiants): Promise<void> {
    const to = { x: cfg.fieldTile.x, z: cfg.fieldTile.z, level: cfg.fieldTile.level };
    for (let attempt = 0; attempt < 4; attempt++) {
        const me = Game.tile();
        if (!me) {
            await Execution.delayTicks(2);
            continue;
        }
        const from = { x: me.x, z: me.z, level: me.level };
        const res = await Navigator.findPath(from, to, {
            timeoutMs: 8000,
            avoidZones: attempt > 0 ? [WRONG_BOAT_ZONE] : undefined
        });
        const hops = res.ok ? (res.hops ?? []) : [];
        const wrong = routeUsesWrongBoat(hops);
        const barnaby = routeUsesBarnaby(hops);
        if (!res.ok || wrong || !barnaby) {
            bot.log(`planned route rejected (ok=${res.ok}, barnaby=${barnaby}, wrongBoat=${wrong}) — replanning (attempt ${attempt + 1})`);
            continue;
        }
        bot.log('planned route uses Captain Barnaby — sailing to Brimhaven');
        // Anchor at the pier so the boat hop fires from a stationary, in-range spot.
        if (!(await Traversal.walkResilient(PIER_TILE, { radius: 2, attempts: 4, timeoutMs: 120_000, log: m => bot.log(`  ${m}`) }))) {
            bot.log('walk to the pier failed — sailing straight to the field');
        }
        if (await Traversal.walkResilient(cfg.fieldTile, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => bot.log(`  ${m}`) })) {
            return;
        }
        bot.log('sail to field failed — retrying');
    }
    // Last resort: walk without validation so we never stall (may still pick the wrong boat).
    bot.log('route validation exhausted — walking to the field without validation');
    if (!(await Traversal.walkResilient(PIER_TILE, { radius: 2, attempts: 4, timeoutMs: 120_000, log: m => bot.log(`  ${m}`) }))) {
        bot.log('walk to the pier failed — sailing straight to the field');
    }
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
