import { expect, spyOn, test } from 'bun:test';
import { enterDragonShop, gameZanarisPort, leaveZanaris, type ZanarisPort } from '#/bot/scripts/AccountLeveler/zanaris.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { auditDragonWeapons } from '#/bot/scripts/AccountLeveler/dragonWeapons.js';
import { enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 60])), target: 60, now: 1000,
    bankReady: true, wilderness: false, quests: { 'Lost City': true },
    stock: { coins: 1000000, diamond: 1, 'dramen staff': 1 }
});

test('weapon audit buys both once at Attack 60 while preserving the existing cash reserve', () => {
    const s = snapshot();
    s.stock.coins = 150000;
    expect(auditDragonWeapons(s).needs).toEqual([{ item: 'Dragon longsword', count: 1 }, { item: 'Dragon dagger', count: 1 }]);
    expect(auditDragonWeapons(s).budget + auditDragonWeapons(s).reserve).toBeLessThanOrEqual(s.stock.coins);
    s.stock['dragon dagger'] = 1;
    expect(auditDragonWeapons(s).needs).toEqual([{ item: 'Dragon longsword', count: 1 }]);
    s.stock['dragon longsword'] = 1;
    expect(auditDragonWeapons(s).needs).toEqual([]);
});

test('weapon audit defers locked, inaccessible, failed and unaffordable purchases', () => {
    const s = snapshot();
    s.levels.attack = 59;
    expect(auditDragonWeapons(s).needs).toEqual([]);
    s.levels.attack = 60; s.quests['Lost City'] = false;
    expect(auditDragonWeapons(s).needs).toEqual([]);
    s.quests['Lost City'] = true; delete s.stock.diamond;
    expect(auditDragonWeapons(s).skipped.join(' ')).toContain('Diamond');
    s.stock.diamond = 1; s.stock.coins = 200;
    expect(auditDragonWeapons(s).needs).toEqual([]);
    s.stock.coins = 1000000; s.unavailableItems = ['dragon dagger', 'dragon longsword'];
    expect(auditDragonWeapons(s).needs).toEqual([]);
});

test('a usable uncut Diamond adds affordable chisel preparation before buying weapons', () => {
    const s = snapshot();
    delete s.stock.diamond; s.stock['uncut diamond'] = 1;
    expect(auditDragonWeapons(s).needs).toEqual([{ item: 'Chisel', count: 1 }, { item: 'Dragon longsword', count: 1 }, { item: 'Dragon dagger', count: 1 }]);
    s.levels.crafting = 42;
    expect(auditDragonWeapons(s).needs).toEqual([]);
});

function fixture(start = { x: 3200, z: 3169, level: 0 }) {
    let tile = start;
    let diamond = 1;
    let completed = true;
    let teleport = false;
    let staff = false;
    const events: string[] = [];
    const port: ZanarisPort = {
        tile: () => tile,
        complete: () => completed,
        held: name => name === 'Diamond' ? diamond : name === 'Dramen staff' ? 1 : 0,
        wearingStaff: () => staff,
        equipStaff: async () => { staff = true; events.push('staff'); return true; },
        prepareExit: async () => true,
        teleport: async () => { if (teleport) { tile = { x: 3210, z: 3424, level: 0 }; events.push('teleport'); } return teleport; },
        walk: async target => { tile = target; events.push(`walk:${target.x},${target.z}`); return true; },
        interact: async id => { events.push(`open:${id}`); if (id === 2406) tile = { x: 3220, z: 9592, level: 0 }; return true; },
        dialog: async prefer => {
            events.push(prefer[0]);
            if (prefer[0] === 'Okay...') { diamond--; tile = { x: 3238, z: 9558, level: 0 }; }
            else tile = { x: 3260, z: 3171, level: 0 };
            return true;
        },
        wait: async condition => condition()
    };
    return { port, events, lock: () => completed = false, noDiamond: () => diamond = 0, teleport: () => teleport = true };
}

test('shop access equips the staff, pays one gate tax and leaves through the dialogue ladder', async () => {
    const f = fixture();
    expect(await enterDragonShop(f.port)).toBe(true);
    expect(await leaveZanaris(f.port)).toBe(true);
    expect(f.events).toEqual(['staff', 'walk:3201,3169', 'open:2406', 'walk:3237,9558', 'open:2411', 'Okay...', 'walk:3252,9572', 'walk:3253,9592', 'open:2410', "Yes, I'm ready to leave."]);
});

test('an account already inside the market does not pay another diamond', async () => {
    const f = fixture({ x: 3252, z: 9572, level: 0 });
    f.noDiamond();
    expect(await enterDragonShop(f.port)).toBe(true);
    expect(f.events).toEqual(['walk:3252,9572']);
});

test('unknown completion never enters Zanaris and missing tax never opens the market door', async () => {
    const locked = fixture(); locked.lock();
    expect(await enterDragonShop(locked.port)).toBe(false);
    expect(locked.events).toEqual([]);
    const noTax = fixture({ x: 3220, z: 9592, level: 0 }); noTax.noDiamond();
    expect(await enterDragonShop(noTax.port)).toBe(false);
    expect(noTax.events).toEqual([]);
});

test('a prepared teleport leaves the city without spending a Diamond', async () => {
    const f = fixture({ x: 3220, z: 9592, level: 0 }); f.teleport(); f.noDiamond();
    expect(await leaveZanaris(f.port)).toBe(true);
    expect(f.events).toEqual(['teleport']);
});

test('exit preparation banks a full pack before withdrawing its travel item', async () => {
    let pack: Record<string, number> = { Logs: 27, Tinderbox: 1 };
    let used = 28;
    const patches = [
        spyOn(Quests, 'status').mockReturnValue('complete'),
        spyOn(Bank, 'isOpen').mockReturnValue(true),
        spyOn(Bank, 'waitReady').mockResolvedValue(true),
        spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined),
        spyOn(Bank, 'depositInventory').mockImplementation(async () => { pack = {}; used = 0; }),
        spyOn(Bank, 'count').mockImplementation(name => name === 'Diamond' ? 1 : 0),
        spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => { if (used === 28) return false; pack[name] = count; used++; return true; }),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(Inventory, 'used').mockImplementation(() => used),
        spyOn(Inventory, 'count').mockImplementation(name => pack[name] ?? 0),
        spyOn(Skills, 'level').mockReturnValue(1),
        spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition())
    ];
    try {
        expect(await gameZanarisPort(() => {}).prepareExit()).toBe(true);
        expect(pack).toEqual({ Diamond: 1 });
    } finally { for (const patch of patches) patch.mockRestore(); }
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('Zanaris travel stands are reachable on each side of the paid market gate', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    const tile = (x: number, z: number) => ({ x, z, level: 0 });
    for (const [from, to] of [
        [tile(3220, 9592), tile(3237, 9558)],
        [tile(3238, 9558), tile(3252, 9572)],
        [tile(3252, 9572), tile(3253, 9592)]
    ]) {
        const route = finder.findPath(from, to);
        expect(route.ok).toBe(true);
        if (route.ok) expect(route.waypoints.at(-1)).toEqual(to);
    }
    expect(finder.findPath(tile(3220, 9592), tile(3253, 9592)).ok).toBe(false);
});
