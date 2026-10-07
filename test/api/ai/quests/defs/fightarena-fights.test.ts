import { describe, expect, test } from 'bun:test';

import { FA_FIGHT, fightWon } from '#/bot/api/ai/quests/defs/fightarena/fights.js';
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
