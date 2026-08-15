import type { WorldTile } from '../../adapter/ClientAdapter.js';
import {
    bankDistance,
    nearestBank,
    type BankLocation,
    type BankNpcAccess,
    type BankObjectAccess
} from './BankLocations.js';
import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../walking/Traversal.js';
import { Bank } from './Bank.js';
import { Inventory } from '../inventory/Inventory.js';
import { Locs } from '../locs/Locs.js';
import { depositAllExcept, depositMatcher } from './bankRules.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';

/**
 * Snap radius for "I'm already at a bank" — booth underfoot or local stand.
 * Why: wider than a single booth tile so starting next to Draynor still counts when the script's camp bank is Edgeville (Barb fly restock).
 */
export const NEARBY_BANK_RADIUS = 14;

export {
    COMMON_BANK_LOOT,
    PERIODIC_BANK_SETTINGS,
    RANDOM_EVENT_CASKET_ID,
    depositAllExcept,
    depositMatcher,
    isDisposableGatherJunk,
    matchesCommonBankLoot,
    parseBankStrategy,
    shouldBankNow,
    type BankStrategy,
    type BankTriggerState
} from './bankRules.js';

export interface BankDestination {
    name: string;
    tile: WorldTile;
    access?: BankObjectAccess;
    /** Set when the bank is a person (Gundai) rather than a booth. */
    npcAccess?: BankNpcAccess;
}

/** A bank behind a conversation opens differently from one behind a booth. */
function openAccess(
    dest: { access?: BankObjectAccess; npcAccess?: BankNpcAccess } | null,
    fallback: BankObjectAccess,
    log?: (m: string) => void
): boolean | Promise<boolean> {
    if (dest?.npcAccess) {
        return Bank.openNpcAccess(dest.npcAccess, log);
    }
    return Bank.openNearestAccess(dest?.access ?? fallback, log);
}

/**
 * Start-of-script pack cleanup (#170): deposit anything not on the keep list so the bot can start anywhere without a full junk pack.
 * Why: true when nothing needed banking or the purge finished; false only when junk remains and the bank could not be opened or deposited.
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
     * Prefer a bank already underfoot or in the local scene over a distant preset stand; default true.
     * Why: starting next to Draynor must not web-walk to Edgeville because the camp table says Edgeville.
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
     * Open a bank for script work (deposit, withdraw, restock).
     * Why: this neither deposits nor returns — callers own the bank session.
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
            return openAccess(nearest, { name: boothName, op: boothOp }, log);
        }

        if (route === 'preset-stand' && opts.stand) {
            const stand = asTile(opts.stand);
            if (obstacles.length > 0) {
                await walkOpening(stand, 2, obstacles, log);
            } else {
                await Traversal.walkResilient(stand, { radius: 2, timeoutMs: 120_000, log });
            }
            // Shantay / Duel Arena / Gundai: the known bank's access beats a generic booth name.
            const known = nearestBank(stand);
            if (
                known
                && (known.access || known.npcAccess)
                && bankDistance(stand, known.tile) <= nearbyRadius
            ) {
                log(`bank: ${known.name} uses ${known.npcAccess ? 'npc' : 'object'} access`);
                return openAccess(known, { name: boothName, op: boothOp }, log);
            }
            return Bank.openBooth(stand, boothName, boothOp, log);
        }

        // nearest-fallback (no stand): scene booth anywhere, else web-walk nearestBank
        let destination: BankDestination | null = null;
        if (!realBooth(boothName)) {
            destination = opts.destination ?? (nearest ? { name: nearest.name, tile: nearest.tile, access: nearest.access, npcAccess: nearest.npcAccess } : null);
            if (destination) {
                log(`no booth in scene — web-walking to the ${destination.name} bank at ${destination.tile}`);
                await Traversal.walkResilient(asTile(destination.tile), { radius: 4, timeoutMs: 120_000, log });
            }
        }

        return openAccess(destination, { name: boothName, op: boothOp }, log);
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

/**
 * Human-ish pause between bank UI actions (open→scan, withdraw, deposit).
 * Why: tick-based at 1–2 ticks so bank load is not raced by open→scan→close on the same tick after the GatheringBot split.
 */
export function bankPaceTicks(rand: () => number = Math.random): number {
    return rand() < 0.35 ? 2 : 1;
}

/** Pause between bank UI actions so tool checks don't flash open/close. */
export async function bankPace(log?: (m: string) => void): Promise<void> {
    const ticks = bankPaceTicks();
    log?.(`bank: pause ${ticks}t`);
    await Execution.delayTicks(ticks);
}

/**
 * Wait for bank item list after open. Counts stay 0 until loaded — without a
 * human pause this looks like an instant open→scan→close.
 */
export async function waitBankReady(log?: (m: string) => void): Promise<boolean> {
    if (!Bank.isOpen()) {
        return false;
    }
    await bankPace(log);
    // ~7 ticks for bank table load
    await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 7);
    if (!Bank.isOpen()) {
        return false;
    }
    await Execution.delayTicks(1);
    await bankPace();
    return Bank.isOpen();
}

/**
 * Withdraw coins so inventory holds at least `need`. Bank must already be open.
 * Returns false when the bank has no coins or the withdraw fails.
 */
export async function withdrawCoins(
    need: number,
    opts: {
        invCoins: number;
        bankCoins: number;
        coinName?: string;
        log?: (m: string) => void;
    }
): Promise<boolean> {
    const log = opts.log ?? (() => {});
    const coin = opts.coinName ?? 'Coins';
    const take = Math.max(0, need - opts.invCoins);
    if (take <= 0) {
        return true;
    }
    if (!Bank.isOpen()) {
        return false;
    }
    if (opts.bankCoins <= 0) {
        log(`acquire: no coins in bank (need ${need}gp)`);
        return false;
    }
    const amt = Math.min(take, opts.bankCoins);
    log(`acquire: withdraw ${amt}gp`);
    await bankPace();
    if (!(await Bank.withdrawX(coin, amt))) {
        return false;
    }
    const ok = await Execution.delayUntilTicks(() => Inventory.count(coin) >= Math.min(need, opts.invCoins + amt), 7);
    if (ok) {
        await bankPace();
    }
    return ok;
}
