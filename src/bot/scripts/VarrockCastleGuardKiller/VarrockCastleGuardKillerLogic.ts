import type { WorldTile } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';

/** Fountain in the Varrock Palace courtyard (inside the south large doors). Ground floor only. */
export const GUARD_CAMP = new Tile(3212, 3464, 0);
export const CAMP_RADIUS = 12;

/** Inclusive courtyard box. Skip square-south and palace-interior NPCs. */
export const COURT_X1 = 3203;
export const COURT_X2 = 3224;
export const COURT_Z1 = 3458;
export const COURT_Z2 = 3472;

/** Closest booth to the palace. */
export const BANK_STAND = new Tile(3185, 3440, 0);

export const DEATH_RE = /oh dear.*you are dead/i;
export const CANT_REACH_RE = /i can't reach that/i;

export const TRAINABLE = ['attack', 'strength', 'defence'] as const;
export type TrainableStyle = (typeof TRAINABLE)[number];
export const COMBAT_TRACK = ['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as const;

export const STYLE_RANDOM = 'Random swap';
export const STYLE_LOWEST = 'Lowest melee';
export const STYLE_OPTIONS = [STYLE_RANDOM, STYLE_LOWEST] as const;
export type StyleMode = (typeof STYLE_OPTIONS)[number];

export const OWN_LOOT_RADIUS = 3;
export const OWN_LOOT_MS = 12_000;
export const GROUND_SCAN_RADIUS = 24;

export const FOOD_OPTIONS = ['Best', 'Lobster', 'Tuna', 'Swordfish', 'Shrimp'] as const;
export type FoodType = (typeof FOOD_OPTIONS)[number];

export const FOOD_TYPES: Record<FoodType, { eat: readonly string[]; withdraw: readonly string[]; label: string }> = {
    Best: {
        eat: ['Swordfish', 'Lobster', 'Tuna', 'Shrimps', 'Shrimp'],
        withdraw: ['Swordfish', 'Lobster', 'Tuna', 'Shrimps', 'Shrimp'],
        label: 'best'
    },
    Lobster: { eat: ['Lobster'], withdraw: ['Lobster'], label: 'lobster' },
    Tuna: { eat: ['Tuna'], withdraw: ['Tuna'], label: 'tuna' },
    Swordfish: { eat: ['Swordfish'], withdraw: ['Swordfish'], label: 'swordfish' },
    Shrimp: { eat: ['Shrimps', 'Shrimp'], withdraw: ['Shrimps', 'Shrimp'], label: 'shrimp' }
};

export interface LootDef {
    key: string;
    label: string;
    names?: readonly string[];
    kind?: 'anySeed';
}

export const LOOT_DEFS: readonly LootDef[] = [
    { key: 'lootIronBolts', label: 'Iron Bolts (Members)', names: ['iron bolts', 'iron bolt'] },
    { key: 'lootSteelArrow', label: 'Steel Arrow', names: ['steel arrow', 'steel arrows'] },
    { key: 'lootBronzeArrow', label: 'Bronze Arrow', names: ['bronze arrow', 'bronze arrows'] },
    { key: 'lootAirRune', label: 'Air Rune', names: ['air rune', 'air runes', 'air-rune'] },
    { key: 'lootEarthRune', label: 'Earth Rune', names: ['earth rune', 'earth runes', 'earth-rune'] },
    { key: 'lootFireRune', label: 'Fire Rune', names: ['fire rune', 'fire runes', 'fire-rune'] },
    { key: 'lootBloodRune', label: 'Blood Rune (Members)', names: ['blood rune', 'blood runes', 'blood-rune'] },
    { key: 'lootChaosRune', label: 'Chaos Rune', names: ['chaos rune', 'chaos runes', 'chaos-rune'] },
    { key: 'lootNatureRune', label: 'Nature Rune', names: ['nature rune', 'nature runes', 'nature-rune'] },
    { key: 'lootIronDagger', label: 'Iron Dagger', names: ['iron dagger'] },
    { key: 'lootBodyTalisman', label: 'Body Talisman', names: ['body talisman'] },
    { key: 'lootGrain', label: 'Grain', names: ['grain'] },
    { key: 'lootIronOre', label: 'Iron Ore', names: ['iron ore'] },
    { key: 'lootSeeds', label: 'Seeds (Members)', kind: 'anySeed' },
    {
        key: 'lootClueMedium',
        label: 'Clue Scroll (medium) (Members)',
        names: ['clue scroll (medium)', 'clue scroll (level 2)', 'clue scroll (level-2)', 'clue scroll']
    },
    { key: 'lootCoins', label: 'Coins', names: ['coins', 'coin', 'money'] },
    { key: 'lootBones', label: 'Bones', names: ['bones', 'bone'] }
];

export function isTrainableStyle(value: string): value is TrainableStyle {
    return (TRAINABLE as readonly string[]).includes(value);
}

export function isStyleMode(value: string): value is StyleMode {
    return (STYLE_OPTIONS as readonly string[]).includes(value);
}

export function isFoodType(value: string): value is FoodType {
    return (FOOD_OPTIONS as readonly string[]).includes(value);
}

export function isRandomStyleMode(mode: string): boolean {
    return mode === STYLE_RANDOM;
}

export function trainablePool(except: string | null = null): TrainableStyle[] {
    const pool = TRAINABLE.filter(style => style !== except);
    return pool.length > 0 ? [...pool] : [...TRAINABLE];
}

export function pickRandomStyle(except: string | null = null): TrainableStyle {
    const choices = trainablePool(except);
    return choices[Math.floor(Math.random() * choices.length)]!;
}

/** Lowest of Attack / Strength / Defence. If `prefer` is tied for lowest, keep it. */
export function pickLowestStyle(levels: Readonly<Record<string, number>>, prefer: string | null = null): TrainableStyle {
    let best: TrainableStyle = TRAINABLE[0];
    let bestLevel = levels[best] ?? 1;
    for (let i = 1; i < TRAINABLE.length; i++) {
        const style = TRAINABLE[i]!;
        const level = levels[style] ?? 1;
        if (level < bestLevel) {
            best = style;
            bestLevel = level;
        }
    }
    if (prefer && isTrainableStyle(prefer) && (levels[prefer] ?? 1) === bestLevel) {
        return prefer;
    }
    return best;
}

export function shouldRotateStyle(currentLevel: number, styleLevelAnchor: number, levelsBeforeSwap: number): boolean {
    return currentLevel >= styleLevelAnchor + levelsBeforeSwap;
}

export function clampPercent(n: unknown): number {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) {
        return 50;
    }
    return Math.min(100, Math.max(1, v));
}

