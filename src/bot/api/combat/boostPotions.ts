import type { CarryEntry } from '../loadout/loadouts.js';

export interface BoostPotion {
    /** The skill the dose lifts. */
    skill: string;
    /** Paint label, kept to three characters so a boost row still fits three columns. */
    short: string;
    /** The dose form drawn when the loadout names none. */
    flask: string;
    /** Every dose form, so a part-used flask still counts as one in the pack. */
    doses: readonly string[];
}

function superPotion(skill: string, short: string, label: string): BoostPotion {
    return { skill, short, flask: `${label}(3)`, doses: [4, 3, 2, 1].map(d => `${label}(${d})`) };
}

export const SUPER_ATTACK: BoostPotion = superPotion('attack', 'Att', 'Super attack');
export const SUPER_STRENGTH: BoostPotion = superPotion('strength', 'Str', 'Super strength');

// Why: the server runs one op per tick and drops the rest, so a fixed order is what makes "one sip per tick" a decision rather than a race.

/** Checked in this order; attack wins a tick both could use. */
export const BOOST_POTIONS: readonly BoostPotion[] = [SUPER_ATTACK, SUPER_STRENGTH];

/** What the last dose leaves behind. */
export const EMPTY_VIAL = 'Vial';

/** Share of the base level the boost may decay to before another dose is worth its tick. */
export const BOOST_FLOOR = 0.1;

// Why: a level drained below base is damage or a stat-reducing hit, and a super potion restores none of it, so a dose is asked for only by a boost on its way down.

/** Whether the boost has decayed back into the floor band. */
export function boostFaded(base: number, effective: number, floor: number = BOOST_FLOOR): boolean {
    const boost = effective - base;
    return base > 0 && boost >= 0 && boost <= floor * base;
}

export interface PotionPlan {
    potion: BoostPotion;
    /** The dose form the bank run draws. */
    flask: string;
    /** Flasks to carry per trip. */
    want: number;
}

/** The potions to carry, taking the dose form and count from the loadout and falling back to one three-dose flask of each. */
export function plannedPotions(carry: readonly CarryEntry[]): PotionPlan[] {
    return BOOST_POTIONS.map(potion => {
        for (const entry of carry) {
            const dose = potion.doses.find(d => d.toLowerCase() === entry.item.trim().toLowerCase());
            if (dose !== undefined) {
                return { potion, flask: dose, want: entry.qty };
            }
        }
        return { potion, flask: potion.flask, want: 1 };
    });
}

export interface SipState {
    plans: readonly PotionPlan[];
    /** Flasks of that potion held, counting every dose form. */
    held: (plan: PotionPlan) => number;
    levels: (skill: string) => { base: number; effective: number };
}

/** The one potion to drink this tick, or null. */
export function potionToSip(s: SipState): PotionPlan | null {
    for (const plan of s.plans) {
        const { base, effective } = s.levels(plan.potion.skill);
        if (s.held(plan) > 0 && boostFaded(base, effective)) {
            return plan;
        }
    }
    return null;
}
