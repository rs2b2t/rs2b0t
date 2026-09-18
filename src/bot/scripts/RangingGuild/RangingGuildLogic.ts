import Tile from '../../geometry/Tile.js';
import { bestFromTiers, type ToolTier } from '../../api/acquisition/Tools.js';
import { CANT_REACH } from '../../api/chatbox/gameMessages.js';

export const RANGED_REQUIRED = 40;
export const ENTRY_FEE = 200;
export const ARROW_RESTOCK_FEE = 100;
export const SHOTS_PER_ROUND = 10;
export const TICKETS_PER_RUNE_ARROWS = 2000;
export const RUNE_ARROWS_PER_TRADE = 50;

export const COINS = 995;
export const BRONZE_ARROW = 882;
export const RUNE_ARROW = 892;
export const ARCHERY_TICKET = 1464;
export const BRONZE_ARROW_NAME = 'Bronze arrow';
export const RUNE_ARROW_NAME = 'Rune arrow';
export const TICKET_NAME = 'Archery ticket';
export const COINS_NAME = 'Coins';

export const VARP_TARGET_COUNT = 156;
export const VARP_TARGET_SCORE = 157;
export const VARP_TARGET_HIT = 158;

export const TARGET_RESULT_MODAL = 446;
export const TICKET_SHOP_MODAL = 4461;
export const TICKET_SHOP_RUNE_ARROWS = 4552;

export const JUDGE = 'Competition Judge';
export const MERCHANT = 'Ticket Merchant';
export const TARGET = 'Target';
export const FIRE_OP = 'Fire-at';

export const STAND = new Tile(2672, 3419, 0);
export const JUDGE_SPAWN = new Tile(2669, 3418, 0);
export const JUDGE_STAND = new Tile(2670, 3418, 0);
export const MERCHANT_STAND = new Tile(2659, 3430, 0);
export const SEERS_BANK = new Tile(2725, 3491, 0);
export const TARGETS: readonly Tile[] = [
    new Tile(2679, 3426, 0),
    new Tile(2679, 3428, 0),
    new Tile(2681, 3425, 0),
    new Tile(2681, 3427, 0),
    new Tile(2682, 3425, 0)
];

export const BOWS: readonly ToolTier[] = [
    { name: 'Magic shortbow', level: 50 },
    { name: 'Magic longbow', level: 50 },
    { name: 'Yew shortbow', level: 40 },
    { name: 'Yew longbow', level: 40 },
    { name: 'Maple shortbow', level: 30 },
    { name: 'Maple longbow', level: 30 },
    { name: 'Willow shortbow', level: 20 },
    { name: 'Willow longbow', level: 20 },
    { name: 'Oak shortbow', level: 5 },
    { name: 'Oak longbow', level: 5 },
    { name: 'Shortbow', level: 1 },
    { name: 'Longbow', level: 1 }
];

const BOW_NAMES = new Set(BOWS.map(b => b.name.toLowerCase()));

export function isBow(name: string | null | undefined): boolean {
    return name !== null && name !== undefined && BOW_NAMES.has(name.toLowerCase());
}

export function bestBow(rangedLevel: number, available: (name: string) => boolean): string | null {
    return bestFromTiers(rangedLevel, BOWS, available);
}

export const JUDGE_PREFS: readonly string[] = ['give it a go', 'take some', "i've got it"];

export function pickOption(options: readonly string[], prefs: readonly string[]): number {
    const lower = options.map(o => o.toLowerCase());
    for (const pref of prefs) {
        const i = lower.findIndex(o => o.includes(pref.toLowerCase()));
        if (i !== -1) {
            return i;
        }
    }
    return -1;
}

export type RoundPhase = 'idle' | 'shooting' | 'finished';

export function roundPhase(targetCount: number): RoundPhase {
    if (targetCount >= 1 && targetCount <= SHOTS_PER_ROUND) {
        return 'shooting';
    }
    return targetCount === SHOTS_PER_ROUND + 1 ? 'finished' : 'idle';
}

export interface WorldView {
    targetCount: number;
    tickets: number;
    coins: number;
    bowWorn: boolean;
    bowHeld: boolean;
    bronzeWorn: number;
    bronzeHeld: number;
}

export type Action =
    | { kind: 'redeem' }
    | { kind: 'collect' }
    | { kind: 'wield-bow' }
    | { kind: 'wield-arrows' }
    | { kind: 'shoot' }
    | { kind: 'restock-arrows' }
    | { kind: 'enter' }
    | { kind: 'bank' };

export function decide(v: WorldView): Action {
    if (v.tickets >= TICKETS_PER_RUNE_ARROWS) {
        return { kind: 'redeem' };
    }
    const phase = roundPhase(v.targetCount);
    if (phase === 'finished') {
        return { kind: 'collect' };
    }
    if (!v.bowWorn) {
        return { kind: v.bowHeld ? 'wield-bow' : 'bank' };
    }
    if (phase === 'shooting') {
        if (v.bronzeWorn > 0) {
            return { kind: 'shoot' };
        }
        if (v.bronzeHeld > 0) {
            return { kind: 'wield-arrows' };
        }
        return { kind: v.coins >= ARROW_RESTOCK_FEE ? 'restock-arrows' : 'bank' };
    }
    return { kind: v.coins >= ENTRY_FEE ? 'enter' : 'bank' };
}

export type ShotRefusal = 'too-close' | 'no-bow' | 'no-arrows' | 'round-over' | 'not-entered' | 'unreachable';

const REFUSALS: readonly [RegExp, ShotRefusal][] = [
    [/behind the/i, 'too-close'],
    [/bow might help|need a bow/i, 'no-bow'],
    [/needing those bronze arrows|use the 10 bronze arrows/i, 'no-arrows'],
    [/fired all your arrows/i, 'round-over'],
    [/ask before using|only use the targets/i, 'not-entered'],
    [CANT_REACH, 'unreachable']
];

export function classifyShot(messages: readonly string[]): ShotRefusal | null {
    for (const text of messages) {
        for (const [pattern, refusal] of REFUSALS) {
            if (pattern.test(text)) {
                return refusal;
            }
        }
    }
    return null;
}

export function hitLabel(hit: number): string {
    if (hit === 0) return 'Bulls-Eye!';
    if (hit === 1) return 'Hit Yellow!';
    if (hit <= 4) return 'Hit Red!';
    if (hit <= 8) return 'Hit Blue!';
    if (hit <= 10) return 'Hit Black!';
    return 'Missed!';
}

export function hitPoints(hit: number): number {
    if (hit === 0) return 100;
    if (hit === 1) return 50;
    if (hit <= 4) return 30;
    if (hit <= 8) return 20;
    if (hit <= 10) return 10;
    return 0;
}

export function ticketsForScore(score: number): number {
    return Math.floor(score / 10);
}
