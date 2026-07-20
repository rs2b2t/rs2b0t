import { describe, expect, test } from 'bun:test';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { auditInputsPresent, runClueAudit } from '../../tools/clues/audit-clues.js';

// The 7 kill-for-key medium riddles (carry a `keyFrom`): the container key drops
// wherever the target NPC dies, so the killer is NOT at the container and the
// executor hunts it at KILL_ANCHORS[id]. Pinned explicitly so a data drift (a
// new keyFrom riddle without an anchor, a renumbered id, a stale leftover key)
// fails offline — no pack required.
const KEY_FROM_IDS = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].keyFrom)
    .sort((a, b) => a - b);

// Kill-anchor present/stale/well-formed correspondence — data-only, so it runs
// everywhere (no pack). Reachability of each anchor is proved by the pack-gated
// audit below (a missing/malformed/unreachable/stale anchor surfaces there as a
// finding, dropping `clean` and failing `findings.toEqual([])`).
describe('kill-for-key anchors (KILL_ANCHORS ↔ keyFrom)', () => {
    test('exactly the 7 keyFrom riddles carry a well-formed hunt anchor, none stale', () => {
        // the concrete kill-for-key riddle ids (riddle001-005/007/008)
        expect(KEY_FROM_IDS).toEqual([2831, 2833, 2835, 2837, 2839, 3605, 3607]);
        // every kill-for-key riddle has an anchor (a missing one falls the executor
        // back to the container = the pre-617e5a0 broken hunt)
        for (const id of KEY_FROM_IDS) {
            expect(KILL_ANCHORS[id], `riddle ${id} missing KILL_ANCHORS entry`).toBeDefined();
        }
        // no anchor points at a non-keyFrom clue (stale/misplaced entry)
        expect(Object.keys(KILL_ANCHORS).map(Number).sort((a, b) => a - b)).toEqual(KEY_FROM_IDS);
        // every anchor is a well-formed Tile (finite int x/z, level 0-3)
        for (const id of KEY_FROM_IDS) {
            const a = KILL_ANCHORS[id];
            expect(Number.isInteger(a.x) && Number.isInteger(a.z) && Number.isInteger(a.level) && a.level >= 0 && a.level <= 3, `riddle ${id} anchor malformed: (${a.x},${a.z},${a.level})`).toBe(true);
        }
    });
});

// Full offline audit of every clue variant (all 122 — easy + medium) against
// the real collision pack + engine map data — the regression gate behind the
// live abandons (simple009 diagonal-door house, vague006 drawers wall-side,
// vague009 Dwarven Mine, vague026 Gnome Stronghold, medium kill-for-key hunt
// anchors). Reachability is probed at the audit's big budget (matching live
// walkResilient escalation); the two KNOWN_UNREACHABLE clues (2811 Baxtorian
// Falls, 2815 Crandor) are reported as expected-abandon inside the audit and
// never surface as findings. Skips on machines without the pack/engine/content
// checkouts (CI); on a dev box `bun test` runs it in ~1 min.
const present = auditInputsPresent();

describe.skipIf(!present)('clue audit (pack-gated)', () => {
    test('every clue variant is solvable: reachable, interact-legal, egress, loc/npc present', () => {
        const { total, findings, expectedAbandon, clean } = runClueAudit();
        // 0 unexpected failures — any real cluedb/nav regression surfaces here
        // (a corrupted sextant/coord/level row on an allowlisted clue included,
        // since only a genuine nav-unreachable finding is expected-abandoned).
        expect(findings.map(f => `${f.obj} [${f.id}] ${f.type}: ${f.problem}`)).toEqual([]);
        // exactly the two genuinely nav-unreachable clues are allowlisted. This
        // pins the SET: a stale entry (a clue that became reachable) drops out,
        // and padding the allowlist to silence a real failure adds an id — both
        // change this array and fail the test.
        expect(expectedAbandon).toEqual([2811, 2815]);
        // 120 clues pass every check outright. Padding the allowlist to hide a
        // failure (or losing a clean clue to a regression) drops this below 120.
        expect(clean).toBe(120);
        expect(total).toBe(122);
    }, 240_000);
});
