import Tile from '../api/Tile.js';
import { PICKPOCKET_TARGETS } from './PickpocketTargets.js';

/**
 * Pure ArdyThiever knowledge — no client imports so it runs under plain
 * `bun test` (ArdyFighterLogic pattern). Encodes the East Ardougne market
 * layout the bot used to take as settings: where each pickpocket target
 * hangs out, what Thieving level it needs, and which NPCs a caught stall
 * theft can turn hostile.
 */

export interface TargetSpot {
    anchor: Tile;
    leash: number;
}

// Anchors/leashes derived from the engine's packed spawn data (n40_51/n41_51):
// Guard x7 and Knight x4 all wander within 12 of the market centre; the two
// market Paladins sit a nudge south-west; the two market-side Heroes
// ((2647,3306) + (2667,3316)) need a wider ring from a midpoint anchor. All
// four spots are a short walk from the Baker's stall (2667,3310) and the
// south bank (2655,3286).
const SPOTS: Record<string, TargetSpot> = {
    'Guard': { anchor: new Tile(2661, 3306, 0), leash: 12 },
    'Knight of Ardougne': { anchor: new Tile(2661, 3306, 0), leash: 12 },
    'Paladin': { anchor: new Tile(2655, 3311, 0), leash: 12 },
    'Hero': { anchor: new Tile(2657, 3311, 0), leash: 14 }
};

/** The thieving spot for a dropdown target; unknown names get the Guard spot. */
export function targetSpot(target: string): TargetSpot {
    return SPOTS[target] ?? SPOTS['Guard'];
}

/** Thieving level the pickpocket needs (content pickpocket table); unknown → 1. */
export function requiredThieving(target: string): number {
    return PICKPOCKET_TARGETS.find(t => t.name === target)?.level ?? 1;
}

// A caught stall theft retaliates with the market's human hostiles: the
// stall's LOS-blocker is always an Ardougne Guard, and the Baker's
// "Guards guards!" alert additionally pulls any Knight/Paladin/Hero within 5
// tiles of him (content stall_owner_alert_guards).
export const HOSTILE_NAMES: readonly string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];

export interface AttackerCandidate {
    name: string | null;
    inCombat: boolean;
    distance: number;
    actions: string[];
}

/** Is this NPC plausibly the one attacking us — a market hostile, currently in
 *  combat, close enough to be meleeing us, and actually attackable? */
export function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean {
    return c.name !== null
        && HOSTILE_NAMES.includes(c.name)
        && c.inCombat
        && c.distance <= maxDistance
        && c.actions.includes('Attack');
}