export function clampLevels(n: unknown): number {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) {
        return 5;
    }
    return Math.min(99, Math.max(1, v));
}

export function clampFoodAmount(n: unknown): number {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) {
        return 20;
    }
    return Math.min(28, Math.max(1, v));
}

export function hpPercent(current: number, max: number): number {
    return (current / Math.max(1, max)) * 100;
}

export function needEat(hasFood: boolean, percent: number, eatAtPercent: number): boolean {
    return hasFood && percent <= eatAtPercent;
}

export function needPanicExit(foodCount: number, percent: number, panicHpPercent: number): boolean {
    return foodCount === 0 && percent <= panicHpPercent;
}

export function normName(s: string | null | undefined): string {
    return (s ?? '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cheb(a: WorldTile, b: WorldTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function distToBank(tile: WorldTile | null | undefined): number {
    if (!tile) {
        return 999;
    }
    return cheb(Tile.from(tile), BANK_STAND);
}

export function tileLevel(tile: WorldTile | null | undefined): number {
    return tile?.level ?? 0;
}

export function inCourtyard(tile: WorldTile | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    const t = Tile.from(tile);
    if (tileLevel(t) !== 0) {
        return false;
    }
    return t.x >= COURT_X1 && t.x <= COURT_X2 && t.z >= COURT_Z1 && t.z <= COURT_Z2;
}

export function inCamp(tile: WorldTile | null | undefined, radius = CAMP_RADIUS): boolean {
    if (!tile || !inCourtyard(tile)) {
        return false;
    }
    return cheb(Tile.from(tile), GUARD_CAMP) <= radius;
}

export function isCastleGuardName(name: string | null | undefined): boolean {
    return (name ?? '').toLowerCase().trim() === 'guard';
}

export function isBoneName(name: string | null | undefined): boolean {
    const n = normName(name);
    return n === 'bones' || n === 'bone';
}

export function isAnySeedName(itemName: string | null | undefined): boolean {
    const n = normName(itemName);
    if (!n) {
        return false;
    }
    return n.endsWith(' seed') || n.endsWith(' seeds') || n === 'seed' || n === 'seeds';
}

export function namesMatchWanted(dropName: string | null | undefined, wanted: string): boolean {
    const b = normName(wanted);
    let a = normName(dropName);
    if (!a || !b) {
        return false;
    }
    a = a
        .replace(/^\d+\s*x\s+/, '')
        .replace(/^\d+\s+/, '')
        .replace(/\s*\(\d+\)\s*$/, '')
        .trim();
    if (a === b || a === `${b}s` || b === `${a}s`) {
        return true;
    }
    if (a.startsWith(`${b} `) || a.startsWith(`${b}(`)) {
        return true;
    }
    return false;
}

export function lootDefMatches(def: LootDef, itemName: string | null | undefined): boolean {
    if (def.kind === 'anySeed') {
        return isAnySeedName(itemName);
    }
    return (def.names ?? []).some(n => namesMatchWanted(itemName, n));
}

export function shouldLootName(itemName: string | null | undefined, buryBones: boolean, lootTicks: Readonly<Record<string, boolean>>): boolean {
    if (buryBones && isBoneName(itemName)) {
        return true;
    }
    return LOOT_DEFS.some(def => lootTicks[def.key] === true && lootDefMatches(def, itemName));
}

export function isKeepOnDeposit(name: string | null | undefined, foodNames: readonly string[], buryBones: boolean): boolean {
    const n = (name ?? '').toLowerCase();
    if (!n) {
        return false;
    }
    if (foodNames.some(f => f.toLowerCase() === n)) {
        return true;
    }
    if (buryBones && isBoneName(n)) {
        return true;
    }
    return false;
}

export function describeFood(foodType: string): string {
    if (foodType === 'Best') {
        return 'best (Swordfish / Lobster / Tuna / Shrimp)';
    }
    if (foodType === 'Shrimp') {
        return 'Shrimps / Shrimp';
    }
    return foodType;
}

export interface WithdrawStep {
    name: string;
    take: number;
}

export function buildWithdrawPlan(amount: number, free: number, names: readonly string[], bankCount: (name: string) => number): WithdrawStep[] {
    let need = Math.max(0, amount);
    let slots = Math.max(0, free);
    const plan: WithdrawStep[] = [];
    for (const name of names) {
        if (need <= 0 || slots <= 0) {
            break;
        }
        const inBank = bankCount(name) || 0;
        if (inBank <= 0) {
            continue;
        }
        const take = Math.min(need, inBank, slots);
        if (take <= 0) {
            continue;
        }
        plan.push({ name, take });
        need -= take;
        slots -= take;
    }
    return plan;
}

export interface NamedActions {
    name?: string | null;
    actions?: () => string[];
}

export function locActions(loc: NamedActions | null | undefined): string[] {
    try {
        return typeof loc?.actions === 'function' ? (loc.actions() ?? []) : [];
    } catch {
        return [];
    }
}

export function openDoorOp(loc: NamedActions): string | null {
    return locActions(loc).find(a => /^open/i.test(String(a))) ?? null;
}

export function isShutDoor(loc: NamedActions): boolean {
    const n = (loc.name ?? '').toLowerCase();
    if (!n.includes('door') && !n.includes('gate')) {
        return false;
    }
    return openDoorOp(loc) != null;
}

export function fmtXph(n: number): string {
    if (n >= 100_000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    if (n >= 10_000) {
        return `${(n / 1000).toFixed(1)}k`;
    }
    return String(Math.round(n));
}

export function fmtElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}
