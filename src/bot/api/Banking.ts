import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import {
    bankDistance,
    nearestBank,
    type BankLocation,
    type BankObjectAccess
} from './BankLocations.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { Bank } from './hud/Bank.js';
import { Inventory } from './hud/Inventory.js';
import { Locs } from './queries/Locs.js';
import { walkOpening } from './walkOpening.js';

/**
 * Snap radius for "I'm already at a bank" — booth underfoot / local stand.
 * Wider than a single booth tile so starting next to Draynor still counts when
 * the script's camp bank is Edgeville (Barb fly restock).
 */
export const NEARBY_BANK_RADIUS = 14;

/**
 * When a bot should break off and bank.
 * @see docs/API.md#bank
 */
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

/**
 * Shared banking parameters, mixed into a script's own settings schema.
 * @see docs/API.md#settings
 */
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

/**
 * Inventory junk that steals pack slots during long AFK loops (random-event
 * leftovers, common bank loot). Callers must still exclude tools/gear/logs.
 * Used by GatheringBot chop-then-burn when banking is deferred for a fire load.
 */
export function isDisposableGatherJunk(name: string | null | undefined, id: number = -1): boolean {
    if (matchesCommonBankLoot(name ?? '', id)) {
        return true;
    }
    const n = (name ?? '').toLowerCase().trim();
    if (n.length === 0) {
        return false;
    }
    // Misc event / world leftovers that are not gear and not a gather product.
    return (
        n === 'flier'
        || n === 'spin ticket'
        || n === 'security book'
        || n.includes('discount certificate')
        || n === 'half a meat pie'
        || n === 'half a redberry pie'
        || n === 'half an apple pie'
    );
}

export function depositMatcher(own: (name: string) => boolean, includeCommon: boolean): (name: string, id?: number) => boolean {
    return (name: string, id: number = -1) => own(name) || (includeCommon && matchesCommonBankLoot(name, id));
}

export function depositAllExcept(keep: Iterable<string>): (name: string) => boolean {
    const set = new Set([...keep].map(s => s.toLowerCase()));
    return (name: string) => name.length > 0 && !set.has(name.toLowerCase());
}

/**
 * Start-of-script pack cleanup (#170): if the inventory holds anything that is
 * not on the keep list, open a bank and deposit the rest so the bot can start
 * anywhere without a full junk pack.
 *
 * Returns true when nothing needed banking or the purge finished. False only
 * when junk remains and the bank could not be opened / deposited.
 */
export async function purgePackAtBank(opts: {
    /** Exact display names to keep (case-insensitive), e.g. pickaxe / rod. */
    keep: Iterable<string>;
    stand?: WorldTile | null;
    boothName?: string;
    boothOp?: string;
    obstacles?: string[];
    log?: (msg: string) => void;
}): Promise<boolean> {
    const log = opts.log ?? (() => {});
    const deposit = depositAllExcept(opts.keep);
    const junk = Inventory.items().filter(i => deposit(i.name ?? ''));
    if (junk.length === 0) {
        return true;
    }
    log(
        `start purge: banking ${junk.length} stack(s) ` +
            `(keep: ${[...opts.keep].join(', ') || 'none'})`
    );
    if (
        !(await Banking.open({
            stand: opts.stand ?? null,
            boothName: opts.boothName,
            boothOp: opts.boothOp,
            obstacles: opts.obstacles,
            log
        }))
    ) {
        log('start purge: could not open bank — leaving pack as-is');
        return false;
    }
    await Bank.depositAllMatching((name) => deposit(name));
    await Execution.delayTicks(1);
    await Bank.close().catch(() => undefined);
    const left = Inventory.items().filter(i => deposit(i.name ?? ''));
    if (left.length > 0) {
        log(`start purge: still holding ${left.length} junk stack(s) after deposit`);
        return false;
    }
    log('start purge: pack cleared');
    return true;
}

function realBooth(boothName: string) {
    return Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
}

/** Usable booth within Chebyshev `maxDist` of the player (scene-local). */
function nearbyUsableBooth(boothName: string, maxDist: number) {
    return Locs.query()
        .name(boothName)
        .where(l => l.actions().length > 0 && l.distance() <= maxDist)
        .nearest();
}

export interface OpenBankOpts {
    /**
     * Preset bank stand (location table). Used when no bank is already nearby.
     * Nearby booth / local nearestBank always wins when {@link preferNearby} is on.
     */
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
    /**
     * Prefer a bank already underfoot / in the local scene over a distant preset
     * stand. Default true — starting next to Draynor must not web-walk to Edgeville
     * just because the camp table says Edgeville.
     */
    preferNearby?: boolean;
    /** Chebyshev / booth distance for nearby snap. Default {@link NEARBY_BANK_RADIUS}. */
    nearbyRadius?: number;
    log?: (msg: string) => void;
}

