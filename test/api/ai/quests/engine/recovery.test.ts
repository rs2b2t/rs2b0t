import { describe, expect, test } from 'bun:test';
import { tbwt } from '#/bot/api/ai/quests/defs/tbwt/index.js';
import { QuestBankReset, type QuestBankResetPort, type RecoveryItem } from '#/bot/api/ai/quests/engine/recovery.js';
import type { QuestModule, QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const item = (id: number, name: string | null, count = 1): RecoveryItem => ({ id, name, count });
const moduleFor = (extra: Partial<QuestModule> = {}): QuestModule => ({
    record: { id: 'imp', name: 'Imp Catcher', questPoints: 1, requirements: {}, items: [] },
    decide: () => ({ kind: 'done' }), ...extra
});
const snapshot = (): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 0,
    tile: { x: 3200, z: 3200, level: 0 }
});

class World implements QuestBankResetPort {
    pack: RecoveryItem[] = [item(779, 'Crest part'), item(780, 'Crest part'), item(605, 'Bone key'), item(1436, 'Rune essence', 20)];
    worn: RecoveryItem[] = [item(1333, 'Rune scimitar'), item(882, 'Bronze arrow', 100)];
    bank: RecoveryItem[] = [];
    open = false;
    deposits = 0;
    travel = 0;
    refuseDeposit = false;
    refuseWithdraw = false;
    refuseUnequip = false;
    sideReady = true;
    combat = false;
    position = { x: 3200, z: 3200, level: 0 };
    inventory = () => this.pack;
    equipment = () => this.worn;
    tile = () => this.position;
    inCombat = () => this.combat;
    async openBank() { this.travel++; this.open = true; return true; }
    async closeBank() { this.open = false; return true; }
    async bankInventory() { return this.open && this.sideReady ? this.pack : null; }
    async depositAll() {
        this.deposits++;
        if (this.refuseDeposit) return;
        for (const item of this.pack) this.add(this.bank, item);
        this.pack = [];
    }
    async unequip(id: number) {
        if (this.refuseUnequip) return false;
        const found = this.worn.find(item => item.id === id);
        if (found) this.add(this.pack, found);
        this.worn = this.worn.filter(item => item.id !== id);
        return true;
    }
    async withdraw(id: number, qty: number) {
        if (this.refuseWithdraw) return false;
        const found = this.bank.find(item => item.id === id);
        if (!found || found.count < qty) return false;
        this.add(this.pack, { ...found, count: qty });
        found.count -= qty;
        return true;
    }
    async equip(id: number) {
        const found = this.pack.find(item => item.id === id);
        if (!found) return false;
        this.add(this.worn, found);
        this.pack = this.pack.filter(item => item.id !== id);
        return true;
    }
    async runStep() { this.position = { x: 3201, z: 3200, level: 0 }; return true; }
    private add(items: RecoveryItem[], item: RecoveryItem) {
        const found = items.find(candidate => candidate.id === item.id);
        if (found) found.count += item.count;
        else items.push({ ...item });
    }
}
const log = () => {};

