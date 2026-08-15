import { beforeEach, describe, expect, test } from 'bun:test';
import { decide, lostCityArea, LOST_CITY_FOOD_TARGET, LOST_CITY_STAGE, LOST_CITY_STAFF_TARGET, lostcity, parseLostCityJournal } from '#/bot/api/ai/quests/defs/lostcity.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const MAINLAND: WorldTile = { x: 3200, z: 3200, level: 0 };
const ENTRANA_SHIP: WorldTile = { x: 2834, z: 3334, level: 1 };
const ENTRANA: WorldTile = { x: 2820, z: 3374, level: 0 };
const DUNGEON: WorldTile = { x: 2822, z: 9774, level: 0 };
const ZANARIS: WorldTile = { x: 3220, z: 9592, level: 0 };
const COMBAT_FOOD = Array(LOST_CITY_FOOD_TARGET).fill('Lobster') as string[];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

function counts(names: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: 0,
        stage: options.stage ?? LOST_CITY_STAGE.NOT_STARTED,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? MAINLAND : options.tile,
        freeSlots: options.freeSlots
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

beforeEach(() => {
    QuestFood.name = 'Lobster';
});

describe('Lost City journal stage parsing', () => {
    test.each([
        ['@dbl@I can start this quest by speaking to the Adventurers', 0],
        ['@dbl@Apparently there is a @dre@leprechaun@dbl@ hiding in a @dre@tree', 1],
        ['I found a Leprechaun.|@dbl@I can find a @dre@Dramen Tree@dbl@ in a cave', 2],
        ['@dbl@With the @dre@Spirit@dbl@ defeated I can cut a @dre@branch@dbl@ from the tree', 3],
        ['I cut a branch from the tree.|@dbl@I should @dre@craft@dbl@ the @dre@branch@dbl@ from the tree into a @dre@staff', 4],
        ['I cut a branch from the tree and crafted a Dramen Staff.', 5],
        ['@red@QUEST COMPLETE!', 6]
    ])('maps rendered journal text to exact stage %i', (text, stage) => {
        expect(parseLostCityJournal(text as string)).toBe(stage);
    });

    test('does not infer a stage from unrecognized text', () => {
        expect(parseLostCityJournal(['Lost City', 'Loading…'])).toBeUndefined();
    });
});

describe('Lost City area classification', () => {
    test('recognizes each quest region and a missing player tile', () => {
        expect(lostCityArea(MAINLAND)).toBe('mainland');
        expect(lostCityArea(ENTRANA_SHIP)).toBe('entranaShip');
        expect(lostCityArea(ENTRANA)).toBe('entrana');
        expect(lostCityArea(DUNGEON)).toBe('dungeon');
        expect(lostCityArea(ZANARIS)).toBe('zanaris');
        expect(lostCityArea(null)).toBe('unknown');
    });
});

describe('Lost City stages 0-3', () => {
    test('stage 0 checks an unknown bank before sourcing tools', () => {
        expect(decide(snap({ stage: 0, bankKnown: false })).kind).toBe('scanBank');
    });

    test('stage 0 sources a missing Knife once the bank is known empty', () => {
        const step = decide(snap({ stage: 0 }));
        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Knife');
        expect(step.kind === 'grabGround' && step.waitIfMissing).toBe(true);
    });

    test('a full mainland pack is cleaned before acquiring another quest item', () => {
        const step = decide(snap({ stage: 0, inv: ['Coins', 'Bones'], freeSlots: 0 }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('knife');
        expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
    });

    test('stage 0 withdraws known bank tools and then starts with the Warrior', () => {
        const knife = decide(snap({ stage: 0, bank: ['Knife'] }));
        expect(knife.kind === 'withdraw' && knife.items).toEqual([{ name: 'Knife', qty: 1 }]);

        const axe = decide(snap({ stage: 0, inv: ['Knife'], bank: ['Rune axe'] }));
        expect(axe.kind === 'withdraw' && axe.items).toEqual([{ name: 'Rune axe', qty: 1 }]);

        const start = decide(snap({ stage: 0, inv: ['Knife', 'Bronze axe'] }));
        expect(start.kind === 'talk' && start.stop.npc).toBe('Warrior');
    });

    test('stage 1 reveals Shamus after ensuring the same mainland tools', () => {
        const step = decide(snap({ stage: 1, inv: ['Knife'], worn: ['Bronze axe'] }));
        expect(customName(step)).toBe('reveal Shamus and learn about the staff');
    });

    test('stage 2 strips Entrana-forbidden inventory and equipment before sailing', () => {
        const spillover = decide(snap({ stage: 2, inv: ['Knife', 'Bronze axe'] }));
        expect(spillover.kind).toBe('deposit');
        expect(spillover.kind === 'deposit' && spillover.keep).toContain('knife');
        expect(spillover.kind === 'deposit' && spillover.exactKeep).toBe(true);

        const lookalike = decide(snap({ stage: 2, inv: ['Knife', 'Bronze knife'] }));
        expect(lookalike.kind).toBe('deposit');

        const equipment = decide(snap({ stage: 2, inv: ['Knife'], worn: ['Leather body'] }));
        expect(customName(equipment)).toBe('remove Entrana-restricted equipment');

        const food = decide(snap({ stage: 2, inv: ['Knife'], bank: COMBAT_FOOD }));
        expect(food.kind === 'withdraw' && food.items).toEqual([{ name: 'Lobster', qty: LOST_CITY_FOOD_TARGET }]);

        const ready = decide(snap({ stage: 2, inv: ['Knife', ...COMBAT_FOOD] }));
        expect(customName(ready)).toBe('sail from Port Sarim to Entrana');
    });

    test('requires the configured food without falling back to Kebabs', () => {
        QuestFood.name = null;
        const blank = decide(snap({ stage: 2, inv: ['Knife'] }));
        expect(blank.kind === 'wait' && blank.reason).toContain('select a food item');

        QuestFood.name = 'Lobster';
        const short = decide(snap({ stage: 2, inv: ['Knife'], bank: Array(10).fill('Lobster') }));
        expect(short.kind === 'wait' && short.reason).toContain('20 combat food total');
        expect(JSON.stringify(short)).not.toContain('Kebab');
    });

    test('reserves enough inventory space for all configured combat food', () => {
        const step = decide(
            snap({
                stage: 2,
                inv: ['Knife'],
                bank: COMBAT_FOOD,
                freeSlots: LOST_CITY_FOOD_TARGET - 1
            })
        );
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain(`${LOST_CITY_FOOD_TARGET} free inventory slots`);
    });

    test('stage 2 resumes aboard the ship and on Entrana', () => {
        expect(customName(decide(snap({ stage: 2, tile: ENTRANA_SHIP })))).toBe('disembark on Entrana');
        expect(customName(decide(snap({ stage: 2, tile: ENTRANA })))).toBe('descend the one-way Entrana ladder');
    });

    test('stage 2 dungeon restart obtains, equips, then uses a dropped axe', () => {
        const missing = decide(snap({ stage: 2, tile: DUNGEON }));
        expect(customName(missing)).toBe('get an axe from Entrana Zombies');

        const held = decide(snap({ stage: 2, tile: DUNGEON, inv: ['Bronze axe'] }));
        expect(held.kind === 'equip' && held.item).toBe('Bronze axe');

        const equipped = decide(snap({ stage: 2, tile: DUNGEON, worn: ['Bronze axe'] }));
        expect(customName(equipped)).toBe('defeat the Tree Spirit');
    });

    test('stage 3 cuts a branch in the dungeon and can recover an axe after restart', () => {
        const ready = decide(snap({ stage: 3, tile: DUNGEON, worn: ['Iron axe'] }));
        expect(customName(ready)).toBe('cut a Dramen branch');

        const restarted = decide(snap({ stage: 3, tile: DUNGEON }));
        expect(customName(restarted)).toBe('get an axe from Entrana Zombies');
    });
});

describe('Lost City stage 4 branch recovery', () => {
    test('collects five branches before crafting all five staves', () => {
        const collect = decide(
            snap({
                stage: 4,
                inv: ['Knife', 'Dramen branch'],
                worn: ['Iron axe'],
                tile: DUNGEON
            })
        );
        expect(customName(collect)).toBe('cut a Dramen branch');

        let inventory = ['Knife', ...Array(LOST_CITY_STAFF_TARGET).fill('Dramen branch')] as string[];
        let stage: number = LOST_CITY_STAGE.BRANCH_CUT;
        for (let made = 0; made < LOST_CITY_STAFF_TARGET; made++) {
            const step = decide(snap({ stage, inv: inventory, worn: ['Iron axe'], tile: DUNGEON }));
            expect(step.kind).toBe('useOn');
            if (step.kind === 'useOn') {
                expect(step.item).toBe('Knife');
                expect(step.target).toBe('Dramen branch');
                expect(step.product).toBe('Dramen staff');
            }
            inventory = inventory.filter((name, index) => name !== 'Dramen branch' || index !== inventory.indexOf('Dramen branch'));
            inventory.push('Dramen staff');
            stage = LOST_CITY_STAGE.STAFF_MADE;
        }
        expect(customName(decide(snap({ stage, inv: inventory, worn: ['Iron axe'], tile: DUNGEON })))).toBe('exit through the Wilderness portal');
    });

    test('leaves the dungeon if five held branches have outlived the Knife', () => {
        const step = decide(
            snap({
                stage: 4,
                inv: Array(LOST_CITY_STAFF_TARGET).fill('Dramen branch'),
                tile: DUNGEON
            })
        );
        expect(customName(step)).toBe('leave the dungeon to replace the Knife');
    });

    test('scans an unknown bank, then restores a mixed five-staff batch', () => {
        expect(decide(snap({ stage: 4, bankKnown: false })).kind).toBe('scanBank');

        const bank = ['Knife', ...Array(2).fill('Dramen staff'), ...Array(3).fill('Dramen branch')] as string[];
        const knife = decide(snap({ stage: 4, bank }));
        expect(knife.kind === 'withdraw' && knife.items).toEqual([{ name: 'Knife', qty: 1 }]);

        const materials = decide(snap({ stage: 4, inv: ['Knife'], bank }));
        expect(materials.kind === 'withdraw' && materials.items).toEqual([
            { name: 'Dramen staff', qty: 2 },
            { name: 'Dramen branch', qty: 3 }
        ]);
    });

    test('recovers a lost branch by returning to Entrana and cutting another', () => {
        const mainland = decide(snap({ stage: 4, inv: ['Knife', ...COMBAT_FOOD] }));
        expect(customName(mainland)).toBe('sail from Port Sarim to Entrana');

        const dungeon = decide(snap({ stage: 4, tile: DUNGEON, worn: ['Bronze axe'] }));
        expect(customName(dungeon)).toBe('cut a Dramen branch');
    });
});

describe('Lost City stages 5-6', () => {
    test('stage 5 scans first, then restores five banked staves', () => {
        expect(decide(snap({ stage: 5, bankKnown: false })).kind).toBe('scanBank');

        const step = decide(snap({ stage: 5, bank: Array(LOST_CITY_STAFF_TARGET).fill('Dramen staff') }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Dramen staff', qty: LOST_CITY_STAFF_TARGET }]);
    });

    test('stage 5 does not equip or finish with only one staff', () => {
        const step = decide(snap({ stage: 5, inv: ['Knife', 'Dramen staff', ...COMBAT_FOOD] }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).not.toContain('dramen staff');
    });

    test('stage 5 equips only after holding five staves and then enters Zanaris', () => {
        const equip = decide(
            snap({
                stage: 5,
                inv: Array(LOST_CITY_STAFF_TARGET).fill('Dramen staff'),
                bankKnown: false
            })
        );
        expect(equip.kind === 'equip' && equip.item).toBe('Dramen staff');

        const enter = decide(
            snap({
                stage: 5,
                inv: Array(LOST_CITY_STAFF_TARGET - 1).fill('Dramen staff'),
                worn: ['Dramen staff']
            })
        );
        expect(customName(enter)).toBe('enter Zanaris through the swamp shed');
    });

    test('stage 5 exits the dungeon after all five staves are made', () => {
        const step = decide(
            snap({
                stage: 5,
                inv: Array(LOST_CITY_STAFF_TARGET).fill('Dramen staff'),
                worn: ['Iron axe'],
                tile: DUNGEON
            })
        );
        expect(customName(step)).toBe('exit through the Wilderness portal');
    });

    test('stage 5 recovers a completely lost staff, including an axe-less dungeon restart', () => {
        const mainland = decide(snap({ stage: 5, inv: ['Knife', ...COMBAT_FOOD] }));
        expect(customName(mainland)).toBe('sail from Port Sarim to Entrana');

        const dungeon = decide(snap({ stage: 5, tile: DUNGEON }));
        expect(customName(dungeon)).toBe('get an axe from Entrana Zombies');
    });

    test('stage 6 is done even before the journal cache updates', () => {
        expect(decide(snap({ stage: 6 })).kind).toBe('done');
        expect(decide(snap({ stage: 0, journal: 'complete' })).kind).toBe('done');
    });

    test('unknown journal remains safely idle', () => {
        expect(decide(snap({ stage: 2, journal: 'unknown' })).kind).toBe('wait');
    });

    test('uses the AIO-selected food at the quest-safe combat threshold', () => {
        // 0.5 — not 0.9; the tree spirit fight was burning food every tick (#393).
        expect(lostcity.sustain).toEqual({ foods: [], eatBelowHp: 0.5 });
    });
});
