import { LOOT_DATA } from './lootData.js';
import type { JiveSettings } from './types.js';

export const LOOT_CATALOG = LOOT_DATA;
export const DEFAULT_KEEP_ITEMS = LOOT_CATALOG.filter(item => item.default).map(item => String(item.id));
const identities = new Map(LOOT_CATALOG.flatMap(item => [item.id, ...item.noteIds].map(id => [id, item] as const)));

export function lootIdentity(id: number) { return identities.get(id); }

export function lootPolicy(id: number, settings: Pick<JiveSettings, 'keepItems' | 'dragonBones' | 'dragonHides' | 'ordinaryBones'>): 'keep' | 'bury' | 'leave' {
    const item = lootIdentity(id);
    if (!item) return 'leave';
    if (item.id === 536) return settings.dragonBones;
    if (item.id === 526) return settings.ordinaryBones;
    if ([1747, 1749, 1751].includes(item.id)) return settings.dragonHides === 'bank' ? 'keep' : 'leave';
    return settings.keepItems.includes(String(item.id)) ? 'keep' : 'leave';
}

export function missingLootIds(ids: readonly number[]): number[] {
    return [...new Set(ids.filter(id => !identities.has(id)))];
}

export function compareLoot(a: number, b: number, settings: Pick<JiveSettings, 'keepItems' | 'dragonBones' | 'dragonHides' | 'ordinaryBones'>): number {
    return Number(lootPolicy(b, settings) === 'keep') - Number(lootPolicy(a, settings) === 'keep')
        || (lootIdentity(a)?.priority ?? Infinity) - (lootIdentity(b)?.priority ?? Infinity);
}
