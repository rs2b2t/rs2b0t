import Tile from '../api/Tile.js';
import { PICKPOCKET_TARGETS } from './PickpocketTargets.js';

export interface TargetSpot {
    anchor: Tile;
    leash: number;
}

const SPOTS: Record<string, TargetSpot> = {
    'Guard': { anchor: new Tile(2661, 3306, 0), leash: 19 },
    'Knight of Ardougne': { anchor: new Tile(2661, 3306, 0), leash: 29 },
    'Paladin': { anchor: new Tile(2655, 3311, 0), leash: 12 },
    'Hero': { anchor: new Tile(2657, 3311, 0), leash: 17 }
};

export function targetSpot(target: string): TargetSpot {
    return SPOTS[target] ?? SPOTS['Guard'];
}

export function requiredThieving(target: string): number {
    return PICKPOCKET_TARGETS.find(t => t.name === target)?.level ?? 1;
}

export const HOSTILE_NAMES: readonly string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];

export interface AttackerCandidate {
    name: string | null;
    inCombat: boolean;
    distance: number;
    actions: string[];
    targetsAnotherPlayer: boolean;
}

export function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean {
    return c.name !== null
        && HOSTILE_NAMES.includes(c.name)
        && c.inCombat
        && !c.targetsAnotherPlayer
        && c.distance <= maxDistance
        && c.actions.includes('Attack');
}

export function chooseTarget<T>(candidatesNearestFirst: T[], reachable: (t: T) => boolean): { target: T | null; blocked: T | null } {
    for (const c of candidatesNearestFirst) {
        if (reachable(c)) {
            return { target: c, blocked: null };
        }
    }
    return { target: null, blocked: candidatesNearestFirst[0] ?? null };
}
