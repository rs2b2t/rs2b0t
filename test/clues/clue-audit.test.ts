import { describe, expect, test } from 'bun:test';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { auditInputsPresent, runClueAudit } from '../../tools/clues/audit-clues.js';

const KEY_FROM_IDS = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].keyFrom)
    .sort((a, b) => a - b);

describe('kill-for-key anchors (KILL_ANCHORS ↔ keyFrom)', () => {
    test('exactly the 7 keyFrom riddles carry a well-formed hunt anchor, none stale', () => {
        expect(KEY_FROM_IDS).toEqual([2831, 2833, 2835, 2837, 2839, 3605, 3607]);
        for (const id of KEY_FROM_IDS) {
            expect(KILL_ANCHORS[id], `riddle ${id} missing KILL_ANCHORS entry`).toBeDefined();
        }
        expect(Object.keys(KILL_ANCHORS).map(Number).sort((a, b) => a - b)).toEqual(KEY_FROM_IDS);
        for (const id of KEY_FROM_IDS) {
            const a = KILL_ANCHORS[id];
            expect(Number.isInteger(a.x) && Number.isInteger(a.z) && Number.isInteger(a.level) && a.level >= 0 && a.level <= 3, `riddle ${id} anchor malformed: (${a.x},${a.z},${a.level})`).toBe(true);
        }
    });
});

const present = auditInputsPresent();

// Destinations the baked nav pack cannot route to. Each is a pack gap with a
// diagnosis in KNOWN_UNREACHABLE, not a clue-database bug: the solver abandons
// cleanly, and fixing the pack makes the clue start working untouched.
const EXPECTED_ABANDON = [
    2815, 2855, 3522, 3526, 3528, 3532, 3534, 3536,
    3546, 3548, 3552, 3554, 3560, 3562, 3564
];

describe.skipIf(!present)('clue audit (pack-gated)', () => {
    test('every clue variant is solvable: reachable, interact-legal, egress, loc/npc present', () => {
        const { total, findings, expectedAbandon, clean } = runClueAudit();
        expect(findings.map(f => `${f.obj} [${f.id}] ${f.type}: ${f.problem}`)).toEqual([]);
        expect(expectedAbandon).toEqual(EXPECTED_ABANDON);
        expect(total).toBe(186);
        expect(clean).toBe(total - EXPECTED_ABANDON.length);
    }, 240_000);
});
