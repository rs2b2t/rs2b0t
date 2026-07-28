import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { nearestBank, type BankObjectAccess } from './BankLocations.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { Bank } from './hud/Bank.js';
import { Locs } from './queries/Locs.js';
import { walkOpening } from './walkOpening.js';

export type BankStrategy = 'off' | 'items' | 'time' | 'either';

export interface BankDestination {
    name: string;
    tile: WorldTile;
    access?: BankObjectAccess;
}

export interface BankTriggerState {
    lootCount: number;
    minutesSinceLastBank: number;
    itemsThreshold: number;
    minutesThreshold: number;
}

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

export const PERIODIC_BANK_SETTINGS: SettingsSchema = {
    bankStrategy: { type: 'string', default: 'Off', options: BANK_STRATEGY_OPTIONS, label: 'Periodic bank', help: 'save accumulated loot so a death does not lose it all' },
    bankEveryItems: { type: 'number', default: 15, min: 1, max: 27, label: 'Bank at N loot items' },
    bankEveryMinutes: { type: 'number', default: 10, min: 1, max: 120, label: 'Bank every N minutes' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also bank gems/fruit/beer/kebabs/caskets' }
};

export const COMMON_BANK_LOOT: string[] = [
    'uncut', 'sapphire', 'emerald', 'ruby', 'diamond', 'opal', 'jade', 'topaz',
    'strange fruit', 'beer', 'kebab'
];

export const RANDOM_EVENT_CASKET_ID = 405;

export function matchesCommonBankLoot(name: string, id: number = -1): boolean {
    if (id === RANDOM_EVENT_CASKET_ID) {
        return true;
    }
    if (name.length === 0) {
        return false;
    }
    const n = name.toLowerCase();
    return COMMON_BANK_LOOT.some(p => n.includes(p));
}

export function depositMatcher(own: (name: string) => boolean, includeCommon: boolean): (name: string, id?: number) => boolean {
    return (name: string, id: number = -1) => own(name) || (includeCommon && matchesCommonBankLoot(name, id));
}

export function depositAllExcept(keep: Iterable<string>): (name: string) => boolean {
    const set = new Set([...keep].map(s => s.toLowerCase()));
    return (name: string) => name.length > 0 && !set.has(name.toLowerCase());
}

function realBooth(boothName: string) {
    return Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
}

export interface OpenBankOpts {
    /** Preset bank stand (location table). When set, walk here then openBooth. */
    stand?: WorldTile | null;
    boothName?: string;
    boothOp?: string;
    /**
     * Openable obstacles on the way to a preset stand (doors/gates).
     * Empty = plain walkResilient to the stand.
     */
    obstacles?: string[];
    /** Optional forced destination when no booth is in scene and stand is unset. */
    destination?: BankDestination;
    log?: (msg: string) => void;
}

function asTile(t: WorldTile): Tile {
    return t instanceof Tile ? t : new Tile(t.x, t.z, t.level);
}

export const Banking = {
    /**
     * Open a bank for script work (deposit / withdraw / restock).
     * - Preset `stand`: walkOpening (if obstacles) or walkResilient → openBooth
     * - No stand: booth in scene → openNearestAccess; else web-walk nearestBank first
     *
     * Does not deposit or return — callers own the bank session.
     */
    async open(opts: OpenBankOpts = {}): Promise<boolean> {
        const boothName = opts.boothName ?? 'Bank booth';
        const boothOp = opts.boothOp ?? 'Use-quickly';
        const log = opts.log ?? (() => {});
        const obstacles = (opts.obstacles ?? []).map(s => s.trim().toLowerCase()).filter(Boolean);

        if (opts.stand) {
            const stand = asTile(opts.stand);
            if (obstacles.length > 0) {
                await walkOpening(stand, 2, obstacles, log);
            } else {
                await Traversal.walkResilient(stand, { radius: 2, timeoutMs: 120_000, log });
            }
            return Bank.openBooth(stand, boothName, boothOp, log);
        }

        let destination: BankDestination | null = null;
        if (!realBooth(boothName)) {
            const here = Game.tile();
            destination = opts.destination ?? (here ? nearestBank(here) : null);
            if (destination) {
                log(`no booth in scene — web-walking to the ${destination.name} bank at ${destination.tile}`);
                await Traversal.walkResilient(asTile(destination.tile), { radius: 4, timeoutMs: 120_000, log });
            }
        }

        const access = destination?.access ?? { name: boothName, op: boothOp };
        return Bank.openNearestAccess(access, log);
    },

    async bankNearest(opts: {
        deposit: (name: string) => boolean;
        commonJunk?: boolean;
        destination?: BankDestination;
        returnTo?: WorldTile;
        boothName?: string;
        boothOp?: string;
        afterDeposit?: () => void | Promise<void>;
        log?: (msg: string) => void;
    }): Promise<boolean> {
        const log = opts.log ?? (() => {});
        if (
            !(await Banking.open({
                boothName: opts.boothName,
                boothOp: opts.boothOp,
                destination: opts.destination,
                log
            }))
        ) {
            return false;
        }
        await Bank.depositAllMatching(depositMatcher(opts.deposit, opts.commonJunk ?? true));
        await opts.afterDeposit?.();
        await Execution.delayTicks(1);
        if (opts.returnTo) {
            await Traversal.walkResilient(asTile(opts.returnTo), { radius: 3, timeoutMs: 120_000, log });
        }
        return true;
    }
};
