import assert from 'node:assert/strict';
import type { LootEvent } from './jivedragons-loot-sequence.js';

function record(value: unknown): Record<string, unknown> {
    assert(typeof value === 'object' && value !== null && !Array.isArray(value));
    return Object.fromEntries(Object.entries(value));
}
function number(value: unknown): number { assert(typeof value === 'number' && Number.isFinite(value)); return value; }
function tile(value: unknown) { const p = record(value); return { x: number(p.x), z: number(p.z) }; }
function inventory(client: Record<string, unknown>) {
    assert(Array.isArray(client.inventory) && Array.isArray(client.ground));
    const anchor = tile(client.anchor);
    const ground = client.ground.map(record).filter(i => i.name === 'Shark' && tile(i.tile).x === anchor.x && tile(i.tile).z === anchor.z);
    return { hideCount: client.inventory.map(record).filter(i => i.name === 'Dragonhide').reduce((sum, i) => sum + number(i.count), 0),
        groundSharks: ground.reduce((sum, i) => sum + number(i.count), 0) };
}

export function lootEvidence(rawEvents: readonly unknown[], rawFrames: readonly unknown[]): LootEvent[] {
    const clients = rawEvents.map(record).sort((a, b) => number(a.at) - number(b.at));
    const frames = rawFrames.map(record).sort((a, b) => number(a.at) - number(b.at));
    const events: LootEvent[] = [];
    const attacks = clients.filter(e => e.kind === 'npc-action' && e.action === 'Attack');
    const deaths = new Set<string>();
    let cursor = 0;
    for (const frame of frames) {
        const at = number(frame.at);
        while (cursor + 1 < clients.length && number(clients[cursor + 1].at) <= at) cursor++;
        const client = clients[cursor];
        if (!client || number(client.at) > at || at - number(client.at) > 300) continue;
        assert(Array.isArray(frame.dragons));
        for (const raw of frame.dragons) {
            const n = record(raw);
            const key = `${n.nid}:${n.life}`;
            if (n.hp !== 0 || deaths.has(key) || !attacks.some(a => a.index === n.nid && number(a.at) < at)) continue;
            deaths.add(key);
            events.push({ at, action: 'death', item: '', tile: tile(client.tile), anchor: tile(client.anchor),
                used: number(client.used), sharks: number(client.sharks), prayerXp: number(client.prayerXp), ...inventory(client) });
        }
    }
    for (const client of clients) {
        let action: LootEvent['action'] = 'tick';
        if (client.kind === 'npc-action' && client.action === 'Attack') action = 'Attack';
        if (client.kind === 'inventory-action' && (client.action === 'Drop' || client.action === 'Bury')) action = client.action;
        if (client.kind === 'ground-action' && client.action === 'Take') action = 'Take';
        events.push({ at: number(client.at), action, item: typeof client.item === 'string' ? client.item : '',
            danger: typeof client.hpFraction === 'number' && typeof client.retreatHp === 'number' && client.hpFraction < client.retreatHp,
            tile: tile(client.tile), anchor: tile(client.anchor), used: number(client.used), sharks: number(client.sharks), prayerXp: number(client.prayerXp), ...inventory(client) });
    }
    return events.sort((a, b) => a.at - b.at);
}
