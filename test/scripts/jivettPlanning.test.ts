import { describe, expect, test } from 'bun:test';
import { countDoses, countStock, planPack, stockDeficits } from '../../src/bot/scripts/JiveTT/stock.js';
import { clueBlocker, planNext, selectSite } from '../../src/bot/scripts/JiveTT/planner.js';
import { emptySession, restoreSession } from '../../src/bot/scripts/JiveTT/session.js';
import { SITES } from '../../src/bot/scripts/JiveTT/sites.js';
import { DEFAULT_SETTINGS } from '../../src/bot/scripts/JiveTT/settings.js';
import type { AccountSnapshot, JiveSite } from '../../src/bot/scripts/JiveTT/types.js';

const snapshot = (): AccountSnapshot => ({ account: 'test', world: 1, bankFresh: true, inventory: [], bank: [], equipment: [], levels: { attack: 90, strength: 90, defence: 90, hitpoints: 90, prayer: 70, magic: 70 }, quests: [], weaponId: 1305, escapeReady: true, suppliesReady: true });
const validated = (id: string): JiveSite => ({ ...SITES.find(site => site.id === id)!, validation: { revision: '289-test', evidence: 'test fixture only', entry: true, melee: true, loot: true, exit: true, npcIds: [49] } });

describe('JiveTT planning', () => {
    test('counts each potion dose and canonical noted stock separately from usable inventory', () => {
        const items = [{ id: 2434, count: 2 }, { id: 139, count: 1 }, { id: 141, count: 2 }, { id: 143, count: 1 }, { id: 140, count: 3, noted: true }];
        expect(countDoses(items, 'prayer')).toBe(25);
        expect(countDoses(items, 'prayer', true)).toBe(16);
        expect(countStock([{ id: 386, count: 10, noted: true }, { id: 385, count: 2 }], 385)).toBe(12);
    });
    test('uses partial potion stock before buying complete super sets', () => {
        expect(stockDeficits([{ id: 145, count: 10 }, { id: 157, count: 9 }, { id: 163, count: 10 }], DEFAULT_SETTINGS).superSets).toBe(1);
    });
    test('rejects an infeasible pack and reserves a clue slot', () => {
        expect(planPack([{ id: 385, count: 28, stackable: false, purpose: 'food' }], 1).kind).toBe('blocked');
        expect(planPack([{ id: 385, count: 20, stackable: false, purpose: 'food' }, { id: 556, count: 100, stackable: true, purpose: 'escape' }], 1)).toMatchObject({ kind: 'ready', slots: 21, reserveSlots: 1 });
    });
    test('refuses unimplemented difficulty before bank audit', () => {
        const state = snapshot(); state.bankFresh = false;
        expect(planNext(state, { ...DEFAULT_SETTINGS, clueTier: 'easy' }, emptySession('test'), 0)).toEqual({ kind: 'park', reason: 'Easy clues are not implemented in JiveTT' });
    });
    test('requires fresh bank and parks unsupported stored clues', () => {
        const state = snapshot(); state.bankFresh = false;
        expect(planNext(state, DEFAULT_SETTINGS, emptySession('test'), 0).kind).toBe('audit');
        state.bankFresh = true; state.bank = [{ id: 2677, count: 1 }];
        expect(planNext(state, DEFAULT_SETTINGS, emptySession('test'), 0)).toMatchObject({ kind: 'park' });
        expect(clueBlocker([{ id: 2722, count: 1 }])).toMatchObject({ id: 2722, tier: 'hard' });
    });
    test('selects a stored hard clue before any hunting or shopping', () => {
        const state = snapshot(); state.bank = [{ id: 2722, count: 1 }]; state.suppliesReady = false;
        expect(planNext(state, DEFAULT_SETTINGS, emptySession('test'), 0)).toMatchObject({ kind: 'clue', id: 2722 });
    });
    test('never selects an unvalidated or inaccessible site', () => {
        expect(selectSite(snapshot(), DEFAULT_SETTINGS, emptySession('test'), 0, SITES)).toBeNull();
        const site = validated('taverley-hellhounds');
        expect(selectSite(snapshot(), { ...DEFAULT_SETTINGS, allowedSites: [site.id] }, emptySession('test'), 0, [site])).toBeNull();
    });
    test('stable seeds distribute eligible accounts and respect cooldowns', () => {
        const a = validated('taverley-hellhounds'); a.requirements = { ...a.requirements, items: [] };
        const b = { ...a, id: 'second' };
        const settings = { ...DEFAULT_SETTINGS, allowedSites: [a.id, b.id] };
        const choices = new Set(Array.from({ length: 40 }, (_, index) => selectSite({ ...snapshot(), account: `bot${index}` }, settings, emptySession(`bot${index}`), 0, [a, b])?.site.id));
        expect(choices.size).toBe(2);
        const memory = emptySession('test'); memory.cooldowns[a.id] = 100;
        expect(selectSite(snapshot(), settings, memory, 0, [a, b])?.site.id).toBe(b.id);
    });
    test('restores only same-account durable intent and resets executable phase to audit', () => {
        const saved = { ...emptySession('test'), phase: 'hunt', returnWorld: 2, siteId: 'taverley-hellhounds', targetIndex: 42 };
        expect(restoreSession(JSON.stringify(saved), 'test')).toMatchObject({ phase: 'audit', returnWorld: 2, siteId: saved.siteId });
        expect(restoreSession(JSON.stringify(saved), 'other')).toEqual(emptySession('other'));
        expect(restoreSession(JSON.stringify(saved), 'test')).not.toHaveProperty('targetIndex');
    });
    test('completed throughput includes solving and supply time', () => {
        const site = validated('taverley-hellhounds');
        site.requirements = { ...site.requirements, items: [] };
        const settings = { ...DEFAULT_SETTINGS, allowedSites: [site.id] };
        const state = emptySession('test');
        state.observations[site.id] = { kills: 20, huntingMs: 60000, idleMs: 1000, bankingMs: 1000, completed: 1, elapsedMs: 120000 };
        const fast = selectSite(snapshot(), settings, state, 0, [site])!.score;
        state.observations[site.id].elapsedMs = 240000;
        expect(selectSite(snapshot(), settings, state, 0, [site])!.score).toBe(fast * 2);
        expect(restoreSession(JSON.stringify(state), 'test').observations[site.id].elapsedMs).toBe(240000);
    });
});
