import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import JiveTT from '#/bot/scripts/JiveTT/JiveTT.js';
import { DEFAULT_SETTINGS } from '#/bot/scripts/JiveTT/settings.js';
import { emptySession, restoreSession, sessionKey } from '#/bot/scripts/JiveTT/session.js';
import * as Provision from '#/bot/scripts/JiveTT/provision.js';
import * as Market from '#/bot/scripts/JiveTT/market.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Npcs, Npc } from '#/bot/api/npcs/Npcs.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Hunting } from '#/bot/scripts/JiveTT/hunting.js';
import { Survival } from '#/bot/scripts/JiveTT/survival.js';
import { survivalPort } from '#/bot/scripts/JiveTT/liveSurvival.js';
import { SITES } from '#/bot/scripts/JiveTT/sites.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptWorldResume } from '#/bot/runtime/ScriptWorldResume.js';
import type { PurchaseIntent } from '#/bot/scripts/JiveTT/marketTrade.js';

let pack: InvItemSnapshot[];
let bank: InvItemSnapshot[];
let storage: Map<string, string>;
const bots: JiveTT[] = [];
const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, slot: 0, comId: 1, name: `Item ${id}`, ops: ['Drop'] });
const deposit = (): void => {
    for (const stack of pack) {
        const held = bank.find(i => i.id === stack.id);
        if (held) held.count += stack.count;
        else bank.push({ ...stack });
    }
    pack = [];
};
function bot(account = 'alice'): JiveTT {
    const script = new JiveTT();
    script.bindLog(() => {});
    script['memory'] = emptySession(account);
    script['config'] = { ...DEFAULT_SETTINGS };
    script['storage'] = () => ({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } });
    script['escape'] = async () => true;
    bots.push(script);
    return script;
}
function intent(): PurchaseIntent {
    return { account: 'alice', item: 'Shark', quantity: 10, expected: [{ id: 385, count: 10 }], coinsBefore: 5000,
        itemsBefore: [{ id: 995, count: 5000 }], cost: 1000, at: 1 };
}

test('site observations separate idle hunting and charge travel before changing phase', () => {
    const script = bot();
    let now = 1000;
    spyOn(Date, 'now').mockImplementation(() => now);
    script['lastSample'] = now;
    script['memory'].phase = 'hunt';
    now += 3000;
    script['sample']();
    expect(script['memory'].observations.clue.idleMs).toBe(3000);
    expect(script['memory'].observations.clue.huntingMs).toBe(0);
    script['memory'].phase = 'travel';
    now += 2000;
    script['phase']('hunt', 'Arrived');
    expect(script['memory'].observations.clue.bankingMs).toBe(2000);
});

test('a lingering combat flag after a kill does not skip visible hide loot', async () => {
    const tile = { x: 2904, z: 9802, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Inventory, 'free').mockReturnValue(10);
    spyOn(reader, 'groundItems').mockReturnValue([{ id: 1751, name: 'Blue dragonhide', count: 1, ops: ['Take'], tile, distance: 0 }]);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Npcs, 'all').mockReturnValue([]);
    const take = spyOn(GroundItem.prototype, 'interact').mockImplementation(() => { pack.push(item(1751)); return true; });
    const counters = emptySession('test').counters;
    const survival = new Survival(survivalPort(counters), DEFAULT_SETTINGS);
    spyOn(survival, 'run').mockResolvedValue();
    spyOn(survival, 'canStartFight').mockReturnValue(true);
    const hunting = new Hunting(SITES.find(site => site.id === 'taverley-blue')!, DEFAULT_SETTINGS, survival, counters, 'Dragon longsword', () => {});
    expect(await hunting.tick()).toBe('hunting');
    expect(take).toHaveBeenCalledWith('Take');
    expect(Inventory.countById(1751)).toBe(1);
    pack = [];
    take.mockReturnValue(false);
    hunting['idleSince'] = Date.now() - 121000;
    expect(await hunting.tick()).toBe('contention');
    take.mockImplementation(() => { pack.push(item(1751)); return true; });
    hunting.reset();
    expect(await hunting.tick()).toBe('hunting');
    expect(Inventory.countById(1751)).toBe(1);
});

