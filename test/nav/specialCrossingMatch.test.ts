import { describe, expect, test } from 'bun:test';
import { specialCrossingForTransport } from '#/bot/nav/data/specialCrossings.js';

describe('specialCrossingForTransport', () => {
    test('gangplank hop on Brimhaven deck does not steal reverse Customs ship', () => {
        // Live fail: after Barnaby land, gangplank to 2772,3234,L0 was matched as
        // Brimhaven→Ardougne Customs (same pier tile, toTile elsewhere).
        const sc = specialCrossingForTransport(
            { locX: 2774, locZ: 3234, locName: 'Gangplank' },
            { x: 2775, z: 3234, level: 1 },
            { x: 2772, z: 3234, level: 0 }
        );
        expect(sc).toBeNull();
    });

    test('Customs reverse ship still matches when hop lands in Ardougne', () => {
        const sc = specialCrossingForTransport(
            { locX: 2772, locZ: 3234, locName: 'Customs officer' },
            { x: 2772, z: 3234, level: 1 },
            { x: 2683, z: 3268, level: 1 }
        );
        expect(sc).not.toBeNull();
        expect(sc!.label).toContain('Brimhaven');
        expect(sc!.npc).toBe('Customs officer');
    });

    test('glider multi-dest picks by hop landing', () => {
        const gandius = specialCrossingForTransport(
            { locX: 2465, locZ: 3501, locName: 'Gnome pilot' },
            { x: 2465, z: 3501, level: 3 },
            { x: 2971, z: 2969, level: 0 }
        );
        expect(gandius?.mapChoice).toBe('Gandius');

        const kar = specialCrossingForTransport(
            { locX: 2465, locZ: 3501, locName: 'Gnome pilot' },
            { x: 2465, z: 3501, level: 3 },
            { x: 3284, z: 3211, level: 0 }
        );
        expect(kar?.mapChoice).toBe('Kar-Hewo');
    });
});
