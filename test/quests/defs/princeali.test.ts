import { expect, test, describe } from 'bun:test';
import { decide, princeali } from '#/bot/quests/defs/princeali.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (
    journal: string,
    items: [string, number][] = [],
    noProgress = 0,
    bankCoins = 0,
    worn: string[] = []
): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(worn),
    noProgress,
    bankCoins
});

const ALL4: [string, number][] = [['bronze key', 1], ['wig', 1], ['pink skirt', 1], ['paste', 1]];

describe('princeali provisioning — raw items declared + gatherable', () => {
    test('every acquirable record item has a gather fn (else the engine blocks it)', () => {
        const acquirable = princeali.record.items.filter(i => i.kind === 'acquirable');
        expect(acquirable.length).toBeGreaterThan(0);
        for (const it of acquirable) {
            expect(princeali.gather?.[it.name.toLowerCase()]).toBeDefined();
        }
    });
    test('raw declarations are leaves only — no created/stage-gated or Leela-probe items', () => {
        const names = princeali.record.items.map(i => i.name.toLowerCase());
        for (const created of ['wig', 'blond wig', 'paste', 'soft clay', 'yellow dye', 'ashes', 'key print', 'bronze key', 'clay', 'bucket', 'beer']) {
            expect(names).not.toContain(created);
        }
    });
    test('declared raws are the cheap buyables — buy steps; onion/logs/wool are NOT provisioned', () => {
        const s = snap('inProgress', [], 0, 100);
        expect(princeali.gather!['redberries'](s, 1).kind).toBe('buy');
        expect(princeali.gather!['bronze bar'](s, 1).kind).toBe('buy');
        expect(princeali.gather!['pink skirt'](s, 1).kind).toBe('buy');
        expect(princeali.gather!['rope'](s, 1).kind).toBe('buy');
        for (const jit of ['onion', 'logs', 'ball of wool', 'clay', 'jug of water']) {
            expect(princeali.gather?.[jit]).toBeUndefined();
            expect(princeali.record.items.map(i => i.name.toLowerCase())).not.toContain(jit);
        }
    });
});

describe('princeali decide — lifecycle', () => {
    test('notStarted -> Hassan', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Hassan');
    });
    test('complete -> done; unknown -> wait', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
    });
});