test('stalled melee reissues Attack while incoming hits keep the combat flag active', async () => {
    let now = 20000;
    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(Game, 'tile').mockReturnValue({ x: 2910, z: 9803, level: 0 });
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Game, 'combatMode').mockReturnValue(2);
    spyOn(Inventory, 'free').mockReturnValue(10);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(reader, 'selfSlot').mockReturnValue(0);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Reachability, 'canStep').mockReturnValue(true);
    const npc = new Npc({ id: 55, index: 1, name: 'Blue dragon', level: 111, anim: -1, size: 4, tile: { x: 2908, z: 9804, level: 0 },
        distance: 2, ops: ['Attack'], inCombat: true, health: 100, totalHealth: 105, faceEntity: 32768 });
    spyOn(Npcs, 'all').mockReturnValue([npc]);
    const attack = spyOn(npc, 'interact').mockReturnValue(true);
    const counters = emptySession('test').counters;
    const survival = new Survival(survivalPort(counters), DEFAULT_SETTINGS);
    spyOn(survival, 'run').mockResolvedValue();
    const hunting = new Hunting(SITES.find(site => site.id === 'taverley-blue')!, DEFAULT_SETTINGS, survival, counters, 'Dragon longsword', () => {});
    hunting['target'] = { index: 1, id: 55, started: 0, lastHp: 100, progressed: 0 };
    expect(await hunting.tick()).toBe('hunting');
    expect(attack).toHaveBeenCalledTimes(1);
    await hunting.tick();
    expect(attack).toHaveBeenCalledTimes(1);
    now += 7000;
    npc.snap.health = 80;
    await hunting.tick();
    expect(attack).toHaveBeenCalledTimes(1);
});

beforeEach(() => {
    pack = [];
    bank = [];
    storage = new Map();
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'bankItems').mockImplementation(() => bank);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(Inventory, 'used').mockImplementation(() => pack.length);
    spyOn(Bank, 'items').mockImplementation(() => bank);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Bank, 'close').mockResolvedValue(true);
    spyOn(Bank, 'depositInventory').mockImplementation(async () => { deposit(); });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, count) => {
        const held = bank.find(i => i.id === id);
        if (!held || held.count < count) return false;
        held.count -= count;
        pack.push(item(id, count));
        bank = bank.filter(i => i.count > 0);
        return true;
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op !== 'Drop') return false;
        pack = pack.filter(i => i.id !== this.id);
        return true;
    });
    spyOn(Provision, 'freshBank').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async cond => cond());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async cond => cond());
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'myName').mockReturnValue('alice');
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(ScriptWorldResume, 'pending').mockReturnValue(null);
});
afterEach(() => {
    for (const script of bots.splice(0)) { script.onStop(); script.disposeSubscriptions(); }
    Sustain.set(null);
    mock.restore();
});

test.each(['easy', 'medium'])('%s is rejected before game observation, travel or banking', async tier => {
    const script = bot();
    const finished: string[] = [];
    script.settings = new SettingsBag({ clueTier: tier });
    script.bindFinish(reason => finished.push(reason));
    await script.onStart();
    expect(finished).toEqual([`${tier[0].toUpperCase()}${tier.slice(1)} clues are not implemented in JiveTT`]);
    expect(Game.sceneReady).not.toHaveBeenCalled();
    expect(Game.setAutoRetaliate).not.toHaveBeenCalled();
    expect(Provision.freshBank).not.toHaveBeenCalled();
});

