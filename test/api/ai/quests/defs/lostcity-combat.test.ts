import { expect, test } from 'bun:test';
import { highestLostCityStrike, defeatTreeSpirit } from '#/bot/api/ai/quests/defs/lostcityCombat.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs, Npc } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const stocked = () => 1000;

for (const [magic, spell] of [
    [0, null], [1, 'Wind Strike'], [4, 'Wind Strike'], [5, 'Water Strike'],
    [8, 'Water Strike'], [9, 'Earth Strike'], [12, 'Earth Strike'], [13, 'Fire Strike'], [99, 'Fire Strike']
] as const) {
    test(`Magic ${magic} selects ${spell} from stocked Strike runes`, () => {
        expect(highestLostCityStrike(magic, stocked)).toBe(spell);
    });
}

test('falls back through available Strike runes without selecting stronger spell families', () => {
    const runes = new Map([['Mind rune', 10], ['Air rune', 10], ['Fire rune', 3], ['Earth rune', 2], ['Water rune', 1]]);
    const count = (name: string) => runes.get(name) ?? 0;
    for (const [name, element] of [['Fire Strike', 'Fire rune'], ['Earth Strike', 'Earth rune'], ['Water Strike', 'Water rune'], ['Wind Strike', 'Air rune']]) {
        expect(highestLostCityStrike(99, count)).toBe(name);
        runes.set(element!, 0);
    }
    expect(highestLostCityStrike(99, count)).toBeNull();
});

async function fightFixture(options: { runes?: Record<string, number>; winAfter?: number; displaced?: boolean; refuses?: boolean; event?: boolean; credit?: boolean;
    corpse?: boolean; noConsumption?: boolean; eventAfterCast?: boolean; driftAfterCast?: boolean; missingTile?: boolean } = {}) {
    const safe = { x: 2859, z: 9731, level: 0 };
    let here: typeof safe | null = options.missingTile ? null : options.displaced ? { x: 2860, z: 9733, level: 0 } : safe;
    const runes = new Map(Object.entries(options.runes ?? { 'Mind rune': 2, 'Air rune': 3, 'Fire rune': 3 }));
    const cast: string[] = [];
    const walks: typeof safe[] = [];
    const logs: string[] = [];
    let alive = true;
    let retaliate = true;
    let ticks = 0;
    const npc = new Npc({ id: 655, index: 7, name: 'Tree spirit', size: 1, level: 101, distance: 2, anim: -1,
        tile: { x: 2859, z: 9733, level: 0 }, networkTile: { x: 2859, z: 9733, level: 0 },
        faceEntity: 32768, health: 85, totalHealth: 85, inCombat: true, ops: ['Attack'] });
    let melee = 0;
    const restores = [
        stubProps(reader, { serverTile: () => here, selfSlot: () => 0 }),
        stubProps(Game, { tile: () => here, autoRetaliateOn: () => retaliate,
            setAutoRetaliate: on => { retaliate = on; return true; },
            castOnNpc: async spell => {
                expect(here).toEqual(safe);
                expect(retaliate).toBe(false);
                cast.push(spell);
                if (options.refuses) return false;
                if (options.noConsumption) return true;
                runes.set('Mind rune', (runes.get('Mind rune') ?? 0) - 1);
                runes.set('Air rune', (runes.get('Air rune') ?? 0) - (spell === 'Fire Strike' ? 2 : 1));
                if (spell === 'Fire Strike') runes.set('Fire rune', (runes.get('Fire rune') ?? 0) - 3);
                if (cast.length >= (options.winAfter ?? 2)) { alive = false; npc.snap.health = 0; }
                return true;
            } }),
        stubProps(Npc.prototype, { interact: () => { melee++; return true; } }),
        stubProps(Npcs, { all: () => alive || options.corpse ? [npc] : [] }),
        stubProps(Inventory, { count: name => runes.get(name as string) ?? 0 }),
        stubProps(Skills, { effective: () => 13 }),
        stubProps(Sustain, { run: async () => {} }),
        stubProps(EventSignal, { pending: () => !!options.event || !!options.eventAfterCast && cast.length > 0 }),
        stubProps(Execution, { delayTicks: async () => {
            if (++ticks > 100) throw new Error('fight did not settle');
            if (options.driftAfterCast && cast.length > 0) npc.snap.networkTile!.x = 2860;
        },
        delayUntilTicks: async check => check() }),
        stubProps(Traversal, { walkResilient: async tile => { walks.push(tile); return false; } }),
        stubProps(DirectNavigator, { walk: tile => { walks.push(tile); here = tile; return true; } })
    ];
    try {
        const won = await defeatTreeSpirit(message => logs.push(message), async () => !alive && options.credit !== false);
        return { won, cast, walks, logs, retaliate, melee };
    } finally {
        for (const restore of restores.reverse()) restore();
    }
}

