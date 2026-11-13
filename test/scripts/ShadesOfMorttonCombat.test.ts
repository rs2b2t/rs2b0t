import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { CombatSupport, PRAYER_POTIONS } from '#/bot/scripts/ShadesOfMortton/combat.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => mock.restore());

const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, slot: id, comId: 3214, name: '', ops: ['Drink'] });
function fixture() {
    const state = { pack: [item(379, 2)], points: 30, level: 43, hp: 50, combat: false, dungeon: true, event: false, active: false, enabled: true, drinks: 0, toggles: [] as boolean[] };
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(Skills, 'effective').mockImplementation(skill => skill === 'prayer' ? state.points : state.hp);
    spyOn(Skills, 'level').mockImplementation(skill => skill === 'prayer' ? state.level : 50);
    spyOn(Game, 'inCombat').mockImplementation(() => state.combat);
    spyOn(Game, 'tile').mockImplementation(() => ({ x: 3490, z: state.dungeon ? 9690 : 3290, level: 0 }));
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Prayer, 'active').mockImplementation(() => state.active);
    spyOn(Prayer, 'set').mockImplementation(async (_name, on) => { state.toggles.push(on); state.active = on; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        state.drinks++;
        const index = PRAYER_POTIONS.findIndex(potion => potion.id === this.id);
        state.pack = state.pack.filter(entry => entry.id !== this.id);
        state.pack.push(item(PRAYER_POTIONS[index + 1]?.id ?? 229));
        state.points = Math.min(state.level, state.points + 17);
        return true;
    });
    const supply = new Supplies(() => {});
    const heal = spyOn(supply, 'heal').mockResolvedValue(true);
    const support = new CombatSupport(supply, () => state.enabled);
    return { state, support, heal };
}

test('uses the source-verified potion dose variants', () => {
    expect(PRAYER_POTIONS).toEqual([{ id: 2434, doses: 4 }, { id: 139, doses: 3 }, { id: 141, doses: 2 }, { id: 143, doses: 1 }]);
});

test('protects in catacombs with available prayer and no potion', async () => {
    const { state, support } = fixture();
    state.pack = [];
    expect(await support.maintain()).toBe(true);
    expect(support.protected()).toBe(true);
    expect(state.drinks).toBe(0);
    expect(state.toggles).toEqual([true]);
});

test('restores each dose variant and verifies its successor before protection', async () => {
    for (const [index, potion] of PRAYER_POTIONS.entries()) {
        const { state, support } = fixture();
        state.points = 0;
        state.pack = [item(potion.id)];
        expect(await support.maintain()).toBe(true);
        expect(Inventory.countById(potion.id)).toBe(0);
        expect(Inventory.countById(PRAYER_POTIONS[index + 1]?.id ?? 229)).toBe(1);
        expect(state.drinks).toBe(1);
        expect(support.protected()).toBe(true);
        mock.restore();
    }
});

test('falls back to food when prayer is unavailable, disabled or exhausted', async () => {
    for (const reason of ['level', 'enabled', 'points'] as const) {
        const { state, support } = fixture();
        if (reason === 'level') state.level = 42;
        if (reason === 'enabled') state.enabled = false;
        if (reason === 'points') state.points = 0;
        expect(await support.maintain()).toBe(true);
        expect(state.toggles).toEqual([]);
        state.pack = [];
        expect(await support.maintain()).toBe(false);
        mock.restore();
    }
});

test('does not spend prayer in idle overworld and shuts down owned protection on exit', async () => {
    const { state, support } = fixture();
    state.dungeon = false;
    state.points = 0;
    state.pack.push(item(2434));
    expect(await support.maintain()).toBe(true);
    expect(state.drinks).toBe(0);
    expect(state.toggles).toEqual([]);
    state.combat = true;
    expect(await support.maintain()).toBe(true);
    state.combat = false;
    expect(await support.maintain()).toBe(true);
    expect(state.toggles).toEqual([true, false]);
});

test('standDown disables only protection enabled by this helper', async () => {
    const { state, support } = fixture();
    state.active = true;
    await support.maintain();
    await support.standDown();
    expect(state.toggles).toEqual([]);
    state.active = false;
    await support.maintain();
    await support.standDown();
    expect(state.toggles).toEqual([true, false]);
});

test('overlapping sustain and action callbacks drink only once', async () => {
    const { state, support, heal } = fixture();
    state.points = 0;
    state.pack.push(item(2434));
    let release!: () => void;
    heal.mockImplementation(() => new Promise(resolve => { release = () => resolve(true); }));
    const first = support.maintain();
    const second = support.maintain();
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(state.drinks).toBe(1);
});

test('interrupted dose resumes verification without issuing a second drink', async () => {
    const { state, support } = fixture();
    state.points = 0;
    state.pack.push(item(2434));
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { state.drinks++; state.event = true; return true; });
    expect(await support.maintain()).toBe(false);
    state.event = false;
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        state.pack = [item(379, 2), item(139)];
        state.points = 17;
        return condition();
    });
    expect(await support.maintain()).toBe(true);
    expect(state.drinks).toBe(1);
});

test('accepted drink without a dose transition is not prayer readiness', async () => {
    const { state, support } = fixture();
    state.points = 0;
    state.pack = [item(2434)];
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { state.drinks++; return true; });
    expect(await support.maintain()).toBe(false);
    expect(support.protected()).toBe(false);
    expect(state.toggles).toEqual([]);
});

test('events prevent healing, drinking and prayer toggles', async () => {
    const { state, support, heal } = fixture();
    state.event = true;
    expect(await support.maintain()).toBe(false);
    expect(heal).not.toHaveBeenCalled();
    expect(state.drinks).toBe(0);
    expect(state.toggles).toEqual([]);
});


test('an event during dose reconciliation yields before healing or toggling protection', async () => {
    const { state, support, heal } = fixture();
    state.points = 0;
    state.pack.push(item(2434));
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { state.event = true; return true; });
    expect(await support.maintain()).toBe(false);
    heal.mockClear();
    state.event = false;
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        state.pack = [item(139), item(379, 2)];
        state.points = 17;
        state.event = true;
        return condition();
    });
    expect(await support.maintain()).toBe(false);
    expect(heal).not.toHaveBeenCalled();
    expect(state.toggles).toEqual([]);
});

test('standDown waits for an in-flight prayer enable then disables it', async () => {
    const { state, support } = fixture();
    let release!: () => void;
    let enabling!: () => void;
    const started = new Promise<void>(resolve => { enabling = resolve; });
    spyOn(Prayer, 'set').mockImplementation(async (_name, on) => {
        if (on) {
            enabling();
            await new Promise<void>(resolve => { release = resolve; });
        }
        state.toggles.push(on);
        state.active = on;
        return true;
    });
    const upkeep = support.maintain();
    await started;
    const stop = support.standDown();
    release();
    await upkeep;
    await stop;
    expect(state.toggles).toEqual([true, false]);
    expect(support.protected()).toBe(false);
});

test('a failed optional potion restore still permits the food fallback', async () => {
    const { state, support } = fixture();
    state.points = 0;
    state.pack.push(item(2434));
    spyOn(InvItem.prototype, 'interact').mockReturnValue(false);
    expect(await support.maintain()).toBe(true);
    expect(support.protected()).toBe(false);
    expect(state.toggles).toEqual([]);
});
