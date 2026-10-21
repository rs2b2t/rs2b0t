import type { Task } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { nearestBankReachable } from '../../api/bank/BankLocations.js';
import { isEdibleFood } from '../../api/combat/food.js';
import { shouldPanic } from '../../api/inventory/packRules.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reach } from '../../api/walking/Reach.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import {
    pickWanderTile,
    shouldBankLoot,
    shouldDepositOnBank,
    shouldIdleBank,
    type LootAttemptStatus
} from './WanderLooterLogic.js';
import type WanderLooter from './WanderLooter.js';

export async function eatOne(bot: WanderLooter): Promise<boolean> {
    if (Bank.isOpen() || !bot.needEat()) {
        return false;
    }
    const food = Inventory.items().find(item => isEdibleFood(item, bot.foodName()));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
    const before = Skills.effective('hitpoints');
    if (!(await food.interact('Eat'))) {
        return false;
    }
    const healed = await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
    if (healed) {
        bot.countEat();
    }
    return healed;
}

export class EatFood implements Task {
    readonly label = 'Eat food';
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        return !Bank.isOpen() && this.bot.needEat();
    }

    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (EventSignal.pending() || !this.bot.needEat()) {
                return;
            }
            if (!(await eatOne(this.bot))) {
                return;
            }
        }
    }
}

export class FleeLowHealth implements Task {
    readonly label = 'Flee low health';
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        return shouldPanic(Skills.hpFraction(), this.bot.panicAt(), this.bot.foodCount());
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        this.bot.setStatus('low health — fleeing');
        this.bot.log(`fleeing at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp with no food`);
        const bank = here ? await nearestBankReachable(here, Navigator) : null;
        if (!bank) {
            this.bot.requestFinish('fled low health: no reachable bank');
            return;
        }
        const arrived = await Traversal.walkResilient(bank.tile, {
            radius: 4,
            timeoutMs: 180_000,
            log: message => this.bot.log(`  ${message}`)
        });
        this.bot.requestFinish(arrived
            ? `fled to the ${bank.name} bank at low health`
            : `fled low health: could not reach the ${bank.name} bank`);
    }
}

async function bankTrip(bot: WanderLooter, reason: string): Promise<boolean> {
    bot.setStatus('banking loot');
    bot.log(`banking (${reason})`);
    const ok = await Banking.bankNearest({
        deposit: name => shouldDepositOnBank(
            name,
            bot.foodName(),
            bot.foodCount(),
            bot.foodWithdraw()
        ),
        commonJunk: false,
        afterDeposit: async () => {
            await withdrawFood(bot);
        },
        log: message => bot.log(`  ${message}`)
    });
    await Bank.close().catch(() => undefined);
    if (!ok) {
        return false;
    }
    bot.noteBank();
    bot.log(`banked loot (trip ${bot.trips()})`);
    return true;
}

export class BankRun implements Task {
    readonly label = 'Bank run';
    private nextTryAt = 0;
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        return Date.now() >= this.nextTryAt
            && shouldBankLoot(this.bot.lootSlots(), this.bot.bankAt(), Inventory.isFull());
    }

    async execute(): Promise<void> {
        const reason = Inventory.isFull() ? 'inventory full' : `${this.bot.lootSlots()}/${this.bot.bankAt()} loot slots`;
        if (await bankTrip(this.bot, reason)) {
            this.nextTryAt = 0;
            return;
        }
        this.nextTryAt = Date.now() + 60_000;
        this.bot.log('bank run failed — retrying in 60s');
    }
}

async function withdrawFood(bot: WanderLooter): Promise<void> {
    const target = bot.foodWithdraw();
    if (target <= 0) {
        return;
    }
    for (let guard = 0; guard < 40 && bot.foodCount() < target && !Inventory.isFull(); guard++) {
        const before = bot.foodCount();
        const need = target - before;
        const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
        if (!(await Bank.withdraw(bot.foodName(), op))) {
            break;
        }
        if (!(await Execution.delayUntil(() => bot.foodCount() > before, 2500))) {
            break;
        }
    }
    if (bot.foodCount() === 0) {
        bot.log(`no '${bot.foodName()}' in the bank — continuing foodless`);
    }
}

function countItem(id: number): number {
    return Inventory.countById(id);
}

