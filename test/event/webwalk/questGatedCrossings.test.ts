import { describe, expect, test } from 'bun:test';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import { postQuestTalkFor } from '#/bot/event/webwalk/data/postQuestTalks.js';
import { TRANSPORT_QUEST_SEEDS } from '#/bot/event/webwalk/transportQuestReqs.js';
import type { QuestProgress, WorldState } from '#/bot/event/webwalk/types.js';

function world(quests: Record<string, QuestProgress>, worn: string[] = []): WorldState {
    return {
        skillLevel: () => 99,
        questStatus: (q: string) => quests[q] ?? 'not_started',
        itemCount: () => 0,
        wornCount: (n: string) => (worn.includes(n) ? 1 : 0),
        freeSlots: 28,
        entranaRestrictedGear: false,
        members: true
    } as unknown as WorldState;
}

// Why: Paterdomus is the only way into Morytania, so an ungated route sends every Morytania destination to a barrier the player cannot pass.
describe('Priest in Peril crossings', () => {
    const gate1 = { x: 3405, z: 9895, level: 0 }; // pip_underground_door1
    const gate2 = { x: 3431, z: 9897, level: 0 }; // pip_underground_door2
    const barrier = { x: 3440, z: 9887, level: 0 }; // holy barrier `from` tile

    for (const [name, tile, need] of [
        ['tunnel gate 1', gate1, 'started'],
        ['tunnel gate 2', gate2, 'started'],
        ['Salve holy barrier', barrier, 'complete']
    ] as const) {
        test(`${name} is gated on Priest in Peril ${need}`, () => {
            const req = specialRequiresAt(tile.x, tile.z, tile.level);
            expect(req?.quests).toEqual([{ quest: 'Priest in Peril', minStatus: need }]);
        });
    }

    test('a fresh account cannot plan through any of them', () => {
        const fresh = world({});
        for (const tile of [gate1, gate2, barrier]) {
            const req = specialRequiresAt(tile.x, tile.z, tile.level)!;
            expect(meetsRequires(req, fresh).ok).toBe(false);
        }
    });

    test('starting the quest opens the tunnel but not the barrier', () => {
        const started = world({ 'Priest in Peril': 'started' });
        expect(meetsRequires(specialRequiresAt(gate1.x, gate1.z, 0)!, started).ok).toBe(true);
        expect(meetsRequires(specialRequiresAt(gate2.x, gate2.z, 0)!, started).ok).toBe(true);
        expect(meetsRequires(specialRequiresAt(barrier.x, barrier.z, 0)!, started).ok).toBe(false);
    });

    test('completing it opens everything — a finished player still routes', () => {
        const done = world({ 'Priest in Peril': 'complete' });
        for (const tile of [gate1, gate2, barrier]) {
            expect(meetsRequires(specialRequiresAt(tile.x, tile.z, 0)!, done).ok).toBe(true);
        }
    });

    test('the barrier carries the post-quest talk that completion alone misses', () => {
        // holy_barrier.rs2 wants %priestperil 61; the journal reads complete at 60.
        const talk = postQuestTalkFor(3440, 9886, 0);
        expect(talk?.npc).toBe('Drezel');
        expect(talk?.requireComplete).toBe('Priest in Peril');
    });

    test('the quest is seedable, so harnesses can walk it both ways', () => {
        expect(TRANSPORT_QUEST_SEEDS.some(s => s.journal === 'Priest in Peril')).toBe(true);
    });
});

/**
 * `plaguesewerpipe` checks the gas mask in the *hat slot*, not the pack, and
 * only past `^quest_elena_opened_pipe`. The pack asked for one carried.
 */
describe('West Ardougne sewer pipe', () => {
    const pipe = { x: 2530, z: 9703, level: 0 };

    test('needs Plague City started and the mask worn', () => {
        const req = specialRequiresAt(pipe.x, pipe.z, pipe.level)!;
        expect(req.quests).toEqual([{ quest: 'Plague City', minStatus: 'started' }]);
        expect(req.worn).toEqual([{ name: 'Gas mask', count: 1 }]);
    });

    test('carrying the mask without the quest is not enough', () => {
        const req = specialRequiresAt(pipe.x, pipe.z, pipe.level)!;
        expect(meetsRequires(req, world({}, ['Gas mask'])).ok).toBe(false);
        expect(meetsRequires(req, world({ 'Plague City': 'started' })).ok).toBe(false);
        expect(meetsRequires(req, world({ 'Plague City': 'started' }, ['Gas mask'])).ok).toBe(true);
    });
});

/** Offline probes carry no WorldState, so pack-tool parity must not move. */
describe('pack parity', () => {
    test('gates are absent from tiles that never had one', () => {
        expect(specialRequiresAt(3200, 3200, 0)).toBeUndefined();
    });
});
