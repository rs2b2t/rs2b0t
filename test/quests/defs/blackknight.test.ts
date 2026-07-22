import { describe, expect, test } from 'bun:test';
import { decide } from '#/bot/quests/defs/blackknight.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return { journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 0, ...over };
}
const held = (...names: string[]) => new Map(names.map(n => [n.toLowerCase(), 1] as const));
const wearing = (...names: string[]) => new Set(names.map(n => n.toLowerCase()));

describe('Black Knight decide', () => {
    test('complete → done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });
    test('not started → talk Sir Amik', () => {
        const s = decide(snap({ journal: 'notStarted' }));
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Sir Amik Varze');
    });
    test('in progress, disguise not worn → equip the missing piece', () => {
        const s = decide(snap({ worn: wearing('iron chainbody'), inv: held('Bronze med helm', 'Cabbage') }));
        expect(s.kind).toBe('equip');
        expect(s.kind === 'equip' && s.item).toBe('Bronze med helm');
    });
    test('in progress, disguise worn, cabbage held → infiltrate', () => {
        const s = decide(snap({ worn: wearing('iron chainbody', 'bronze med helm'), inv: held('Cabbage') }));
        expect(s.kind).toBe('custom');
        expect(s.kind === 'custom' && s.name).toBe('infiltrate');
    });
    test('in progress, disguise worn, cabbage GONE (sabotaged) → talk Sir Amik', () => {
        const s = decide(snap({ worn: wearing('iron chainbody', 'bronze med helm'), inv: new Map() }));
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Sir Amik Varze');
    });
    test('unknown journal → wait', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });
});
