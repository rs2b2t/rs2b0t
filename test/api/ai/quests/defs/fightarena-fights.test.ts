import { describe, expect, test } from 'bun:test';

import { ENGAGE_PROOF, FA_FIGHT, fightWon, unengaged } from '#/bot/api/ai/quests/defs/fightarena/fights.js';
import { FA_NPC } from '#/bot/api/ai/quests/defs/fightarena/areas.js';

describe('the arena fights', () => {
    test('each fight names the npc id the server spawns', () => {
        expect(FA_FIGHT.ogre.npcId).toBe(FA_NPC.OGRE);
        expect(FA_FIGHT.scorpion.npcId).toBe(FA_NPC.SCORPION);
        expect(FA_FIGHT.bouncer.npcId).toBe(FA_NPC.BOUNCER);
    });

    test('Bouncer gets the longest guard — 116 hitpoints behind 120 defence', () => {
        expect(FA_FIGHT.bouncer.guard).toBeGreaterThan(FA_FIGHT.scorpion.guard);
        expect(FA_FIGHT.bouncer.guard).toBeGreaterThan(FA_FIGHT.ogre.guard);
    });
});

describe('fightWon', () => {
    test('an empty scene before the first swing is not a win', () => {
        expect(fightWon(0, 99)).toBe(false);
    });

    test('one missing tick after a swing is not a win', () => {
        expect(fightWon(4, 1)).toBe(false);
    });

    test('three missing ticks after a swing is a win', () => {
        expect(fightWon(4, 3)).toBe(true);
    });
});

describe('unengaged', () => {
    test('a beast that never fights back after enough swings is not out of its cage', () => {
        expect(unengaged(ENGAGE_PROOF, false)).toBe(true);
    });

    test('a few swings are not proof yet — the first clicks land before combat registers', () => {
        expect(unengaged(ENGAGE_PROOF - 1, false)).toBe(false);
    });

    test('combat, however brief, proves the beast is out', () => {
        expect(unengaged(600, true)).toBe(false);
    });

    test('the proof is cheap next to the fight budget, so a caged beast is caught in seconds', () => {
        expect(ENGAGE_PROOF).toBeLessThan(FA_FIGHT.ogre.guard / 10);
    });
});
