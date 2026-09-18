import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import Tile from '#/bot/geometry/Tile.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { PACK_UNREACHABLE } from '#/bot/api/ai/clues/data/unreachable.js';
import {
    KHARAZI_CLUES,
    crossesKharazi,
    hasJungleMap,
    inKharazi,
    jungleCrossing,
    jungleAxe,
    jungleKitMissing
} from '#/bot/api/ai/clues/kharaziTravel.js';
import { stubProps } from '../../../lib/stubSingletons.js';

const KHARAZI_IDS = [...KHARAZI_CLUES].sort((a, b) => a - b);
/** trail_clue_hard_sextant019, 08 degrees 05 minutes South, 15 degrees 56 minutes East. */
const CHEST_DIG = 3536;
/** Two chops south of the mouth: the first jungle tile the band opens onto. */
const JUNGLE_LANDING: NavPoint = { x: 2816, z: 2936, level: 0 };
const KARAMJA_MAINLAND: NavPoint = { x: 2946, z: 3050, level: 0 };

describe('the Kharazi clue set', () => {
    test('is exactly the clues whose dig is inside the jungle', () => {
        const inside = Object.keys(CLUE_DB)
            .map(Number)
            .filter(id => inKharazi(CLUE_DB[id]!.coord ?? null))
            .sort((a, b) => a - b);
        expect(inside).toEqual(KHARAZI_IDS);
    });

    test('08 05 South 15 56 East is one of them, and digs at (2950,2902)', () => {
        expect(KHARAZI_CLUES.has(CHEST_DIG)).toBe(true);
        expect(CLUE_DB[CHEST_DIG]!.coord).toEqual({ x: 2950, z: 2902, level: 0 });
    });

    test('each one still tells the pack audit why it cannot be routed to', () => {
        for (const id of KHARAZI_IDS) {
            expect(PACK_UNREACHABLE[id], `${id} must stay diagnosed`).toContain('machete');
        }
    });
});

let restore: (() => void)[] = [];

afterEach(() => {
    for (const undo of restore.reverse()) {
        undo();
    }
    restore = [];
});

function stubPack(opts: { at: NavPoint; inv?: string[]; worn?: string[]; bank?: string[]; legends?: string }): void {
    const inv = new Set((opts.inv ?? []).map(n => n.toLowerCase()));
    const worn = new Set((opts.worn ?? []).map(n => n.toLowerCase()));
    const bank = new Set((opts.bank ?? []).map(n => n.toLowerCase()));
    restore.push(
        stubProps(Game, { tile: () => new Tile(opts.at.x, opts.at.z, opts.at.level) }),
        stubProps(Inventory, {
            first: (name: string) => (inv.has(name.toLowerCase()) ? ({ id: 0, count: 1 } as never) : null)
        }),
        stubProps(Equipment, { contains: (name: string) => worn.has(name.toLowerCase()) }),
        stubProps(Bank, { count: (name: string) => (bank.has(name.toLowerCase()) ? 1 : 0) }),
        stubProps(Skills, { level: () => 60 }),
        stubProps(Quests, { status: () => (opts.legends ?? 'started') as never })
    );
}

describe('cutting into the jungle', () => {
    test('the direction to cut follows which end is inside', () => {
        const dig = CLUE_DB[CHEST_DIG]!.coord!;
        expect(jungleCrossing(dig, KARAMJA_MAINLAND)).toBe('enter');
        expect(jungleCrossing(KARAMJA_MAINLAND, dig)).toBe('leave');
        expect(jungleCrossing(dig, JUNGLE_LANDING)).toBe('none');
        expect(jungleCrossing(KARAMJA_MAINLAND, KARAMJA_MAINLAND)).toBe('none');
        // Why: an unknown tile reads as outside, so a walk to a dig still cuts its way in rather than giving up.
        expect(jungleCrossing(dig, null)).toBe('enter');
    });

    test('a dig inside is a crossing from the mainland and not from inside', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(crossesKharazi(CLUE_DB[CHEST_DIG]!.coord!)).toBe(true);
        restore.pop()!();

        stubPack({ at: JUNGLE_LANDING });
        expect(crossesKharazi(CLUE_DB[CHEST_DIG]!.coord!)).toBe(false);
        expect(crossesKharazi(KARAMJA_MAINLAND)).toBe(true);
    });

    test('the kit the server checks is reported item by item when the pack is empty', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(jungleKitMissing()).toEqual(['Machete', 'an axe', 'Radimus notes (Legends Quest reads started)']);
    });

    test('a machete, any axe and the notes are enough', () => {
        stubPack({ at: KARAMJA_MAINLAND, inv: ['Machete', 'Bronze axe', 'Radimus notes'] });
        expect(jungleKitMissing()).toEqual([]);
    });

    test('a finished Legends account needs no notes, and a worn machete counts', () => {
        stubPack({ at: KARAMJA_MAINLAND, inv: ['Iron axe'], worn: ['Machete'], legends: 'complete' });
        expect(hasJungleMap()).toBe(true);
        expect(jungleKitMissing()).toEqual([]);
    });

    test('the bank supplies the best axe it has, not the first', () => {
        stubPack({ at: KARAMJA_MAINLAND, bank: ['Bronze axe', 'Mithril axe', 'Adamant axe'] });
        expect(jungleAxe()).toBe('Adamant axe');
    });

    test('no axe anywhere reads as none', () => {
        stubPack({ at: KARAMJA_MAINLAND });
        expect(jungleAxe()).toBeNull();
    });
});

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const built = new PathFinder(bytes);
    built.addEdges(doors as DoorEdgeData[], transports as TransportEdgeData[], stairs as TransportEdgeData[]);
    return built;
}

// Why: the feature rests on the band being the only thing in the way, so both halves are pinned: the
// Why: pack cannot route in, and once the chop has landed the ordinary walker reaches every dig.
describe.skipIf(!HAS_COLLISION_PACK)('the band is the only thing sealing the digs', () => {
    test('no dig routes from Karamja, and every one routes from the far side of the band', () => {
        const finder = loadFinder();
        const fromMainland = KHARAZI_IDS.filter(id => finder.findPath(KARAMJA_MAINLAND, CLUE_DB[id]!.coord!, undefined, 4_000_000).ok);
        expect(fromMainland).toEqual([]);
        const fromJungle = KHARAZI_IDS.filter(id => finder.findPath(JUNGLE_LANDING, CLUE_DB[id]!.coord!, undefined, 4_000_000).ok);
        expect(fromJungle).toEqual(KHARAZI_IDS);
    }, 120_000);
});
