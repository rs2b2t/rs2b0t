import assert from 'node:assert/strict';
import { evidenceRow, evidenceRows, evidenceNumber } from './jivedragons-evidence-values.js';
import type { PrivateFrame } from './jive-private-types.js';

const text = (value: unknown): string => { assert(typeof value === 'string'); return value; };
const bool = (value: unknown): boolean => { assert(typeof value === 'boolean'); return value; };
const items = (value: unknown) => evidenceRows(value).map(i => ({ id: evidenceNumber(i.id), count: evidenceNumber(i.count) }));

export function parsePrivateFrame(value: unknown): PrivateFrame {
    const f = evidenceRow(value);
    return { at: evidenceNumber(f.at), tick: evidenceNumber(f.tick), fixture: text(f.fixture),
        guardians: evidenceRows(f.guardians).map(n => ({ nid: evidenceNumber(n.nid), life: text(n.life), name: text(n.name),
            hp: evidenceNumber(n.hp), owner: n.owner === null ? null : text(n.owner), active: bool(n.active) })),
        players: evidenceRows(f.players).map(p => ({ username: text(p.username), hp: evidenceNumber(p.hp), trailStatus: evidenceNumber(p.trailStatus),
            inventory: items(p.inventory), bank: items(p.bank), ground: evidenceRows(p.ground).map(i => ({
                id: evidenceNumber(i.id), count: evidenceNumber(i.count), owned: bool(i.owned) })) })) };
}

export async function readPrivateFrames(path: string) {
    const text = await Bun.file(path).text();
    return text.split('\n').slice(0, -1).filter(Boolean).map(line => parsePrivateFrame(JSON.parse(line)));
}
