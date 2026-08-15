import { describe, expect, test } from 'bun:test';

import { combatSwap } from '#/bot/api/ai/quests/defs/fightarena/legs.js';
import { FA_OBJ } from '#/bot/api/ai/quests/defs/fightarena/areas.js';

const RUNE_FULL_HELM = 1163;
const RUNE_CHAINBODY = 1113;
const LOBSTER = 379;

describe('combatSwap', () => {
    test('picks the pack hat and torso, hat first', () => {
        expect(combatSwap([LOBSTER, RUNE_CHAINBODY, RUNE_FULL_HELM])).toEqual([RUNE_FULL_HELM, RUNE_CHAINBODY]);
    });

    test('never picks the Khazard pieces back up', () => {
        expect(combatSwap([FA_OBJ.HELMET, FA_OBJ.ARMOUR])).toEqual([]);
    });

    test('an empty pack swaps nothing', () => {
        expect(combatSwap([])).toEqual([]);
    });

    test('a pack with only a body still swaps the body', () => {
        expect(combatSwap([FA_OBJ.HELMET, RUNE_CHAINBODY])).toEqual([RUNE_CHAINBODY]);
    });
});
