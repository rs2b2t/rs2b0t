import { describe, expect, test } from 'bun:test';
import {
    FISH_TICK_MANIP_OPTIONS,
    FLETCHABLE_LOG_NAMES,
    MINE_TICK_MANIP_OPTIONS,
    TANNERFISH_EAT_HP,
    TICK_MANIP_SHIPPED,
    WC_TICK_MANIP_OPTIONS,
    combatBreaksGather,
    extraDelayLogsToDrop,
    farmerWillowPhase,
    fishTickManipProfile,
    isFletchableLogName,
    isShortbowName,
    knifeDelayPhase,
    miningRateForPickaxe,
    nextGatherClickTick,
    parseFishTickManip,
    parseMineTickManip,
    parseWcTickManip,
    profileForSetting,
    shouldCookForTannerfish,
    shouldEatForTannerfish,
    tickManipUiOptions,
    wcTickManipProfile
} from '#/bot/scripts/GatheringBot/TickManipLogic.js';

describe('parseFishTickManip', () => {
    test('maps UI labels', () => {
        expect(parseFishTickManip('Off')).toBe('off');
        expect(parseFishTickManip('4t fly reclick')).toBe('4t-fly');
        expect(parseFishTickManip('Knife delay (+2)')).toBe('knife-delay');
        expect(parseFishTickManip('Tannerfishing')).toBe('tannerfish');
    });

    test('every dropdown option parses stably', () => {
        for (const o of FISH_TICK_MANIP_OPTIONS) {
            expect(typeof parseFishTickManip(o)).toBe('string');
        }
    });
});

describe('parseMineTickManip / parseWcTickManip', () => {
    test('mine labels', () => {
        expect(parseMineTickManip('Off')).toBe('off');
        expect(parseMineTickManip('Iron cadence (pick-aware)')).toBe('iron-cadence');
        expect(parseMineTickManip('4t iron')).toBe('iron-cadence');
        for (const o of MINE_TICK_MANIP_OPTIONS) {
            expect(typeof parseMineTickManip(o)).toBe('string');
        }
    });

    test('wc labels', () => {
        expect(parseWcTickManip('Off')).toBe('off');
        expect(parseWcTickManip('Knife delay (+2)')).toBe('knife-delay');
        expect(parseWcTickManip('2t retaliate oaks')).toBe('2t-oaks');
        expect(parseWcTickManip('3t farmer willows')).toBe('3t-farmer');
        expect(parseWcTickManip('3t willows shortbow rapid')).toBe('3t-shortbow');
        for (const o of WC_TICK_MANIP_OPTIONS) {
            expect(typeof parseWcTickManip(o)).toBe('string');
        }
    });
});

describe('product gate (TICK_MANIP_SHIPPED)', () => {
    test('UI options are Off-only until shipped', () => {
        if (TICK_MANIP_SHIPPED) {
            expect(tickManipUiOptions(FISH_TICK_MANIP_OPTIONS).length).toBeGreaterThan(1);
        } else {
            expect(tickManipUiOptions(FISH_TICK_MANIP_OPTIONS)).toEqual(['Off']);
            expect(tickManipUiOptions(MINE_TICK_MANIP_OPTIONS)).toEqual(['Off']);
            expect(tickManipUiOptions(WC_TICK_MANIP_OPTIONS)).toEqual(['Off']);
        }
    });

    test('profileForSetting ignores non-Off labels while unshipped', () => {
        if (TICK_MANIP_SHIPPED) {
            expect(profileForSetting('wc', 'Knife delay (+2)').useKnifeDelay).toBe(true);
            return;
        }
        expect(profileForSetting('fish', 'Tannerfishing').method).toBe('off');
        expect(profileForSetting('wc', 'Knife delay (+2)').method).toBe('off');
        expect(profileForSetting('mine', 'Iron cadence (pick-aware)').method).toBe('off');
        expect(profileForSetting('fish', 'Off').method).toBe('off');
    });
});

describe('profiles', () => {
    test('Off defaults flee and no combat gather', () => {
        const p = fishTickManipProfile('off');
        expect(p.method).toBe('off');
        expect(p.combat).toBe('flee');
        expect(p.allowCombat).toBe(false);
        expect(p.mayDie).toBe(false);
    });

    test('4t fly is timed reclick without combat', () => {
        const p = fishTickManipProfile('4t-fly');
        expect(p.timedReclick).toBe(true);
        expect(p.nativeCycleTicks).toBe(4);
        expect(p.allowCombat).toBe(false);
        expect(p.useKnifeDelay).toBe(false);
    });

    test('knife delay flags inventory delay', () => {
        const p = wcTickManipProfile('knife-delay');
        expect(p.useKnifeDelay).toBe(true);
        expect(p.allowCombat).toBe(false);
    });

    test('retaliate methods allow combat and may die', () => {
        expect(wcTickManipProfile('2t-oaks').allowCombat).toBe(true);
        expect(wcTickManipProfile('3t-farmer').mayDie).toBe(true);
        expect(wcTickManipProfile('3t-shortbow').combat).toBe('retaliate-may-die');
        expect(fishTickManipProfile('tannerfish').allowCombat).toBe(true);
        expect(fishTickManipProfile('tannerfish').mayDie).toBe(true);
    });

    test('shortbow rapid only on 3t shortbow method', () => {
        expect(wcTickManipProfile('3t-shortbow').shortbowRapid).toBe(true);
        expect(wcTickManipProfile('2t-oaks').shortbowRapid).toBe(false);
    });

    test('farmer cycle flag', () => {
        expect(wcTickManipProfile('3t-farmer').farmerWillowCycle).toBe(true);
        expect(wcTickManipProfile('3t-farmer').nativeCycleTicks).toBe(6);
    });

    test('tannerfish cook/eat interleave', () => {
        const p = fishTickManipProfile('tannerfish');
        expect(p.cookEatInterleave).toBe(true);
    });
});

