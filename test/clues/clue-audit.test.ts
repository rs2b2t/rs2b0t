import { describe, expect, test } from 'bun:test';
import { auditInputsPresent, runClueAudit } from '../../tools/clues/audit-clues.js';

// Full offline audit of every clue variant (all 122 — easy + medium) against
// the real collision pack + engine map data — the regression gate behind the
// live abandons (simple009 diagonal-door house, vague006 drawers wall-side,
// vague009 Dwarven Mine, vague026 Gnome Stronghold). Reachability is probed at
// the audit's big budget (matching live walkResilient escalation); the two
// KNOWN_UNREACHABLE clues (2811 Baxtorian Falls, 2815 Crandor) are reported as
// expected-abandon inside the audit and never surface as findings. Skips on
// machines without the pack/engine/content checkouts (CI); on a dev box
// `bun test` runs it in ~1 min.
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