export type BankOpenRoute = 'already-open' | 'scene-booth' | 'local-bank' | 'preset-stand' | 'nearest-fallback';

/**
 * Pure routing for {@link Banking.open} — unit-tested without the client.
 * Nearby scene booth or local known bank beats a distant camp/vendor stand.
 */
export function resolveBankOpenRoute(input: {
    bankOpen?: boolean;
    here: WorldTile | null;
    stand?: WorldTile | null;
    /** Distance to a usable booth in scene, or null if none within radius. */
    nearbyBoothDist: number | null;
    nearest: BankLocation | null;
    preferNearby?: boolean;
    nearbyRadius?: number;
}): BankOpenRoute {
    if (input.bankOpen) {
        return 'already-open';
    }
    const prefer = input.preferNearby !== false;
    const radius = input.nearbyRadius ?? NEARBY_BANK_RADIUS;
    if (prefer && input.nearbyBoothDist !== null && input.nearbyBoothDist <= radius) {
        return 'scene-booth';
    }
    const here = input.here;
    if (prefer && here && input.nearest) {
        const localD = bankDistance(here, input.nearest.tile);
        if (localD <= radius) {
            const stand = input.stand;
            // Already at/near a bank that isn't the preset — use it (Draynor vs Edgeville).
            if (!stand || bankDistance(here, stand) > radius) {
                return 'local-bank';
            }
            // Preset stand is also local (same bank area) — still fine to walk the stand.
        }
    }
    if (input.stand) {
        return 'preset-stand';
    }
    return 'nearest-fallback';
}

function asTile(t: WorldTile): Tile {
    return t instanceof Tile ? t : new Tile(t.x, t.z, t.level);
}

export const Banking = {
    /**
     * Open a bank for script work (deposit / withdraw / restock).
     *
     * Route (default {@link preferNearby} = true):
     * 1. Bank already open → done
     * 2. Usable booth within {@link nearbyRadius} → open it (ignore distant stand)
     * 3. Known {@link nearestBank} within radius and stand is far → walk that bank
     * 4. Preset `stand` → walkOpening / walkResilient → openBooth
     * 5. Else booth in scene → openNearest; else web-walk nearestBank
     *
     * Does not deposit or return — callers own the bank session.
     */
    async open(opts: OpenBankOpts = {}): Promise<boolean> {
        const boothName = opts.boothName ?? 'Bank booth';
        const boothOp = opts.boothOp ?? 'Use-quickly';
        const log = opts.log ?? (() => {});
        const obstacles = (opts.obstacles ?? []).map(s => s.trim().toLowerCase()).filter(Boolean);
        const preferNearby = opts.preferNearby !== false;
        const nearbyRadius = opts.nearbyRadius ?? NEARBY_BANK_RADIUS;

        if (Bank.isOpen()) {
            return true;
        }

        const here = Game.tile();
        const boothNear = preferNearby ? nearbyUsableBooth(boothName, nearbyRadius) : null;
        const nearest = here ? nearestBank(here) : null;
        const route = resolveBankOpenRoute({
            bankOpen: false,
            here,
            stand: opts.stand ?? null,
            nearbyBoothDist: boothNear ? boothNear.distance() : null,
            nearest,
            preferNearby,
            nearbyRadius
        });

        if (route === 'scene-booth') {
            log(`bank: booth within ${nearbyRadius} — opening here (skip long walk)`);
            return Bank.openNearestAccess({ name: boothName, op: boothOp }, log);
        }

        if (route === 'local-bank' && nearest) {
            log(`bank: local ${nearest.name} bank — using it instead of distant preset`);
            await Traversal.walkResilient(asTile(nearest.tile), { radius: 4, timeoutMs: 120_000, log });
            const access = nearest.access ?? { name: boothName, op: boothOp };
            return Bank.openNearestAccess(access, log);
        }

        if (route === 'preset-stand' && opts.stand) {
            const stand = asTile(opts.stand);
            if (obstacles.length > 0) {
                await walkOpening(stand, 2, obstacles, log);
            } else {
                await Traversal.walkResilient(stand, { radius: 2, timeoutMs: 120_000, log });
            }
            return Bank.openBooth(stand, boothName, boothOp, log);
        }

        // nearest-fallback (no stand): scene booth anywhere, else web-walk nearestBank
        let destination: BankDestination | null = null;
        if (!realBooth(boothName)) {
            destination = opts.destination ?? (nearest ? { name: nearest.name, tile: nearest.tile, access: nearest.access } : null);
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
            // Soft arrive — no need to stand on the exact return pin.
            await Traversal.walkResilient(asTile(opts.returnTo), { radius: 6, timeoutMs: 120_000, log });
        }
        return true;
    }
};
