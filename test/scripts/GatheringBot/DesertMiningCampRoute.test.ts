import { describe, expect, test } from 'bun:test';
import {
    desertCampBankCatchNeeded,
    desertCampBankTripDirection,
    desertCampDestinationFor,
    desertCampKeepNames,
    DESERT_CAMP_ITEMS,
    DESERT_CAMP_KEEP_NAMES,
    desertCampRouteArea,
    desertCampRoutePhase,
    isDesertCampLocation,
    metalKeyCaptainAvailable,
    metalKeyCaptainClaimAcknowledged,
    metalKeyDuelNeedsRetreat,
    metalKeyRetreatAfterSustain,
    planDesertCampSupplies,
    type DesertCampSupplySnapshot
} from '#/bot/scripts/GatheringBot/DesertMiningCampRoute.js';

const fullGear = Object.fromEntries([DESERT_CAMP_ITEMS.metalKey, DESERT_CAMP_ITEMS.wroughtKey, ...DESERT_CAMP_ITEMS.desert, ...DESERT_CAMP_ITEMS.slave].map(name => [name, 1]));

function supply(overrides: Partial<DesertCampSupplySnapshot> = {}): DesertCampSupplySnapshot {
    return { inventory: {}, equipment: {}, bank: {}, freeSlots: 28, ...overrides };
}

describe('Metal key duel safety', () => {
    test('waits for an unoccupied Mercenary Captain', () => {
        expect(metalKeyCaptainAvailable(null)).toBe(false);
        expect(metalKeyCaptainAvailable({ inCombat: true, targetsAnotherPlayer: () => false })).toBe(false);
        expect(metalKeyCaptainAvailable({ inCombat: false, targetsAnotherPlayer: () => true })).toBe(false);
        expect(metalKeyCaptainAvailable({ inCombat: false, targetsAnotherPlayer: () => false })).toBe(true);
    });

    test('does not treat an unacknowledged Talk-to packet as captain ownership', () => {
        expect(metalKeyCaptainClaimAcknowledged(false, false, false)).toBe(false);
        expect(metalKeyCaptainClaimAcknowledged(true, false, false)).toBe(true);
        expect(metalKeyCaptainClaimAcknowledged(false, true, false)).toBe(true);
        expect(metalKeyCaptainClaimAcknowledged(false, false, true)).toBe(true);
    });

    test('retreats before fighting on the final food item', () => {
        expect(metalKeyDuelNeedsRetreat(2, true)).toBe(false);
        expect(metalKeyDuelNeedsRetreat(1, true)).toBe(true);
        expect(metalKeyDuelNeedsRetreat(0, true)).toBe(true);
    });

    test('does not retreat after the captain has died and the key reward is pending', () => {
        expect(metalKeyDuelNeedsRetreat(0, false)).toBe(false);
    });

    test('rechecks both the key and captain after sustain before retreating', () => {
        expect(metalKeyRetreatAfterSustain(true, 1, true)).toBe(false);
        expect(metalKeyRetreatAfterSustain(false, 1, false)).toBe(false);
        expect(metalKeyRetreatAfterSustain(false, 1, true)).toBe(true);
    });
});

describe('Desert Mining Camp route areas', () => {
    const cases = [
        [{ x: 3309, z: 3120, level: 0 }, 'shantayNorth'],
        [{ x: 3302, z: 3114, level: 0 }, 'desert'],
        [{ x: 3288, z: 3029, level: 0 }, 'campSurface'],
        [{ x: 3290, z: 3033, level: 1 }, 'campSurface'],
        [{ x: 3285, z: 3034, level: 0 }, 'unsupported'],
        [{ x: 3278, z: 9415, level: 0 }, 'mineEntrance'],
        [{ x: 3286, z: 9415, level: 0 }, 'mineLower'],
        [{ x: 3288, z: 9435, level: 0 }, 'unsupported'],
        [{ x: 3322, z: 9448, level: 0 }, 'mineLower'],
        [{ x: 3322, z: 9449, level: 0 }, 'mineDeep'],
        [{ x: 3323, z: 9458, level: 0 }, 'mineDeep'],
        [{ x: 2606, z: 3102, level: 0 }, 'mainland'],
        [{ x: 3218, z: 9618, level: 0 }, 'unsupported']
    ] as const;
    for (const [tile, area] of cases) {
        test(`${tile.x},${tile.z},${tile.level} is ${area}`, () => {
            expect(desertCampRouteArea(tile)).toBe(area);
        });
    }
});

