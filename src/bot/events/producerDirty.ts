/**
 * Which producer tables need a rescan.
 *
 * Scans are relatively expensive (esp. 300 varps + inventory component walk).
 * The server already tells us *when* state changes via packets — so we keep a
 * cache of last snapshots and only re-diff a family after a relevant opcode
 * (or a login seed / safety resync).
 */
import { ServerProt } from '#/io/ServerProt.js';

export type ProducerFamily = 'skills' | 'inventory' | 'varps' | 'chat';

export interface ProducerDirtyFlags {
    skills: boolean;
    inventory: boolean;
    varps: boolean;
    chat: boolean;
}

export function emptyDirty(all = false): ProducerDirtyFlags {
    return { skills: all, inventory: all, varps: all, chat: all };
}

export function anyDirty(d: ProducerDirtyFlags): boolean {
    return d.skills || d.inventory || d.varps || d.chat;
}

/**
 * Map a server packet opcode to dirty families.
 * Returns null when the packet does not affect producer tables (most traffic).
 *
 * Uses {@link ServerProt} member access only (const enums cannot be cast to objects).
 */
export function dirtyFamiliesForPacket(ptype: number): ProducerFamily[] | 'reset' | null {
    if (ptype === ServerProt.LOGOUT) {
        return 'reset';
    }
    if (
        ptype === ServerProt.UPDATE_INV_FULL ||
        ptype === ServerProt.UPDATE_INV_PARTIAL ||
        ptype === ServerProt.UPDATE_INV_STOP_TRANSMIT
    ) {
        return ['inventory'];
    }
    if (ptype === ServerProt.UPDATE_STAT) {
        return ['skills'];
    }
    if (ptype === ServerProt.VARP_SMALL || ptype === ServerProt.VARP_LARGE || ptype === ServerProt.VARP_SYNC) {
        return ['varps'];
    }
    // Game + private messages land in the chat buffer the producers scan.
    if (ptype === ServerProt.MESSAGE_GAME || ptype === ServerProt.MESSAGE_PRIVATE) {
        return ['chat'];
    }
    // Rebuild can reshuffle UI/state; re-seed everything cheaply once.
    if (ptype === ServerProt.REBUILD_NORMAL) {
        return ['skills', 'inventory', 'varps', 'chat'];
    }
    return null;
}

export function applyDirty(flags: ProducerDirtyFlags, families: readonly ProducerFamily[]): ProducerDirtyFlags {
    const next = { ...flags };
    for (const f of families) {
        next[f] = true;
    }
    return next;
}
