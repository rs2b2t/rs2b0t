import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { BANK_STAND_COORDINATES } from '../../data/bankStandCoordinates.js';
import { bankDistance } from '../../geometry/distance.js';
import { SettingsStore } from '../../runtime/Settings.js';
import { Quests } from '../ui/questlog/Quests.js';
import { Skills } from '../skills/Skills.js';
import Tile from '../../geometry/Tile.js';

export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string;
    // Why: Gundai's cellar is reached by slashing into ~level 55 Wilderness, so an Ardougne script must never pick it up for being a few tiles closer.
    // Why: off by default, so a Wilderness bot opts in.

    /** A Global setting that must be true before this bank is offered at all. */
    setting?: string;
}

export interface BankObjectAccess {
    name: string;
    op: string;
    openFirst?: {
        name: string;
        op: string;
    };
}

export interface BankNpcAccess {
    name: string;
    op: string;
    /** The dialogue option that opens the bank, when the banker surfaces one. */
    choose?: string;
}

/**
 * A bank, its stand tile, and how to open it.
 * @see docs/reference/api-items.md#bank
 */
export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
    access?: BankObjectAccess;
    npcAccess?: BankNpcAccess;
    // Why: callers still walk to `tile`, since the nav graph knows how to get there.
    // Why: ranking is straight-line, and Gundai's cellar at z=4714 scores ~800 tiles from the ladder it's reached by, so it would never be chosen.

    /** Where the surface route to this bank starts, for distance ranking only. */
    approach?: Tile;
}

/** Global setting key gating the Mage Arena bank. @see BankRequirement.setting */
export const USE_MAGE_BANK = 'useMageBank';
export const USE_ZANARIS_BANK = 'useZanarisBank';

/**
 * Every known bank. Some stands are sealed collision islands, so reaching one is a data problem.
 * @see docs/reference/nav-walker.md#arrival
 */
export const BANK_LOCATIONS: BankLocation[] = [
    { name: 'Varrock East', tile: new Tile(...BANK_STAND_COORDINATES.varrockEast) },
    { name: 'Varrock West', tile: new Tile(...BANK_STAND_COORDINATES.varrockWest) },
    { name: 'Al Kharid', tile: new Tile(...BANK_STAND_COORDINATES.alKharid) },
    { name: 'Draynor', tile: new Tile(...BANK_STAND_COORDINATES.draynor) },
    { name: 'Falador East', tile: new Tile(...BANK_STAND_COORDINATES.faladorEast) },
    { name: 'Falador West', tile: new Tile(...BANK_STAND_COORDINATES.faladorWest) },
    { name: 'Edgeville', tile: new Tile(...BANK_STAND_COORDINATES.edgeville) },
    { name: 'Seers', tile: new Tile(...BANK_STAND_COORDINATES.seers) },
    { name: 'Catherby', tile: new Tile(...BANK_STAND_COORDINATES.catherby) },
    { name: 'Yanille', tile: new Tile(...BANK_STAND_COORDINATES.yanille) },
    { name: 'Ardougne West', tile: new Tile(...BANK_STAND_COORDINATES.ardougneWest) },
    { name: 'Ardougne East', tile: new Tile(...BANK_STAND_COORDINATES.ardougneEast) },
    { name: 'Canifis', tile: new Tile(...BANK_STAND_COORDINATES.canifis), requires: { quest: 'Priest in Peril' } },
    // Why: Shilo has no booth: `bank_store_icon` is the only bank loc in the mapsquare and the teller is `shilobanker` (npc 499), whose `op3=Bank` runs `@openbank`. Without npcAccess the booth query finds nothing and the bank never opens.
    // Why: the quest gate is the village itself: every tile is behind Vigroy's cart, and `shiloCartEdges` refuses the Brimhaven crossing until Shilo Village is complete.
    {
        name: 'Shilo Village',
        tile: new Tile(...BANK_STAND_COORDINATES.shiloVillage),
        requires: { quest: 'Shilo Village' },
        npcAccess: { name: 'Banker', op: 'Bank' }
    },
    { name: 'Zanaris', tile: new Tile(...BANK_STAND_COORDINATES.zanaris), requires: { quest: 'Lost City', setting: USE_ZANARIS_BANK }, npcAccess: { name: 'Banker', op: 'Bank' } },
    { name: 'Fishing Guild', tile: new Tile(...BANK_STAND_COORDINATES.fishingGuild), requires: { skill: { name: 'fishing', level: 68 } } },
    { name: 'Legends Guild', tile: new Tile(...BANK_STAND_COORDINATES.legendsGuild), requires: { quest: 'Legends Quest' }, npcAccess: { name: 'Banker', op: 'Bank' } },
    // Why: the live object is "Shantay chest" (id 2693) with Open; "Bank chest" with Use doesn't exist here, and neither does a Bank booth.
    {
        name: 'Shantay Pass',
        tile: new Tile(...BANK_STAND_COORDINATES.shantayPass),
        access: { name: 'Shantay chest', op: 'Open' }
    },
    // Why: Gundai's cellar, where magearena_ladder_to_cellar lands: slash the 2 bigweb_slashable webs along z=3957 and climb down at (3091,3958), all 3 baked as edges. Kolodion's arena teleport is unrelated.
    // Why: still gated, because that's ~level 55 Wilderness and the webs need a wielded slash weapon, so it must not win on distance for a script working elsewhere.
    {
        name: 'Mage Arena',
        tile: new Tile(...BANK_STAND_COORDINATES.mageArena),
        requires: { setting: USE_MAGE_BANK },
        approach: new Tile(3091, 3958, 0),
        npcAccess: { name: 'Gundai', op: 'Talk-to', choose: "I'd like to access my bank account" }
    },
    // Why: the Grand Tree 1F bank booths (SE of the trunk ladder) open without the Grand Tree quest, though the mine still requires it.
    // Why: the stand is in front of the south booth row.
    { name: 'Grand Tree', tile: new Tile(...BANK_STAND_COORDINATES.grandTree) },
    {
        name: 'Duel Arena',
        tile: new Tile(...BANK_STAND_COORDINATES.duelArena),
        access: {
            name: 'Open chest',
            op: 'Bank',
            openFirst: { name: 'Closed chest', op: 'Open' }
        }
    }
];

