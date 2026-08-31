import type { WorldTile } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';

/** West Falador mine camp. */
export const ANCHOR = new Tile(2907, 3359, 0);
export const MINE_RADIUS = 30;

/** Crumbling / broken wall west of Falador. Climb-over into the city only (mine to bank). */
export const WALL_PIN = new Tile(2935, 3355, 0);
export const WALL_WEST = new Tile(2934, 3355, 0);
export const WALL_EAST = new Tile(2936, 3355, 0);
export const FALADOR_WEST_BANK = new Tile(2946, 3368, 0);
/** Climb-over the broken wall requires Agility 5. Below that, walk the long gate route. */
export const WALL_AGILITY_NEED = 5;

export const HANDLE_POWERMINE = 'Powermine (drop)';
export const HANDLE_BANK = 'Bank';
export const HANDLE_OPTIONS = [HANDLE_POWERMINE, HANDLE_BANK] as const;
export type Handling = (typeof HANDLE_OPTIONS)[number];

export const ROCK_EMPTY = 'empty';
export const ROCK_OTHER = 'other';

export interface OreDef {
    id: string;
    label: string;
    level: number;
    itemNames: readonly string[];
    matches: readonly string[];
    prefKey: 'mineCoal' | 'mineIron' | 'mineCopper' | 'mineTin';
    defaultOn: boolean;
}

export const ORE_COAL: OreDef = { id: 'coal', label: 'Coal', level: 30, itemNames: ['Coal'], matches: ['coal'], prefKey: 'mineCoal', defaultOn: true };
export const ORE_IRON: OreDef = { id: 'iron', label: 'Iron', level: 15, itemNames: ['Iron ore'], matches: ['iron'], prefKey: 'mineIron', defaultOn: true };
export const ORE_COPPER: OreDef = { id: 'copper', label: 'Copper', level: 1, itemNames: ['Copper ore'], matches: ['copper'], prefKey: 'mineCopper', defaultOn: false };
export const ORE_TIN: OreDef = { id: 'tin', label: 'Tin', level: 1, itemNames: ['Tin ore'], matches: ['tin'], prefKey: 'mineTin', defaultOn: false };

/** Highest-level first so Coal is preferred over Iron when both are ticked. */
export const ORES: readonly OreDef[] = [ORE_COAL, ORE_IRON, ORE_COPPER, ORE_TIN];

export interface PickaxeDef {
    name: string;
    aliases: readonly string[];
    mining: number;
    attack: number;
}

export const PICKAXES: readonly PickaxeDef[] = [
    { name: 'Dragon pickaxe', aliases: ['Dragon pickaxe'], mining: 61, attack: 60 },
    { name: 'Rune pickaxe', aliases: ['Rune pickaxe', 'Runite pickaxe'], mining: 41, attack: 40 },
    { name: 'Adamant pickaxe', aliases: ['Adamant pickaxe', 'Adamantite pickaxe'], mining: 31, attack: 30 },
    { name: 'Mithril pickaxe', aliases: ['Mithril pickaxe'], mining: 21, attack: 20 },
    { name: 'Black pickaxe', aliases: ['Black pickaxe'], mining: 11, attack: 10 },
    { name: 'Steel pickaxe', aliases: ['Steel pickaxe'], mining: 6, attack: 5 },
    { name: 'Iron pickaxe', aliases: ['Iron pickaxe'], mining: 1, attack: 1 },
    { name: 'Bronze pickaxe', aliases: ['Bronze pickaxe'], mining: 1, attack: 1 }
];

export const PICKAXE_UNLOCKS = new Set([6, 11, 21, 31, 41, 61]);

export interface NamedActions {
    name?: string | null;
    id?: number | (() => number);
    actions?: () => string[];
    tile?: () => WorldTile | null;
    distance?: () => number;
}

export function isHandling(value: string): value is Handling {
    return (HANDLE_OPTIONS as readonly string[]).includes(value);
}

export function pickFrom(options: readonly string[], raw: string, fallback: string): string {
    const hit = options.find(o => o.toLowerCase() === raw.trim().toLowerCase());
    return hit ?? fallback;
}

