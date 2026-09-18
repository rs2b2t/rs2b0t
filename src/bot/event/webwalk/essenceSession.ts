// Why: server-only varp 64 is mirrored after an entry hop so the planner can select the right exit.

import type { EssenceReturnId } from './essenceExit.js';
import { essenceReturnIdFromTile } from './essenceExit.js';

/** Map entry NPC / loc display names to return id. */
const NPC_TO_RETURN: Readonly<Record<string, EssenceReturnId>> = {
    aubury: 'aubury',
    sedridor: 'sedridor',
    'wizard distentor': 'distentor',
    distentor: 'distentor',
    'wizard cromperty': 'cromperty',
    cromperty: 'cromperty',
    brimstail: 'brimstail'
};

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

    /** Infer from NPC / loc name (Aubury, Wizard Cromperty). */
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

    /** Infer from a completed transport hop: entry edges carry action Teleport, then the NPC name or the surface stand tile. */
    noteEntryFromTransport(transport: {
        locName?: string;
        action?: string;
        kind?: string;
        toTile?: { x: number; z: number };
        locX?: number;
        locZ?: number;
    }): EssenceReturnId | null {
        const action = (transport.action ?? '').toLowerCase();
        // Only wizard Teleport hops set the session return; the mine exit is Portal Use.
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

    /** Match a specialCrossing label like "Aubury -> essence mine". */
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

    /** Logout / new character, drop remembered return. */
    clear(): void {
        sessionReturn = undefined;
        harnessOverride = undefined;
    },

    /** Test helper. */
    _resetForTests(): void {
        this.clear();
    }
};
