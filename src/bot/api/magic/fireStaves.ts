import { STAFF_RUNES } from '../../data/spelldb.js';

export const NATURE_RUNE = 'Nature rune';
export const FIRE_STAFF = 'Staff of fire';

export const FIRE_STAVES: readonly string[] = [
    FIRE_STAFF,
    ...Object.entries(STAFF_RUNES)
        .filter(([staff, runes]) => staff.toLowerCase() !== FIRE_STAFF.toLowerCase() && runes.some(rune => rune.toLowerCase() === 'fire rune'))
        .map(([staff]) => staff)
];

export function pickFireStaff(has: (name: string) => boolean): string | undefined {
    return FIRE_STAVES.find(name => has(name));
}