export function normName(name: string | null | undefined): string {
    return (name ?? '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function locActions(loc: NamedActions | null | undefined): string[] {
    try {
        return typeof loc?.actions === 'function' ? (loc.actions() ?? []) : [];
    } catch {
        return [];
    }
}

export function locTile(loc: NamedActions | null | undefined): WorldTile | null {
    try {
        return loc?.tile?.() ?? null;
    } catch {
        return null;
    }
}

export function locIdOf(loc: NamedActions | null | undefined): number | null {
    try {
        const raw = typeof loc?.id === 'function' ? loc.id() : loc?.id;
        if (raw == null) {
            return null;
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

export function locDist(loc: NamedActions | null | undefined): number {
    try {
        if (typeof loc?.distance === 'function') {
            return loc.distance();
        }
    } catch {
        /* fall through */
    }
    return 0;
}

export function mineOp(actions: readonly string[]): string | null {
    return actions.find(a => /^mine/i.test(String(a))) ?? null;
}

export function locMineOp(loc: NamedActions): string | null {
    return mineOp(locActions(loc));
}

export function prospectOp(loc: NamedActions): string | null {
    return locActions(loc).find(a => /^prospect/i.test(String(a))) ?? null;
}

export function openDoorOp(loc: NamedActions): string | null {
    return locActions(loc).find(a => /^open/i.test(String(a))) ?? null;
}

export function isShutDoor(loc: NamedActions): boolean {
    const name = normName(loc.name);
    if (!name.includes('door') && !name.includes('gate')) {
        return false;
    }
    return openDoorOp(loc) != null;
}

export function locMatchesOre(loc: NamedActions, ore: OreDef): boolean {
    const name = normName(loc.name);
    if (!name) {
        return false;
    }
    return ore.matches.some(m => name.includes(m));
}

export function wallClimbOp(loc: NamedActions): string | null {
    const actions = locActions(loc);
    return actions.find(a => /climb-over/i.test(String(a))) ?? actions.find(a => /climb/i.test(String(a))) ?? null;
}

/** Shut crumbling / broken wall at the west Falador pin. */
export function isCrumblingWall(loc: NamedActions): boolean {
    if (!wallClimbOp(loc)) {
        return false;
    }
    const t = locTile(loc);
    if (!t || Tile.from(t).distanceTo(WALL_PIN) > 3) {
        return false;
    }
    const name = normName(loc.name);
    return name.includes('crumbling') || name.includes('crumble') || name.includes('broken wall') || name.includes('wall');
}

export function inMineRadius(tile: WorldTile | null | undefined, radius = MINE_RADIUS): boolean {
    if (!tile) {
        return false;
    }
    return Tile.from(tile).distanceTo(ANCHOR) <= radius;
}

export function canUseWallShortcut(agilityLevel: number): boolean {
    return agilityLevel >= WALL_AGILITY_NEED;
}

/** Outside the west wall (mine / crafting-guild side). */
export function westOfWall(tile: WorldTile | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    const p = Tile.from(tile);
    return (p.level ?? 0) === 0 && p.x <= WALL_WEST.x;
}

/** Inside Falador (west-bank side of the crumbling wall). */
export function eastOfWall(tile: WorldTile | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    const p = Tile.from(tile);
    return (p.level ?? 0) === 0 && p.x >= WALL_EAST.x;
}

export function isPickaxeName(name: string | null | undefined): boolean {
    const n = normName(name);
    return n.includes('pickaxe') || n === 'pick axe';
}

export function isKeepTool(name: string | null | undefined): boolean {
    return isPickaxeName(name);
}

export function pickDefByName(name: string | null | undefined): PickaxeDef | null {
    const n = normName(name);
    if (!n || !n.includes('pickaxe')) {
        return null;
    }
    return PICKAXES.find(p => p.aliases.some(a => a.toLowerCase() === n) || n.includes(p.name.toLowerCase().replace(' pickaxe', ''))) ?? null;
}

export function canUsePick(def: PickaxeDef | null, mining: number): boolean {
    return !!def && mining >= def.mining;
}

export function canWieldPick(def: PickaxeDef | null, attack: number): boolean {
    return !!def && attack >= def.attack;
}

export function pickRank(def: PickaxeDef | null): number {
    if (!def) {
        return 999;
    }
    const i = PICKAXES.indexOf(def);
    return i < 0 ? 999 : i;
}

export function isBestPickName(name: string | null | undefined, bestDef: PickaxeDef | null): boolean {
    if (!bestDef || !name) {
        return false;
    }
    const n = normName(name);
    return bestDef.aliases.some(a => a.toLowerCase() === n);
}

export function bestUsablePickDef(mining: number, hasFn: (def: PickaxeDef) => boolean): PickaxeDef | null {
    for (const def of PICKAXES) {
        if (mining >= def.mining && hasFn(def)) {
            return def;
        }
    }
    return null;
}

export function isOreItemName(name: string | null | undefined): boolean {
    const n = normName(name);
    if (!n) {
        return false;
    }
    return ORES.some(o => o.itemNames.some(x => x.toLowerCase() === n) || o.matches.some(m => n === m || n === `${m} ore`));
}

/** Drunken Dwarf beer/kebab: Drop, do not Eat, Drink, or bank. */
export function isDropJunk(name: string | null | undefined): boolean {
    const n = normName(name);
    if (!n) {
        return false;
    }
    if (n === 'kebab') {
        return true;
    }
    return n === 'beer' || (n.includes('beer') && !n.includes('keg'));
}

export function isBankLoot(name: string | null | undefined): boolean {
    if (!name || isKeepTool(name) || isDropJunk(name) || isOreItemName(name)) {
        return false;
    }
    return true;
}

export function shouldDropWhenPowermining(name: string | null | undefined): boolean {
    if (isKeepTool(name) || isBankLoot(name)) {
        return false;
    }
    return isOreItemName(name) || isDropJunk(name);
}

export function wantedOres(ticked: readonly OreDef[], miningLevel: number): OreDef[] {
    return ticked.filter(o => miningLevel >= o.level);
}

export function oreLine(ticked: readonly OreDef[]): string {
    if (ticked.length === 0) {
        return 'no ore ticked';
    }
    return ticked.map(o => o.label).join('+');
}

export function parseRockChat(text: string | null | undefined): string | null {
    const t = String(text ?? '').trim();
    if (!t) {
        return null;
    }
    if (/you examine the rock/i.test(t)) {
        return null;
    }
    if (/no ore left/i.test(t) || /currently no ore/i.test(t) || /contains no ore/i.test(t) || /no ore available/i.test(t)) {
        return ROCK_EMPTY;
    }
    const m = t.match(/this rock contains\s+(.+?)\.?$/i);
    if (!m) {
        return null;
    }
    const what = m[1]!.toLowerCase();
    for (const ore of ORES) {
        if (ore.matches.some(x => what.includes(x))) {
            return ore.id;
        }
    }
    return ROCK_OTHER;
}

export function wallShortcutStatus(agilityLevel: number): string {
    if (canUseWallShortcut(agilityLevel)) {
        return `Agility ${agilityLevel}/${WALL_AGILITY_NEED}: broken-wall shortcut ON (mine to bank)`;
    }
    return `Agility ${agilityLevel}/${WALL_AGILITY_NEED}: broken-wall shortcut OFF (need Agility ${WALL_AGILITY_NEED})`;
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
