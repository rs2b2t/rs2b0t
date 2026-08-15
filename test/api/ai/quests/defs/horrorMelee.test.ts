import { describe, expect, test } from 'bun:test';

import { FORM_ELEMENT, IMMUNE_FORMS, MELEE_FORM, MOTHER_IDS, RANGED_FORM } from '#/bot/api/ai/quests/defs/horror/fight.js';

// `npc.dat` runs the block contiguously from horror_dagannoth_jr4 (1347): aira/airb/airc/air, water, fire, earth, ranged, melee.
// Why: swapping the last two swings a scimitar at the ranged-only form, with no message and no damage.
describe('Dagannoth mother forms', () => {
    test('the melee-weak form is 1356, the ranged-weak form 1355', () => {
        expect(MELEE_FORM).toBe(1356);
        expect(RANGED_FORM).toBe(1355);
    });

    test('neither of the two takes damage from any spell', () => {
        expect(IMMUNE_FORMS.has(MELEE_FORM)).toBe(true);
        expect(IMMUNE_FORMS.has(RANGED_FORM)).toBe(true);
        expect(FORM_ELEMENT[MELEE_FORM]).toBeUndefined();
        expect(FORM_ELEMENT[RANGED_FORM]).toBeUndefined();
    });

    test('both are still forms the fight expects to meet', () => {
        expect(MOTHER_IDS).toContain(MELEE_FORM);
        expect(MOTHER_IDS).toContain(RANGED_FORM);
    });

    test('the elemental forms keep their spells — the block alignment depends on it', () => {
        // These four are what cross-validate the 104 offset against npc.dat:
        // water/fire/earth land where the pack orders them.
        expect(FORM_ELEMENT[1352]).toBe('Water');
        expect(FORM_ELEMENT[1353]).toBe('Fire');
        expect(FORM_ELEMENT[1354]).toBe('Earth');
        expect(FORM_ELEMENT[1351]).toBe('Wind');
    });

    test('every non-immune form has a spell, and no form has both', () => {
        for (const id of MOTHER_IDS) {
            const hasSpell = FORM_ELEMENT[id] !== undefined;
            expect(hasSpell).toBe(!IMMUNE_FORMS.has(id));
        }
    });
});
