import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { fightGuardian, GuardianEncounter } from '#/bot/api/ai/clues/Guardian.js';
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
import Tile from '#/bot/geometry/Tile.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
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
    ClueExecutor.resetSession();
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
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); });

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
    pack = [item(3526, 'Clue scroll (hard)'), ...pack.filter(i => i.id !== id)];
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(InvItem.prototype.interact).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(pack.some(i => i.id === 3526)).toBe(true);
});

function guardedTrail(guardian = 'Saradomin Wizard', clue = 3526): void {
    pack.push(item(clue, 'Clue scroll (hard)'), item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'), item(2576, 'Chart'));
    npcs = npcs.map(n => ({ ...n, name: guardian }));
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { events.push(`walk:${tick}`); return true; });
}

test('hard sextant012 digs at 3054,3696 before and after chasing its wizard', async () => {
    guardedTrail();
    pack = pack.map(i => i.id === 3526 ? { ...i, id: 2745 } : i);
    let here = new Tile(3053, 3696, 0);
    let pending = false;
    const digs: Tile[] = [];
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(GuardianProtection.prototype, 'prepare').mockResolvedValue(true);
    spyOn(GuardianEncounter.prototype, 'fight').mockImplementation(async () => {
        here = new Tile(3056, 3697, 0);
        return 'killed';
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async (dest, opts) => {
        here = new Tile(dest.x + opts.radius, dest.z, dest.level);
        return true;
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op) {
        if (this.id !== 952 || op !== 'Dig') return false;
        digs.push(here);
        if (digs.length === 2) {
            pack = pack.map(i => i.id === 2745 ? { ...i, id: 2746 } : i);
            pending = true;
        }
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(digs).toEqual([new Tile(3054, 3696, 0), new Tile(3054, 3696, 0)]);
    expect(pack.some(i => i.id === 2746)).toBe(true);
});

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
        if (op === 'Dig' && ++digs === 2) pack = pack.map(i => i.id === 3526 ? { ...i, id: 3528 } : i);
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
            if (digs === 2) pack = pack.map(i => i.id === 3526 ? { ...i, id: 3528 } : i);
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
    expect(pack.some(i => i.id === 3528)).toBe(true);
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
    expect(pack.some(i => i.id === 3526)).toBe(true);
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

test.each([3, 20])('walks to an owned guardian displaced by %s tiles before attacking', async distance => {
    const protection = new GuardianProtection();
    await protection.prepare();
    npcs = npcs.map(n => ({ ...n, distance, tile: { x: 3000 + distance, z: 3000, level: 0 } }));
    const walk = spyOn(Traversal, 'walkTo').mockImplementation(async (_dest, opts) => {
        expect(opts?.useTeleportCatalog).toBe(false);
        expect(opts?.policy?.useTeleports).toBe(false);
        npcs = npcs.map(n => ({ ...n, distance: 1 }));
        return true;
    });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('killed');
    expect(walk).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.startsWith('attack:'))).toBe(true);
});

test('does not chase a displaced guardian belonging to another player', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    npcs = npcs.map(n => ({ ...n, distance: 20, faceEntity: 32769 }));
    const walk = spyOn(Traversal, 'walkTo').mockResolvedValue(true);
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('guardian-lost');
    expect(walk).not.toHaveBeenCalled();
    expect(events.some(e => e.startsWith('attack:'))).toBe(false);
});

test.each(['blocked', 'event', 'death'] as const)('guardian approach handles %s without attacking', async outcome => {
    const protection = new GuardianProtection();
    await protection.prepare();
    npcs = npcs.map(n => ({ ...n, distance: 3 }));
    spyOn(Traversal, 'walkTo').mockImplementation(async () => {
        if (outcome === 'event') spyOn(EventSignal, 'pending').mockReturnValue(true);
        if (outcome === 'death') GameMessages.record('Oh dear, you are dead!');
        return false;
    });
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe(outcome === 'event' ? 'yield' : outcome === 'death' ? 'dead' : 'guardian-lost');
    expect(events.some(e => e.startsWith('attack:'))).toBe(false);
});


