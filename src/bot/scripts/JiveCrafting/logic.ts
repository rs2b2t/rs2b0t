export const GOLD_BAR = 'Gold bar';
export const PACK = 28;

export type Kind = 'ring' | 'necklace' | 'amulet';

export interface Jewel {
    label: string;
    /** The pack name, and the slot name in the furnace panel. */
    item: string;
    kind: Kind;
    gem: string | null;
    level: number;
    xp: number;
    mould: string;
}

const MOULD: Record<Kind, string> = { ring: 'Ring mould', necklace: 'Necklace mould', amulet: 'Amulet mould' };

const row = (kind: Kind, gem: string | null, level: number, xp: number, item?: string): Jewel => {
    const label = `${gem ?? 'Gold'} ${kind}`;
    return { label, item: item ?? label, kind, gem, level, xp, mould: MOULD[kind] };
};

/** The gold jewellery of the content's `crafting_jewelry_struct`, xp as the skill grants it. */
export const JEWELLERY: readonly Jewel[] = [
    row('ring', null, 5, 15),
    row('ring', 'Sapphire', 20, 40),
    row('ring', 'Emerald', 27, 55),
    row('ring', 'Ruby', 34, 70),
    row('ring', 'Diamond', 43, 85),
    row('ring', 'Dragonstone', 55, 100),
    row('necklace', null, 6, 20),
    row('necklace', 'Sapphire', 20, 55),
    row('necklace', 'Emerald', 29, 60),
    row('necklace', 'Ruby', 40, 75),
    row('necklace', 'Diamond', 56, 90),
    row('necklace', 'Dragonstone', 72, 105, 'Dragon necklace'),
    row('amulet', null, 8, 30),
    row('amulet', 'Sapphire', 24, 65),
    row('amulet', 'Emerald', 31, 70),
    row('amulet', 'Ruby', 50, 85),
    row('amulet', 'Diamond', 70, 100),
    row('amulet', 'Dragonstone', 80, 150, 'Dragonstoneamulet')
];

export const PRODUCT_OPTIONS = JEWELLERY.map(j => j.label);

export function jewelByName(name: string): Jewel | null {
    const want = name.trim().toLowerCase();
    return JEWELLERY.find(j => j.label.toLowerCase() === want || j.item.toLowerCase() === want) ?? null;
}

/** Bars a trip carries beside the mould: paired with a gem, or filling the pack for gold. */
export function setsPerTrip(j: Jewel): number {
    return j.gem ? Math.floor((PACK - 1) / 2) : PACK - 1;
}

export interface PackState {
    mould: boolean;
    bars: number;
    gems: number;
}

export type Step = { kind: 'craft' } | { kind: 'bank' };

export function craftable(pack: PackState, j: Jewel): number {
    if (!pack.mould) {
        return 0;
    }
    return j.gem ? Math.min(pack.bars, pack.gems) : pack.bars;
}

/** One step per loop, read off the pack alone so a restart lands on the same choice. */
export function decide(pack: PackState, j: Jewel): Step {
    return craftable(pack, j) > 0 ? { kind: 'craft' } : { kind: 'bank' };
}

export type Plan = { ok: true; mould: boolean; bars: number; gems: number } | { ok: false; reason: string };

/** What a bank visit withdraws, or why the run has to stop. */
export function withdrawPlan(j: Jewel, mouldHeld: boolean, stock: (name: string) => number): Plan {
    if (!mouldHeld && stock(j.mould) < 1) {
        return { ok: false, reason: `no ${j.mould} in the pack or the bank` };
    }
    const bars = stock(GOLD_BAR);
    if (bars < 1) {
        return { ok: false, reason: `the bank has no ${GOLD_BAR}` };
    }
    const gems = j.gem ? stock(j.gem) : 0;
    if (j.gem && gems < 1) {
        return { ok: false, reason: `the bank has no ${j.gem}` };
    }
    const sets = Math.min(setsPerTrip(j), bars, j.gem ? gems : bars);
    return { ok: true, mould: !mouldHeld, bars: sets, gems: j.gem ? sets : 0 };
}

export type MakeOp = 'Make' | 'Make 5' | 'Make 10';

// Why: every click reopens the panel and a batch that outruns the bars ends in one mesbox, so the bigger button wins from six up and Make 5 covers two to five.
export function makeOp(remaining: number): MakeOp {
    if (remaining >= 6) {
        return 'Make 10';
    }
    if (remaining >= 2) {
        return 'Make 5';
    }
    return 'Make';
}
