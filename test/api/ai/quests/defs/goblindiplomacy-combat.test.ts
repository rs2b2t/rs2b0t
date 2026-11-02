import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type NpcSnapshot, type GroundItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { farmGoblinMail, resetGoblinMailCombat } from '#/bot/api/ai/quests/defs/goblindiplomacy/combat.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';

const realCanReach = Reachability.canReach;

afterEach(() => { mock.restore(); resetGoblinMailCombat(); });

function goblin(index = 1, faceEntity = -1): NpcSnapshot {
    return {
        index, id: 101, name: 'Goblin', level: 5, size: 1, anim: -1,
        tile: { x: 2957 + index, z: 3507, level: 0 }, distance: index,
        ops: ['Talk-to', 'Attack'], inCombat: false, health: 5, totalHealth: 5, faceEntity
    };
}

function fixture(npcs = [goblin()]) {
    resetGoblinMailCombat();
    const state = {
        now: 1000, npcs, face: -1, anim: -1, xp: 0, hp: 20, inCombat: false,
        mail: 0, ground: [] as GroundItemSnapshot[], attacks: [] as number[], walks: 0,
        sustained: 0, progress: 0, interrupted: false, advance: () => {}, attack: () => {},
        blocked: new Set<number>(), unprobeable: new Set<number>()
    };
    spyOn(performance, 'now').mockImplementation(() => state.now);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    spyOn(reader, 'selfFaceEntity').mockImplementation(() => state.face);
    spyOn(reader, 'selfAnim').mockImplementation(() => state.anim);
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 1, lz: 1 });
    spyOn(Game, 'myName').mockReturnValue('combat-test');
    spyOn(Game, 'tile').mockReturnValue({ x: 2958, z: 3507, level: 0 });
    spyOn(Game, 'inCombat').mockImplementation(() => state.inCombat);
    spyOn(Reachability, 'probeable').mockImplementation(tile => !state.unprobeable.has(tile.x));
    spyOn(Reachability, 'canReach').mockImplementation(tile => !state.blocked.has(tile.x));
    spyOn(Skills, 'xp').mockImplementation(() => state.xp);
    spyOn(Skills, 'effective').mockImplementation(() => state.hp);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Goblin mail' ? state.mail : 0);
    spyOn(Sustain, 'run').mockImplementation(async () => { state.sustained++; });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.interrupted);
    spyOn(Execution, 'noteProgress').mockImplementation(() => { state.progress++; });
    spyOn(Execution, 'delayTicks').mockImplementation(async ticks => {
        state.now += ticks * 600;
        state.advance();
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { state.walks++; return false; });
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        state.attacks.push(index);
        state.attack();
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.mail++; state.ground = []; return true; });
    return state;
}

test('missing health bars and repeated misses keep one encounter alive until the goblin dies', async () => {
    const state = fixture();
    state.attack = () => { state.face = 1; state.npcs[0].faceEntity = 32775; };
    state.advance = () => {
        state.anim = state.anim === -1 ? 422 : -1;
        if (state.now >= 13000) state.npcs[0].health = 0;
    };
    await farmGoblinMail(() => {});
    expect(state.npcs[0].health).toBe(0);
    expect(state.attacks).toEqual([1]);
    expect(state.walks).toBe(0);
    expect(state.sustained).toBeGreaterThan(8);
    expect(state.progress).toBeGreaterThan(0);
});

test('incoming hits and stale facing do not suppress resuming our attack after eating', async () => {
    const state = fixture([goblin(1, 32775)]);
    state.inCombat = true;
    state.advance = () => {
        state.hp--;
        state.npcs[0].anim = state.npcs[0].anim === -1 ? 618 : -1;
        if (state.attacks.length >= 2) {
            state.face = 1;
            state.anim = 422;
            state.npcs[0].health = 0;
        }
    };
    await farmGoblinMail(() => {});
    expect(state.attacks).toEqual([1, 1]);
    expect(state.npcs[0].health).toBe(0);
});

test('eating animations with our stale face target do not count as attacks', async () => {
    const state = fixture([goblin(1, 32775)]);
    state.face = 1;
    state.advance = () => {
        state.anim = state.anim === -1 ? 829 : -1;
        if (state.attacks.length >= 2) state.npcs[0].health = 0;
    };
    await farmGoblinMail(() => {});
    expect(state.attacks).toEqual([1, 1]);
    expect(state.npcs[0].health).toBe(0);
});

test('stale combat flags time out and allow another target without inventing progress', async () => {
    const state = fixture([goblin(1, 32775), goblin(2)]);
    state.inCombat = true;
    await farmGoblinMail(() => {});
    expect(state.now).toBeGreaterThanOrEqual(16000);
    expect(state.now).toBeLessThanOrEqual(65000);
    expect(state.progress).toBe(0);
    state.npcs[0].faceEntity = -1;
    state.advance = () => { state.npcs[1].health = 0; };
    await farmGoblinMail(() => {});
    expect(state.attacks.at(-1)).toBe(2);
});

