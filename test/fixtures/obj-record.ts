import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

export function rec(id: number, name: string, overrides: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...overrides };
}
