import { reader } from '../adapter/ClientAdapter.js';
import { bus } from './EventBus.js';
import {
    anyDirty,
    applyDirty,
    dirtyFamiliesForPacket,
    emptyDirty,
    type ProducerDirtyFlags
} from './producerDirty.js';

let lastTick = -1;
let lastXp: number[] | null = null;
let lastLevel: number[] | null = null;
let lastInvIds: number[] | null = null;
let lastInvCounts: number[] | null = null;
let lastVarps: number[] | null = null;
let lastChatSig: string | null = null;
let wasIngame = false;

/** Families that need a rescan before the next bus emit. */
let dirty: ProducerDirtyFlags = emptyDirty(true);

/** Test hook — reset caches + dirty state. */
export function resetProducersForTests(): void {
    lastTick = -1;
    lastXp = lastLevel = lastInvIds = lastInvCounts = lastVarps = null;
    lastChatSig = null;
    wasIngame = false;
    dirty = emptyDirty(true);
}

/**
 * Called from the packet path after the client has applied the opcode.
 * Marks which cached tables are stale; {@link pumpProducers} does the rescan.
 */
export function noteProducerPacket(ptype: number): void {
    const hit = dirtyFamiliesForPacket(ptype);
    if (hit === null) {
        return;
    }
    if (hit === 'reset') {
        lastXp = lastLevel = lastInvIds = lastInvCounts = lastVarps = null;
        lastChatSig = null;
        wasIngame = false;
        dirty = emptyDirty(true);
        return;
    }
    dirty = applyDirty(dirty, hit);
}

/**
 * Frame pump: emit tick on server-tick advance; rescan only dirty families.
 * Steady-state frames with no packets that affect producers cost ~nothing.
 */
export function pumpProducers(tickCount: number): void {
    if (!reader.ingame()) {
        lastXp = lastLevel = lastInvIds = lastInvCounts = lastVarps = null;
        lastChatSig = null;
        lastTick = -1;
        wasIngame = false;
        dirty = emptyDirty(true);
        return;
    }

    // First frame after login: seed caches so subsequent diffs have a baseline.
    if (!wasIngame) {
        wasIngame = true;
        dirty = emptyDirty(true);
    }

    if (tickCount !== lastTick) {
        lastTick = tickCount;
        bus.emit('tick', { tick: tickCount });
    }

    if (!anyDirty(dirty)) {
        return;
    }

    if (dirty.skills) {
        diffSkills();
        dirty.skills = false;
    }
    if (dirty.inventory) {
        diffInventory();
        dirty.inventory = false;
    }
    if (dirty.varps) {
        diffVarps();
        dirty.varps = false;
    }
    if (dirty.chat) {
        diffChat();
        dirty.chat = false;
    }
}

function diffSkills(): void {
    const count = reader.skillCount();
    const xp: number[] = new Array(count);
    const level: number[] = new Array(count);

    for (let i = 0; i < count; i++) {
        const stat = reader.stat(i);
        xp[i] = stat.xp;
        level[i] = stat.base;

        if (lastXp && stat.xp > lastXp[i]) {
            bus.emit('skill.xp', { skill: i, name: stat.name, xp: stat.xp, delta: stat.xp - lastXp[i] });
        }

        if (lastLevel && stat.base !== lastLevel[i] && lastLevel[i] > 0) {
            bus.emit('skill.level', { skill: i, name: stat.name, level: stat.base, previous: lastLevel[i] });
        }
    }

    lastXp = xp;
    lastLevel = level;
}

function diffInventory(): void {
    const items = reader.inventory();
    const size = reader.inventorySize();
    if (size === 0) {
        return;
    }

    const ids: number[] = new Array(size).fill(-1);
    const counts: number[] = new Array(size).fill(0);
    const names: (string | null)[] = new Array(size).fill(null);

    for (const item of items) {
        ids[item.slot] = item.id;
        counts[item.slot] = item.count;
        names[item.slot] = item.name;
    }

    if (lastInvIds && lastInvCounts) {
        for (let slot = 0; slot < size; slot++) {
            if (ids[slot] !== lastInvIds[slot] || counts[slot] !== lastInvCounts[slot]) {
                bus.emit('inventory.changed', {
                    slot,
                    id: ids[slot],
                    name: names[slot],
                    count: counts[slot],
                    previousId: lastInvIds[slot],
                    previousCount: lastInvCounts[slot]
                });
            }
        }
    }

    lastInvIds = ids;
    lastInvCounts = counts;
}

const VARP_SCAN = 300;

function diffVarps(): void {
    const varps: number[] = new Array(VARP_SCAN);
    for (let i = 0; i < VARP_SCAN; i++) {
        varps[i] = reader.varp(i);
    }

    if (lastVarps) {
        for (let i = 0; i < VARP_SCAN; i++) {
            if (varps[i] !== lastVarps[i]) {
                bus.emit('varp.changed', { index: i, value: varps[i], previous: lastVarps[i] });
            }
        }
    }

    lastVarps = varps;
}

function diffChat(): void {
    const lines = reader.chat(20);
    if (lines.length === 0) {
        return;
    }

    const sig = (l: { type: number; username: string | null; text: string }) =>
        `${l.type}|${l.username ?? ''}|${l.text}`;

    if (lastChatSig === null) {
        lastChatSig = sig(lines[0]);
        return;
    }

    const fresh = [];
    for (const line of lines) {
        if (sig(line) === lastChatSig) {
            break;
        }

        fresh.push(line);
    }

    lastChatSig = sig(lines[0]);

    for (const line of fresh.reverse()) {
        bus.emit('chat.message', line);
    }
}
