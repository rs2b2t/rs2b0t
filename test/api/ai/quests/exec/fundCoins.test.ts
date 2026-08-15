import { afterEach, describe, expect, test } from 'bun:test';

import {
    AL_KHARID_ENTRY_CASH,
    AL_KHARID_FUNDING_MAN,
    AL_KHARID_TOLL,
    earnQuestCoinsStep,
    eastOfAlKharidGate,
    fundQuestCoins,
    inAlKharidFundingArea,
    KEBAB_SELLER,
    SAFE_PICKPOCKET_HP,
    VARROCK_FUNDING_MAN
} from '#/bot/api/ai/quests/exec/fundCoins.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';

afterEach(() => EventSignal.setInterrupt(null));

describe('fundCoins anchors', () => {
    test('Al Kharid Man stands next to the kebab shop', () => {
        // Same tiles Waterfall / Goblin Diplomacy used successfully live.
        expect({ x: AL_KHARID_FUNDING_MAN.x, z: AL_KHARID_FUNDING_MAN.z, level: AL_KHARID_FUNDING_MAN.level })
            .toEqual({ x: 3279, z: 3188, level: 0 });
        expect({ x: KEBAB_SELLER.x, z: KEBAB_SELLER.z, level: KEBAB_SELLER.level })
            .toEqual({ x: 3272, z: 3182, level: 0 });
        expect(AL_KHARID_FUNDING_MAN.distanceTo(KEBAB_SELLER)).toBeLessThanOrEqual(10);
    });

    test('toll entry cash covers gate + one kebab', () => {
        expect(AL_KHARID_TOLL).toBe(10);
        expect(AL_KHARID_ENTRY_CASH).toBe(13);
        expect(SAFE_PICKPOCKET_HP).toBe(3);
        expect({ x: VARROCK_FUNDING_MAN.x, z: VARROCK_FUNDING_MAN.z, level: VARROCK_FUNDING_MAN.level })
            .toEqual({ x: 3240, z: 3405, level: 0 });
    });

    test('inAlKharidFundingArea covers the man/kebab block only', () => {
        expect(inAlKharidFundingArea({ x: 3279, z: 3188, level: 0 })).toBe(true);
        expect(inAlKharidFundingArea({ x: 3304, z: 3120, level: 0 })).toBe(false); // Shantay
        expect(inAlKharidFundingArea({ x: 3240, z: 3405, level: 0 })).toBe(false); // Varrock man
        expect(inAlKharidFundingArea(null)).toBe(false);
    });

    test('eastOfAlKharidGate treats Shantay north as already past the toll', () => {
        expect(eastOfAlKharidGate({ x: 3303, z: 3129, level: 0 })).toBe(true);
        expect(eastOfAlKharidGate({ x: 3279, z: 3188, level: 0 })).toBe(true);
        expect(eastOfAlKharidGate({ x: 3240, z: 3405, level: 0 })).toBe(false); // Varrock
        expect(eastOfAlKharidGate({ x: 3093, z: 3243, level: 0 })).toBe(false); // Draynor
    });

    test('earnQuestCoinsStep is a custom earn step', () => {
        const step = earnQuestCoinsStep(50, 'test');
        expect(step.kind).toBe('custom');
        if (step.kind === 'custom') {
            expect(step.name).toContain('50');
            expect(step.name.toLowerCase()).toContain('al kharid');
        }
    });

    test('funding yields before navigation when a runtime event is pending', async () => {
        EventSignal.setInterrupt(() => true);
        expect(await fundQuestCoins(50, () => undefined)).toBe(false);
    });
});
