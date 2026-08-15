import { describe, expect, test } from 'bun:test';

import {
    BARAEK, CURATOR, KATRINE_JOIN, RELDO, ROALD, SOA_ID, SOA_LOC, SOA_TILE, STRAVEN_JOIN, TRAMP,
    inBlackArmUpper, inPhoenixHq, inWeaponStore
} from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';

const tile = (x: number, z: number, level: number) => ({ x, z, level });

describe('arrav areas', () => {
    test('object ids match the content pack', () => {
        expect(SOA_ID.BOOK).toBe(757);
        expect(SOA_ID.STORE_KEY).toBe(759);
        expect(SOA_ID.REPORT).toBe(761);
        expect(SOA_ID.SHIELD_PHOENIX).toBe(763);
        expect(SOA_ID.SHIELD_BLACKARM).toBe(765);
        expect(SOA_ID.CROSSBOW).toBe(767);
        expect(SOA_ID.CERTIFICATE).toBe(769);
    });

    test('loc ids match the map placements', () => {
        expect(SOA_LOC.BOOKCASE).toBe(2402);
        expect(SOA_LOC.PHOENIX_DOOR).toBe(2397);
        expect(SOA_LOC.STORE_DOOR).toBe(2398);
        expect(SOA_LOC.BLACKARM_DOOR).toBe(2399);
        expect(SOA_LOC.CUPBOARD_SHUT).toBe(2400);
        expect(SOA_LOC.CUPBOARD_OPEN).toBe(2401);
        expect(SOA_LOC.CHEST_SHUT).toBe(2403);
        expect(SOA_LOC.CHEST_OPEN).toBe(2404);
    });

    // Why: a display name taken from a guide rather than the .npc config matches nothing, and Reach reports only a bare 'retry'.
    test('every stop names the npc exactly as varrock.npc does', () => {
        expect(RELDO.npc).toBe('Reldo');
        expect(BARAEK.npc).toBe('Baraek');
        expect(TRAMP.npc).toBe('Tramp');
        expect(STRAVEN_JOIN.npc).toBe('Straven');
        expect(KATRINE_JOIN.npc).toBe('Katrine');
        expect(CURATOR.npc).toBe('Curator');
        expect(ROALD.npc).toBe('King Roald');
    });

    test('every stop prefers a line that exists in the content script', () => {
        expect(RELDO.prefer).toContain("I'm in search of a quest.");
        expect(BARAEK.prefer).toContain('Can you tell me where I can find the Phoenix Gang?');
        expect(BARAEK.prefer).toContain('Okay. Have 20 gold coins.');
        expect(TRAMP.prefer).toContain('Is there anything down this alleyway?');
        expect(TRAMP.prefer).toContain('Do you think they would let me join?');
        expect(STRAVEN_JOIN.prefer).toContain('I know who you are!');
        expect(STRAVEN_JOIN.prefer).toContain("I'd like to offer you my services.");
        expect(KATRINE_JOIN.prefer).toContain("I've heard you're the Black Arm Gang.");
        expect(KATRINE_JOIN.prefer).toContain('I want to become a member of your gang.');
        expect(KATRINE_JOIN.prefer).toContain('Ok, no problem.');
    });

    test('no prefer entry is a substring of a later entry in the same list', () => {
        for (const stop of [RELDO, BARAEK, TRAMP, STRAVEN_JOIN, KATRINE_JOIN, CURATOR, ROALD]) {
            for (let i = 0; i < stop.prefer.length; i++) {
                for (let j = i + 1; j < stop.prefer.length; j++) {
                    expect(stop.prefer[j].includes(stop.prefer[i])).toBe(false);
                }
            }
        }
    });

    test('pocket tests name the three sealed areas', () => {
        expect(inPhoenixHq(tile(3240, 9770, 0))).toBe(true);
        expect(inPhoenixHq(SOA_TILE.CHEST_STAND)).toBe(true);
        expect(inPhoenixHq(tile(3244, 3383, 0))).toBe(false);

        expect(inWeaponStore(tile(3246, 3384, 1))).toBe(true);
        expect(inWeaponStore(tile(3246, 3384, 0))).toBe(false);

        expect(inBlackArmUpper(tile(3188, 3386, 1))).toBe(true);
        expect(inBlackArmUpper(tile(3188, 3386, 0))).toBe(false);
    });

    test('pocket tests are null-safe', () => {
        expect(inPhoenixHq(null)).toBe(false);
        expect(inWeaponStore(undefined)).toBe(false);
        expect(inBlackArmUpper(null)).toBe(false);
    });
});
