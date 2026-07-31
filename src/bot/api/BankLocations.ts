import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Quests } from './hud/Quests.js';
import { Skills } from './hud/Skills.js';
import Tile from './Tile.js';

export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string;
}

export interface BankObjectAccess {
    name: string;
    op: string;
    openFirst?: {
        name: string;
        op: string;
    };
}

/**
 * A bank, its stand tile, and how to open it.
 * @see docs/API.md#bank
 */
export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
    access?: BankObjectAccess;
}

/**
 * Every known bank. Some stands are sealed collision islands, so reaching one
 * is a data problem rather than a walker problem.
 * @see docs/NAV.md#arrival
 */
export const BANK_LOCATIONS: BankLocation[] = [
    { name: 'Varrock East', tile: new Tile(3253, 3420, 0) },
    { name: 'Varrock West', tile: new Tile(3185, 3440, 0) },
    { name: 'Al Kharid', tile: new Tile(3269, 3167, 0) },
    { name: 'Draynor', tile: new Tile(3093, 3243, 0) },
    { name: 'Falador East', tile: new Tile(3013, 3355, 0) },
    { name: 'Falador West', tile: new Tile(2946, 3369, 0) },
    { name: 'Edgeville', tile: new Tile(3094, 3493, 0) },
    { name: 'Seers', tile: new Tile(2725, 3491, 0) },
    { name: 'Catherby', tile: new Tile(2809, 3441, 0) },
    { name: 'Yanille', tile: new Tile(2612, 3092, 0) },
    { name: 'Ardougne West', tile: new Tile(2616, 3332, 0) },
    { name: 'Ardougne East', tile: new Tile(2655, 3283, 0) },
    { name: 'Canifis', tile: new Tile(3512, 3480, 0), requires: { quest: 'Priest in Peril' } },
    { name: 'Shilo Village', tile: new Tile(2852, 2954, 0), requires: { quest: 'Shilo Village' } },
    { name: 'Fishing Guild', tile: new Tile(2586, 3420, 0), requires: { skill: { name: 'fishing', level: 68 } } },
    { name: 'Shantay Pass', tile: new Tile(3309, 3120, 0) },
    // Grand Tree 1F bank booths (SE of trunk ladder). Open without Grand Tree quest.
    // Stand in front of the south booth row; mine still requires the quest.
    { name: 'Grand Tree', tile: new Tile(2449, 3482, 1) },
    {
        name: 'Duel Arena',
        tile: new Tile(3382, 3269, 0),
        access: {
            name: 'Open chest',
            op: 'Bank',
            openFirst: { name: 'Closed chest', op: 'Open' }
        }
    }
];

/**
 * Straight-line (Euclidean) distance on the same plane.
 * Chebyshev (king-move) wrongly prefers Falador East over Edgeville from
 * Barbarian Village tin/coal — the walk is shorter north to Edge.
 */
export function bankDistance(from: WorldTile, bank: WorldTile): number {
    const dx = bank.x - from.x;
    const dz = bank.z - from.z;
    return Math.hypot(dx, dz);
}

export function nearestUsableBank(from: WorldTile, usable: (bank: BankLocation) => boolean): BankLocation | null {
    let best: BankLocation | null = null;
    let bestD = Infinity;
    for (const bank of BANK_LOCATIONS) {
        if (bank.tile.level !== from.level || !usable(bank)) {
            continue;
        }
        const d = bankDistance(from, bank.tile);
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
    return true;
}

export function nearestBank(from: WorldTile): BankLocation | null {
    return nearestUsableBank(from, meetsRequirement);
}
