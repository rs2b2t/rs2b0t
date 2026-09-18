import { evidenceRow as row, evidenceNumber as num, evidencePoint as point } from './jivedragons-evidence-values.js';

export function assessClueBank(values: readonly unknown[]) {
    const events = values.map(row).sort((a, b) => num(a.at) - num(b.at));
    const violations = new Set<string>();
    let dungeon = false, egress = false, opened = false, deposited = false, progressed = false;
    let firstBankHides = 0, firstHides = 0;
    let startDistance: number | null = null;
    for (const event of events) {
        const tile = point(event.tile);
        if (!egress && tile.z >= 9000 && event.clueHeld === true) dungeon = true;
        if (dungeon && tile.z < 9000) egress = true;
        if (event.kind === 'walk-request' && tile.z >= 9000 && point(event.goal).z < 9000) violations.add('underground-surface-walk');
        if (event.kind === 'bank-request' && (!egress || Math.max(Math.abs(tile.x - 2946), Math.abs(tile.z - 3369)) > 6)) violations.add('bank-request-before-preferred-arrival');
        if (event.bankOpen === true) {
            if (!egress || Math.max(Math.abs(tile.x - 2946), Math.abs(tile.z - 3369)) > 6) violations.add('wrong-bank-or-order');
            if (event.clueHeld !== true) violations.add('clue-not-held-at-bank');
            if (!opened) { firstBankHides = num(event.bankHides); firstHides = num(event.hides); opened = true; }
            if (num(event.bankHides) > firstBankHides && num(event.hides) < firstHides && event.clueHeld === true) deposited = true;
        }
        if (event.solver !== null && event.solver !== undefined) {
            if (!deposited) violations.add('solver-before-bank');
            const solver = row(event.solver);
            if (solver.clueId !== 2693 || !solver.target || !deposited || tile.z >= 9000) continue;
            const target = point(solver.target);
            const distance = Math.max(Math.abs(tile.x - target.x), Math.abs(tile.z - target.z));
            startDistance ??= distance;
            if (startDistance - distance >= 3) progressed = true;
        }
    }
    const gaps = [...(!dungeon ? ['dungeon-start'] : []), ...(!egress ? ['egress'] : []), ...(!opened ? ['bank-open'] : []),
        ...(!deposited ? ['loot-deposit-with-clue'] : []), ...(!progressed ? ['actual-clue-path-progress'] : [])];
    return { passed: gaps.length === 0 && violations.size === 0, dungeon, egress, opened, deposited, progressed, gaps, violations: [...violations] };
}
