import { expect, test } from 'bun:test';
import { gatherCakes, type CakeSupplyPort } from '#/bot/scripts/AIOQuester/cakeSupply.js';

function fixture() {
    const state = { cakes: 3, mixed: 27, eaten: 0, banked: 0, steals: 0, combat: false, hungry: false, fled: false };
    const port: CakeSupplyPort = {
        count: () => state.cakes,
        full: () => state.mixed >= 28,
        combat: () => state.combat,
        hungry: () => state.hungry,
        stopped: () => false,
        eat: async () => { state.eaten++; state.cakes--; state.hungry = false; },
        flee: async () => { state.fled = true; state.combat = false; },
        bank: async () => { state.banked++; state.mixed = 0; },
        steal: async abort => {
            while (!abort() && state.mixed < 28) { state.steals++; state.mixed++; if (state.steals % 2 === 0) state.cakes++; }
        }
    };
    return { state, port };
}

test('mixed stall loot banks without counting as the whole cake target', async () => {
    const { state, port } = fixture();
    for (let i = 0; i < 10 && state.cakes < 8; i++) await gatherCakes(port, 8);
    expect(state.cakes).toBe(8);
    expect(state.banked).toBe(1);
});

test('a completed cake target is not eaten away before returning to the quest', async () => {
    const { state, port } = fixture(); state.hungry = true;
    await gatherCakes(port, 3);
    expect(state.cakes).toBe(3);
    expect(state.eaten).toBe(0);
    expect(state.steals).toBe(0);
});

test('cake depletion from necessary healing is replenished before completion', async () => {
    const { state, port } = fixture(); state.hungry = true;
    for (let i = 0; i < 10 && state.cakes < 8; i++) await gatherCakes(port, 8);
    expect(state.cakes).toBe(8);
    expect(state.eaten).toBe(1);
});

test('caught stealing flees before banking or attempting another steal', async () => {
    const { state, port } = fixture(); state.combat = true;
    await gatherCakes(port, 8);
    expect(state.fled).toBe(true);
    expect(state.steals).toBe(0);
});
