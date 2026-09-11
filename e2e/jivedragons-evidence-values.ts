import assert from 'node:assert/strict';

export function evidenceRow(value: unknown): Record<string, unknown> {
    assert(typeof value === 'object' && value !== null && !Array.isArray(value));
    return Object.fromEntries(Object.entries(value));
}
export function evidenceRows(value: unknown): Record<string, unknown>[] { assert(Array.isArray(value)); return value.map(evidenceRow); }
export function evidenceNumber(value: unknown): number { assert(typeof value === 'number' && Number.isFinite(value)); return value; }
export function evidencePoint(value: unknown) { const p = evidenceRow(value); return { x: evidenceNumber(p.x), z: evidenceNumber(p.z) }; }