test('restart preserves purchase, rewards and return-world intents only for the identified account', async () => {
    const state = emptySession('alice');
    state.phase = 'switch-world';
    state.returnWorld = 2;
    state.destinationWorld = 1;
    state.pendingPurchase = intent();
    state.pendingRewards = { items: [{ id: 99999, count: 1 }], bankBefore: [{ id: 995, count: 20 }] };
    state.counters.completed = 3;
    storage.set(sessionKey('alice'), JSON.stringify(state));
    const alice = bot('alice');
    await alice.onStart();
    expect(alice['memory']).toMatchObject({ account: 'alice', phase: 'audit', returnWorld: 2, destinationWorld: 1, pendingPurchase: intent(), pendingRewards: state.pendingRewards });
    spyOn(Game, 'myName').mockReturnValue('bob');
    const bob = bot('bob');
    await bob.onStart();
    expect(bob['memory']).toMatchObject({ account: 'bob', returnWorld: null, destinationWorld: null, pendingPurchase: null, pendingRewards: null });
    expect(bob['memory'].counters.completed).toBe(0);
    expect(JSON.parse(storage.get(sessionKey('alice'))!).counters.completed).toBe(3);
});

test('a mismatched persisted account cannot inherit a purchase or reward credit', async () => {
    const state = emptySession('bob');
    state.pendingPurchase = { ...intent(), account: 'bob' };
    state.counters.coinsSpent = 9000;
    storage.set(sessionKey('alice'), JSON.stringify(state));
    const script = bot();
    await script.onStart();
    expect(script['memory'].pendingPurchase).toBeNull();
    expect(script['memory'].counters.coinsSpent).toBe(0);
});

test('a confirmed interrupted purchase is credited once from usable or noted receipts', () => {
    const script = bot();
    script['memory'].pendingPurchase = intent();
    pack = [item(995, 4000), item(386, 10)];
    expect(script['reconcilePurchase']()).toBe(true);
    expect(script['memory'].pendingPurchase).toBeNull();
    expect(script['memory'].counters.coinsSpent).toBe(1000);
    expect(script['memory'].purchases).toHaveLength(1);
    expect(script['reconcilePurchase']()).toBe(true);
    expect(script['memory'].counters.coinsSpent).toBe(1000);
});

test('an unchanged interrupted purchase clears its intent without charging coins', () => {
    const script = bot();
    script['memory'].pendingPurchase = intent();
    pack = [item(995, 5000)];
    expect(script['reconcilePurchase']()).toBe(true);
    expect(script['memory'].pendingPurchase).toBeNull();
    expect(script['memory'].counters.coinsSpent).toBe(0);
});

test('a partial purchase receipt parks with the intent intact', () => {
    const script = bot();
    script['memory'].pendingPurchase = intent();
    pack = [item(995, 4000), item(385, 9)];
    expect(script['reconcilePurchase']()).toBe(false);
    expect(script['memory'].phase).toBe('parked');
    expect(script['memory'].pendingPurchase).toEqual(intent());
    expect(script['memory'].counters.coinsSpent).toBe(0);
});

test('reward banking credits actual new quantities including unknown reward IDs', async () => {
    const script = bot();
    bank = [item(995, 500)];
    pack = [item(995, 50), item(99999, 2)];
    script['memory'].pendingRewards = { items: [{ id: 995, count: 50 }, { id: 99999, count: 2 }], bankBefore: [{ id: 995, count: 500 }] };
    expect(await script['bankRewards']()).toBe(true);
    expect(pack).toEqual([]);
    expect(bank.map(i => [i.id, i.count])).toEqual([[995, 550], [99999, 2]]);
    expect(script['memory'].counters.completed).toBe(1);
    expect(script['memory'].counters.rewardsBanked).toBe(52);
    expect(script['memory'].pendingRewards).toBeNull();
});

test('restart can verify rewards already banked against the persisted pre-reward baseline', async () => {
    const script = bot();
    bank = [item(995, 550), item(99999, 2)];
    script['memory'].pendingRewards = { items: [{ id: 995, count: 50 }, { id: 99999, count: 2 }], bankBefore: [{ id: 995, count: 500 }] };
    expect(await script['bankRewards']()).toBe(true);
    expect(script['memory'].counters.completed).toBe(1);
    expect(script['memory'].pendingRewards).toBeNull();
});

