import { expect, test, describe } from 'bun:test';
import { decide, piratestreasure } from '#/bot/api/ai/quests/defs/piratestreasure/index.js';
import { PT_ID, PT_STAGE } from '#/bot/api/ai/quests/defs/piratestreasure/areas.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const FUNDED: [number, number][] = [[PT_ID.COINS, 5000]];
const PORT_SARIM = { x: 3014, z: 3204, level: 0 };
const PLANTATION = { x: 2943, z: 3151, level: 0 };

const snap = (
    journal: string,
    stage: number,
    flags: string[] = [],
    ids: [number, number][] = FUNDED,
    over: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(ids.map(([id, n]) => [String(id), n])),
    invIds: new Map(ids),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 100_000,
    stage,
    progress: { stage, flags: new Set(flags) },
    bank: new Map([['coins', 100_000]]),
    bankIds: new Map(),
    bankKnown: true,
    tile: PORT_SARIM as QuestSnapshot['tile'],
    ...over
});

describe('pirate decide — guards', () => {
    test('complete is done and unknown waits', () => {
        expect(decide(snap('complete', PT_STAGE.COMPLETE)).kind).toBe('done');
        expect(decide(snap('unknown', PT_STAGE.NOT_STARTED)).kind).toBe('wait');
    });
    test('an unreadable journal waits rather than restarting the quest', () => {
        const s = snap('inProgress', PT_STAGE.FETCH_RUM);
        s.progress = undefined;
        s.stage = undefined;
        expect(decide(s).kind).toBe('wait');
    });
});

describe('pirate decide — the smuggle ladder', () => {
    test('not started talks to Frank with the treasure line', () => {
        const s = decide(snap('notStarted', PT_STAGE.NOT_STARTED));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Redbeard Frank');
        expect(s.kind === 'talk' && s.stop.prefer[0]).toBe("I'm in search of treasure.");
    });
    test('need-rum with no apron buys the apron first', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['need-rum']));
        expect(s.kind === 'buy' && s.item).toBe('White apron');
    });
    test('need-rum with the apron held buys the rum at Zambo', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['need-rum'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Zambo');
    });
    test('rum held but unemployed talks to Luthas', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-held-unemployed'], [...FUNDED, [PT_ID.WHITE_APRON, 1], [PT_ID.RUM, 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Luthas');
    });
    test('employed with the rum ships the crate', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-held-employed'], [...FUNDED, [PT_ID.WHITE_APRON, 1], [PT_ID.RUM, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
    test('rum in the crate ships it', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-in-crate'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
    test('a full crate ships it', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['crate-full'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
    test('shipped takes the job at Wydin', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-shipped'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Wydin');
    });
    test('store-job equips the apron before the door refuses it', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['store-job'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'equip' && s.item).toBe('White apron');
    });
    test('store-job with the apron worn searches the back room', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['store-job'], FUNDED, { wornIds: new Set([PT_ID.WHITE_APRON]) }));
        expect(s.kind === 'custom' && s.name).toMatch(/back room/i);
    });
    test('store-job on Karamja ships the crate rather than searching an empty back room', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['store-job'], FUNDED, {
            wornIds: new Set([PT_ID.WHITE_APRON]),
            tile: PLANTATION as QuestSnapshot['tile']
        }));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
    test('rum in hand on the mainland goes back to Frank', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-in-hand'], [...FUNDED, [PT_ID.RUM, 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Redbeard Frank');
    });
    test('rum in hand on Karamja ships it rather than carrying it past the customs officer', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-in-hand'], [...FUNDED, [PT_ID.RUM, 1]], {
            tile: PLANTATION as QuestSnapshot['tile']
        }));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
    test('lost rum restarts the smuggle rather than parking', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-lost'], [...FUNDED, [PT_ID.WHITE_APRON, 1]]));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Zambo');
    });
    test('a Tai Bwo Wannai look-alike is not the quest rum', () => {
        const s = decide(snap('inProgress', PT_STAGE.FETCH_RUM, ['rum-held-employed'], [...FUNDED, [PT_ID.WHITE_APRON, 1], [3164, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/ship/i);
    });
});

describe('pirate decide — the treasure', () => {
    test('the key is re-issued by Frank when neither key nor note is held', () => {
        const s = decide(snap('inProgress', PT_STAGE.RECEIVED_KEY));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Redbeard Frank');
    });
    test('the key opens the chest', () => {
        const s = decide(snap('inProgress', PT_STAGE.RECEIVED_KEY, [], [...FUNDED, [PT_ID.CHEST_KEY, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/chest/i);
    });
    test('the note is read', () => {
        const s = decide(snap('inProgress', PT_STAGE.RECEIVED_KEY, [], [...FUNDED, [PT_ID.PIRATE_MESSAGE, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/read/i);
    });
    test('a read note with no spade fetches one before digging', () => {
        const s = decide(snap('inProgress', PT_STAGE.READ_NOTE, [], [...FUNDED, [PT_ID.PIRATE_MESSAGE, 1]]));
        expect(s.kind).toBe('grabGround');
    });
    test('spade in hand digs', () => {
        const s = decide(snap('inProgress', PT_STAGE.READ_NOTE, [], [...FUNDED, [PT_ID.SPADE, 1]]));
        expect(s.kind === 'custom' && s.name).toMatch(/dig/i);
    });
});

describe('pirate module wiring', () => {
    test('owns its inventory so every leg is re-derived on resume', () => {
        expect(piratestreasure.ownsInventory).toBe(true);
        expect(piratestreasure.record.id).toBe('hunt');
        expect(piratestreasure.record.name).toBe("Pirate's Treasure");
    });
});
