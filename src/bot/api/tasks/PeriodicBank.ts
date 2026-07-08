// src/bot/api/tasks/PeriodicBank.ts
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { Task } from '../Bot.js';
import { Execution } from '../Execution.js';
import { Game } from '../Game.js';
import { Banking, shouldBankNow, type BankStrategy } from '../Banking.js';

/** After a failed attempt (no bank reachable), suppress ALL strategies this long. */
const FAILURE_BACKOFF_MS = 3 * 60_000;

export interface PeriodicBankOptions {
    strategy: () => BankStrategy;
    itemsThreshold: () => number;
    minutesThreshold: () => number;
    countLoot: () => number;
    deposit: (name: string) => boolean;
    returnTo?: () => WorldTile | null;
    setStatus?: (s: string) => void;
    log?: (m: string) => void;
}

/**
 * Opt-in: banks accumulated loot when the selected strategy trips, so a death
 * doesn't lose it all. Never fires mid-combat (so it doesn't abandon a fight);
 * resets its timer on every attempt and backs off ALL strategies after a failed
 * (unreachable-bank) attempt, so it doesn't livelock retrying an unreachable bank.
 */
export class PeriodicBank implements Task {
    private lastBankAt = performance.now();
    private suppressUntil = 0;

    constructor(private opts: PeriodicBankOptions) {}

    validate(): boolean {
        if (this.opts.strategy() === 'off' || Game.inCombat()) {
            return false;
        }
        if (performance.now() < this.suppressUntil) {
            return false;
        }
        return shouldBankNow(this.opts.strategy(), {
            lootCount: this.opts.countLoot(),
            minutesSinceLastBank: (performance.now() - this.lastBankAt) / 60_000,
            itemsThreshold: this.opts.itemsThreshold(),
            minutesThreshold: this.opts.minutesThreshold()
        });
    }

    async execute(): Promise<void> {
        this.opts.setStatus?.('periodic bank run');
        const ok = await Banking.bankNearest({
            deposit: this.opts.deposit,
            returnTo: this.opts.returnTo?.() ?? undefined,
            log: this.opts.log
        });
        this.lastBankAt = performance.now();
        if (!ok) {
            this.suppressUntil = performance.now() + FAILURE_BACKOFF_MS;
            this.opts.log?.('periodic bank: no bank reachable — will retry later');
            await Execution.delayTicks(3);
        }
    }
}
