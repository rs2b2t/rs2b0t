import assert from 'node:assert/strict';

function row(value: unknown): Record<string, unknown> {
    assert(typeof value === 'object' && value !== null && !Array.isArray(value));
    return Object.fromEntries(Object.entries(value));
}
function count(value: unknown, name: string): number {
    assert(Array.isArray(value));
    return value.map(row).filter(item => item.name === name).reduce((total, item) => {
        assert(typeof item.count === 'number' && Number.isFinite(item.count));
        return total + item.count;
    }, 0);
}

export type CapacityEpisode = {
    readonly hp: number; readonly panicHp: number; readonly food: number; readonly reserve: number;
    readonly full: boolean; readonly requiredSupplies: boolean;
    readonly escaped: boolean; readonly roomConfirmed: boolean;
    readonly retreatHp?: number;
};

export function assessCandidatePolicy(events: readonly unknown[], capacity: readonly CapacityEpisode[] = []) {
    const timeline = events.map(row).sort((a, b) => Number(a.at) - Number(b.at));
    const violations = new Set<string>();
    let merges = 0, otherArrowLoot = 0;
    for (const [i, event] of timeline.entries()) {
        if (event.kind === 'inventory-action' && event.action === 'Wield' && typeof event.item === 'string'
            && /arrow/i.test(event.item) && event.item !== 'Rune arrow') violations.add('unconfigured-ammo');
        if (event.kind === 'ground-action' && event.action === 'Take' && typeof event.item === 'string' && /arrow/i.test(event.item) && event.item !== 'Rune arrow') {
            const name = event.item;
            const confirmed = timeline.slice(i + 1).find(e => Number(e.at) - Number(event.at) <= 5000 && Array.isArray(e.inventory)
                && count(e.inventory, name) > count(event.inventory, name));
            if (confirmed && Array.isArray(confirmed.equipment) && count(confirmed.equipment, name) === 0) otherArrowLoot++;
        }
        if (Array.isArray(event.inventory) && Array.isArray(event.equipment) && count(event.inventory, 'Rune arrow') > 0 && count(event.equipment, 'Rune arrow') > 0
            && ((event.kind === 'ground-action' && event.item === 'Shark') || (event.kind === 'decision' && event.task === 'BankRun' && event.used === 28))) violations.add('merge-before-capacity-or-reclaim');
        const next = timeline[i + 1];
        if (!next || !Array.isArray(event.equipment) || !Array.isArray(next.equipment)
            || !Array.isArray(event.inventory) || !Array.isArray(next.inventory)) continue;
        const bag = count(event.inventory, 'Rune arrow');
        const worn = count(event.equipment, 'Rune arrow');
        if (bag <= 0 || worn <= 0 || count(next.inventory, 'Rune arrow') !== 0) continue;
        if (count(next.equipment, 'Rune arrow') !== worn + bag || typeof event.used !== 'number' || next.used !== event.used - 1) continue;
        const other = event.inventory.map(row).filter(item => typeof item.name === 'string' && /arrow/i.test(item.name) && item.name !== 'Rune arrow');
        if (!other.every(item => typeof item.name === 'string' && count(next.inventory, item.name) === item.count && count(next.equipment, item.name) === 0)) {
            violations.add('other-ammo-changed');
            continue;
        }
        merges++;
    }
    let capacityMadeRoom = 0, emergencyEscapes = 0;
    for (const episode of capacity) {
        if (episode.hp <= Math.max(episode.panicHp, episode.retreatHp ?? episode.panicHp)) {
            if (episode.escaped) emergencyEscapes++;
            continue;
        }
        if (!episode.full || !episode.requiredSupplies || episode.food <= 0) continue;
        if (episode.escaped) violations.add('food-capacity-exit');
        if (!episode.escaped && episode.roomConfirmed && episode.food <= episode.reserve) capacityMadeRoom++;
    }
    const gaps = [...(merges === 0 ? ['confirmed-rune-merge'] : []), ...(capacityMadeRoom === 0 ? ['capacity-at-reserve'] : []),
        ...(emergencyEscapes === 0 ? ['emergency-escape'] : []), ...(otherArrowLoot === 0 ? ['wrong-arrow-loot-preserved'] : [])];
    return { passed: gaps.length === 0 && violations.size === 0, merges, otherArrowLoot, capacityMadeRoom, emergencyEscapes, violations: [...violations], gaps };
}
