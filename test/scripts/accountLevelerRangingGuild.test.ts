import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { auditSupplies } from '#/bot/scripts/AccountLeveler/shopping.js';
import { LevelerSession } from '#/bot/scripts/AccountLeveler/session.js';
import { purchaseBudget, supplyOffer } from '#/bot/scripts/AccountLeveler/offers.js';
import { requirementKey, stockOf, type LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { levelerTravelZones } from '#/bot/scripts/AccountLeveler/travel.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';

const snapshot = (ranged = 40, coins = 100000): LevelerSnapshot => ({
    levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 60])), ranged },
    stock: { coins, lobster: 100 }, bankReady: true, quests: { 'Lost City': true },
    target: 60, wilderness: false, allowQuests: false, now: 1000
});

test('Ranged switches to the guild at 40 without food or combat ammunition', () => {
    const s = snapshot(39);
    const before = methodFor(s, 'ranged', emptyMemory(), () => 0)!;
    expect(before.script).toBe('AutoFighter');
    expect(before.prerequisiteLevels).toEqual({ ranged: 40 });
    s.levels.ranged = 40;
    const decision = planNext(s, { ...emptyMemory(), objective: 'ranged' }, () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind !== 'activity') return;
    expect(decision.queue.map(plan => plan.script)).toEqual(['RangingGuild']);
    expect(decision.plan.settings).toEqual({ coinsPerTrip: 10000, coinsReserve: 200 });
    expect(decision.plan.needs.map(need => need.item)).toEqual(['Coins', 'Oak shortbow']);
    expect(decision.plan.food).toBeUndefined();
    expect(decision.plan.combat).not.toBe(true);
});

test('the guild remains preferred despite recent sessions and supplies a usable banked bow', () => {
    const s = snapshot(50);
    s.stock['#861'] = 1;
    const plan = methodFor(s, 'ranged', { ...emptyMemory(), recent: ['ranging-guild'] }, () => 0)!;
    expect(plan.script).toBe('RangingGuild');
    expect(plan.needs).toContainEqual({ item: 'Magic shortbow', id: 861, count: 1, carry: 1, equip: true });
});

test('guild funds share a budget with the bow and fall back when the trip cannot be funded', () => {
    const s = snapshot(40, 1000);
    const plan = methodFor(s, 'ranged', emptyMemory(), () => 0)!;
    expect(plan.script).toBe('RangingGuild');
    const spend = plan.needs.reduce((sum, need) => sum + (need.item === 'Coins' ? need.count : stockOf(s, requirementKey(need)) ? 0 : purchaseBudget(supplyOffer(need.item)!, need.count)), 0);
    expect(spend).toBeLessThanOrEqual(1000);
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
    s.stock.coins = 699;
    s.stock['#841'] = 1;
    expect(methodFor(s, 'ranged', emptyMemory(), () => 0)?.script).toBe('AutoFighter');
});

test('failed guild sessions cool down and choose lower combat camps until retry is allowed', () => {
    const s = snapshot();
    const session = new LevelerSession(emptyMemory());
    const plan = methodFor(s, 'ranged', session.memory, () => 0)!;
    expect(plan.script).toBe('RangingGuild');
    session.start(plan, 0, () => 0);
    expect(session.failure(100)).toBe('reset');
    session.start(plan, 200, () => 0);
    expect(session.failure(300)).toBe('rotate');
    expect(methodFor(s, 'ranged', session.memory, () => 0)?.script).toBe('AutoFighter');
    s.now = 1000000;
    expect(methodFor(s, 'ranged', session.memory, () => 0)?.script).toBe('RangingGuild');
});

test('guild training does not prebuy combat arrows during the startup audit', () => {
    const s = snapshot(39);
    expect(auditSupplies(s).needs.some(need => need.item === 'Bronze arrow')).toBe(true);
    s.levels.ranged = 40;
    expect(auditSupplies(s).needs.some(need => need.item === 'Bronze arrow')).toBe(false);
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('guild travel reaches the judge and returns from three banks with Ranged 40', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const destination = methodFor(snapshot(), 'ranged', emptyMemory(), () => 0)!.travel!;
    const state = { ...emptyWorldStateData(), skills: { ranged: 40 }, items: { Coins: 10000 }, entranaRestrictedGear: true };
    for (const bank of [{ x: 3092, z: 3243, level: 0 }, { x: 3013, z: 3355, level: 0 }, { x: 2725, z: 3491, level: 0 }]) {
        for (const [from, to] of [[bank, destination], [destination, bank]]) {
            const route = finder.findPath(from, to, {
                state, useTeleportCatalog: false,
                avoidZones: resolveDangerZones(levelerTravelZones(to), { includeAutomatic: true, combatLevel: 22, start: from, destination: to })
            });
            expect(route.ok, `${JSON.stringify(from)} -> ${JSON.stringify(to)}`).toBe(true);
        }
    }
}, 30000);
