import { expect, test, describe } from 'bun:test';
import { decide } from './princeali.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (
    journal: string,
    items: [string, number][] = [],
    noProgress = 0,
    bankCoins = 0
): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress,
    bankCoins
});

// The four disguise pieces the prince handover consumes (research doc §5.5).
const ALL4: [string, number][] = [['bronze key', 1], ['wig', 1], ['pink skirt', 1], ['paste', 1]];

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

describe('princeali decide — row 1 jailbreak', () => {
    test('all 4 + 3 beers + 2 ropes -> jailbreak custom', () => {
        const s = decide(snap('inProgress', [...ALL4, ['beer', 3], ['rope', 2]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('jailbreak');
    });
});

describe('princeali decide — row 2 supplies', () => {
    test('all 4, short a beer, pack coins >= 10 -> talk Bartender', () => {
        const s = decide(snap('inProgress', [...ALL4, ['beer', 1], ['rope', 2], ['coins', 10]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Bartender');
    });
    test('all 4, short a beer, broke (no bank) -> wait', () => {
        const s = decide(snap('inProgress', [...ALL4, ['rope', 2]]));
        expect(s.kind).toBe('wait');
    });
    test('all 4, short a beer, bank covers -> withdraw coins', () => {
        const s = decide(snap('inProgress', [...ALL4, ['rope', 2]], 0, 60));
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Coins');
    });
    test('all 4, beers ok, short rope, pack coins >= 15 -> talk Ned (rope)', () => {
        const s = decide(snap('inProgress', [...ALL4, ['beer', 3], ['coins', 20]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Ned');
    });
});

describe('princeali decide — row 3 Osman/key', () => {
    test('key print + bronze bar -> talk Osman', () => {
        const s = decide(snap('inProgress', [['key print', 1], ['bronze bar', 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Osman');
    });
    test('key print, no bronze bar -> buy Bronze bar at Shantay', () => {
        const s = decide(snap('inProgress', [['key print', 1]]));
        expect(s.kind === 'buy' && s.item).toBe('Bronze bar');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Shantay');
    });
});

describe('princeali decide — rows 4/5/6 key acquisition', () => {
    test('soft clay held -> imprint at Keli (custom)', () => {
        const s = decide(snap('inProgress', [['soft clay', 1]]));
        expect(s.kind === 'custom' && s.name.toLowerCase()).toContain('imprint');
    });
    test('empty-handed, noProgress 0 -> probe Leela (collect a made key)', () => {
        const s = decide(snap('inProgress', [], 0));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Leela');
    });
    test('empty-handed, Leela stalled (noProgress 1) -> mine Clay', () => {
        const s = decide(snap('inProgress', [], 1));
        expect(s.kind === 'mineRock' && s.rock).toBe('Clay');
    });
    test('has clay, no bucket -> grab a Bucket', () => {
        const s = decide(snap('inProgress', [['clay', 1]], 1));
        expect(s.kind === 'grabGround' && s.item).toBe('Bucket');
    });
    test('has clay + bucket -> fill at the Well', () => {
        const s = decide(snap('inProgress', [['clay', 1], ['bucket', 1]], 1));
        expect(s.kind === 'useOn' && s.target).toBe('Well');
    });
    test('has clay + bucket of water -> make soft clay (item-on-item)', () => {
        const s = decide(snap('inProgress', [['clay', 1], ['bucket of water', 1]], 1));
        expect(s.kind === 'useOn' && s.targetKind).toBe('item');
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
    const base: [string, number][] = [['bronze key', 1], ['wig', 1]]; // past rows 1-7
    test('no redberries -> buy at Port Sarim (Wydin)', () => {
        const s = decide(snap('inProgress', base));
        expect(s.kind === 'buy' && s.item).toBe('Redberries');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Wydin');
    });
    test('no pot of flour -> buy at Port Sarim', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1]]));
        expect(s.kind === 'buy' && s.item).toBe('Pot of flour');
    });
    test('no ashes, no tinderbox -> buy Tinderbox at Lumbridge general', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1]]));
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
    test('ashes but no water -> water chain (grab Bucket)', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['ashes', 1]]));
        expect(s.kind === 'grabGround' && s.item).toBe('Bucket');
    });
    test('all paste ingredients + water -> talk Aggie', () => {
        const s = decide(snap('inProgress', [...base, ['redberries', 1], ['pot of flour', 1], ['ashes', 1], ['jug of water', 1]]));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Aggie');
    });
});

describe('princeali decide — row 9 skirt', () => {
    test('no pink skirt -> buy at Thessalia', () => {
        const s = decide(snap('inProgress', [['bronze key', 1], ['wig', 1], ['paste', 1]]));
        expect(s.kind === 'buy' && s.item).toBe('Pink skirt');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Thessalia');
    });
});
