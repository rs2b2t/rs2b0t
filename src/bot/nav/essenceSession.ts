/**
 * Bot-side essence-mine session return (server varp is not client-transmitted).
 *
 * Content sets `%exit_essence_mine_coord` (pack id 64) on wizard entry, but that
 * varp has no `transmit=yes` — see docs/local/varp-transmit-inventory.md.
 * We mirror the dest when we successfully take an entry hop (specialCrossing /
 * catalog edge), and feed it into WorldState.essenceExitReturn for plan filters.
 */

import type { EssenceReturnId } from './essenceExit.js';
import { ESSENCE_EXIT_RETURNS, essenceReturnIdFromTile } from './essenceExit.js';
import type { NavPoint } from './types.js';

/** Map entry NPC / loc display names → return id. */
const NPC_TO_RETURN: Readonly<Record<string, EssenceReturnId>> = {
    aubury: 'aubury',
    sedridor: 'sedridor',
    'wizard distentor': 'distentor',
    distentor: 'distentor',
    'wizard cromperty': 'cromperty',
    cromperty: 'cromperty',
    brimstail: 'brimstail'
};

/** Catalog debugName prefix → return id (ess_entry_aubury). */
const ENTRY_DEBUG_RE = /^ess_entry_([a-z]+)/i;

let sessionReturn: EssenceReturnId | undefined;
/** Optional harness override (cheat-tele into mine without wizard). */
let harnessOverride: EssenceReturnId | undefined;

export const EssenceSession = {
    /** Active return id, if known. */
    getReturnId(): EssenceReturnId | undefined {
        return harnessOverride ?? sessionReturn;
    },

    /** After a successful wizard entry hop. */
    noteEntry(returnId: EssenceReturnId): void {
        sessionReturn = returnId;
    },

    /** Infer from NPC / loc name (Aubury, Wizard Cromperty, …). */
    noteEntryFromNpc(name: string | undefined | null): EssenceReturnId | null {
        if (!name) {
            return null;
        }
        const id = NPC_TO_RETURN[name.trim().toLowerCase()];
        if (id) {
            sessionReturn = id;
            return id;
        }
        return null;
    },

    /**
     * Infer from a completed transport hop: entry edges land on the mine pad
     * with action Teleport; also match ess_entry_* debug via locName heuristics.
     */
    noteEntryFromTransport(transport: {
        locName?: string;
        action?: string;
        kind?: string;
        toTile?: { x: number; z: number };
        locX?: number;
        locZ?: number;
    }): EssenceReturnId | null {
        const action = (transport.action ?? '').toLowerCase();
        // Only wizard Teleport hops set the session return (not mine exit Portal Use).
        if (action !== 'teleport') {
            return null;
        }
        const fromNpc = this.noteEntryFromNpc(transport.locName);
        if (fromNpc) {
            return fromNpc;
        }
        // Approach stand is a known surface return tile.
        if (transport.locX !== undefined && transport.locZ !== undefined) {
            const atStand = essenceReturnIdFromTile({
                x: transport.locX,
                z: transport.locZ,
                level: 0
            });
            if (atStand) {
                sessionReturn = atStand;
                return atStand;
            }
        }
        return null;
    },

    /** Match specialCrossing label "Aubury → essence mine". */
    noteEntryFromCrossingLabel(label: string | undefined): EssenceReturnId | null {
        if (!label || !/essence\s*mine/i.test(label)) {
            return null;
        }
        const head = label.split(/→|->/)[0]?.trim() ?? label;
        return this.noteEntryFromNpc(head);
    },

    /** Live harness: force return when tele'd into mine without entry NPC. */
    setHarnessOverride(id: EssenceReturnId | undefined): void {
        harnessOverride = id;
    },

    clearHarnessOverride(): void {
        harnessOverride = undefined;
    },

    /** Logout / new character — drop remembered return. */
    clear(): void {
        sessionReturn = undefined;
        harnessOverride = undefined;
    },

    /** Test helper. */
    _resetForTests(): void {
        this.clear();
    }
};

/** Surface tile for a return id (content constants). */
export function essenceSessionReturnTile(id: EssenceReturnId): NavPoint {
    return ESSENCE_EXIT_RETURNS[id];
}

export function essenceReturnIdFromEntryDebugName(debugName: string | undefined): EssenceReturnId | null {
    if (!debugName) {
        return null;
    }
    const m = ENTRY_DEBUG_RE.exec(debugName);
    if (!m) {
        return null;
    }
    const key = m[1]!.toLowerCase();
    if (key in ESSENCE_EXIT_RETURNS) {
        return key as EssenceReturnId;
    }
    // distentor spelling in catalog
    if (key === 'distentor') {
        return 'distentor';
    }
    return null;
}
