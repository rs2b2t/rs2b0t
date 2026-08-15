import type { WorldTile } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';

// Why: Alfred Grimhand's Barcrawl is a miniquest in its own right and the only way past the Barbarian Outpost gate, so its data and card parsing live here rather than inside the one quest that needs it.
// Why: {@link RunBarcrawl} drives it, and scripts and quest modules both call that.
// Why: `%barcrawl` is `scope=perm` with no transmit, so which bars are signed is not on the wire.
// Why: the card's Read op is the oracle — it renders one green/red line per bar into a scroll modal, the same shape as a quest journal.

export const COINS_ID = 995;
export const BARCRAWL_CARD = 'Barcrawl card';
export const COINS = 'Coins';

export interface Bar {
    id: number;
    npc: string;
    tile: Tile;
    /** The card line this bar writes, lowercased. */
    line: string;
    /** Asking price of that bar's barcrawl drink. */
    gp: number;
}

export const BARS: readonly Bar[] = [
    { id: 734, npc: 'Bartender', tile: new Tile(3045, 3258, 0), line: 'rusty anchor', gp: 8 },
    { id: 736, npc: 'Barmaid', tile: new Tile(2957, 3371, 0), line: 'rising sun', gp: 70 },
    { id: 733, npc: 'Bartender', tile: new Tile(3226, 3400, 0), line: 'bluemoon', gp: 50 },
    { id: 731, npc: 'Bartender', tile: new Tile(3276, 3488, 0), line: 'jolly boar', gp: 10 },
    { id: 737, npc: 'Bartender', tile: new Tile(2690, 3494, 0), line: 'foresters arms', gp: 18 },
    { id: 738, npc: 'Bartender', tile: new Tile(2575, 3321, 0), line: 'flying horse', gp: 8 },
    { id: 739, npc: 'Bartender', tile: new Tile(2556, 3079, 0), line: 'dragon inn', gp: 12 },
    { id: 848, npc: 'Blurberry', tile: new Tile(2480, 3490, 1), line: "blurberry's bar", gp: 10 },
    { id: 568, npc: 'Zambo', tile: new Tile(2924, 3143, 0), line: 'karamja spirits', gp: 7 },
    { id: 735, npc: 'Bartender', tile: new Tile(2796, 3155, 0), line: "dead man's chest", gp: 15 }
];

/** Every drink, plus slack for the card and the gate. */
export const BARCRAWL_GP = BARS.reduce((sum, bar) => sum + bar.gp, 0) + 200;

export const BARBARIAN_GUARD_ID = 384;
export const GUARD_TILE = new Tile(2544, 3572, 0);

export const GUARD_PREFER = [
    'I want to come through this gate.',
    'Looks can be deceiving, I am in fact a barbarian.'
];

/** Barcrawl-first, so an ale menu never wins the pick. */
export const BAR_PREFER = ['Alfred Grimhand', 'Barcrawl', 'Yes'];

/** The card's own refusal once all ten lines are green. */
export const TOO_DRUNK = /too drunk to be able to read/i;

/** `outpost_guard_talk`'s greeting for `%barcrawl = ^barcrawl_complete`. */
export const GATE_IS_OPEN = /ello friend/i;

export interface BarcrawlProgress {
    /** Bars whose card line is still red. */
    remaining: readonly Bar[];
    /** True once every line is green. */
    done: boolean;
}

function normalise(lines: readonly string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

/**
 * Which bars are still red. "Completed!" and "Not Completed..." both contain
 * the happy word, so each line is matched by its negation instead.
 */
export function parseCard(lines: readonly string[]): BarcrawlProgress | null {
    const text = normalise(lines);
    if (!text.includes('barcrawl')) {
        return null;
    }
    const remaining = BARS.filter(bar => {
        const at = text.indexOf(bar.line);
        return at === -1 || text.slice(at, at + bar.line.length + 24).includes('not completed');
    });
    return { remaining, done: remaining.length === 0 };
}

/** Nearest-first, so the tour is a rough loop rather than the list order. */
export function nextBar(remaining: readonly Bar[], here: WorldTile | null): Bar | undefined {
    if (!here) {
        return remaining[0];
    }
    return [...remaining].sort((a, b) => a.tile.distanceTo(here) - b.tile.distanceTo(here))[0];
}
