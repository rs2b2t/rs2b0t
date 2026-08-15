import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

import { checkItems } from './ItemChecker.js';
import { checkRequirements } from './RequirementChecker.js';
import type { QuestRecord, PlayerState, BankInventorySnapshot, QuestEligibility } from './types.js';

export function evaluate(
    record: QuestRecord,
    player: PlayerState,
    snapshot: BankInventorySnapshot,
    journalStatus: QuestStatus
): QuestEligibility {
    if (journalStatus === 'complete') {
        return { id: record.id, name: record.name, status: 'DONE', reasons: [] };
    }

    const reasons: string[] = [];

    for (const r of checkRequirements(record, player)) {
        if (!r.ok) {
            reasons.push(r.reason);
        }
    }
    // Why: item requirements gate starting a quest, and re-imposing them mid-quest blocks a bot from ever resuming, since the items may legitimately be gone — handed over, ground up, drunk.
    // Why: past the start, the module's decide() sources what it still needs.
    // Why: the requirements above are checked either way, as nothing consumes a skill level or a quest point.
    if (journalStatus !== 'inProgress') {
        for (const it of checkItems(record, snapshot)) {
            if (!it.ok) {
                reasons.push(`missing item: ${it.name} x${it.qty} (have ${it.present})`);
            }
        }
    }

    return {
        id: record.id,
        name: record.name,
        status: reasons.length === 0 ? 'READY' : 'BLOCKED',
        reasons
    };
}

export function evaluateAll(
    records: QuestRecord[],
    player: PlayerState,
    snapshot: BankInventorySnapshot,
    statusOf: (name: string) => QuestStatus
): QuestEligibility[] {
    return records.map(r => evaluate(r, player, snapshot, statusOf(r.name)));
}
