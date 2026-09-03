import type { FlaskPlan } from '../JiveDragons/supply.js';

/** poison_player's opening line, printed once per fresh poisoning. */
export const POISONED = /you have been poisoned/i;

export const ANTIPOISON_LABEL = 'Superantipoison';
export const ANTIPOISON_DOSES: readonly string[] = [4, 3, 2, 1].map(d => `${ANTIPOISON_LABEL}(${d})`);

/** Ticks a super antipoison holds the poison counter below zero. */
export const IMMUNE_TICKS = 600;
/** Ticks kept back so the lever is pulled inside the window rather than on its edge. */
export const DOSE_MARGIN_TICKS = 100;

export function antipoisonPlan(want: number): FlaskPlan {
    return { flask: ANTIPOISON_DOSES[0]!, doses: ANTIPOISON_DOSES, want };
}

// Why: the poison varp is not sent to the client, so the only clock on the immunity is the bot's own record of the last drink.

/** Whether a dose is owed before the walk past the lever spiders. */
export function doseDue(lastDoseTick: number | null, now: number): boolean {
    return lastDoseTick === null || now - lastDoseTick >= IMMUNE_TICKS - DOSE_MARGIN_TICKS;
}

/** The first dose form held, smallest flask first so a part-used one goes before a full one. */
export function doseToDrink(count: (name: string) => number): string | null {
    for (const name of [...ANTIPOISON_DOSES].reverse()) {
        if (count(name) > 0) {
            return name;
        }
    }
    return null;
}