test('targets our attacker before idle goblins and never attacks another player\'s target', async () => {
    const state = fixture([goblin(1, 32776), goblin(2), goblin(3, 32775)]);
    state.npcs[2].inCombat = true;
    state.advance = () => { state.npcs[2].health = 0; };
    await farmGoblinMail(() => {});
    expect(state.attacks).toEqual([3]);
});

test('a target switching to another player ends our encounter without another attack', async () => {
    const state = fixture();
    state.advance = () => { state.npcs[0].faceEntity = 32776; };
    await farmGoblinMail(() => {});
    expect(state.attacks).toEqual([1]);
    expect(state.now).toBeLessThan(5000);
});

test('target death yields for loot and collects mail before selecting another goblin', async () => {
    const state = fixture();
    state.advance = () => {
        state.npcs = [];
        state.ground = [{ id: 288, name: 'Goblin mail', count: 1, tile: { x: 2958, z: 3507, level: 0 }, distance: 1, ops: ['Take'] }];
    };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.mail).toBe(1);
    expect(state.attacks).toEqual([1]);
    expect(state.walks).toBe(0);
});

test('a confirmed goblin kill succeeds even when no mail drops', async () => {
    const state = fixture();
    state.advance = () => { state.npcs[0].health = 0; };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.mail).toBe(0);
    expect(state.attacks).toEqual([1]);
});

test('a living goblin leaving attack range is not a kill or progress', async () => {
    const state = fixture();
    state.advance = () => { state.npcs[0].distance = 16; };
    expect(await farmGoblinMail(() => {})).toBe(false);
    expect(state.progress).toBe(0);
    expect(state.npcs[0].health).toBe(5);
});

test('losing sight of a goblin without a corpse or loot does not confirm a kill', async () => {
    const state = fixture();
    state.advance = () => { state.npcs = []; };
    expect(await farmGoblinMail(() => {})).toBe(false);
    expect(state.progress).toBe(0);
});

test('an interrupt yields a live encounter for random events or skip', async () => {
    const state = fixture();
    state.advance = () => { state.interrupted = true; };
    expect(await farmGoblinMail(() => {})).toBe(false);
    expect(state.now).toBeLessThan(5000);
});

test('a goblin behind a wall is skipped for a reachable field target', async () => {
    const state = fixture([goblin(1), goblin(2)]);
    state.blocked.add(2958);
    state.advance = () => { state.npcs[1].health = 0; };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.attacks).toEqual([2]);
    expect(state.now).toBeLessThan(5000);
});

test('all blocked targets produce one bounded walk without attacking a wall', async () => {
    const state = fixture();
    state.blocked.add(2958);
    expect(await farmGoblinMail(() => {})).toBe(false);
    expect(state.attacks).toEqual([]);
    expect(state.walks).toBe(1);
    expect(state.now).toBeLessThan(5000);
    expect(state.progress).toBe(0);
});

test('a streaming scene walks and retries without rejecting its unprobeable target', async () => {
    const state = fixture();
    state.unprobeable.add(2958);
    expect(await farmGoblinMail(() => {})).toBe(false);
    expect(state.attacks).toEqual([]);
    expect(state.walks).toBe(1);
    state.unprobeable.clear();
    state.advance = () => { state.npcs[0].health = 0; };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.attacks).toEqual([1]);
});

test.each([12, 15])('real scene search reaches a goblin %i tiles away', async distance => {
    const target = goblin();
    target.tile.x += distance;
    target.distance = distance;
    const state = fixture([target]);
    spyOn(Reachability, 'canReach').mockImplementation(realCanReach);
    spyOn(reader, 'worldTile').mockReturnValue({ x: 2958, z: 3507, level: 0 });
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 2908, lz: z - 3457 }));
    spyOn(reader, 'collisionFlags').mockImplementation((x, z) => x >= 0 && x < 104 && z >= 0 && z < 104 ? 0 : null);
    state.advance = () => { target.health = 0; };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.attacks).toEqual([1]);
    expect(state.walks).toBe(0);
});

test('real scene search follows a modest detour to a goblin at the scan boundary', async () => {
    const target = goblin();
    target.tile.x += 15;
    target.distance = 15;
    const state = fixture([target]);
    spyOn(Reachability, 'canReach').mockImplementation(realCanReach);
    spyOn(reader, 'worldTile').mockReturnValue({ x: 2958, z: 3507, level: 0 });
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 2908, lz: z - 3457 }));
    spyOn(reader, 'collisionFlags').mockImplementation((x, z) => {
        if (x < 0 || x >= 104 || z < 0 || z >= 104) return null;
        return x === 52 && z >= 42 && z <= 58 ? CollisionFlag.SQ_BLOCKED : 0;
    });
    state.advance = () => { target.health = 0; };
    expect(await farmGoblinMail(() => {})).toBe(true);
    expect(state.attacks).toEqual([1]);
    expect(state.walks).toBe(0);
});
