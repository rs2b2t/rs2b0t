// src/bot/api/Banking.ts
import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { nearestBank } from './BankLocations.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import { Traversal } from './Traversal.js';
import { Bank } from './hud/Bank.js';
import { Locs } from './queries/Locs.js';

export type BankStrategy = 'off' | 'items' | 'time' | 'either';

export interface BankTriggerState {
    lootCount: number;
    minutesSinceLastBank: number;
    itemsThreshold: number;
    minutesThreshold: number;
}

/** Pure: does the selected strategy say to bank now? Never trips with no loot. */
export function shouldBankNow(strategy: BankStrategy, s: BankTriggerState): boolean {
    if (s.lootCount <= 0) {
        return false;
    }
    const byItems = s.lootCount >= s.itemsThreshold;
    const byTime = s.minutesSinceLastBank >= s.minutesThreshold;
    switch (strategy) {
        case 'off':
            return false;
        case 'items':
            return byItems;
        case 'time':
            return byTime;
        case 'either':
            return byItems || byTime;
    }
}

export const BANK_STRATEGY_OPTIONS = ['Off', 'Loot count', 'Time', 'Either'];

/** Map the settings-dropdown label to a BankStrategy (unknown -> off). */
export function parseBankStrategy(label: string): BankStrategy {
    switch (label.trim().toLowerCase()) {
        case 'loot count':
            return 'items';
        case 'time':
            return 'time';
        case 'either':
            return 'either';
        default:
            return 'off';
    }
}

/** Settings fragment an opt-in bot spreads into its schema. */
export const PERIODIC_BANK_SETTINGS: SettingsSchema = {
    bankStrategy: { type: 'string', default: 'Off', options: BANK_STRATEGY_OPTIONS, label: 'Periodic bank', help: 'save accumulated loot so a death does not lose it all' },
    bankEveryItems: { type: 'number', default: 15, min: 1, max: 27, label: 'Bank at N loot items' },
    bankEveryMinutes: { type: 'number', default: 10, min: 1, max: 120, label: 'Bank every N minutes' }
};

function realBooth(boothName: string) {
    return Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
}

export const Banking = {
    /**
     * Bank at the nearest bank. Real booth in the loaded scene → use it; else
     * web-walk to the nearest known bank (BANK_LOCATIONS). Bank.openNearest then
     * walks onto a reachable stand beside the booth and opens it (reach-the-stall
     * guarantee). Deposit everything `deposit` matches; optionally web-walk back
     * to `returnTo`. True once loot was deposited; false if no bank was reachable
     * or it could not open.
     */
    async bankNearest(opts: {
        deposit: (name: string) => boolean;
        returnTo?: WorldTile;
        boothName?: string;
        boothOp?: string;
        log?: (msg: string) => void;
    }): Promise<boolean> {
        const boothName = opts.boothName ?? 'Bank booth';
        const boothOp = opts.boothOp ?? 'Use-quickly';
        const log = opts.log ?? (() => {});

        if (!realBooth(boothName)) {
            const here = Game.tile();
            const bank = here ? nearestBank(here) : null;
            if (bank) {
                log(`no booth in scene — web-walking to the ${bank.name} bank at ${bank.tile}`);
                await Traversal.walkResilient(bank.tile, { radius: 4, timeoutMs: 120_000, log });
            }
        }
        if (!realBooth(boothName)) {
            return false;
        }
        if (!(await Bank.openNearest(boothName, boothOp, log))) {
            return false;
        }
        await Bank.depositAllMatching(opts.deposit);
        await Execution.delayTicks(1);
        if (opts.returnTo) {
            await Traversal.walkResilient(opts.returnTo, { radius: 3, timeoutMs: 120_000, log });
        }
        return true;
    }
};
