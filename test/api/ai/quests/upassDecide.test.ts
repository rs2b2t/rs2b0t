import { describe, expect, test } from 'bun:test';

import { UP_ITEM } from '#/bot/api/ai/quests/defs/upass/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/upass/index.js';
import { UP_FLAG, UP_STAGE } from '#/bot/api/ai/quests/defs/upass/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

// Why: decide() reads only a snapshot, so every branch of the routing table is testable without a client.
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const ARDOUGNE = { x: 2655, z: 3283, level: 0 };
const WEST_ARDOUGNE = { x: 2500, z: 3300, level: 0 };
const AREA1 = { x: 2450, z: 9716, level: 0 };

/** The kit the module refuses to go underground without. */
const KIT: Stack[] = [
    [UP_ITEM.ROPE.id, 3],
    UP_ITEM.SHORTBOW.id,
    [UP_ITEM.BRONZE_ARROW.id, 50],
    UP_ITEM.TINDERBOX.id,
    UP_ITEM.SPADE.id,
    UP_ITEM.BUCKET.id,
    [UP_ITEM.LOBSTER.id, 14]
];

// Why: the melee kit is matched by name, not id — any scimitar or platebody will do — so a snapshot needs the name maps as well. It is worn by default, because a pack holding one unworn is a step of its own and a pack holding none parks at the cave mouth.
const WEAPON = 'rune scimitar';

function snapshot(over: Partial<QuestSnapshot> & {
    stage?: number;
    flags?: string[];
    carried?: Stack[];
    banked?: Stack[];
    wornIdList?: number[];
    carriedNames?: string[];
    wornNames?: string[];
} = {}): QuestSnapshot {
    const {
        stage = UP_STAGE.NOT_STARTED, flags = [], carried = [], banked = [], wornIdList = [],
        carriedNames = [], wornNames = [WEAPON], ...rest
    } = over;
    return {
        journal: 'inProgress',
        inv: new Map(carriedNames.map(name => [name, 1])),
        invIds: counts(carried),
        worn: new Set(wornNames),
        wornIds: new Set(wornIdList),
        noProgress: 0,
        bankCoins: 0,
        bank: new Map(),
        bankIds: counts(banked),
        bankKnown: true,
        stage,
        progress: { stage, flags: new Set(flags) },
        tile: ARDOUGNE,
        ...rest
    } as QuestSnapshot;
}

const nameOf = (step: unknown): string => (step as { name?: string }).name ?? '';
const kindOf = (step: unknown): string => (step as { kind: string }).kind;
const reasonOf = (step: unknown): string => (step as { reason?: string }).reason ?? '';