describe('princeali decide — row 1 commits to the jailbreak on all-4', () => {
    test('all 4 + coins in pack -> jailbreak custom (custom self-provisions beers/rope)', () => {
        const s = decide(snap('inProgress', [...ALL4, ['beer', 3], ['rope', 2], ['coins', 40]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('jailbreak');
    });
    test('all 4, no supplies, pack coins present -> STILL jailbreak (not a buy detour)', () => {
        const s = decide(snap('inProgress', [...ALL4, ['coins', 40]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('jailbreak');
    });
    test('all 4, pack short of coins but bank covers -> withdraw coins first', () => {
        const s = decide(snap('inProgress', [...ALL4], 0, 60));
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Coins');
    });
    test('all 4, pack has enough coins -> jailbreak (no withdraw)', () => {
        const s = decide(snap('inProgress', [...ALL4, ['coins', 30]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('jailbreak');
    });
});

describe('princeali decide — row 3 Osman/key', () => {
    test('key print + bronze bar -> talk Osman', () => {
        const s = decide(snap('inProgress', [['key print', 1], ['bronze bar', 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Osman');
    });
    test('key print, no bronze bar, bank covers -> buy Bronze bar at Shantay', () => {
        const s = decide(snap('inProgress', [['key print', 1]], 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Bronze bar');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Shantay');
    });
    test('key print, no bronze bar, BROKE (no pack/bank coins) -> park a wait, never loop', () => {
        const s = decide(snap('inProgress', [['key print', 1]], 0, 0));
        expect(s.kind).toBe('wait');
    });
});

describe('princeali decide — rows 4/5/6 key acquisition', () => {
    test('soft clay held -> osman briefing + keli imprint (custom)', () => {
        const s = decide(snap('inProgress', [['soft clay', 1]]));
        expect(s.kind === 'custom' && s.name).toBe('osman briefing + keli imprint');
    });
    test('fresh start (holds Bronze bar + pickaxe), noProgress 0 -> mine Clay, NOT a premature Osman trip', () => {
        const s = decide(snap('inProgress', [['bronze bar', 1], ['bronze pickaxe', 1]], 0));
        expect(s.kind === 'mineRock' && s.rock).toBe('Clay');
    });
    test('post-forge (Bronze bar consumed), noProgress 0 -> collect the key from Leela', () => {
        const s = decide(snap('inProgress', [], 0));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Leela');
    });
    test('empty-handed, Leela stalled (noProgress 1), pickaxe in pack -> mine Clay', () => {
        const s = decide(snap('inProgress', [['bronze pickaxe', 1]], 1));
        expect(s.kind === 'mineRock' && s.rock).toBe('Clay');
    });
    test('empty-handed, Leela stalled, NO pickaxe -> get a pickaxe (bank-first, then spawn)', () => {
        const s = decide(snap('inProgress', [], 1));
        expect(s.kind === 'custom' && s.name).toBe('get a pickaxe');
    });
    test('a pickaxe EQUIPPED (worn) counts -> mine Clay, no fetch', () => {
        const s = decide(snap('inProgress', [], 1, 0, ['iron pickaxe']));
        expect(s.kind === 'mineRock' && s.rock).toBe('Clay');
    });
    test('has clay, no water, bank covers -> buy Jug of water at Shantay', () => {
        const s = decide(snap('inProgress', [['clay', 1]], 1, 100));
        expect(s.kind === 'buy' && s.item).toBe('Jug of water');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Shantay');
    });
    test('has clay + jug of water -> make soft clay (item-on-item)', () => {
        const s = decide(snap('inProgress', [['clay', 1], ['jug of water', 1]], 1));
        expect(s.kind === 'useOn' && s.targetKind).toBe('item');
        expect(s.kind === 'useOn' && s.item).toBe('Jug of water');
        expect(s.kind === 'useOn' && s.product).toBe('Soft clay');
    });
});

describe('princeali decide — row 7 wig', () => {
    test('have key, no wig -> wig pipeline (custom)', () => {
        const s = decide(snap('inProgress', [['bronze key', 1]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('wig');
    });
    test('plain wig + yellow dye (mid-dye) still routes to wig pipeline', () => {
        const s = decide(snap('inProgress', [['bronze key', 1], ['wig', 1], ['yellow dye', 1]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('wig');
    });
});

describe('princeali decide — row 8 paste chain', () => {
    const base: [string, number][] = [['bronze key', 1], ['wig', 1]];
    test('no redberries -> buy at Port Sarim (Wydin)', () => {
        const s = decide(snap('inProgress', base, 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Redberries');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Wydin');
    });
    test('no pot of flour -> buy at Port Sarim', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1]], 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Pot of flour');
    });
    test('no ashes, no tinderbox -> buy Tinderbox at Lumbridge general', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1]], 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Tinderbox');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Shop keeper');
    });
    test('tinderbox but no logs -> grab Logs', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['tinderbox', 1]]));
        expect(s.kind === 'grabGround' && s.item).toBe('Logs');
    });
    test('tinderbox + logs -> burn for ashes (custom)', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['tinderbox', 1], ['logs', 1]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('ash');
    });
    test('ashes but no water -> buy Jug of water', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['ashes', 1]], 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Jug of water');
    });
    test('all paste ingredients + water -> talk Aggie', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['ashes', 1], ['jug of water', 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Aggie');
    });
});

describe('princeali decide — row 9 skirt', () => {
    test('no pink skirt -> buy at Thessalia', () => {
        const s = decide(snap('inProgress', [['bronze key', 1], ['wig', 1], ['paste', 1]], 0, 100));
        expect(s.kind === 'buy' && s.item).toBe('Pink skirt');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Thessalia');
    });
});
