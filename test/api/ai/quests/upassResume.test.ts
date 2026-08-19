import { describe, expect, test } from 'bun:test';

import { UP_ITEM } from '#/bot/api/ai/quests/defs/upass/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/upass/index.js';
import { UP_FLAG, UP_STAGE } from '#/bot/api/ai/quests/defs/upass/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

// Why: the issue asks for a module resumable from any point, and `decide()` is a pure function of the snapshot — so that is provable without a client. This walks every stage against every place the quest can leave a character standing and asserts none of them parks.

type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const KIT: Stack[] = [
    [UP_ITEM.ROPE.id, 3],
    UP_ITEM.SHORTBOW.id,
    [UP_ITEM.BRONZE_ARROW.id, 50],
    UP_ITEM.TINDERBOX.id,
    UP_ITEM.SPADE.id,
    UP_ITEM.BUCKET.id,
    [UP_ITEM.LOBSTER.id, 14]
];

/** One tile in each pocket the quest can strand a character in, named as the classifier names it. */
const WHERE: Record<string, { x: number; z: number; level: number }> = {
    mainland: { x: 2655, z: 3283, level: 0 },
    westardougne: { x: 2500, z: 3300, level: 0 },
    area1: { x: 2450, z: 9716, level: 0 },
    area2: { x: 2400, z: 9620, level: 0 },
    gridpit: { x: 2400, z: 9560, level: 0 },
    main: { x: 2173, z: 4725, level: 1 },
    temple: { x: 2161, z: 4642, level: 1 },
    witch: { x: 2136, z: 4579, level: 1 },
    dwarves: { x: 2323, z: 9804, level: 0 },
    kalrag: { x: 2356, z: 9911, level: 0 }
};

function snapshot(stage: number, flags: string[], tile: { x: number; z: number; level: number }): QuestSnapshot {
    const carried: Stack[] = [...KIT];
    // Why: past the chest the doll is what every remaining step is keyed on, so a resume there holds one.
    if (stage >= UP_STAGE.FOUND_DOLL && stage < UP_STAGE.DEFEATED_IBAN) {
        carried.push(UP_ITEM.DOLL.id, UP_ITEM.GAUNTLETS.id);
    }
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(['rune scimitar']),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 0,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        stage,
        progress: { stage, flags: new Set(flags) },
        tile
    } as QuestSnapshot;
}

// Why: the pass is one-way, so most (stage, pocket) pairs cannot happen — the bridge is what sets stage 2, so stage 1 in the second cavern is not a resume anyone can be in, and the temple collapses behind the throw, so stage 9 back on the platforms is not either. Sweeping those would assert on states the quest cannot produce. This is where each stage can leave a character standing.
const REACHABLE: Record<number, string[]> = {
    [UP_STAGE.NOT_STARTED]: ['mainland', 'westardougne'],
    [UP_STAGE.SPOKEN_KOFTIK]: ['mainland', 'westardougne', 'area1'],
    [UP_STAGE.PASSED_BRIDGE]: ['area1'],
    [UP_STAGE.ENTERED_SECOND_AREA]: ['area1', 'area2', 'gridpit'],
    [UP_STAGE.KILLED_UNICORN]: ['area2', 'gridpit'],
    [UP_STAGE.ENTERED_MAIN_AREA]: ['main', 'witch', 'temple', 'dwarves'],
    [UP_STAGE.SPOKEN_NILHOOF]: ['main', 'witch', 'temple', 'dwarves'],
    [UP_STAGE.FOUND_DOLL]: ['main', 'witch', 'temple', 'dwarves', 'kalrag'],
    [UP_STAGE.CONFRONTED_IBAN]: ['main', 'witch', 'temple', 'dwarves', 'kalrag'],
    [UP_STAGE.DEFEATED_IBAN]: ['area2', 'area1', 'westardougne', 'mainland']
};

const STAGES = [
    UP_STAGE.NOT_STARTED, UP_STAGE.SPOKEN_KOFTIK, UP_STAGE.PASSED_BRIDGE, UP_STAGE.ENTERED_SECOND_AREA,
    UP_STAGE.KILLED_UNICORN, UP_STAGE.ENTERED_MAIN_AREA, UP_STAGE.SPOKEN_NILHOOF, UP_STAGE.FOUND_DOLL,
    UP_STAGE.CONFRONTED_IBAN, UP_STAGE.DEFEATED_IBAN
];

const DOLL_FLAGS = [
    UP_FLAG.ASHES_ON_DOLL, UP_FLAG.BLOOD_ON_DOLL, UP_FLAG.DOVE_ON_DOLL, UP_FLAG.SHADOW_ON_DOLL
];

/** Every subset of the four elements, plus the completion line the journal prints for the full set. */
function dollStates(): string[][] {
    const out: string[][] = [];
    for (let mask = 0; mask < 16; mask++) {
        const flags = DOLL_FLAGS.filter((_, bit) => (mask & (1 << bit)) !== 0);
        out.push(mask === 15 ? [...flags, UP_FLAG.DOLL_COMPLETE] : flags);
    }
    return out;
}

// Why: two stops are honest and have to stay reachable — a pack that cannot survive the pass, and a
// position the quest never puts anyone in. Everything else parking is a resume that cannot recover.
const ALLOWED = [/not equipped for the pass/, /reached from mainland/, /reached from westardougne/];

const kindOf = (step: unknown): string => (step as { kind: string }).kind;
const reasonOf = (step: unknown): string => (step as { reason?: string }).reason ?? '';

describe('Underground Pass resumability', () => {
    test('every stage in every pocket has something to do', () => {
        const parked: string[] = [];
        for (const stage of STAGES) {
            for (const name of REACHABLE[stage]!) {
                const step = decide(snapshot(stage, [UP_FLAG.STARTED], WHERE[name]!));
                if (kindOf(step) === 'wait' && !ALLOWED.some(ok => ok.test(reasonOf(step)))) {
                    parked.push(`stage ${stage} in ${name}: ${reasonOf(step)}`);
                }
            }
        }
        expect(parked).toEqual([]);
    });

    test('every combination of the four elements has a next step', () => {
        const parked: string[] = [];
        for (const flags of dollStates()) {
            for (const stage of [UP_STAGE.FOUND_DOLL, UP_STAGE.CONFRONTED_IBAN]) {
                for (const name of REACHABLE[stage]!) {
                    const step = decide(snapshot(stage, [UP_FLAG.STARTED, ...flags], WHERE[name]!));
                    if (kindOf(step) === 'wait' && !ALLOWED.some(ok => ok.test(reasonOf(step)))) {
                        parked.push(`${flags.length} element(s) at stage ${stage} in ${name}: ${reasonOf(step)}`);
                    }
                }
            }
        }
        expect(parked).toEqual([]);
    });

    // Why: a complete doll means the robes and the temple, and the gear step has to stand down over that
    // stretch or it re-wears the armour the doors refuse, every tick, forever.
    test('a complete doll never asks for armour back until Iban is dead', () => {
        for (const stage of [UP_STAGE.FOUND_DOLL, UP_STAGE.CONFRONTED_IBAN]) {
            for (const name of REACHABLE[stage]!) {
                const step = decide(snapshot(stage, [UP_FLAG.STARTED, ...DOLL_FLAGS, UP_FLAG.DOLL_COMPLETE], WHERE[name]!));
                expect((step as { name?: string }).name ?? '').not.toMatch(/^wear /);
            }
        }
    });
});
