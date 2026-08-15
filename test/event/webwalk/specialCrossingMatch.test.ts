import { describe, expect, test } from 'bun:test';
import { specialCrossingForTransport } from '#/bot/event/webwalk/data/specialCrossings.js';

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

    test('Customs officer: Musa and Brimhaven routes stay instance-keyed (#404)', () => {
        const musa = specialCrossingForTransport(
            { locX: 2955, locZ: 3146, locName: 'Customs officer' },
            { x: 2955, z: 3146, level: 0 },
            { x: 3032, z: 3217, level: 1 }
        );
        const brim = specialCrossingForTransport(
            { locX: 2772, locZ: 3234, locName: 'Customs officer' },
            { x: 2772, z: 3234, level: 0 },
            { x: 2683, z: 3268, level: 1 }
        );
        expect(musa?.label).toBe('Musa->Port Sarim ship');
        expect(brim?.label).toBe('Brimhaven->Ardougne ship');
        expect(musa?.toTile).not.toEqual(brim?.toTile);
        // Wrong landing for this pier → do not steal the other Customs route.
        expect(
            specialCrossingForTransport(
                { locX: 2955, locZ: 3146, locName: 'Customs officer' },
                { x: 2955, z: 3146, level: 0 },
                { x: 2683, z: 3268, level: 1 }
            )
        ).toBeNull();
        expect(
            specialCrossingForTransport(
                { locX: 2772, locZ: 3234, locName: 'Customs officer' },
                { x: 2772, z: 3234, level: 0 },
                { x: 3032, z: 3217, level: 1 }
            )
        ).toBeNull();
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
