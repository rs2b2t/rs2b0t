import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Quests } from './hud/Quests.js';
import { Skills } from './hud/Skills.js';
import Tile from './Tile.js';

/** Entry gate on a bank AREA (not the booth): the door/village refuses
 *  characters that don't meet it, so selection must skip the bank entirely. */
export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string; // exact journal name, complete required
}

export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
}

/**
 * Known bank centres (level 0), world coords, derived from the content's
 * `bank_zones.dbrow` (skill_firemaking) — midpoint of each named zone. Used to
 * web-walk to the NEAREST bank when a gathering bot fills up and no booth is
 * loaded in the current scene (the resource is more than a screen from a bank).
 * A centre may be a solid booth tile; callers walk to within a couple tiles and
 * then open the nearest booth from there.
 *
 * Gated areas carry `requires` and are SKIPPED for characters that can't
 * enter — pure geometry stranded sub-68 fishers at the guild door (live
 * 2026-07-17, re-hit 2026-07-21). Shantay Pass is ungated: its bank sits on
 * the free north side of the gate.
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
    { name: 'Shilo Village', tile: new Tile(2852, 2954, 0), requires: { quest: 'Shilo Village' } },
    { name: 'Fishing Guild', tile: new Tile(2586, 3420, 0), requires: { skill: { name: 'fishing', level: 68 } } },
    { name: 'Shantay Pass', tile: new Tile(3309, 3120, 0) },
    { name: 'Duel Arena', tile: new Tile(3382, 3269, 0) }
];

/** Nearest bank passing `usable`, on the same level, by Chebyshev distance.
 *  Pure — the selection logic under test; live callers use nearestBank(). */
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

/** Can THIS character enter the bank's area right now (live reads)? */
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

/** Nearest known bank this character can actually ENTER, same level, by
 *  Chebyshev distance. */
export function nearestBank(from: WorldTile): BankLocation | null {
    return nearestUsableBank(from, meetsRequirement);
}
