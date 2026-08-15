import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const MURDER_NAME = 'Murder Mystery';

// Why: every floured item renders the same name as its clean form, all three threads render "Criminals' thread", and "Pot" has twins, so nothing here is matched by name.

/** Object ids. */
export const MURDER_OBJ = {
    POT: 1931,
    POT_FLOUR: 1933,
    FLYPAPER: 1811,
    DAGGER: 1813,
    DAGGER_DUST: 1814,
    UNKNOWN_PRINT: 1822,
    KILLERS_PRINT: 1815,
    THREAD_RED: 1808,
    THREAD_GREEN: 1809,
    THREAD_BLUE: 1810
} as const;

export const MURDER_LOC = {
    WINDOW: 2666,
    FLOUR_BARREL: 2662,
    SACKS: 2663
} as const;

export const MURDER_TILE = {
    BANK: new Tile(2725, 3491, 0),
    /** The garden path guard, outside every mansion door. */
    GUARD: new Tile(2741, 3562, 0),
    /** North of the smashed window, beside the dagger on the study floor. */
    STUDY: new Tile(2747, 3578, 0),
    /** South of the kitchen's north wall — z 3583 is the far side of it. */
    FLOUR_BARREL: new Tile(2735, 3581, 0),
    SACKS: new Tile(2732, 3581, 0),
    SALESMAN: new Tile(2737, 3491, 0),
    ARHEIN: new Tile(2803, 3430, 0)
} as const;

export const ARHEIN = { npc: 'Arhein', anchor: MURDER_TILE.ARHEIN };

export const GUARD_START: NpcStop = {
    npc: 'Guard',
    anchor: MURDER_TILE.GUARD,
    leash: 8,
    prefer: ["Sure, I'll help"]
};

export const GUARD_HANDIN: NpcStop = {
    npc: 'Guard',
    anchor: MURDER_TILE.GUARD,
    leash: 8,
    prefer: ['I know who did it']
};

export const SALESMAN: NpcStop = {
    npc: 'Poison Salesman',
    anchor: MURDER_TILE.SALESMAN,
    leash: 10,
    prefer: ['Talk about the Murder Mystery Quest', 'Who did you sell Poison to at the house']
};

export interface LocStop {
    id: number;
    name: string;
    near: Tile;
}

export interface Suspect {
    stop: NpcStop;
    barrel: LocStop;
    /** The silver keepsake in their barrel, its floured form, and the print lifted off it. */
    silver: number;
    dust: number;
    print: number;
    /** The thread colour their clothes are made of. */
    thread: number;
    /** What they claim they bought the poison for. */
    poison: LocStop;
}

const POISON_ASK = ['buy poison the other day'];

export const SUSPECTS: readonly Suspect[] = [
    {
        stop: { npc: 'Anna', anchor: new Tile(2734, 3575, 0), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2656, name: "Annas' barrel", near: new Tile(2734, 3575, 0) },
        silver: 1796,
        dust: 1797,
        print: 1816,
        thread: MURDER_OBJ.THREAD_GREEN,
        poison: { id: 2650, name: 'Sinclair family compost heap', near: new Tile(2732, 3572, 0) }
    },
    {
        stop: { npc: 'Bob', anchor: new Tile(2748, 3559, 0), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2657, name: "Bobs' barrel", near: new Tile(2734, 3578, 0) },
        silver: 1798,
        dust: 1799,
        print: 1817,
        thread: MURDER_OBJ.THREAD_RED,
        poison: { id: 2651, name: 'Sinclair family beehive', near: new Tile(2731, 3559, 0) }
    },
    {
        stop: { npc: 'Carol', anchor: new Tile(2734, 3581, 1), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2658, name: "Carols' barrel", near: new Tile(2734, 3581, 1) },
        silver: 1800,
        dust: 1801,
        print: 1818,
        thread: MURDER_OBJ.THREAD_RED,
        poison: { id: 2652, name: 'Sinclair mansion drain', near: new Tile(2736, 3572, 0) }
    },
    {
        stop: { npc: 'David', anchor: new Tile(2739, 3581, 0), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2659, name: "Davids' barrel", near: new Tile(2734, 3578, 1) },
        silver: 1802,
        dust: 1803,
        print: 1819,
        thread: MURDER_OBJ.THREAD_GREEN,
        poison: { id: 2653, name: "Spiders' nest", near: new Tile(2740, 3575, 1) }
    },
    {
        stop: { npc: 'Elizabeth', anchor: new Tile(2746, 3581, 1), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2660, name: "Elizabeths' barrel", near: new Tile(2746, 3581, 1) },
        silver: 1804,
        dust: 1805,
        print: 1820,
        thread: MURDER_OBJ.THREAD_BLUE,
        poison: { id: 2654, name: 'Sinclair family fountain', near: new Tile(2746, 3563, 0) }
    },
    {
        stop: { npc: 'Frank', anchor: new Tile(2742, 3577, 0), leash: 8, prefer: POISON_ASK },
        barrel: { id: 2661, name: "Franks' barrel", near: new Tile(2746, 3577, 1) },
        silver: 1806,
        dust: 1807,
        print: 1821,
        thread: MURDER_OBJ.THREAD_BLUE,
        poison: { id: 2655, name: 'Sinclair family crest', near: new Tile(2745, 3573, 0) }
    }
];

// Why: the thread left on the window is cut from the murderer's own clothes, so its colour halves the field before a single print is lifted.

/** The two whose clothes match the thread, then the rest as a fallback. */
export function suspectOrder(thread: number): readonly Suspect[] {
    const matched = SUSPECTS.filter(s => s.thread === thread);
    return [...matched, ...SUSPECTS.filter(s => !matched.includes(s))];
}

/** Every object the guard's evidence check or a barrel's own gate counts, in the bank as well as the pack. */
export const MURDER_EVIDENCE: readonly { id: number; name: string }[] = [
    { id: MURDER_OBJ.DAGGER, name: "Criminals' dagger" },
    { id: MURDER_OBJ.DAGGER_DUST, name: "Criminals' dagger" },
    { id: MURDER_OBJ.UNKNOWN_PRINT, name: 'Unknown print' },
    { id: MURDER_OBJ.KILLERS_PRINT, name: "Killers' print" },
    { id: MURDER_OBJ.THREAD_RED, name: "Criminals' thread" },
    { id: MURDER_OBJ.THREAD_GREEN, name: "Criminals' thread" },
    { id: MURDER_OBJ.THREAD_BLUE, name: "Criminals' thread" },
    ...SUSPECTS.flatMap(s => [
        { id: s.silver, name: 'silver keepsake' },
        { id: s.dust, name: 'floured keepsake' },
        { id: s.print, name: 'suspect print' }
    ])
];
