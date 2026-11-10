import type { QuestRecord } from '../../api/ai/quests/types.js';

export function planQuestSelection(
    selected: ReadonlySet<string>, excluded: ReadonlySet<string>, records: readonly QuestRecord[],
    completed: ReadonlySet<string>, points: number
): Set<string> {
    const picked = new Set(selected);
    const byId = new Map(records.map(record => [record.id, record]));
    const add = (id: string): void => {
        if (picked.has(id) || excluded.has(id) || completed.has(id) || !byId.has(id)) return;
        picked.add(id);
        for (const prerequisite of byId.get(id)!.requirements.quests ?? []) add(prerequisite);
    };
    for (const id of picked) {
        const requirements = byId.get(id)?.requirements;
        for (const prerequisite of requirements?.quests ?? []) add(prerequisite);
        if (requirements?.skills?.some(skill => skill.skill === 'herblore')) add('druid');
        if (requirements?.skills?.some(skill => skill.skill === 'runecraft')) add('runemysteries');
    }
    for (const id of picked) {
        const required = byId.get(id)?.requirements.minQuestPoints ?? 0;
        const projected = (): number => points + records.filter(record => picked.has(record.id) && !completed.has(record.id)
            && (record.requirements.minQuestPoints ?? 0) < required).reduce((sum, record) => sum + record.questPoints, 0);
        for (const candidate of records) {
            if (projected() >= required) break;
            if ((candidate.requirements.minQuestPoints ?? 0) >= required) continue;
            add(candidate.id);
        }
    }
    return picked;
}
