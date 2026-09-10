import { STAFF_RUNES } from '../../data/spelldb.js';

export const SCRIPT_NAME = 'ClimbingBoots';
export const SCRIPT_VERSION = '1.1.0';
export const BOOT_COST = 12;
export const BOOTS = 'Climbing boots';
export const COINS = 'Coins';
export const TENZING = 'Tenzing';
export const PACK_SIZE = 28;
export const FALADOR_TELE_LEVEL = 37;
export const DEATH_PLATEAU_QUEST = 'Death Plateau';

export const FALADOR_TELE_RUNES: { rune: string; perCast: number }[] = [
    { rune: 'Law rune', perCast: 1 },
    { rune: 'Air rune', perCast: 3 },
    { rune: 'Water rune', perCast: 1 }
];

export function providedRunes(wornNames: string[]): Set<string> {
    const out = new Set<string>();
    for (const name of wornNames) {
        const wanted = name.toLowerCase();
        const runes = Object.entries(STAFF_RUNES).find(([staff]) => staff.toLowerCase() === wanted)?.[1] ?? [];
        for (const rune of runes) {
            out.add(rune);
        }
    }
    return out;
}

export function carriedTeleRunes(provided: Set<string>): { rune: string; perCast: number }[] {
    return FALADOR_TELE_RUNES.filter(row => !provided.has(row.rune));
}

export function tripQty(packSize: number, runeStacks: number): number {
    return Math.max(0, packSize - Math.max(0, runeStacks));
}

export function tripGp(qty: number): number {
    return Math.max(0, qty) * BOOT_COST;
}

export function remainingGp(boots: number, qty: number): number {
    return Math.max(0, qty - boots) * BOOT_COST;
}

export function runeWithdraw(perCast: number, casts: number, held: number): number {
    return Math.max(0, perCast * Math.max(0, casts) - Math.max(0, held));
}

export function otherSlots(used: number, coins: number, boots: number, runeStacksHeld: number): number {
    return used - (coins > 0 ? 1 : 0) - boots - runeStacksHeld;
}

export function stillBuying(coins: number, boots: number, qty: number, used: number, packSize: number): boolean {
    if (coins < BOOT_COST || boots >= qty) {
        return false;
    }
    if (used < packSize) {
        return true;
    }
    return coins === BOOT_COST;
}

export function canFinishTrip(
    coins: number,
    boots: number,
    used: number,
    qty: number,
    runeStacksHeld: number
): boolean {
    if (otherSlots(used, coins, boots, runeStacksHeld) > 0) {
        return false;
    }
    if (boots >= qty) {
        return false;
    }
    return coins === remainingGp(boots, qty) && coins >= BOOT_COST;
}

export function tripComplete(boots: number, qty: number): boolean {
    return boots >= qty;
}

export function shopPrefer(buying: boolean): string[] {
    return buying
        ? ['Can I buy some Climbing boots?', 'OK, sounds good.']
        : ['Nothing, thanks!'];
}

export function pickShopOption(options: string[], prefer: string[]): string | null {
    for (const want of prefer) {
        const hit = options.find(option => option.toLowerCase().includes(want.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

export const MILKMAN_PREFER = ["I'm not the milkman", 'I need your help', 'Nothing, thanks!'];