export class LootDrops implements Task {
    readonly label = 'Loot drops';
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        this.bot.observeHealth();
        return !Inventory.isFull() && this.bot.findLoot() !== null;
    }

    async execute(): Promise<void> {
        const hpBefore = this.bot.observeHealth();
        const drop = this.bot.findLoot();
        if (!drop) {
            return;
        }
        const id = drop.id;
        const name = drop.name ?? 'loot';
        const tile = drop.tile();
        if (this.bot.damageNear(tile)) {
            this.bot.blacklist.markUnsafe(id, tile);
            this.bot.log(`blacklisting ${name} at ${tile} for 30m — damage nearby before looting`);
            return;
        }
        this.bot.setStatus(`looting ${name} at ${tile}`);
        const find = () => this.bot.findLootAt(id, tile);
        const before = countItem(id);
        const status = await Reach.entityOp({
            find,
            op: 'Take',
            expect: () => countItem(id) > before,
            expectMs: 5000,
            what: name,
            log: message => this.bot.log(message)
        });
        const hurt = this.bot.observeHealth() < hpBefore;
        if (status === 'done' && countItem(id) > before) {
            const now = Date.now();
            this.bot.blacklist.success(id, tile);
            this.bot.noteLoot(now);
            this.bot.log(`looted ${name} at ${tile}`);
            if (hurt) {
                this.bot.blacklist.markUnsafe(id, tile);
                this.bot.log(`blacklisting ${name} at ${tile} for 30m — took damage while looting`);
            } else {
                this.bot.notePickup(id, tile, now);
            }
            return;
        }
        if (hurt) {
            this.bot.blacklist.markUnsafe(id, tile);
            this.bot.log(`blacklisting ${name} at ${tile} for 30m — took damage while trying to loot`);
            return;
        }
        this.handleFailure(id, name, tile, status);
    }

    private handleFailure(id: number, name: string, tile: WorldTile, status: LootAttemptStatus): void {
        const result = this.bot.blacklist.failure(id, tile, status);
        if (result === 'blacklisted') {
            const until = status === 'unreachable' ? 'unreachable' : 'stuck';
            this.bot.log(`blacklisting ${until} loot '${name}' id=${id} at ${tile} for 30m`);
            return;
        }
        this.bot.log(`loot '${name}' id=${id} at ${tile} did not complete (${status}); still trying`);
    }
}

export class Wander implements Task {
    readonly label = 'Wander';
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        return true;
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        if (!here) {
            return;
        }
        let target: WorldTile | null = null;
        for (let attempt = 0; attempt < 6 && target === null; attempt++) {
            const candidate = pickWanderTile(
                here,
                this.bot.wanderDistance(),
                tile => (attempt === 0 || tile.level === here.level) && this.bot.canWanderTo(tile),
                Math.random,
                this.bot.wanderDirection()
            );
            if (candidate && await this.bot.canWalkTo(candidate)) {
                target = candidate;
            }
        }
        if (!target) {
            this.bot.noteWander();
            this.bot.log('no reachable wander target — trying again');
            return;
        }
        const steps = Math.max(Math.abs(target.x - here.x), Math.abs(target.z - here.z));
        this.bot.setStatus(`wandering ${steps} steps to ${target}`);
        this.bot.log(`wandering ${steps} steps to ${target}`);
        const arrived = await Traversal.walkResilient(target, {
            radius: 3,
            timeoutMs: 120_000,
            log: message => this.bot.log(`  ${message}`)
        });
        this.bot.noteWander(here, target);
        this.bot.log(arrived ? `wandered to ${target}` : `wander to ${target} did not complete`);
    }
}

export class IdleBank implements Task {
    readonly label = 'Bank when idle';
    private nextTryAt = 0;
    constructor(private readonly bot: WanderLooter) {}

    validate(): boolean {
        return Date.now() >= this.nextTryAt
            && shouldIdleBank(Date.now(), this.bot.lastLootAt, this.bot.bankAfterMs());
    }

    async execute(): Promise<void> {
        const minutes = Math.round(this.bot.bankAfterMs() / 60_000);
        if (await bankTrip(this.bot, `no loot for ${minutes} minutes`)) {
            this.nextTryAt = 0;
            this.bot.restartIdleTimer();
            return;
        }
        this.nextTryAt = Date.now() + 60_000;
        this.bot.log('bank run failed — retrying in 60s');
    }
}
