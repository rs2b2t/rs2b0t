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

const BANK_STRATEGY_OPTIONS = ['Off', 'Loot count', 'Time', 'Either'];

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
    bankEveryMinutes: { type: 'number', default: 10, min: 1, max: 120, label: 'Bank every N minutes' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also bank gems/fruit/beer/kebabs' }
};

// Junk every banking bot offloads unless it opts out (bankCommonJunk=false).
// Name-contains (case-insensitive), like all deposit filters. NOTE: 'sapphire'
// etc. also match cut-gem jewellery — intended (saving a valuable); opt out per
// bot if a script wants to keep them.
export const COMMON_BANK_LOOT: string[] = [
    'uncut', 'sapphire', 'emerald', 'ruby', 'diamond', 'opal', 'jade', 'topaz',
    'strange fruit', 'beer', 'kebab'
];

export function matchesCommonBankLoot(name: string): boolean {
    if (name.length === 0) {
        return false;
    }
    const n = name.toLowerCase();
    return COMMON_BANK_LOOT.some(p => n.includes(p));
}

/** Compose a bot's own deposit predicate with the shared junk list. */
export function depositMatcher(own: (name: string) => boolean, includeCommon: boolean): (name: string) => boolean {
    return (name: string) => own(name) || (includeCommon && matchesCommonBankLoot(name));
}

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
        commonJunk?: boolean;
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
        await Bank.depositAllMatching(depositMatcher(opts.deposit, opts.commonJunk ?? true));
        await Execution.delayTicks(1);
        if (opts.returnTo) {
            await Traversal.walkResilient(opts.returnTo, { radius: 3, timeoutMs: 120_000, log });
        }
        return true;
    }
};
