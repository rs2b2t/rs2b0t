import { firstFreeName, upsertNamedEntry } from '../namedEntries.js';
import { SLOTS, type Slot } from './types.js';

export interface CarryEntry {
    item: string;
    qty: number;
}

export interface Loadout {
    name: string;
    /** Slot to display name. Why: scripts match on display names. */
    worn: Partial<Record<Slot, string>>;
    carry: CarryEntry[];
}

const KNOWN: ReadonlySet<string> = new Set(SLOTS);

function readWorn(raw: unknown): Partial<Record<Slot, string>> {
    const out: Partial<Record<Slot, string>> = {};
    if (typeof raw !== 'object' || raw === null) {
        return out;
    }
    for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
        if (KNOWN.has(slot) && typeof value === 'string' && value.trim().length > 0) {
            out[slot as Slot] = value;
        }
    }
    return out;
}

function readCarry(raw: unknown): CarryEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: CarryEntry[] = [];
    for (const entry of raw as Record<string, unknown>[]) {
        const item = entry?.item;
        const qty = entry?.qty;
        if (typeof item === 'string' && item.trim().length > 0 && typeof qty === 'number' && qty > 0) {
            out.push({ item, qty: Math.floor(qty) });
        }
    }
    return out;
}

/** Parse user-edited storage without throwing; invalid data returns no loadouts. */
export function parseLoadouts(raw: string): Loadout[] {
    if (raw.trim().length === 0) {
        return [];
    }
    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(payload)) {
        return [];
    }
    const out: Loadout[] = [];
    for (const entry of payload as Record<string, unknown>[]) {
        const name = entry?.name;
        if (typeof name !== 'string' || name.trim().length === 0) {
            continue;
        }
        out.push({ name, worn: readWorn(entry.worn), carry: readCarry(entry.carry) });
    }
    return out;
}

export function serializeLoadouts(list: readonly Loadout[]): string {
    return JSON.stringify(list);
}

export function upsertLoadout(list: readonly Loadout[], loadout: Loadout): Loadout[] {
    return upsertNamedEntry(list, loadout);
}

export function removeLoadout(list: readonly Loadout[], name: string): Loadout[] {
    const wanted = name.toLowerCase();
    return list.filter(l => l.name.toLowerCase() !== wanted);
}

export function uniqueName(list: readonly Loadout[], base: string): string {
    return firstFreeName(list, base);
}