export { bankDistance };

export function bankTile(bankName: string): Tile {
    const loc = BANK_LOCATIONS.find(b => b.name === bankName);
    if (!loc) {
        throw new Error(`bankTile: unknown bank '${bankName}'`);
    }
    return loc.tile;
}

/** The tile a bank is walked to, its approach when it has one. */
export function approachOf(bank: BankLocation): Tile {
    return bank.approach ?? bank.tile;
}

// Why: ranked on x/z across planes, because stair edges are baked into the nav graph and a bank one floor down is a walk like any other.
// Why: matching planes made the Grand Tree, the one bank off level 0, the only candidate for anyone standing upstairs anywhere.
// Why: straight-line order can't see a toll gate or a fare, so a caller that needs a walkable bank probes these in order.

/** Every bank this account can use, nearest first by straight line. */
export function nearestBanks(from: WorldTile): BankLocation[] {
    return BANK_LOCATIONS.filter(bank => meetsRequirement(bank)).sort((a, b) => bankDistance(from, approachOf(a)) - bankDistance(from, approachOf(b)));
}

export function nearestUsableBank(from: WorldTile, usable: (bank: BankLocation) => boolean): BankLocation | null {
    let best: BankLocation | null = null;
    let bestD = Infinity;
    for (const bank of BANK_LOCATIONS) {
        if (!usable(bank)) {
            continue;
        }
        const d = bankDistance(from, approachOf(bank));
        if (d < bestD) {
            bestD = d;
            best = bank;
        }
    }
    return best;
}

/** Whether this account's quests and stats unlock the bank at all. */
export function bankUnlocked(bank: BankLocation): boolean {
    return meetsRequirement(bank);
}

export function lockedBankAt(tile: WorldTile): BankLocation | null {
    return BANK_LOCATIONS.find(bank => bank.tile.level === tile.level
        && bank.tile.distanceTo(tile) <= 14 && !bankUnlocked(bank)) ?? null;
}

function meetsRequirement(bank: BankLocation): boolean {
    const req = bank.requires;
    if (!req) {
        return true;
    }
    if (req.skill && Skills.level(req.skill.name) < req.skill.level) {
        return false;
    }
    if (req.quest && Quests.status(req.quest) !== 'complete') {
        return false;
    }
    if (req.setting && !SettingsStore.globalBag().bool(req.setting, false)) {
        return false;
    }
    return true;
}

export function nearestBank(from: WorldTile): BankLocation | null {
    return nearestUsableBank(from, meetsRequirement);
}

// Why: inside a dungeon the z-offset (~6400) dwarfs every straight-line bank difference, so air ranking collapses to "closest by x only" and can pick a bank far from the mine exit. Buying the cost of every candidate to its real tile is what flips Edgeville to Falador East.