test('walks around a fence to a reachable melee tile instead of attacking through it', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    let here = new Tile(3055, 3696, 0);
    const mage = new Tile(3056, 3696, 0);
    const stand = new Tile(3056, 3697, 0);
    npcs = npcs.map(n => ({ ...n, distance: 1, tile: mage }));
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Reachability, 'probeable').mockReturnValue(true);
    spyOn(Reachability, 'canStep').mockImplementation(from => from.x === stand.x && from.z === stand.z);
    spyOn(Reachability, 'canReach').mockImplementation(tile => tile.x === stand.x && tile.z === stand.z);
    const walk = spyOn(Traversal, 'walkTo').mockImplementation(async (tile, opts) => {
        expect(tile).toEqual(stand);
        expect(opts?.radius).toBe(0);
        expect(opts?.policy?.useTeleports).toBe(false);
        here = stand;
        return true;
    });
    const attack = spyOn(Npc.prototype, 'interact').mockImplementation(() => {
        expect(here).toEqual(stand);
        npcs = npcs.map(n => ({ ...n, health: 0 }));
        return true;
    });
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('killed');
    expect(walk).toHaveBeenCalledTimes(1);
    expect(attack).toHaveBeenCalledTimes(1);
});

test('an enclosed guardian with no reachable melee tile requests recovery without attacking', async () => {
    const protection = new GuardianProtection();
    await protection.prepare();
    spyOn(Game, 'tile').mockReturnValue(new Tile(2999, 3000, 0));
    spyOn(Reachability, 'probeable').mockReturnValue(true);
    spyOn(Reachability, 'canStep').mockReturnValue(false);
    const walk = spyOn(Traversal, 'walkTo').mockResolvedValue(false);
    expect(await fightGuardian('Saradomin Wizard', () => {}, protection)).toBe('guardian-lost');
    expect(walk).not.toHaveBeenCalled();
    expect(events.some(e => e.startsWith('attack:'))).toBe(false);
});

for (const hasPotion of [false, true]) {
    test(`Zamorak preparation and prolonged combat never drink or require antipoison: carried ${hasPotion}`, async () => {
        if (!hasPotion) pack = pack.filter(i => i.id !== 185);
        const protection = new GuardianProtection('Zamorak Wizard');
        expect(await protection.prepare()).toBe(true);
        expect(await protection.maintain()).toBe('ready');
        tick += 600;
        expect(await protection.maintain()).toBe('ready');
        expect(events.filter(e => e.startsWith('drink:'))).toEqual([]);
        expect(worn[0].id).toBe(1231);
    });

    test(`Zamorak clue completes both digs without consuming a dose: carried ${hasPotion}`, async () => {
        guardedTrail('Zamorak Wizard', 2723);
        if (!hasPotion) pack = pack.filter(i => i.id !== 185);
        let digs = 0;
        let pending = false;
        spyOn(EventSignal, 'pending').mockImplementation(() => pending);
        spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
            if (op === 'Drink') { events.push(`drink:${tick}`); pack = pack.filter(i => i.id !== this.id); }
            if (op === 'Dig' && ++digs === 2) { pack = pack.map(i => i.id === 2723 ? { ...i, id: 2724 } : i); pending = true; }
            return true;
        });
        advance = () => { if (npcs[0]?.health === 0) npcs = []; };
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
        expect(digs).toBe(2);
        expect(events.filter(e => e.startsWith('drink:'))).toEqual([]);
        expect(pack.some(i => i.id === 185)).toBe(hasPotion);
        expect(pack.some(i => i.id === 2724)).toBe(true);
    });
}

test.each(['function', 'encounter'])('default %s guardian entry does not drink against Zamorak', async entry => {
    worn = [{ ...item(1305, 'Dragon longsword'), slot: 3 }];
    npcs = npcs.map(n => ({ ...n, name: 'Zamorak Wizard' }));
    advance = () => { if (npcs[0]?.health === 0) npcs = []; };
    const result = entry === 'function' ? await fightGuardian('Zamorak Wizard', () => {})
        : await new GuardianEncounter('Zamorak Wizard').fight(() => {});
    expect(result).toBe('killed');
    expect(events.filter(e => e.startsWith('drink:'))).toEqual([]);
    expect(pack.some(i => i.id === 185)).toBe(true);
});