describe('Desert Mining Camp restart phases', () => {
    test('hands a latched trip to banking after the route reaches Shantay', () => {
        expect(desertCampBankCatchNeeded(true, false, false, false)).toBe(true);
        expect(desertCampBankCatchNeeded(false, false, false, false)).toBe(false);
        expect(desertCampBankCatchNeeded(false, true, false, false)).toBe(true);
        expect(desertCampBankCatchNeeded(false, false, true, false)).toBe(true);
        expect(desertCampBankCatchNeeded(false, false, false, true)).toBe(true);
    });

    test('keeps an outbound bank trip latched after eating frees a pack slot', () => {
        const idle = desertCampBankTripDirection(false, false);
        expect(idle).toEqual({ bankTrip: false, direction: 'enter' });
        const fullPack = desertCampBankTripDirection(idle.bankTrip, true);
        expect(fullPack).toEqual({ bankTrip: true, direction: 'exit' });
        const afterEating = desertCampBankTripDirection(fullPack.bankTrip, false);
        expect(afterEating).toEqual({
            bankTrip: true,
            direction: 'exit'
        });
        expect(desertCampBankTripDirection(afterEating.bankTrip, false)).toEqual(afterEating);
        expect(desertCampBankTripDirection(false, false)).toEqual({
            bankTrip: false,
            direction: 'enter'
        });
    });

    test('entry hands every physical crossing to one shared mine walk', () => {
        expect(desertCampRoutePhase('enter', 'shantayNorth')).toBe('prepareAndCrossShantay');
        expect(desertCampRoutePhase('enter', 'desert')).toBe('enterCamp');
        expect(desertCampRoutePhase('enter', 'campSurface')).toBe('enterMine');
        expect(desertCampRoutePhase('enter', 'mineEntrance')).toBe('enterMine');
        expect(desertCampRoutePhase('enter', 'mineLower')).toBe('enterMine');
        expect(desertCampRoutePhase('enter', 'mineDeep')).toBe('done');
    });

    test('surface destination stops at the camp and walks out of a leftover underground tile', () => {
        expect(desertCampRoutePhase('enter', 'shantayNorth', 'campSurface')).toBe('prepareAndCrossShantay');
        expect(desertCampRoutePhase('enter', 'desert', 'campSurface')).toBe('enterCamp');
        expect(desertCampRoutePhase('enter', 'campSurface', 'campSurface')).toBe('done');
        expect(desertCampRoutePhase('enter', 'mineDeep', 'campSurface')).toBe('exitMine');
        expect(desertCampRoutePhase('exit', 'campSurface', 'campSurface')).toBe('exitCamp');
        expect(isDesertCampLocation('Desert Mining Camp')).toBe(true);
        expect(isDesertCampLocation('Desert Mining Camp Surface')).toBe(true);
        expect(desertCampDestinationFor('Desert Mining Camp Surface')).toBe('campSurface');
        expect(desertCampDestinationFor('Desert Mining Camp')).toBe('mineDeep');
    });

    test('exit hands every underground crossing to one shared surface walk', () => {
        expect(desertCampRoutePhase('exit', 'mineDeep')).toBe('exitMine');
        expect(desertCampRoutePhase('exit', 'mineLower')).toBe('exitMine');
        expect(desertCampRoutePhase('exit', 'mineEntrance')).toBe('exitMine');
        expect(desertCampRoutePhase('exit', 'campSurface')).toBe('exitCamp');
        expect(desertCampRoutePhase('exit', 'desert')).toBe('crossShantayNorth');
        expect(desertCampRoutePhase('exit', 'shantayNorth')).toBe('done');
    });

    test('unsupported starts remain explicit failures', () => {
        expect(desertCampRoutePhase('enter', 'unsupported')).toBe('unsupported');
        expect(desertCampRoutePhase('exit', 'unsupported')).toBe('unsupported');
    });
});

