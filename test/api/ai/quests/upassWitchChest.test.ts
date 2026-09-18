import { describe, expect, test } from 'bun:test';

import { CHEST_FORMS, chestForm } from '#/bot/api/ai/quests/defs/upass/chest.js';
import { UP_LOC } from '#/bot/api/ai/quests/defs/upass/areas.js';

// Why: the chest changes from loc 3272 `Open` to loc 3273 `Search` for 20 ticks; both run the same script.

const inScene = (...ids: readonly number[]) => (id: number, op: string): boolean =>
    ids.includes(id) && (id === UP_LOC.WITCH_CHEST ? op === 'Open' : op === 'Search');

describe('which chest to act on', () => {
    test('takes the closed chest with Open when it is the one standing there', () => {
        expect(chestForm(inScene(UP_LOC.WITCH_CHEST))).toEqual({ id: UP_LOC.WITCH_CHEST, op: 'Open' });
    });

    test('takes the open chest with Search while the loc_change is still up', () => {
        expect(chestForm(inScene(UP_LOC.WITCH_CHEST_OPEN))).toEqual({ id: UP_LOC.WITCH_CHEST_OPEN, op: 'Search' });
    });

    test('falls back to the closed form when neither is in the scene, so the reach still walks', () => {
        expect(chestForm(inScene())).toEqual({ id: UP_LOC.WITCH_CHEST, op: 'Open' });
    });

    test('knows both forms and nothing else', () => {
        expect(CHEST_FORMS).toEqual([
            { id: UP_LOC.WITCH_CHEST, op: 'Open' },
            { id: UP_LOC.WITCH_CHEST_OPEN, op: 'Search' }
        ]);
    });
});