describe('miningRateForPickaxe', () => {
    test('matches server pickaxes.obj rates', () => {
        expect(miningRateForPickaxe('Bronze pickaxe')).toBe(7);
        expect(miningRateForPickaxe('Iron pickaxe')).toBe(6);
        expect(miningRateForPickaxe('Steel pickaxe')).toBe(5);
        expect(miningRateForPickaxe('Mithril pickaxe')).toBe(4);
        expect(miningRateForPickaxe('Adamant pickaxe')).toBe(3);
        expect(miningRateForPickaxe('Rune pickaxe')).toBe(2);
    });
});

describe('cycle planners', () => {
    test('nextGatherClickTick adds cycle length', () => {
        expect(nextGatherClickTick(100, 4)).toBe(104);
        expect(nextGatherClickTick(100, 4, 1)).toBe(105);
        expect(nextGatherClickTick(100, 0)).toBe(101);
    });

    test('knifeDelayPhase roll / +1 / late', () => {
        expect(knifeDelayPhase(50, 50)).toBe('delay-action');
        expect(knifeDelayPhase(51, 50)).toBe('reclick');
        expect(knifeDelayPhase(55, 50)).toBe('delay-action');
    });

    test('farmerWillowPhase 6-tick machine', () => {
        const start = 10;
        expect(farmerWillowPhase(10, start)).toBe('click-tree'); // t1
        expect(farmerWillowPhase(11, start)).toBe('wait');
        expect(farmerWillowPhase(14, start)).toBe('cut-log'); // t5
        expect(farmerWillowPhase(15, start)).toBe('drop-log'); // t6
        expect(farmerWillowPhase(16, start)).toBe('click-tree'); // next cycle
    });
});

describe('combatBreaksGather', () => {
    test('default AFK yields on combat', () => {
        expect(combatBreaksGather(true, false)).toBe(true);
        expect(combatBreaksGather(false, false)).toBe(false);
    });

    test('retaliate methods ignore combat alone', () => {
        expect(combatBreaksGather(true, true)).toBe(false);
        expect(combatBreaksGather(false, true)).toBe(false);
    });
});

describe('delay log helpers', () => {
    test('fletchable log names', () => {
        expect(isFletchableLogName('Oak logs')).toBe(true);
        expect(isFletchableLogName('Teak logs')).toBe(false);
        expect(FLETCHABLE_LOG_NAMES.length).toBe(6);
    });

    test('extraDelayLogsToDrop keeps one', () => {
        expect(extraDelayLogsToDrop(0)).toBe(0);
        expect(extraDelayLogsToDrop(1)).toBe(0);
        expect(extraDelayLogsToDrop(5)).toBe(4);
        expect(extraDelayLogsToDrop(5, 2)).toBe(3);
    });

    test('shortbow detect', () => {
        expect(isShortbowName('Maple shortbow')).toBe(true);
        expect(isShortbowName('Maple longbow')).toBe(false);
    });
});

describe('tannerfish heuristics', () => {
    test('eat when HP below threshold and cooked held', () => {
        expect(shouldEatForTannerfish(TANNERFISH_EAT_HP - 0.01, true)).toBe(true);
        expect(shouldEatForTannerfish(TANNERFISH_EAT_HP, true)).toBe(false);
        expect(shouldEatForTannerfish(0.1, false)).toBe(false);
    });

    test('cook when pack tight or building food buffer', () => {
        expect(
            shouldCookForTannerfish({ rawCount: 1, cookedCount: 0, freeSlots: 2, hpFraction: 1 })
        ).toBe(true);
        expect(
            shouldCookForTannerfish({ rawCount: 1, cookedCount: 0, freeSlots: 10, hpFraction: 0.8 })
        ).toBe(true);
        expect(
            shouldCookForTannerfish({ rawCount: 4, cookedCount: 1, freeSlots: 10, hpFraction: 1 })
        ).toBe(true);
        expect(
            shouldCookForTannerfish({ rawCount: 0, cookedCount: 0, freeSlots: 0, hpFraction: 0.2 })
        ).toBe(false);
        expect(
            shouldCookForTannerfish({ rawCount: 1, cookedCount: 4, freeSlots: 10, hpFraction: 1 })
        ).toBe(false);
    });
});
