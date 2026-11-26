import { loadStaticFinder } from '../../lib/navigation.js';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';

// The pack is a build artifact, not a committed file, so CI runs without it.
const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

const finder = HAS_COLLISION_PACK ? loadStaticFinder(PACK_PATH) : (null as unknown as PathFinder);

const DRAYNOR_BANK: NavPoint = { x: 3093, z: 3243, level: 0 };
const ALCOVE: NavPoint = { x: 3096, z: 3358, level: 0 };
const BASEMENT_LANDING: NavPoint = { x: 3116, z: 9754, level: 0 };
const OIL_CAN: NavPoint = { x: 3092, z: 9755, level: 0 };

describe.skipIf(!HAS_COLLISION_PACK)('Draynor Manor secret door', () => {
    test('the bookcase alcove is reachable, so the puzzle ladder is usable', () => {
        expect(finder.findPath(DRAYNOR_BANK, ALCOVE, undefined, 4_000_000).ok).toBe(true);
    });

    test('the basement landing is reachable through the ladder', () => {
        expect(finder.findPath(DRAYNOR_BANK, BASEMENT_LANDING, undefined, 4_000_000).ok).toBe(true);
    });

    test("the oil can stays unreachable — the maze is the module's job, not the walker's", () => {
        // All nine puzzle doors are in derive-doors SCRIPT_REFUSED. If this ever
        // passes, one got baked and the navigator will loop against a locked door.
        expect(finder.findPath(BASEMENT_LANDING, OIL_CAN, undefined, 4_000_000).ok).toBe(false);
    });
});
