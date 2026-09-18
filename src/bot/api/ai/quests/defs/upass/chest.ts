import { UP_LOC } from './areas.js';

/** A loc id and the op that runs `@search_cavewitch_chest` on it. */
export interface ChestForm {
    id: number;
    op: string;
}

// Why: Kardia's chest changes from id 3272/Open to id 3273/Search for 20 ticks, so accept either form.
export const CHEST_FORMS: readonly ChestForm[] = [
    { id: UP_LOC.WITCH_CHEST, op: 'Open' },
    { id: UP_LOC.WITCH_CHEST_OPEN, op: 'Search' }
];

/**
 * The form of the chest that is standing there now.
 * Why: the closed form when neither is in sight, so the reach still walks to it; the chest can be out of the build area from the street.
 */
export function chestForm(present: (id: number, op: string) => boolean): ChestForm {
    return CHEST_FORMS.find(form => present(form.id, form.op)) ?? CHEST_FORMS[0]!;
}