describe('QuestBankReset', () => {
    test('banks the entire loadout and restores exact quest IDs and equipped stack quantities', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(true);
        expect(world.pack).toEqual([]);
        expect(world.worn).toEqual([]);
        expect(world.bank.map(item => item.id)).toEqual([779, 780, 605, 1436, 1333, 882]);
        expect(await reset.restore(log)).toBe(true);
        expect(world.pack).toEqual([item(779, 'Crest part'), item(780, 'Crest part'), item(605, 'Bone key')]);
        expect(world.worn).toEqual([item(1333, 'Rune scimitar'), item(882, 'Bronze arrow', 100)]);
        expect(reset.pending).toBe(false);
    });

    test('Trio reset restores the current recipe and six mixed food portions', async () => {
        const world = new World();
        world.pack = [item(946, 'Knife'), item(303, 'Small fishing net'), item(3166, 'Monkey corpse'),
            item(401, 'Seaweed'), item(1891, 'Cake', 4), item(1893, '2/3 cake', 4)];
        const snap = { ...snapshot(), progress: { stage: 3, flags: new Set(['lubufu:31', 'tiadeche:4', 'tamayu:4', 'tinsay:4']) } };
        const reset = new QuestBankReset('Cake', world);
        expect(await reset.tick(tbwt, snap, log)).toBe(true);
        expect(world.pack).toEqual([item(3166, 'Monkey corpse'), item(401, 'Seaweed'), item(1891, 'Cake', 4), item(1893, '2/3 cake', 2)]);
        expect(world.worn).toEqual([item(1333, 'Rune scimitar'), item(882, 'Bronze arrow', 100)]);
        expect(world.bank.find(item => item.id === 946)?.count).toBe(1);
    });

    test('reports original exact-ID supplies across backpack and worn stacks for replenishment', async () => {
        const world = new World();
        world.pack.push(item(882, 'Bronze arrow', 50), item(995, 'Coins', 50000), item(99999, null));
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(true);
        expect(reset.supplies).toEqual([
            { item: 'Crest part', id: 779, count: 1 }, { item: 'Crest part', id: 780, count: 1 },
            { item: 'Bone key', id: 605, count: 1 }, { item: 'Bronze arrow', id: 882, count: 150 },
            { item: '#99999', id: 99999, count: 1 }, { item: 'Rune scimitar', id: 1333, count: 1 }
        ]);
    });

    test('does not require training expenses to be returned to the original coin stack', async () => {
        const world = new World();
        world.pack.push(item(995, 'Coins', 50000));
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(true);
        world.bank.find(item => item.id === 995)!.count = 1000;
        expect(await reset.restore(log)).toBe(true);
        expect(world.pack.some(item => item.id === 995)).toBe(false);
        expect(reset.pending).toBe(false);
        expect(reset.supplies).toEqual([]);
    });

    test('keeps the original snapshot across a partial deposit and a failed restore', async () => {
        const world = new World();
        world.refuseUnequip = true;
        const reset = new QuestBankReset(null, world);
        expect(await reset.tick(moduleFor(), snapshot(), log)).toBe(false);
        expect(reset.pending).toBe(true);
        expect(world.pack).toEqual([]);
        world.refuseUnequip = false;
        world.refuseWithdraw = true;
        expect(await reset.tick(moduleFor(), snapshot(), log)).toBe(false);
        world.refuseWithdraw = false;
        expect(await reset.tick(moduleFor(), snapshot(), log)).toBe(true);
        expect(world.pack.map(item => item.id)).toEqual([779, 780, 605]);
        expect(world.worn).toEqual([item(1333, 'Rune scimitar'), item(882, 'Bronze arrow', 100)]);
    });

    test('banks child equipment and inventory before restoring the quest loadout', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(true);
        world.pack = [item(1436, 'Rune essence', 28)];
        world.worn = [item(1265, 'Bronze pickaxe')];
        expect(await reset.restore(log)).toBe(true);
        expect(world.worn.map(item => item.id)).toEqual([1333, 882]);
        expect(world.pack.map(item => item.id)).toEqual([779, 780, 605]);
    });

    test('does not report a successful deposit when the bank backpack still holds items', async () => {
        const world = new World();
        world.refuseDeposit = true;
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(false);
        expect(reset.banked).toBe(false);
        expect(world.worn.length).toBe(2);
    });

    test('requires a ready bank backpack before removing equipment', async () => {
        const world = new World();
        world.sideReady = false;
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor(), snapshot(), log)).toBe(false);
        expect(world.deposits).toBe(0);
        expect(world.worn.length).toBe(2);
    });

    test.each([431, 723, 724, 725, 726])('refuses travel with fragile quest object %i', async id => {
        const world = new World();
        world.pack.push(item(id, 'Quest object'));
        const reset = new QuestBankReset(null, world);
        expect(await reset.tick(moduleFor(), snapshot(), log)).toBe(false);
        expect(reset.reason).toMatch(/rum|bowl/i);
        expect(world.travel).toBe(0);
        expect(reset.pending).toBe(false);
    });

    test('refuses a bank walk out of a quest pocket without a safe exit', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        expect(await reset.tick(moduleFor({ resumeAt: () => true }), snapshot(), log)).toBe(false);
        expect(reset.reason).toMatch(/exit/i);
        expect(world.travel).toBe(0);
    });

    test('does not treat a successful recovery action as proof that the quest pocket was exited', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        const module = moduleFor({ resumeAt: () => true, recover: () => ({ kind: 'custom', name: 'rescue', run: async () => true }) });
        expect(await reset.tick(module, snapshot(), log)).toBe(false);
        expect(world.travel).toBe(0);
    });

    test('runs an explicit exit before attempting any bank travel', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        const module = moduleFor({ resumeAt: tile => tile.x === 3200, exit: async () => { world.position.x = 3201; return true; } });
        expect(await reset.tick(module, snapshot(), log)).toBe(true);
        expect(world.position.x).toBe(3201);
    });

    test('does not run an end-of-quest exit when preparing an unstarted quest in the open', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        const module = moduleFor({ exit: async () => { throw new Error('end-of-quest exit'); } });
        expect(await reset.prepare(module, { ...snapshot(), journal: 'notStarted' }, log)).toBe(true);
    });

    test('does not run an end-of-quest exit for an in-progress quest on the surface', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        const module = moduleFor({ exit: async () => { throw new Error('end-of-quest exit'); } });
        expect(await reset.prepare(module, snapshot(), log)).toBe(true);
    });

    test('verifies an exit actually left the protected quest area', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        expect(await reset.prepare(moduleFor({ resumeAt: () => true, exit: async () => true }), snapshot(), log)).toBe(false);
        expect(world.travel).toBe(0);
        expect(reset.pending).toBe(false);
    });

    test('does not repeat quest exits after a partial bank reset', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        world.position.z = 9600;
        let exits = 0;
        const module = moduleFor({ exit: async () => ++exits === 1 });
        world.refuseUnequip = true;
        expect(await reset.prepare(module, snapshot(), log)).toBe(false);
        world.refuseUnequip = false;
        expect(await reset.tick(module, snapshot(), log)).toBe(true);
        expect(world.pack.map(item => item.id)).toEqual([779, 780, 605]);
    });

    test('propagates cancellation and retains restoration state', async () => {
        const world = new World();
        const reset = new QuestBankReset(null, world);
        const abort = new Error('Aborted');
        world.depositAll = async () => { throw abort; };
        await expect(reset.prepare(moduleFor(), snapshot(), log)).rejects.toBe(abort);
        expect(reset.pending).toBe(true);
    });
});
