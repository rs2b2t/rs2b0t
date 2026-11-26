import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';

export function itemCounts<T extends string | number>(items: readonly T[]): Map<T, number> {
    const counts = new Map<T, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return counts;
}

export function nameCounts(names: readonly string[]): Map<string, number> {
    return itemCounts(names.map(name => name.toLowerCase()));
}

export function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

export function talkTarget(step: QuestStep): string | null {
    return step.kind === 'talk' ? step.stop.npc : null;
}
