import type { QuestRecord, PlayerState, RequirementResult } from './types.js';

function skillLabel(skill: string): string {
    return skill.length === 0 ? skill : skill[0].toUpperCase() + skill.slice(1);
}

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
