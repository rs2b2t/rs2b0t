import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Quests } from './hud/Quests.js';
import { Skills } from './hud/Skills.js';
import Tile from './Tile.js';

export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string;
}

export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
}

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
    { name: 'Duel Arena', tile: new Tile(3382, 3269, 0) }
];

export function nearestUsableBank(from: WorldTile, usable: (bank: BankLocation) => boolean): BankLocation | null {
    let best: BankLocation | null = null;
    let bestD = Infinity;
    for (const bank of BANK_LOCATIONS) {
        if (bank.tile.level !== from.level || !usable(bank)) {
            continue;
        }
        const d = Math.max(Math.abs(bank.tile.x - from.x), Math.abs(bank.tile.z - from.z));
        if (d < bestD) {
            bestD = d;
            best = bank;
        }
    }
    return best;
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
