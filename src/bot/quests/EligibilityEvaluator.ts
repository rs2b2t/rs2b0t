import type { QuestStatus } from '#/bot/api/hud/Quests.js'; // type-only: does NOT pull the client at runtime

import { checkItems } from './ItemChecker.js';
import { checkRequirements } from './RequirementChecker.js';
import type { QuestRecord, PlayerState, BankInventorySnapshot, QuestEligibility } from './types.js';

/**
 * Combine requirement + item checks with the live journal status into a single
 * DONE/READY/BLOCKED verdict. Pure — journalStatus is passed in, so the client
 * never enters this module. 'complete' short-circuits to DONE.
 */
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
    for (const it of checkItems(record, snapshot)) {
        if (!it.ok) {
            reasons.push(`missing item: ${it.name} x${it.qty} (have ${it.present})`);
        }
    }

    return {
        id: record.id,
        name: record.name,
        status: reasons.length === 0 ? 'READY' : 'BLOCKED',
        reasons
    };
}

/** Evaluate every record; statusOf maps a quest display name to its journal status. */
export function evaluateAll(
    records: QuestRecord[],
    player: PlayerState,
    snapshot: BankInventorySnapshot,
    statusOf: (name: string) => QuestStatus
): QuestEligibility[] {
    return records.map(r => evaluate(r, player, snapshot, statusOf(r.name)));
}
