import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { FIRE_SPOTS, localFirePlot, type FirePlot } from '../../api/firemaking/Firemaking.js';

export interface PackItem {
    readonly name: string | null;
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

export function countRaw(items: readonly PackItem[], pattern: string): number {
    return items.filter(i => matches(i.name, pattern)).length;
}

export function lastRawIndex(items: readonly PackItem[], pattern: string): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (matches(items[i].name, pattern)) {
            return i;
        }
    }
    return -1;
}

// Why: four banks already carry a hand-walked burn strip in FIRE_SPOTS, which beats a blind box around the stand: the Varrock East strip is the street north of the bank, and an 8-tile box only clips its edge.

/** Curated burn strip for this location, else a box around the bank stand. */
export function firePlotFor(locationName: string, bank: WorldTile, half: number): FirePlot {
    return FIRE_SPOTS[locationName] ?? localFirePlot(bank, half);
}

export const SURFACE_OPTIONS = ['Range', 'Fire'] as const;

/** `range` walks to a catalogued oven or fireplace, `fire` lights one beside the bank. */
export type CookSurfaceMode = 'range' | 'fire';

export function parseSurfaceMode(label: string): CookSurfaceMode {
    return label.trim().toLowerCase() === 'fire' ? 'fire' : 'range';
}

/** Items the bank leg must hold back before it withdraws the next load. */
export function cookKeepNames(mode: CookSurfaceMode, tinderbox: string, logName: string): string[] {
    return mode === 'fire' ? [tinderbox, logName] : [];
}

// Why: one log per trip, so a fire that burns out early leaves nothing to relight with and the bot banks instead of stalling on the spot.

/** Logs carried per trip. */
export const LOGS_PER_TRIP = 1;

/** How many logs to top the pack up by. */
export function logsToWithdraw(mode: CookSurfaceMode, held: number): number {
    if (mode !== 'fire') {
        return 0;
    }
    return Math.max(0, LOGS_PER_TRIP - Math.max(0, held));
}

export interface CookState {
    mode: CookSurfaceMode;
    rawLeft: number;
    logsLeft: number;
    /** A Fire loc is within reach of the player. */
    fireLit: boolean;
}

// Why: an empty log pack only sends the bot back to the bank when nothing is burning, otherwise it finishes the load on the fire it already has.

export function needsBank(s: CookState): boolean {
    return s.rawLeft === 0 || (s.mode === 'fire' && s.logsLeft === 0 && !s.fireLit);
}

export function needsLight(s: CookState): boolean {
    return s.mode === 'fire' && s.rawLeft > 0 && s.logsLeft > 0 && !s.fireLit;
}

export function canCook(s: CookState): boolean {
    return s.rawLeft > 0 && (s.mode === 'range' || s.fireLit);
}