test('missing reward quantities never increment completion and retain reconciliation evidence', async () => {
    const script = bot();
    bank = [item(995, 500)];
    pack = [item(995, 49)];
    script['memory'].pendingRewards = { items: [{ id: 995, count: 50 }], bankBefore: [{ id: 995, count: 500 }] };
    expect(await script['bankRewards']()).toBe(false);
    expect(script['memory'].counters.completed).toBe(0);
    expect(script['memory'].pendingRewards).not.toBeNull();
    expect(script['memory'].phase).toBe('parked');
});

test.each([{ id: 3526, acquired: false }, { id: 3549, acquired: true }])('blocked pre-existing clues and every casket remain protected: %j', async pending => {
    const script = bot();
    pack = [item(pending.id)];
    script['memory'].pendingClue = { ...pending, outcome: 'unsupported', retries: 0 };
    await script['blockedClue']({ kind: 'unsupported', reason: 'Blocked route', clueId: pending.id });
    expect(pack.map(i => i.id)).toEqual([pending.id]);
    expect(script['memory'].counters.discarded).toBe(0);
    expect(script['memory'].phase).toBe('parked');
});

test('discard removes only an acquired clue and its recorded obsolete trail item', async () => {
    const script = bot();
    pack = [item(3526), item(2795), item(385, 10), item(3549)];
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: 'unsupported', retries: 0, trailItems: [2795] };
    await script['blockedClue']({ kind: 'unsupported', reason: 'Blocked route', clueId: 3526 });
    expect(pack.map(i => i.id)).toEqual([385, 3549]);
    expect(script['memory'].counters.discarded).toBe(1);
    expect(script['memory'].phase).toBe('audit');
});

test('a lost interrupted trail without a verified receipt parks before farming', async () => {
    const script = bot();
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: null, retries: 0 };
    await script['audit']();
    expect(script['memory'].phase).toBe('parked');
    expect(script['memory'].lastFailure).toContain('no clue');
    expect(script['memory'].counters.completed).toBe(0);
});

test('a banked unsupported-tier clue blocks work before equipment or supply changes', async () => {
    const script = bot();
    bank = [item(3490)];
    await script['audit']();
    expect(script['memory'].phase).toBe('parked');
    expect(script['memory'].lastFailure).toContain('easy');
    expect(Bank.depositInventory).not.toHaveBeenCalled();
});

test('a replacement hard clue cannot inherit acquired-clue discard authorization', async () => {
    const script = bot();
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: null, retries: 0 };
    bank = [item(3532), item(1305), item(1113), item(1079), item(1163)];
    spyOn(Skills, 'level').mockReturnValue(75);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Quests, 'all').mockReturnValue([{ name: 'Lost City', status: 'complete' }]);
    spyOn(Equipment, 'items').mockReturnValue([]);
    script['requestRestock'] = async () => {};
    await script['audit']();
    expect(script['memory'].pendingClue).toMatchObject({ id: 3532, acquired: false });
});


test('normal kit rebuilds on successive hard clues do not exhaust transient retries', async () => {
    const script = bot();
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: null, retries: 0 };
    for (const id of [3526, 3528, 3530]) {
        pack = [item(id)];
        const solver = new SolveClue({ log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 });
        spyOn(solver, 'execute').mockImplementation(async () => { solver.result = { kind: 'resupply', reason: 'Pack next clue', clueId: id }; });
        script['solver'] = solver;
        await script['solve']();
        expect(script['memory'].phase).toBe('prepare-clue');
        expect(script['memory'].pendingClue?.retries).toBe(0);
    }
});

test('resupply retries for an unchanged clue remain bounded across restart', async () => {
    const script = bot();
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: null, retries: 0 };
    pack = [item(3526)];
    for (let attempt = 0; attempt < 2; attempt++) {
        const solver = new SolveClue({ log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 });
        spyOn(solver, 'execute').mockImplementation(async () => { solver.result = { kind: 'resupply', reason: 'No prayer doses', clueId: 3526 }; });
        script['solver'] = solver;
        await script['solve']();
        if (attempt === 0) {
            expect(script['memory'].phase).toBe('prepare-clue');
            script['memory'] = restoreSession(JSON.stringify(script['memory']), 'alice');
        }
    }
    expect(script['memory'].phase).toBe('parked');
    expect(script['memory'].pendingClue?.retries).toBe(0);
});