describe('Underground Pass decide()', () => {
    test('an unloaded journal waits rather than guessing a stage', () => {
        expect(kindOf(decide(snapshot({ journal: 'unknown' })))).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(kindOf(decide(snapshot({ journal: 'complete' })))).toBe('done');
    });

    // Why: the paladins are level 62 and there is no bank past the cave mouth, so a pack with the kit and
    // no weapon has to stop and say so rather than walk a one-way dungeon into a fight it cannot win.
    test('without a melee weapon the cave mouth is a stop, not a descent', () => {
        const step = decide(snapshot({ carried: KIT, wornNames: [], flags: [UP_FLAG.STARTED] }));
        expect(kindOf(step)).toBe('wait');
        expect(reasonOf(step)).toContain('melee weapon');
    });

    // Why: the journal prints the same two sentences at stage three and stage four and differs only in which is struck through, so the module reads three while the server is at four — and levered a boulder that was already spent, forever. The two stages are one leg, and the horn is what ends it.
    // Why: and the crests, the well and the doors are one step after that, because the well eats the crests and the journal never says it did — a run killed three respawned paladins after feeding the first.
    test('the unicorn leg is keyed on the horn, not on the stage', () => {
        const inArea2 = { x: 2396, z: 9600, level: 0 };
        for (const stage of [UP_STAGE.ENTERED_SECOND_AREA, UP_STAGE.KILLED_UNICORN]) {
            const before = decide(snapshot({ stage, tile: inArea2, carried: [UP_ITEM.RAILING.id] }));
            expect(nameOf(before)).toContain('crush the unicorn');
            const after = decide(snapshot({ stage, tile: inArea2, carried: [UP_ITEM.UNICORN_HORN.id] }));
            expect(nameOf(after)).toContain('crests');
        }
    });

    // Why: the fire arrow puts the bow in the right hand and the scimitar in the pack, and nothing after
    // the bridge took it back out — the paladins were being fought bare-handed.
    test('the weapon goes back on before the paladins', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.KILLED_UNICORN,
            tile: { x: 2424, z: 9719, level: 0 },
            wornNames: [],
            carriedNames: [WEAPON]
        }));
        expect(nameOf(step)).toBe(`wear ${WEAPON}`);
    });

    test('the kit is drawn before the quest is started', () => {
        const step = decide(snapshot({ banked: KIT }));
        expect(kindOf(step)).toBe('withdraw');
    });

    test('with the kit in the pack, an unstarted quest goes to King Lathas', () => {
        const step = decide(snapshot({ carried: KIT }));
        expect(nameOf(step)).toContain('King Lathas');
    });

    // Why: the started bit is not a stage — reading it as one sent the bot back to Lathas forever.
    test('started is a flag on stage zero and routes to Koftik, not back to Lathas', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED] }));
        expect(nameOf(step)).not.toContain('King Lathas');
    });

    // Why: `no path to (2436,3315): unreachable` — the navigator has no edge into West Ardougne, so the
    // wall has to be crossed explicitly before anything inside it is reachable.
    test('Koftik is behind the wall, so the crossing comes first', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED] }));
        expect(nameOf(step)).toContain('West Ardougne');
    });

    test('inside West Ardougne it goes to Koftik instead of crossing again', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED], tile: WEST_ARDOUGNE }));
        expect(nameOf(step)).toContain('Koftik');
    });

    // Why: the pass is one-way with no bank in it, so a short pack stops at the mouth and says what is
    // missing rather than walking in and parking at an obstacle it cannot pass.
    test('a pack short of the kit refuses to descend and names what is missing', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: WEST_ARDOUGNE,
            carried: [UP_ITEM.TINDERBOX.id],
            banked: []
        }));
        expect(kindOf(step)).toBe('wait');
        expect(reasonOf(step)).toContain('Shortbow');
    });

    test('in the first cavern with no cloth, it asks Koftik for one', () => {
        const step = decide(snapshot({ stage: UP_STAGE.SPOKEN_KOFTIK, tile: AREA1, carried: KIT }));
        expect(nameOf(step)).toContain('damp cloth');
    });

    test('with the cloth it builds the fire arrow', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: [...KIT, UP_ITEM.DAMP_CLOTH.id]
        }));
        expect(nameOf(step)).toContain('fire arrow');
    });

    test('a lit arrow in the pack is wielded before the shot', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: [...KIT, UP_ITEM.LIT_ARROW.id]
        }));
        expect(nameOf(step)).toContain('wield');
    });

    test('a lit arrow already worn fires at the stay rope', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: KIT,
            wornIdList: [UP_ITEM.LIT_ARROW.id, UP_ITEM.SHORTBOW.id]
        }));
        expect(nameOf(step)).toContain('stay rope');
    });

    // Why: which orbs are already dark is not answerable from a snapshot — a burned orb has left the pack, and neither the trap nor the ground spawns hand over a second one. A per-site decide cycle therefore picks the same site forever, so the sweep is one step from end to end that keeps its own tally.
    test('past the grid, the orb phase is a single step whatever the pack holds', () => {
        const inside = { x: 2460, z: 9678, level: 0 };
        for (const carried of [[], [UP_ITEM.ORB1.id], [UP_ITEM.ORB1.id, UP_ITEM.ORB2.id, UP_ITEM.ORB3.id]]) {
            const step = decide(snapshot({ stage: UP_STAGE.PASSED_BRIDGE, tile: inside, carried }));
            expect(nameOf(step)).toContain('orbs');
        }
    });

    test('east of the grid it crosses before sweeping orbs', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.PASSED_BRIDGE,
            tile: { x: 2479, z: 9679, level: 0 }
        }));
        expect(nameOf(step)).toContain('grid');
    });

    // Why: the bridge-and-rope shelf overlaps the orb corridor's bounding box on x 2431-2464 / z 9686-9731, and a plain box read the shelf as the corridor — one run drifted onto the rope shelf, declared the grid crossed and spent six minutes clicking at stepping stones on the far side of a seam.
    test('the bridge and rope shelf is not mistaken for the corridor past the grid', () => {
        for (const tile of [
            { x: 2442, z: 9716, level: 0 },
            { x: 2460, z: 9693, level: 0 },
            { x: 2446, z: 9697, level: 0 }
        ]) {
            expect(nameOf(decide(snapshot({ stage: UP_STAGE.PASSED_BRIDGE, tile })))).toContain('grid');
        }
    });

    test('the far west of the corridor still reads as past the grid', () => {
        for (const tile of [
            { x: 2416, z: 9698, level: 0 },
            { x: 2382, z: 9668, level: 0 },
            { x: 2464, z: 9677, level: 0 }
        ]) {
            expect(nameOf(decide(snapshot({ stage: UP_STAGE.PASSED_BRIDGE, tile })))).toContain('orbs');
        }
    });

    test('a finished doll at the confronted stage is thrown into the pit', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.CONFRONTED_IBAN,
            tile: { x: 2140, z: 4647, level: 1 },
            carried: [UP_ITEM.DOLL.id],
            flags: [UP_FLAG.DOLL_COMPLETE]
        }));
        expect(nameOf(step)).toContain('pit of the damned');
    });

    // Why: the temple throws the player into the second cavern, which has no walkable way back up — Koftik's
    // dialogue is the transport. Each step of the walk out is keyed on where the last one landed.
    test('the walk out is keyed on where the last step landed', () => {
        const legs: [{ x: number; z: number; level: number }, string][] = [
            [{ x: 2482, z: 9607, level: 0 }, 'Koftik'],
            [AREA1, 'leave the underground pass'],
            [WEST_ARDOUGNE, 'East Ardougne'],
            [ARDOUGNE, 'King Lathas']
        ];
        for (const [tile, expected] of legs) {
            expect(nameOf(decide(snapshot({ stage: UP_STAGE.DEFEATED_IBAN, tile })))).toContain(expected);
        }
    });

    // Why: the doll comes out of a chest in a fifteen-tile pocket whose only exit is a door the collision pack calls blocked, so a leg that lifts it ends shut in and every later step answers "unreachable". A live run spent fifty-five minutes there. The way out has to come before anything else, at any stage.
    test('being shut in Kardia\'s house outranks every other step', () => {
        const inside = [
            { x: 2156, z: 4566, level: 1 },
            { x: 2151, z: 4566, level: 1 },
            { x: 2157, z: 4565, level: 1 }
        ];
        for (const tile of inside) {
            const step = decide(snapshot({ stage: UP_STAGE.FOUND_DOLL, carried: [UP_ITEM.DOLL.id], tile }));
            expect(nameOf(step)).toContain("out of Kardia's house");
        }
    });

    // Why: the door tile and the platform outside it are one tile apart from the pocket and must not be
    // read as inside it, or the module lets itself out of a house it is already standing outside, forever.
    test('the door tile and the platform outside it are not the house', () => {
        for (const tile of [{ x: 2158, z: 4566, level: 1 }, { x: 2158, z: 4567, level: 1 }]) {
            const step = decide(snapshot({ stage: UP_STAGE.FOUND_DOLL, carried: [UP_ITEM.DOLL.id], tile }));
            expect(nameOf(step)).not.toContain("out of Kardia's house");
        }
    });

    // Why: taking the blood leaves the character on Kalrag's own tile, one pocket with the dwarf camp but a different area name. A live run read that as "on the platforms" and spent seven attempts walking at a level-1 cage from level 0. Every step below has to accept both names.
    test("Kalrag's side of the cave is below, not on the platforms", () => {
        const KALRAG = { x: 2356, z: 9911, level: 0 };
        const doll = [UP_ITEM.DOLL.id, UP_ITEM.GAUNTLETS.id];
        const withBlood = decide(snapshot({
            stage: UP_STAGE.FOUND_DOLL, carried: doll, tile: KALRAG,
            flags: [UP_FLAG.ASHES_ON_DOLL, UP_FLAG.BLOOD_ON_DOLL]
        }));
        expect(nameOf(withBlood)).toContain('climb back up');

        const noAshes = decide(snapshot({ stage: UP_STAGE.FOUND_DOLL, carried: doll, tile: KALRAG }));
        expect(nameOf(noAshes)).not.toContain('climb down');
    });

    // Why: every value the journal can report is now routed, so this guards the shape of the fallback —
    // a stage the module does not know has to name itself and stop, not retry the last step it did know.
    test('a stage the module does not know waits with the stage named', () => {
        const step = decide(snapshot({ stage: -1, tile: AREA1 }));
        expect(kindOf(step)).toBe('wait');
        expect(reasonOf(step)).toContain('-1');
    });
});
