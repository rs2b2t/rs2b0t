import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { fightGuardian } from '#/bot/api/ai/clues/Guardian.js';
import { GuardianProtection } from '#/bot/api/ai/clues/guardianKit.js';
import { SUPERANTI } from '#/bot/api/ai/clues/hardClueKit.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Special } from '#/bot/api/combat/Special.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

let tick: number;
let pack: InvItemSnapshot[];
let worn: InvItemSnapshot[];
let npcs: NpcSnapshot[];
let energy: number;
let armed: boolean;
let events: string[];
let advance: () => void;
function item(id: number, name: string, count = 1): InvItemSnapshot {
    return { id, name, count, slot: 0, comId: 1, ops: ['Drink', 'Eat', 'Wield'] };
}
beforeEach(() => {
    tick = 0; energy = 1000; armed = false; events = []; advance = () => {};
    pack = [item(185, 'Superantipoison(1)'), item(385, 'Shark', 15), item(1231, 'Dragon dagger(p)')];
    worn = [];
    npcs = [{ index: 4, id: 1, anim: -1, name: 'Saradomin Wizard', level: 65, size: 1,
        tile: { x: 3000, z: 3000, level: 0 }, distance: 1, ops: ['Attack'], inCombat: true,
        health: 40, totalHealth: 40, faceEntity: 32768 }];
    GameMessages.reset();
    ClueExecutor.retryGuardian();
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    spyOn(reader, 'npcs').mockImplementation(() => npcs);
    spyOn(reader, 'selfSlot').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Game, 'tick').mockImplementation(() => tick);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; advance(); });
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        const dds = pack.find(i => i.name === name);
        if (!dds) return false;
        worn = [{ ...dds, slot: 3 }]; pack = pack.filter(i => i !== dds);
        events.push(`equip:${tick}`); return true;
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        events.push(`drink:${tick}`);
        pack = pack.filter(i => i.id !== this.id);
        return true;
    });
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(Special, 'energy').mockImplementation(() => energy);
    spyOn(Special, 'armed').mockImplementation(() => armed);
    spyOn(Special, 'arm').mockImplementation(async () => { events.push(`special:${tick}`); armed = true; return true; });
    spyOn(Npc.prototype, 'interact').mockImplementation(() => {
        events.push(`attack:${tick}`);
        if (armed) { energy -= 250; armed = false; }
        npcs = npcs.map(n => ({ ...n, health: 0 }));
        return true;
    });
    Sustain.set(null);
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.retryGuardian(); });