test('casts strongest remaining Strike from cover and confirms quest credit', async () => {
    const result = await fightFixture();
    expect(result.won).toBe(true);
    expect(result.cast).toEqual(['Fire Strike', 'Wind Strike']);
    expect(result.melee).toBe(0);
    expect(result.walks).toEqual([]);
});

test('exhaustion holds cover with retaliation disabled instead of meleeing', async () => {
    const result = await fightFixture({ runes: { 'Mind rune': 1, 'Air rune': 2, 'Fire rune': 3 }, winAfter: 2 });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual(['Fire Strike']);
    expect(result.melee).toBe(0);
    expect(result.walks).toEqual([]);
    expect(result.retaliate).toBe(false);
    expect(result.logs.join(' ')).toContain('no castable Strike');
});

test('a failed lure never casts or falls back to melee', async () => {
    const result = await fightFixture({ displaced: true });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual([]);
    expect(result.melee).toBe(0);
    expect(result.walks.length).toBeGreaterThan(0);
});

test('a rejected cast ends the attempt without attacking', async () => {
    const result = await fightFixture({ refuses: true });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual(['Fire Strike']);
    expect(result.melee).toBe(0);
});

test('a disappearing spirit without quest credit is not a victory', async () => {
    const result = await fightFixture({ winAfter: 1, credit: false });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual(['Fire Strike']);
    expect(result.logs.join(' ')).toContain('credit');
});

test('a pending random event yields before movement or casting', async () => {
    const result = await fightFixture({ event: true });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual([]);
    expect(result.walks).toEqual([]);
});

test('waits out a known death animation without casting at the corpse', async () => {
    const result = await fightFixture({ winAfter: 1, corpse: true });
    expect(result.won).toBe(true);
    expect(result.cast).toEqual(['Fire Strike']);
    expect(result.melee).toBe(0);
});

for (const option of ['eventAfterCast', 'driftAfterCast', 'noConsumption'] as const) {
    test(`cancels the queued cast when ${option} interrupts its acknowledgement`, async () => {
        const result = await fightFixture({ [option]: true, noConsumption: true });
        expect(result.won).toBe(false);
        expect(result.cast).toEqual(['Fire Strike']);
        expect(result.walks).toContainEqual({ x: 2859, z: 9731, level: 0 });
        expect(result.melee).toBe(0);
        expect(result.retaliate).toBe(false);
    });
}

test('missing player tiles stop the attempt without throwing or casting', async () => {
    const result = await fightFixture({ missingTile: true });
    expect(result.won).toBe(false);
    expect(result.cast).toEqual([]);
});

test('requires the full rune cost and a mind rune for each cast', () => {
    const runes = new Map([['Mind rune', 1], ['Air rune', 1], ['Fire rune', 3]]);
    const count = (name: string) => runes.get(name) ?? 0;
    expect(highestLostCityStrike(13, count)).toBe('Wind Strike');
    runes.set('Air rune', 2);
    expect(highestLostCityStrike(13, count)).toBe('Fire Strike');
    runes.set('Fire rune', 2);
    expect(highestLostCityStrike(13, count)).toBe('Wind Strike');
    runes.set('Mind rune', 0);
    expect(highestLostCityStrike(99, count)).toBeNull();
});
