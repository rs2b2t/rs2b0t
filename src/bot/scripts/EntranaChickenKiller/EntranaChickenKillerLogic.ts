import type { WorldTile } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';

/** Chicken coop on Entrana. Open the fence gate before attacking through it. */
export const CHICKEN_CAMP = new Tile(2851, 3371, 0);
export const CAMP_RADIUS = 8;
export const INSIDE_RADIUS = 4;
export const LOOT_RADIUS = 10;
/** Shut gate/door must sit this close to the coop pin (ignore dock/house). */
export const COOP_GATE_RADIUS = 8;

/** Port Sarim western pier, Monk of Entrana. Walking here from Entrana boards the return boat. */
export const SARIM_MONK_DOCK = new Tile(3048, 3235, 0);
/** Closest bank before the boat (must bank weapons/armour). */
export const BANK_STAND = new Tile(3092, 3244, 0);

export const MONK_NAME = 'Monk of Entrana';
export const CHICKEN_NAME = 'Chicken';
export const FEATHER_NAME = 'Feather';
export const TALK_OP = 'Talk-to';

export const DEATH_RE = /oh dear.*you are dead/i;
export const CANT_REACH_RE = /i can't reach that/i;
export const BANNED_GEAR_RE = /cannot take|weapons? or armou?r|leave your weapon|holy entrana|not permitted/i;

export const TRAINABLE = ['attack', 'strength', 'defence'] as const;
export type TrainableStyle = (typeof TRAINABLE)[number];

export const COMBAT_TRACK = ['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as const;

export const OWN_LOOT_RADIUS = 2;
export const OWN_LOOT_MS = 12_000;

export const MONK_DIALOG_PREFER = ["yes, okay, i'm ready to go", "yes okay i'm ready", "i'm ready to go", 'ready to go', 'yes okay', 'yes, okay', 'yes please', 'yes'];
export const DIALOG_AVOID = ['no, not right now', 'not right now', 'no, not yet', 'not yet', 'no thank', 'no, thank', "i'm good", 'nothing'];
/** Once on the island, refuse the return boat. */
export const MONK_DIALOG_STAY = ['no, not right now', 'not right now', 'no, not yet', 'not yet', 'no thank', 'no'];

export interface NamedActions {
    name?: string | null;
    actions?: () => string[];
    tile?: () => WorldTile | null;
}

export function isTrainableStyle(value: string): value is TrainableStyle {
    return (TRAINABLE as readonly string[]).includes(value);
}

export function trainablePool(except: string | null = null): TrainableStyle[] {
    const pool = TRAINABLE.filter(style => style !== except);
    return pool.length > 0 ? [...pool] : [...TRAINABLE];
}

export function pickRandomStyle(except: string | null = null): TrainableStyle {
    const choices = trainablePool(except);
    return choices[Math.floor(Math.random() * choices.length)]!;
}

export function clampLevels(n: unknown): number {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) {
        return 5;
    }
    return Math.min(99, Math.max(1, v));
}