/** Walk cost in run-tiles from `from` to a bank, or null when the bank is unreachable. */
export type BankPathCost = (from: WorldTile, to: Tile) => number | null;

function cheapestBank(banks: readonly BankLocation[], costFor: (bank: BankLocation, index: number) => number | null): BankLocation | null {
    let best: BankLocation | null = null;
    let bestCost = Infinity;
    for (const [index, bank] of banks.entries()) {
        const cost = costFor(bank, index);
        if (cost !== null && cost < bestCost) {
            bestCost = cost;
            best = bank;
        }
    }
    return best;
}

export function nearestWalkableBank(from: WorldTile, pathCost: BankPathCost): BankLocation | null {
    return cheapestBank(nearestBanks(from), bank => pathCost(from, bank.tile));
}

/** Async walk cost: the nav pack lives in the worker, so a live caller pays per {@link Navigator.findPath} instead of a local {@link PathFinder}. */
export type BankPathCostAsync = (from: WorldTile, to: Tile) => Promise<number | null>;

export async function nearestWalkableBankAsync(from: WorldTile, pathCost: BankPathCostAsync): Promise<BankLocation | null> {
    // Why: Promise.all keeps a full shortlist batch at one worker round-trip, since the async cost is a worker postMessage.
    const banks = nearestBanks(from);
    const costs = await Promise.all(banks.map(bank => pathCost(from, bank.tile).catch(() => null)));
    return cheapestBank(banks, (_bank, index) => costs[index]);
}

export interface BankPathStamp {
    x: number;
    z: number;
    level: number;
}

/** The bits of the {@link Navigator} {@link findPath} that the walk-cost wrapper needs. */
export type NavigatorLike = {
    findPath(
        from: BankPathStamp,
        to: BankPathStamp,
        opts?: unknown
    ): Promise<{
        ok: boolean;
        cost?: number;
        reason?: string;
    }>;
};

/** Wrap a {@link PathFinder} so {@link nearestWalkableBank} can reuse it. */
export function bankCostForFinder(
    finder: {
        findPath(
            from: BankPathStamp,
            to: BankPathStamp,
            opts?: unknown
        ): {
            ok: boolean;
            cost?: number;
            reason?: string;
        };
    },
    findPathOpts?: object
): BankPathCost {
    return (from, to) => {
        const out = finder.findPath(from, to, { useTeleportCatalog: false, ...findPathOpts });
        return out.ok && out.cost !== undefined ? out.cost : null;
    };
}

/**
 * Wrap the {@link Navigator} worker so {@link nearestWalkableBankAsync} can reuse it live.
 * Why: the pack lives in the worker, so this never desyncs from what a web-walk can do.
 */
export function bankCostForNavigator(navigator: NavigatorLike, findPathOpts?: object): BankPathCostAsync {
    return async (from, to) => {
        const out = await navigator.findPath(from, to, { useTeleportCatalog: false, ...findPathOpts });
        return out.ok && out.cost !== undefined ? out.cost : null;
    };
}

/** Standing within this Chebyshev distance of the air-nearest bank, pay no walk-cost search. */
const NEAR_BANK_RADIUS = 4;

/**
 * Live pick of the cheapest reachable bank through the Navigator worker.
 * Why: nearestBank is air-ranked and a dungeon level offset floats every overworld bank near the same distance, so the winner collapses to "closest by x" (Edgeville from the Dwarven Mine); real per-candidate route cost fixes that, with the air-nearest bank as the no-route fallback. That batch ranks banks you are far from; standing at a booth the air-nearest bank is the one already in reach, so pay no walk-cost search there.
 */
export async function nearestBankReachable(here: WorldTile, navigator: NavigatorLike): Promise<BankLocation | null> {
    // Why: the air-nearest pick is gated (quests/skills/settings) and level-penalised by Tile.distanceTo,
    // so a booth in reach short-circuits while a gated bank or a lower-plane one still navigates.
    const near = nearestBank(here);
    if (near && near.tile.distanceTo(here) <= NEAR_BANK_RADIUS) {
        return near;
    }
    // Why: a 5s/500k budget per candidate both caps a worker batch and matches the offline pack budget the fail-closed scenarios were measured with.
    const cost = bankCostForNavigator(navigator, { maxExpansions: 500_000, timeoutMs: 5_000 });
    const picked = await nearestWalkableBankAsync(here, cost).catch(() => null);
    return picked ?? near;
}
