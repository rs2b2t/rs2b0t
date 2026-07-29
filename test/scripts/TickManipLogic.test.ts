import { describe, expect, test } from 'bun:test';
import {
    FISH_TICK_MANIP_OPTIONS,
    FLETCHABLE_LOG_NAMES,
    MINE_TICK_MANIP_OPTIONS,
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
    wcTickManipProfile
} from '#/bot/scripts/TickManipLogic.js';

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

describe('profiles', () => {
    test('Off defaults flee and no combat gather', () => {
        const p = profileForSetting('fish', 'Off');
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
        const p = profileForSetting('wc', 'Knife delay (+2)');
        expect(p.useKnifeDelay).toBe(true);
        expect(p.allowCombat).toBe(false);
    });

    test('retaliate methods allow combat and may die', () => {
        for (const label of ['2t retaliate oaks', '3t farmer willows', '3t willows shortbow rapid', 'Tannerfishing'] as const) {
            const skill = label === 'Tannerfishing' ? 'fish' : 'wc';
            const p = profileForSetting(skill, label);
            expect(p.allowCombat, label).toBe(true);
            expect(p.combat, label).toBe('retaliate-may-die');
            expect(p.mayDie, label).toBe(true);
        }
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
        const p = profileForSetting('fish', 'Tannerfishing');
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
