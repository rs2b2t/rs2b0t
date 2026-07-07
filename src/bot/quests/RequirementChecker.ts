import type { QuestRecord, PlayerState, RequirementResult } from './types.js';

/** Capitalize a skill token for display: 'mining' -> 'Mining'. */
function skillLabel(skill: string): string {
    return skill.length === 0 ? skill : skill[0].toUpperCase() + skill.slice(1);
}

/**
 * Evaluate a quest's hard requirements against a plain PlayerState snapshot.
 * Pure — no client access. Returns one result per gate, ordered:
 * quest-points, then each skill, then each prerequisite quest.
 */
export function checkRequirements(record: QuestRecord, player: PlayerState): RequirementResult[] {
    const out: RequirementResult[] = [];
    const req = record.requirements;

    if (req.minQuestPoints !== undefined) {
        const ok = player.questPoints >= req.minQuestPoints;
        out.push({ ok, reason: ok ? '' : `needs ${req.minQuestPoints} quest points (have ${player.questPoints})` });
    }

    for (const s of req.skills ?? []) {
        const have = player.skillLevels.get(s.skill) ?? 0;
        const ok = have >= s.level;
        out.push({ ok, reason: ok ? '' : `needs ${skillLabel(s.skill)} ${s.level} (have ${have})` });
    }

    for (const q of req.quests ?? []) {
        const ok = player.completedQuests.has(q);
        out.push({ ok, reason: ok ? '' : `prerequisite quest not complete: ${q}` });
    }

    return out;
}