test('equips DDS and confirms the final potion dose before the dig', async () => {
    const protection = new GuardianProtection();
    expect(await protection.prepare()).toBe(true);
    expect(worn[0].id).toBe(1231);
    expect(pack.some(i => i.id === 185)).toBe(false);
    expect(await protection.maintain()).toBe('ready');
});
test.each([false, true])('prepares and defeats a guardian with a dragon longsword: already worn %s', async alreadyWorn => {
    pack = pack.filter(i => i.id !== 1231);
    const sword = item(1305, 'Dragon longsword');
    if (alreadyWorn) worn = [{ ...sword, slot: 3 }];
    else pack.push(sword);
    const protection = new GuardianProtection();
    expect(await protection.prepare()).toBe(true);
    expect(worn[0].id).toBe(1305);
    expect(pack.some(i => i.id === 185)).toBe(false);
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };

    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('killed');
    expect(events.some(event => event.startsWith('attack:'))).toBe(true);
});
test.each([3, 4])('guardian preparation needs food above the escape reserve: %s Sharks', async count => {
    pack = pack.map(i => i.id === 385 ? { ...i, count } : i);
    expect(await new GuardianProtection().prepare()).toBe(count > 3);
    expect(InvItem.prototype.interact).toHaveBeenCalledTimes(count > 3 ? 1 : 0);
});
test.each([3, 4])('guardian stops before attacking with three escape Sharks: starts with %s', async count => {
    const protection = new GuardianProtection();
    await protection.prepare();
    pack = pack.map(i => i.id === 385 ? { ...i, count } : i);
    Sustain.set(async () => { pack = pack.map(i => i.id === 385 ? { ...i, count: 3 } : i); });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };

    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('supplies-needed');
    expect(Npc.prototype.interact).not.toHaveBeenCalled();
    expect(pack.find(i => i.id === 385)?.count).toBe(3);
});
test('does not trust a potion interaction without a dose change', async () => {
    spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    expect(await new GuardianProtection().prepare()).toBe(false);
    expect(InvItem.prototype.interact).toHaveBeenCalledTimes(3);
});
test.each([false, true])('retries a transient potion preparation failure: click returned %s', async sent => {
    const attempts: number[] = [];
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        attempts.push(tick);
        if (attempts.length === 1) return sent;
        pack = pack.filter(i => i.id !== this.id);
        return true;
    });
    const protection = new GuardianProtection();

    expect(await protection.prepare()).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(2);
    expect(await protection.maintain()).toBe('ready');
});
test('accepts a late final-dose confirmation without sending another drink', async () => {
    spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    advance = () => { pack = pack.filter(i => i.id !== 185); };
    const protection = new GuardianProtection();

    expect(await protection.prepare()).toBe(true);
    expect(InvItem.prototype.interact).toHaveBeenCalledTimes(1);
    expect(await protection.maintain()).toBe('ready');
});
test('stops preparation retries when upkeep reaches the escape food reserve', async () => {
    spyOn(InvItem.prototype, 'interact').mockReturnValue(false);
    Sustain.set(async () => { pack = pack.map(i => i.id === 385 ? { ...i, count: 3 } : i); });

    expect(await new GuardianProtection().prepare()).toBe(false);
    expect(InvItem.prototype.interact).toHaveBeenCalledTimes(1);
    expect(pack.find(i => i.id === 385)?.count).toBe(3);
});
test('refreshes before protection expires and cures a poison message', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    pack.push(item(185, 'Superantipoison(1)'));
    tick += 540;
    expect(await protection.maintain()).toBe('drank');
    pack.push(item(185, 'Superantipoison(1)'));
    GameMessages.record('You have been poisoned!');
    expect(await protection.maintain()).toBe('drank');
});
test('the first eaten Shark does not abort combat and DDS energy is spent', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    let eaten = false;
    Sustain.set(async () => {
        if (!eaten) {
            eaten = true; pack = pack.map(i => i.id === 385 ? { ...i, count: 14 } : i);
            events.push(`eat:${tick}`);
        }
    });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };
    const result = await fightGuardian('Saradomin Wizard', () => {}, protection);
    expect(result).toBe('killed');
    expect(energy).toBe(750);
    const bite = events.find(e => e.startsWith('eat:'))?.split(':')[1];
    expect(events).not.toContain(`attack:${bite}`);
});
test('death is not victory even when the guardian disappears', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    Sustain.set(async () => { GameMessages.record('Oh dear, you are dead!'); npcs = []; });
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('dead');
});
test('sends the initial DDS attack when only incoming combat is active', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    spyOn(Game, 'inCombat').mockReturnValue(true);
    advance = () => {
        if (npcs[0]?.health === 0 || tick > 8) npcs = [];
    };

    const result = await fightGuardian('Saradomin Wizard', () => {}, protection);

    expect(result).toBe('killed');
    expect(events.filter(e => e.startsWith('attack:'))).toHaveLength(1);
    expect(energy).toBe(750);
});
test('resumes attacking after eating cancels outgoing combat with retaliation off', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Special, 'ready').mockReturnValue(false);
    let attacking = false;
    let eaten = false;
    const attacks: number[] = [];
    spyOn(Npc.prototype, 'interact').mockImplementation(() => {
        attacks.push(tick);
        attacking = true;
        return true;
    });
    Sustain.set(async () => {
        if (attacking && !eaten) {
            eaten = true;
            attacking = false;
            pack = pack.map(i => i.id === 385 ? { ...i, count: 14 } : i);
        }
    });
    advance = () => {
        if (npcs[0]?.health === 0 || tick > 40) npcs = [];
        else if (attacking && eaten) npcs = npcs.map(n => ({ ...n, health: 0 }));
    };

    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('killed');
    expect(eaten).toBe(true);
    expect(attacks).toHaveLength(2);
    expect(attacks[1] - attacks[0]).toBeGreaterThanOrEqual(4);
    expect(attacks[1] - attacks[0]).toBeLessThanOrEqual(10);
});
test('bounds attack retries while incoming combat hides a stalled attack', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Special, 'ready').mockReturnValue(false);
    const attacks: number[] = [];
    spyOn(Npc.prototype, 'interact').mockImplementation(() => {
        attacks.push(tick);
        return true;
    });
    const end = tick + 25;
    advance = () => { if (tick >= end) npcs = []; };

    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('guardian-lost');
    expect(attacks.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < attacks.length; i++) {
        expect(attacks[i] - attacks[i - 1]).toBeGreaterThanOrEqual(4);
        expect(attacks[i] - attacks[i - 1]).toBeLessThanOrEqual(10);
    }
});
test('despawn without a witnessed death is not a kill', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    Sustain.set(async () => { npcs = []; });
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('guardian-lost');
});
test('a foreign guardian is never attacked', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    npcs = npcs.map(n => ({ ...n, faceEntity: 32769 }));
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('guardian-lost');
    expect(Npc.prototype.interact).not.toHaveBeenCalled();
});

test.each([1231, 185, 385])('executor refuses guarded spawning without %s', async id => {
    pack = [item(2723, 'Clue scroll (hard)'), ...pack.filter(i => i.id !== id)];
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(InvItem.prototype.interact).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(pack.some(i => i.id === 2723)).toBe(true);
});

