/**
 * Crossings that need more than a plain `Open` — a precondition (e.g. a toll
 * fee) and/or a dialogue. Keyed by the loc's own coord + level. WalkExecutor
 * consults this table when it reaches an annotated crossing; a match diverts to
 * the conditional-crossing handler. doors.json still routes through these coords
 * as ordinary door edges, so the pathfinder can use them when the precondition
 * is met and avoid them (repath) when it isn't.
 *
 * This is the curated home for the nav audit's findings — add a row per special
 * gate rather than editing the generated doors.json.
 */
export interface SpecialCrossing {
    x: number;
    z: number;
    level: number;
    /** Loc name + interact op that starts the crossing (matches doors.json). */
    locName: string;
    action: string;
    /** Inventory requirement to attempt the crossing at all. */
    requires?: { item: string; count: number };
    /** Dialogue option text(s) to click while driving the conversation. */
    dialogue?: { choose: string[] };
    /** Human label for logs. */
    label: string;
}

export const SPECIAL_CROSSINGS: SpecialCrossing[] = [
    // Al Kharid toll gate (border_gate_toll_left/right). Opening starts a
    // Border-guard dialogue; "Yes, ok." pays 10 coins and teleports you across.
    { x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },
    { x: 3268, z: 3228, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' }
];

/** The special crossing whose loc sits exactly on (x,z,level), or null. */
export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}

/** First `options` entry containing (case-insensitive) any `choose` term, or null. */
export function pickChoice(options: string[], choose: string[]): string | null {
    const wants = choose.map(c => c.toLowerCase());
    return options.find(o => wants.some(w => o.toLowerCase().includes(w))) ?? null;
}

/** True when there is no requirement, or `have` meets the required count. */
export function meetsRequirement(have: number, requires?: { item: string; count: number }): boolean {
    return !requires || have >= requires.count;
}