test('transient recovery stays limited to one retry after a successful resupply', async () => {
    const script = bot();
    script['memory'].pendingClue = { id: 3526, acquired: true, outcome: null, retries: 0 };
    pack = [item(3526)];
    for (const kind of ['resupply', 'transient-failure', 'transient-failure'] as const) {
        const solver = new SolveClue({ log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 });
        spyOn(solver, 'execute').mockImplementation(async () => { solver.result = { kind, reason: 'Retry test', clueId: 3526 }; });
        script['solver'] = solver;
        await script['solve']();
        if (kind === 'resupply') expect(script['memory'].phase).toBe('prepare-clue');
    }
    expect(script['memory'].phase).toBe('parked');
    expect(script['memory'].pendingClue).toMatchObject({ retries: 1, resupplies: 1, lastResupplyId: 3526 });
});

test('restored resupply counters are validated and bounded', () => {
    const state = emptySession('alice');
    state.pendingClue = { id: 3526, acquired: true, outcome: 'resupply', retries: 0, lastResupplyId: 3526, resupplies: 50 };
    expect(restoreSession(JSON.stringify(state), 'alice').pendingClue).toMatchObject({ lastResupplyId: 3526, resupplies: 1 });
    state.pendingClue.lastResupplyId = -1;
    state.pendingClue.resupplies = -1;
    expect(restoreSession(JSON.stringify(state), 'alice').pendingClue).toMatchObject({ lastResupplyId: undefined, resupplies: 0 });
});

test('reward banking canonicalizes notes outside the hunting loot catalog', async () => {
    const script = bot();
    const catalog = await import('#/bot/api/market/catalog.js');
    spyOn(catalog, 'liveCatalog').mockReturnValue({ byId: new Map(), notedOf: new Map([[379, 380]]), unnotedOf: new Map([[380, 379]]), items: [], aliases: new Map() });
    script['memory'].pendingRewards = { items: [{ id: 380, count: 12 }], bankBefore: [] };
    bank = [item(379, 12)];
    expect(await script['bankRewards']()).toBe(true);
    expect(script['memory'].counters.completed).toBe(1);
    expect(script['memory'].counters.rewardsBanked).toBe(12);
});

test('verified hunting exit clears dragon hazards before bank navigation', async () => {
    const script = bot();
    script['hazard'] = { phase: 'hunt', dragonfire: true, antipoison: true };
    spyOn(Provision, 'freshBank').mockImplementation(async () => {
        expect(script['hazard'].dragonfire).toBe(false);
        expect(script['hazard'].phase).toBe('travel');
        return true;
    });
    bank = [item(2677)];
    await script['audit']();
});

test.each([{ supply: 'Super set', quantity: 8 }, { supply: 'Shark', quantity: 24 }])('shopping limits $supply to unnoted receipt capacity', async ({ supply, quantity }) => {
    const script = bot();
    script['world'] = () => 1;
    spyOn(Inventory, 'free').mockImplementation(() => 28 - pack.length);
    script['config'] = { ...DEFAULT_SETTINGS, marketBatch: 100, stockSuperSets: 100, priceCeilings: { [supply]: 1 } };
    bank = [item(995, 100000), item(385, supply === 'Shark' ? 3 : 100), item(139, 40)];
    spyOn(Provision, 'escapeManifest').mockReturnValue([]);
    spyOn(Provision, 'packInventory').mockImplementation(async () => {
        pack = [item(995, 100000), item(385), item(385), item(385)];
        return true;
    });
    const buy = spyOn(Market, 'buyMarketSupply').mockResolvedValue({ kind: 'bought', spent: quantity, quantity, receipts: [] });
    await script['shop']();
    expect(buy.mock.calls[0]?.[0]).toMatchObject({ item: supply, quantity });
});
