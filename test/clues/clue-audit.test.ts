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
        const findings = runClueAudit();
        expect(findings.map(f => `${f.obj} [${f.id}] ${f.type}: ${f.problem}`)).toEqual([]);
    }, 240_000);
});