describe('Desert Mining Camp supply plan', () => {
    test('withdraws banked keys, slave gear and pass exactly once', () => {
        const plan = planDesertCampSupplies(
            supply({
                equipment: Object.fromEntries(DESERT_CAMP_ITEMS.desert.map(name => [name, 1])),
                bank: { ...fullGear, [DESERT_CAMP_ITEMS.pass]: 30 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            buyPass: false,
            recoverMetalKey: false,
            recoverWroughtKey: false
        });
        expect(plan.withdraw).toEqual([...DESERT_CAMP_ITEMS.slave.map(name => ({ name, qty: 1 })), { name: DESERT_CAMP_ITEMS.metalKey, qty: 1 }, { name: DESERT_CAMP_ITEMS.wroughtKey, qty: 1 }, { name: DESERT_CAMP_ITEMS.pass, qty: 1 }]);
    });

    test('missing camp keys are recoverable and reserve the three desk-award slots', () => {
        const bank = Object.fromEntries([...DESERT_CAMP_ITEMS.desert, ...DESERT_CAMP_ITEMS.slave].map(name => [name, 1]));
        const plan = planDesertCampSupplies(
            supply({
                bank: { ...bank, [DESERT_CAMP_ITEMS.pass]: 1 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverMetalKey: true,
            recoverWroughtKey: true,
            requiredSlots: 7
        });
        expect(plan.missing).toEqual([]);
    });

    test('a missing Wrought key reserves Cell plus Wrought without inventing a fallback', () => {
        const plan = planDesertCampSupplies(
            supply({
                equipment: fullGear,
                inventory: { [DESERT_CAMP_ITEMS.metalKey]: 1 },
                bank: { [DESERT_CAMP_ITEMS.pass]: 1 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverMetalKey: false,
            recoverWroughtKey: false
        });

        const withoutWrought = planDesertCampSupplies(
            supply({
                equipment: Object.fromEntries([...DESERT_CAMP_ITEMS.desert, ...DESERT_CAMP_ITEMS.slave].map(name => [name, 1])),
                inventory: { [DESERT_CAMP_ITEMS.metalKey]: 1 },
                bank: { [DESERT_CAMP_ITEMS.pass]: 1 }
            })
        );
        expect(withoutWrought).toMatchObject({
            ok: true,
            recoverMetalKey: false,
            recoverWroughtKey: true,
            requiredSlots: 3
        });
    });

    test('uses exactly five coins only when no pass is carried or banked', () => {
        const plan = planDesertCampSupplies(
            supply({
                inventory: { [DESERT_CAMP_ITEMS.coins]: 2 },
                equipment: fullGear,
                bank: { [DESERT_CAMP_ITEMS.coins]: 3 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            buyPass: true,
            coinTarget: 5,
            withdraw: [{ name: DESERT_CAMP_ITEMS.coins, qty: 3 }]
        });
    });

    test('does not provision desert clothes when the slave disguise is available', () => {
        const bankGear = Object.fromEntries([DESERT_CAMP_ITEMS.metalKey, DESERT_CAMP_ITEMS.wroughtKey, ...DESERT_CAMP_ITEMS.slave].map(name => [name, 1]));
        const plan = planDesertCampSupplies(
            supply({
                bank: { ...bankGear, [DESERT_CAMP_ITEMS.coins]: 112 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverSlaveOutfit: false,
            buyOutfit: [],
            buyPass: true,
            coinTarget: 5
        });
        expect(plan.withdraw).toContainEqual({ name: DESERT_CAMP_ITEMS.coins, qty: 5 });
    });

    test('provisions one desert outfit to replace a completely lost slave disguise', () => {
        const plan = planDesertCampSupplies(
            supply({
                bank: { [DESERT_CAMP_ITEMS.coins]: 219 }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverSlaveOutfit: true,
            coinTarget: 112,
            requiredSlots: 8
        });
        expect(plan.buyOutfit).toEqual([...DESERT_CAMP_ITEMS.desert]);
        expect(plan.missing).toEqual([]);
        expect(plan.missing).not.toContain(DESERT_CAMP_ITEMS.metalKey);
        expect(plan.missing).not.toContain(DESERT_CAMP_ITEMS.wroughtKey);
    });

    test('uses an existing desert outfit to recover partial slave gear', () => {
        const plan = planDesertCampSupplies(
            supply({
                inventory: {
                    [DESERT_CAMP_ITEMS.slave[0]]: 1,
                    ...Object.fromEntries(DESERT_CAMP_ITEMS.desert.map(name => [name, 1]))
                },
                bank: {
                    ...Object.fromEntries(DESERT_CAMP_ITEMS.desert.map(name => [name, 1])),
                    [DESERT_CAMP_ITEMS.metalKey]: 1,
                    [DESERT_CAMP_ITEMS.wroughtKey]: 1,
                    [DESERT_CAMP_ITEMS.pass]: 1
                }
            })
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverSlaveOutfit: true,
            buyOutfit: [],
            requiredSlots: 3
        });
        expect(plan.withdraw).toEqual([{ name: DESERT_CAMP_ITEMS.metalKey, qty: 1 }, { name: DESERT_CAMP_ITEMS.wroughtKey, qty: 1 }, { name: DESERT_CAMP_ITEMS.pass, qty: 1 }]);
    });

    test('rejects a loadout that cannot fit recovery and route supplies', () => {
        const plan = planDesertCampSupplies(
            supply({
                bank: {
                    ...Object.fromEntries([...DESERT_CAMP_ITEMS.desert, ...DESERT_CAMP_ITEMS.slave].map(name => [name, 1])),
                    [DESERT_CAMP_ITEMS.pass]: 1
                },
                freeSlots: 2
            })
        );
        expect(plan.ok).toBe(false);
        expect(plan.requiredSlots).toBe(7);
        expect(plan.missing).toContain('5 free inventory slot(s)');
    });

    test('banks desert clothes but keeps the slave disguise between trips', () => {
        expect(DESERT_CAMP_KEEP_NAMES).toEqual(expect.arrayContaining([...DESERT_CAMP_ITEMS.slave]));
        for (const name of DESERT_CAMP_ITEMS.desert) {
            expect(DESERT_CAMP_KEEP_NAMES).not.toContain(name);
        }
    });

    test('surface trips keep desert clothes and Metal key, not slave gear or Wrought', () => {
        const keep = desertCampKeepNames('campSurface');
        expect(keep).toEqual(expect.arrayContaining([DESERT_CAMP_ITEMS.metalKey, ...DESERT_CAMP_ITEMS.desert]));
        expect(keep).not.toContain(DESERT_CAMP_ITEMS.wroughtKey);
        for (const name of DESERT_CAMP_ITEMS.slave) {
            expect(keep).not.toContain(name);
        }
    });

    test('surface supply plan withdraws desert clothes and Metal key without slave gear', () => {
        const plan = planDesertCampSupplies(
            supply({
                bank: {
                    ...Object.fromEntries(DESERT_CAMP_ITEMS.desert.map(name => [name, 1])),
                    [DESERT_CAMP_ITEMS.metalKey]: 1,
                    [DESERT_CAMP_ITEMS.pass]: 1,
                    [DESERT_CAMP_ITEMS.wroughtKey]: 1,
                    ...Object.fromEntries(DESERT_CAMP_ITEMS.slave.map(name => [name, 1]))
                }
            }),
            'campSurface'
        );
        expect(plan).toMatchObject({
            ok: true,
            recoverSlaveOutfit: false,
            recoverWroughtKey: false,
            recoverMetalKey: false,
            buyPass: false
        });
        expect(plan.withdraw).toEqual([
            ...DESERT_CAMP_ITEMS.desert.map(name => ({ name, qty: 1 })),
            { name: DESERT_CAMP_ITEMS.metalKey, qty: 1 },
            { name: DESERT_CAMP_ITEMS.pass, qty: 1 }
        ]);
    });

    test('keeps a worn pickaxe equipped without reserving a pack slot', () => {
        const base = {
            inventory: { [DESERT_CAMP_ITEMS.pass]: 1 },
            equipment: fullGear,
            bank: {},
            freeSlots: 1
        };
        expect(planDesertCampSupplies(supply(base))).toMatchObject({ ok: true, requiredSlots: 0 });
        expect(
            planDesertCampSupplies(
                supply({
                    ...base,
                    equipment: { ...fullGear, 'Rune pickaxe': 1 }
                })
            )
        ).toMatchObject({ ok: true, requiredSlots: 0 });
    });
});
