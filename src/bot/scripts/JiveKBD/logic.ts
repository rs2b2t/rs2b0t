// Why: the poison kit is the engine's, so the lair module keeps only the lever-spider clock and passes the rest through for its own importers.
export { ANTIPOISON_DOSES, ANTIPOISON_LABEL, POISONED, antipoisonPlan, doseToDrink } from '../JiveDragons/supply.js';

/** Ticks a super antipoison holds the poison counter below zero. */
export const IMMUNE_TICKS = 600;
/** Ticks kept back so the lever is pulled inside the window rather than on its edge. */
export const DOSE_MARGIN_TICKS = 100;

// Why: the poison varp is not sent to the client, so the only clock on the immunity is the bot's own record of the last drink.

/** Whether a dose is owed before the walk past the lever spiders. */
export function doseDue(lastDoseTick: number | null, now: number): boolean {
    return lastDoseTick === null || now - lastDoseTick >= IMMUNE_TICKS - DOSE_MARGIN_TICKS;
}