function guardedTrail(): void {
    pack.push(item(2723, 'Clue scroll (hard)'), item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'), item(2576, 'Chart'));
    npcs = npcs.map(n => ({ ...n, name: 'Zamorak Wizard' }));
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { events.push(`walk:${tick}`); return true; });
}

test.each(['retry', 'prepared'])('yields before spawning a guardian when an event arrives during potion %s', async phase => {
    guardedTrail();
    let pending = false;
    let drinks = 0;
    let digs = 0;
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Dig') digs++;
        if (op === 'Drink') {
            drinks++;
            if (phase === 'retry') return false;
            pack = pack.filter(i => i.id !== this.id);
        }
        return true;
    });
    advance = () => { pending = true; };

    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(drinks).toBe(1);
    expect(digs).toBe(0);
    expect(Npc.prototype.interact).not.toHaveBeenCalled();
});

test.each([14, 15])('guarded trail permits a travel bite with %s Sharks before the leg', async count => {
    guardedTrail();
    pack = pack.map(i => i.id === 385 ? { ...i, count } : i);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        pack = pack.map(i => i.id === 385 ? { ...i, count: 14 } : i);
        return true;
    });
    let digs = 0;
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Drink') pack = pack.filter(i => i.id !== this.id);
        if (op === 'Dig' && ++digs === 2) pack = pack.map(i => i.id === 2723 ? { ...i, id: 2725 } : i);
        return true;
    });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };

    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(digs).toBe(2);
    expect(Npc.prototype.interact).toHaveBeenCalledTimes(1);
    expect(pack.find(i => i.id === 385)?.count).toBe(14);
});

test('guarded trail preserves three Sharks without spawning a guardian', async () => {
    guardedTrail();
    pack = pack.map(i => i.id === 385 ? { ...i, count: 3 } : i);

    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(InvItem.prototype.interact).not.toHaveBeenCalled();
    expect(pack.find(i => i.id === 385)?.count).toBe(3);
});

test('drinks near the dig, finishes the post-kill dig below fifteen, then requests restock', async () => {
    guardedTrail();
    let digs = 0;
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Drink') { events.push(`drink:${tick}`); pack = pack.filter(i => i.id !== this.id); }
        if (op === 'Dig') {
            digs++; events.push(`dig:${tick}`);
            if (digs === 2) pack = pack.map(i => i.id === 2723 ? { ...i, id: 2725 } : i);
        }
        return true;
    });
    Sustain.set(async () => {
        if (digs === 1) pack = pack.map(i => i.id === 385 ? { ...i, count: 14 } : i);
    });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(digs).toBe(2);
    expect(events.findIndex(e => e.startsWith('walk:'))).toBeLessThan(events.findIndex(e => e.startsWith('drink:')));
    expect(events.findIndex(e => e.startsWith('drink:'))).toBeLessThan(events.findIndex(e => e.startsWith('dig:')));
    expect(pack.some(i => i.id === 2725)).toBe(true);
});
test('death after spawning prevents every later dig until explicit retry', async () => {
    guardedTrail();
    let digs = 0;
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Drink') pack = pack.filter(i => i.id !== this.id);
        if (op === 'Dig') { digs++; GameMessages.record('Oh dear, you are dead!'); npcs = []; }
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('dead');
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('dead');
    expect(digs).toBe(1);
    expect(pack.some(i => i.id === 2723)).toBe(true);
});

test.each([[2448, 181], [181, 183], [183, 185], [185, 229]])('confirms dose transition %s to %s', async (id, nextId) => {
    pack = pack.map(i => i.id === 185 ? { ...i, id, name: SUPERANTI.find(d => d.id === id)?.name ?? '' } : i);
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        pack = pack.map(i => i.id === this.id ? { ...i, id: nextId, name: SUPERANTI.find(d => d.id === nextId)?.name ?? 'Vial' } : i);
        return true;
    });
    const protection = new GuardianProtection();
    expect(await protection.prepare()).toBe(true);
    expect(await protection.maintain()).toBe('ready');
});
test('a final dose remains valid until the conservative immunity bound', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    tick = 540;
    expect(await protection.maintain()).toBe('ready');
    tick = 570;
    expect(await protection.maintain()).toBe('supplies-needed');
});
test('does not trust an equip success without the DDS actually worn', async () => {
    spyOn(Equipment, 'equip').mockResolvedValue(true);
    expect(await new GuardianProtection().prepare()).toBe(false);
    expect(InvItem.prototype.interact).not.toHaveBeenCalled();
});
test('accepts a guardian appearing on the final spawn-wait tick', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    const guardian = npcs[0];
    npcs = [];
    const spawnAt = tick + 10;
    advance = () => {
        if (tick === spawnAt) npcs = [guardian];
        else if (npcs[0]?.health === 0) npcs = [];
    };

    const result = await fightGuardian('Saradomin Wizard', () => {}, protection);

    expect(result).toBe('killed');
});
test('holds the dig back until the potion delay has cleared on the server', async () => {
    await new GuardianProtection().prepare();
    expect(tick).toBe(3);
});
