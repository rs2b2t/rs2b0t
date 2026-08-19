import { UP_LOC } from './areas.js';

/** A loc id and the op that runs `@search_cavewitch_chest` on it. */
export interface ChestForm {
    id: number;
    op: string;
}

// Why: Kardia's chest is two locs, not one. `[oploc1,cavewitchchest]` runs `loc_change(cavewitchchestopen, 20)` before it searches, so for twenty ticks the chest in the scene is 3273 carrying `Search` rather than 3272 carrying `Open`. A step that only names the closed form asks for a loc that is not there, the reach reports the house as unreachable, and the round ends without an op being sent — which is what a retry inside that window always is.
export const CHEST_FORMS: readonly ChestForm[] = [
    { id: UP_LOC.WITCH_CHEST, op: 'Open' },
    { id: UP_LOC.WITCH_CHEST_OPEN, op: 'Search' }
];

/**
 * The form of the chest that is standing there now.
 * Why: the closed form when neither is in sight, so the reach still walks to it — the chest can be out of the build area from the street, and absence at range is not evidence it is gone.
 */
export function chestForm(present: (id: number, op: string) => boolean): ChestForm {
    return CHEST_FORMS.find(form => present(form.id, form.op)) ?? CHEST_FORMS[0]!;
}