export function normName(s: string | null | undefined): string {
    return (s ?? '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cheb(a: WorldTile, b: WorldTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function isUnderground(tile: WorldTile | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    return Tile.from(tile).z >= 6400;
}

export function isOnEntrana(tile: WorldTile | null | undefined): boolean {
    if (!tile || isUnderground(tile)) {
        return false;
    }
    const t = Tile.from(tile);
    // Port Sarim is x~3048. Entrana island / dock / plank is west of 2950.
    return t.x < 2950 && t.z >= 3300 && t.z <= 3420;
}

/** Port Sarim docks / ship (x~3048). Walking here from Entrana boats you back. */
export function isOnSarimSide(tile: WorldTile | null | undefined): boolean {
    if (!tile || isUnderground(tile)) {
        return false;
    }
    const t = Tile.from(tile);
    return t.x >= 3000 && t.x <= 3085 && t.z >= 3200 && t.z <= 3275;
}

export function inChickenCamp(tile: WorldTile | null | undefined, radius = CAMP_RADIUS): boolean {
    if (!tile || !isOnEntrana(tile)) {
        return false;
    }
    return Tile.from(tile).distanceTo(CHICKEN_CAMP) <= radius;
}

export function isInsideCoop(tile: WorldTile | null | undefined): boolean {
    return inChickenCamp(tile, INSIDE_RADIUS);
}

/** True when monk dialogue should refuse the return boat. */
export function shouldStayOnIsland(tile: WorldTile | null | undefined): boolean {
    if (isOnEntrana(tile)) {
        return true;
    }
    if (!tile) {
        return false;
    }
    const t = Tile.from(tile);
    return t.x < 2950 && t.z >= 3300;
}

/** Talking to a Port Sarim monk from west of 2950 boards the return ship. */
export function refuseSarimMonk(tile: WorldTile | null | undefined): boolean {
    if (isOnEntrana(tile)) {
        return true;
    }
    return !!tile && Tile.from(tile).x < 2950;
}

export function locTile(loc: NamedActions | null | undefined): WorldTile | null {
    try {
        return loc?.tile?.() ?? null;
    } catch {
        return null;
    }
}

export function locActions(loc: NamedActions | null | undefined): string[] {
    try {
        return typeof loc?.actions === 'function' ? (loc.actions() ?? []) : [];
    } catch {
        return [];
    }
}

export function isChickenNpcName(name: string | null | undefined): boolean {
    return normName(name) === 'chicken';
}

export function isFeatherName(name: string | null | undefined): boolean {
    const n = normName(name);
    return n === 'feather' || n === 'feathers';
}

export function isBoneName(name: string | null | undefined): boolean {
    return normName(name) === 'bones';
}

export function isJunkName(name: string | null | undefined): boolean {
    const n = normName(name);
    return n === 'raw chicken' || n === 'egg' || n === 'eggs';
}

export function isKeepOnBank(name: string | null | undefined): boolean {
    const n = normName(name);
    return n === 'feather' || n === 'feathers' || n === 'coins';
}

export function canLootFeathers(packIsFull: boolean, feathersHeld: number): boolean {
    if (!packIsFull) {
        return true;
    }
    return feathersHeld > 0;
}

export function needsBankForBoat(nothingEquipped: boolean, inventoryNames: readonly (string | null | undefined)[]): boolean {
    if (!nothingEquipped) {
        return true;
    }
    return inventoryNames.some(name => !!name && !isKeepOnBank(name));
}

export function isShutDoor(loc: NamedActions): boolean {
    const name = (loc.name ?? '').toLowerCase();
    if (name.includes('gangplank')) {
        return false;
    }
    if (!name.includes('door') && !name.includes('gate')) {
        return false;
    }
    return locActions(loc).some(a => /^open/i.test(a));
}

export function isShutGate(loc: NamedActions): boolean {
    const name = (loc.name ?? '').toLowerCase();
    if (name.includes('gangplank')) {
        return false;
    }
    if (!name.includes('gate')) {
        return false;
    }
    return locActions(loc).some(a => /^open/i.test(a));
}

/** Shut gate/door on the chicken-coop fence only. */
export function isCoopBarrier(loc: NamedActions): boolean {
    if (!isShutGate(loc) && !isShutDoor(loc)) {
        return false;
    }
    const t = locTile(loc);
    if (!t) {
        return false;
    }
    return Tile.from(t).distanceTo(CHICKEN_CAMP) <= COOP_GATE_RADIUS;
}

export function openDoorOp(loc: NamedActions): string | null {
    return locActions(loc).find(a => /^open/i.test(a)) ?? null;
}

export function pickDialogOption(options: readonly string[], prefer: readonly string[], avoid: readonly string[]): string | null {
    const usable = options.filter(o => {
        const low = (o ?? '').toLowerCase();
        return !avoid.some(a => low.includes(a.toLowerCase()));
    });
    const pool = usable.length > 0 ? usable : [...options];
    for (const p of prefer) {
        const hit = pool.find(o => (o ?? '').toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return pool.length > 0 ? pool[0]! : null;
}

export function pickMonkOption(options: readonly string[], stayOnIsland: boolean): string | null {
    if (stayOnIsland) {
        return pickDialogOption(options, MONK_DIALOG_STAY, MONK_DIALOG_PREFER);
    }
    return pickDialogOption(options, MONK_DIALOG_PREFER, DIALOG_AVOID);
}

export function monkBoatOp(actions: readonly string[]): string {
    return actions.find(a => /^take.?boat/i.test(a ?? '')) ?? actions.find(a => /^talk/i.test(a ?? '')) ?? TALK_OP;
}

export function shouldRotateStyle(currentLevel: number, styleLevelAnchor: number, levelsBeforeSwap: number): boolean {
    return currentLevel >= styleLevelAnchor + levelsBeforeSwap;
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
