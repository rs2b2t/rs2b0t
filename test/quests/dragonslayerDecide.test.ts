import { describe, expect, test } from 'bun:test';

import { DS_ID, DS_ITEM } from '#/bot/quests/defs/dragonslayer/areas.js';
import { decide } from '#/bot/quests/defs/dragonslayer/index.js';
import { DRAGON_STAGE } from '#/bot/quests/defs/dragonslayer/journal.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

/**
 * `decide()` reads a snapshot and nothing else, so the whole routing table is
 * testable without a client. These cases are the ones that have actually gone
 * wrong in live runs — each names the symptom it prevents.
 */
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

function snapshot(over: Partial<QuestSnapshot> & { flags?: string[]; carried?: Stack[]; banked?: Stack[] } = {}): QuestSnapshot {
    const { flags = [], carried = [], banked = [], ...rest } = over;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        bankIds: counts(banked),
        bankKnown: true,
        progress: { stage: DRAGON_STAGE.SPOKEN_OZIACH, flags: new Set(flags) },
        tile: { x: 3013, z: 3355, level: 0 },
        ...rest
    } as QuestSnapshot;
}

/** Enough nails that the boat's smithing leg is satisfied. */
const NAILS: Stack = [DS_ID.NAILS, 12];

describe('Dragon Slayer decide()', () => {
    test('a banked maze key is not a missing one', () => {
        // The nails leg banks the pack to make room for ore. Reading a banked key
        // as absent sent the bot back to Oziach mid-way through smithing.
        const step = decide(snapshot({
            banked: [DS_ID.MAZE_KEY, DS_ID.SHIELD, NAILS],
            flags: ['has-shield']
        }));
        expect((step as { name?: string }).name ?? '').not.toContain('Oziach');
    });

    test('#379 banked maze key withdraws instead of Oziach', () => {
        const step = decide(snapshot({
            banked: [DS_ID.MAZE_KEY],
            flags: []
        }));
        expect(step).toMatchObject({
            kind: 'withdraw',
            items: [{ id: DS_ID.MAZE_KEY, qty: 1, name: DS_ITEM.MAZE_KEY }]
        });
    });

    test('#379 unseen bank scans before Oziach when key is nowhere', () => {
        const step = decide(snapshot({
            bankKnown: false,
            banked: [],
            carried: [],
            flags: []
        }));
        expect(step).toMatchObject({ kind: 'scanBank' });
    });

    test('an unfinished briefing outranks everything else', () => {
        const step = decide(snapshot({ flags: ['needs-briefing'], carried: [DS_ID.MAZE_KEY] }));
        expect(step).toMatchObject({ kind: 'custom' });
        expect((step as { name: string }).name).toContain('Oziach');
    });

    test('no maze key anywhere sends the bot back to Oziach', () => {
        const step = decide(snapshot({ flags: ['has-shield'] }));
        expect((step as { name: string }).name).toContain('Oziach');
    });

    test('the step name says why it was chosen', () => {
        // These names are the only record of the decision in a live log.
        const step = decide(snapshot({ flags: ['needs-briefing'] }));
        const name = (step as { name: string }).name;
        expect(name).toContain('mazekey=nowhere');
        expect(name).toContain('stage=');
    });

    test('the map is finished before anything else is fetched', () => {
        // The errands between the pieces are what stranded the maze: the Duke is
        // a floor up in Lumbridge and the anvil is at the bottom of the Dwarven
        // Mine, and a run resumed from either read the route from the wrong
        // dungeon. Nothing outranks the map but the briefing.
        const cases = [
            { carried: [DS_ID.MAZE_KEY] },
            { carried: [DS_ID.MAZE_KEY], flags: ['has-shield'] },
            { carried: [DS_ID.MAZE_KEY, DS_ID.SHIELD] }
        ];
        for (const held of cases) {
            const step = decide(snapshot(held));
            expect((step as { name: string }).name).toContain("Melzar's Maze");
        }
    });

    test('the shield is asked of the Duke once the map is whole', () => {
        const missing = decide(snapshot({ carried: [DS_ID.MAZE_KEY, DS_ID.MAP] }));
        expect(missing).toMatchObject({ kind: 'talk', stop: { npc: 'Duke Horacio' } });

        for (const held of [{ carried: [DS_ID.MAZE_KEY, DS_ID.MAP, DS_ID.SHIELD] }, { carried: [DS_ID.MAZE_KEY, DS_ID.MAP], banked: [DS_ID.SHIELD] }]) {
            const step = decide(snapshot(held));
            expect((step as { stop?: { npc: string } }).stop?.npc ?? '').not.toBe('Duke Horacio');
        }
    });

    test('nails are smithed for the boat, not before the map', () => {
        const shopping = decide(snapshot({ carried: [DS_ID.MAZE_KEY, DS_ID.MAP, DS_ID.SHIELD] }));
        expect((shopping as { name?: string }).name ?? '').not.toContain('nails');

        const boat = decide(snapshot({
            carried: [DS_ID.MAP, DS_ID.HAMMER, [DS_ID.PLANK, 3]],
            progress: { stage: DRAGON_STAGE.BOUGHT_SHIP, flags: new Set<string>() }
        }));
        expect((boat as { name: string }).name).toContain('nails');
    });

    test('a patched hole is not a nail shortage', () => {
        // One plank and four nails go into every hole together (lady_lumbridge.rs2
        // inv_dels both). Read against the twelve the whole hull takes, the first
        // patched hole looks like eight missing nails, and the bot walks back to
        // the Dwarven Mine with the hull still open.
        const patching = [
            { carried: [DS_ID.MAP, DS_ID.HAMMER, [DS_ID.PLANK, 2], [DS_ID.NAILS, 8]] as Stack[] },
            { carried: [DS_ID.MAP, DS_ID.HAMMER, [DS_ID.PLANK, 1], [DS_ID.NAILS, 4]] as Stack[] }
        ];
        for (const held of patching) {
            const step = decide(snapshot({
                ...held,
                progress: { stage: DRAGON_STAGE.BOUGHT_SHIP, flags: new Set<string>() }
            }));
            expect((step as { name: string }).name).toContain('patch');
        }
    });

    test('a real shortage still sends the bot to the anvil', () => {
        const step = decide(snapshot({
            carried: [DS_ID.MAP, DS_ID.HAMMER, [DS_ID.PLANK, 2], [DS_ID.NAILS, 4]],
            progress: { stage: DRAGON_STAGE.BOUGHT_SHIP, flags: new Set<string>() }
        }));
        expect((step as { name: string }).name).toContain('smith 4 nails');
    });

    test('nails already banked are not smithed again', () => {
        const step = decide(snapshot({
            carried: [DS_ID.MAP, DS_ID.HAMMER, [DS_ID.PLANK, 3]],
            banked: [NAILS],
            progress: { stage: DRAGON_STAGE.BOUGHT_SHIP, flags: new Set<string>() }
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('map pieces left in the bank are withdrawn, not re-earned', () => {
        const step = decide(snapshot({
            carried: [DS_ID.MAZE_KEY, DS_ID.SHIELD],
            banked: [DS_ID.MAP_MELZAR],
            flags: ['has-shield']
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('the shield is aboard before the ship sails', () => {
        // Crandor is one-way. A shield left in Falador is a dead run: killElvarg
        // can only report it missing, on an island with no way back.
        const sailing = { progress: { stage: DRAGON_STAGE.NED_GIVEN_MAP, flags: new Set<string>() } };

        expect(decide(snapshot({ banked: [DS_ID.SHIELD], ...sailing })).kind).toBe('withdraw');
        expect(decide(snapshot({ carried: [DS_ID.SHIELD], ...sailing }))).toMatchObject({ kind: 'equip' });
        expect(decide(snapshot({ ...sailing, wornIds: new Set([DS_ID.SHIELD]) }))).toMatchObject({ kind: 'custom' });
        // Nowhere at all: back to the Duke rather than sailing without it.
        expect(decide(snapshot(sailing))).toMatchObject({ kind: 'talk', stop: { npc: 'Duke Horacio' } });
    });

    test('boarding is not re-gated once the bot is already aboard', () => {
        const step = decide(snapshot({
            progress: { stage: DRAGON_STAGE.NED_GIVEN_MAP, flags: new Set<string>() },
            tile: { x: 3047, z: 3208, level: 1 }
        }));
        expect(step).toMatchObject({ kind: 'custom' });
    });

    test('a full larder is drawn before the ship sails', () => {
        // The float that carries the shopping is three fish. Elvarg is not a
        // three-fish fight, and the bank is an ocean away once Ned casts off.
        const step = decide(snapshot({
            progress: { stage: DRAGON_STAGE.NED_GIVEN_MAP, flags: new Set<string>() },
            wornIds: new Set([DS_ID.SHIELD]),
            inv: new Map([['trout', 2]]),
            bank: new Map([['trout', 100]])
        }));
        expect(step).toMatchObject({ kind: 'withdraw' });
        const items = (step as { items: { name: string; qty: number }[] }).items;
        expect(items[0].qty).toBeGreaterThan(10);
    });

    test('the shield is fetched before the larder', () => {
        const step = decide(snapshot({
            progress: { stage: DRAGON_STAGE.NED_GIVEN_MAP, flags: new Set<string>() },
            banked: [DS_ID.SHIELD],
            bank: new Map([['trout', 100]])
        }));
        const items = (step as { items: { name: string }[] }).items;
        expect(items.map(i => i.name)).toEqual([DS_ITEM.SHIELD]);
    });

    test('the secret passage is opened before Elvarg is fought', () => {
        // Ned's ship crash-lands on Crandor. With the wall still shut, dying to
        // her ends the quest where it stands — there is no second crossing.
        const landed = { x: 2851, z: 3235, level: 0 };
        const shut = decide(snapshot({
            progress: { stage: DRAGON_STAGE.SAILED_TO_CRANDOR, flags: new Set<string>() },
            wornIds: new Set([DS_ID.SHIELD]),
            tile: landed
        }));
        expect((shut as { name: string }).name).toContain('secret passage');

        const open = decide(snapshot({
            progress: { stage: DRAGON_STAGE.SAILED_TO_CRANDOR, flags: new Set(['secret-passage']) },
            wornIds: new Set([DS_ID.SHIELD]),
            tile: landed
        }));
        expect((open as { name: string }).name).toContain('Elvarg');
    });

    test('a death on Crandor re-kits at the bank before walking back', () => {
        // Off the island at this stage means she killed us and the kit is on her
        // floor. The fare matters as much as the shield: the navigator prunes
        // Pay-fare crossings it cannot afford and then calls Karamja unreachable.
        const dead = {
            progress: { stage: DRAGON_STAGE.SAILED_TO_CRANDOR, flags: new Set(['secret-passage']) },
            tile: { x: 3222, z: 3218, level: 0 }
        };
        expect(decide(snapshot(dead))).toMatchObject({ kind: 'talk', stop: { npc: 'Duke Horacio' } });

        const shielded = decide(snapshot({ ...dead, wornIds: new Set([DS_ID.SHIELD]) }));
        expect(shielded).toMatchObject({ kind: 'withdraw' });
        expect((shielded as { items: { name: string }[] }).items[0].name).toBe('Coins');

        // Kitted and funded, it walks back in rather than shopping again.
        const ready = decide(snapshot({
            ...dead,
            wornIds: new Set([DS_ID.SHIELD]),
            inv: new Map([['coins', 5000], ['trout', 18]])
        }));
        expect((ready as { name: string }).name).toContain('Elvarg');
    });

    test('a complete journal ends the quest whatever the snapshot says', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unreadable journal waits rather than guessing', () => {
        expect(decide(snapshot({ progress: undefined }))).toMatchObject({ kind: 'wait' });
    });
});
