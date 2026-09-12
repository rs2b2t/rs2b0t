/** Session store for the active nav path; paint and recovery read it, nothing here sends packets. */

export interface PublishedPathTile {
    x: number;
    z: number;
    level: number;
    /** True when this step is a transport hop (door/ladder/tele). */
    transport?: boolean;
    /** Hop caption ("Open Door", "Varrock teleport"), transport tiles only. */
    label?: string;
    /** Loc placement the executor will interact with (may differ from stand tile). */
    locX?: number;
    locZ?: number;
    /** Map loc id when known (for object-hull highlight). */
    locId?: number;
    /** Loc display name for scene lookup when id is missing. */
    locName?: string;
    /** Interact action (Open, Climb-up) for live Loc query. */
    action?: string;
    /** Hop kind when known (door, ladder, teleport). */
    kind?: string;
    /** Spell/jewellery tele id, no scenery hull for these. */
    teleportId?: string;
}

interface PublishedPath {
    tiles: PublishedPathTile[];
    pathIdx: number;
    /** Optional next click target index for highlight. */
    clickIdx: number;
    /** Scene-BFS segment for the current walk click (cyan overlay), set after a successful tryMove to compare pack and client routes. */
    clientSegment?: PublishedPathTile[];
}

let active: PublishedPath | null = null;

/** Hop caption from executor transport metadata. */
export function formatHopLabel(t: {
    locName: string;
    action: string;
    teleportId?: string;
    kind?: string;
}): string {
    if (t.teleportId) {
        // Prefer a human locName when the catalog set one ("Varrock teleport").
        if (t.locName && !/^teleport$/i.test(t.locName)) {
            return t.locName;
        }
        const pretty = t.teleportId
            .split('_')
            .map(w => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
            .join(' ');
        return pretty;
    }
    const action = (t.action ?? '').trim();
    const name = (t.locName ?? '').trim();
    if (action && name) {
        return `${action} ${name}`;
    }
    return name || action || 'transport';
}

export const PathPublish = {
    set(tiles: PublishedPathTile[], pathIdx = 0, clickIdx = -1): void {
        // Preserve clientSegment across pathIdx/click republish (same walk).
        const prevSeg = active?.clientSegment;
        active = {
            tiles: tiles.slice(),
            pathIdx,
            clickIdx,
            clientSegment: prevSeg
        };
    },

    update(pathIdx: number, clickIdx = -1): void {
        if (!active) {
            return;
        }
        active.pathIdx = pathIdx;
        active.clickIdx = clickIdx;
    },

    /** Explore: replace the active client-walk segment for dual paint. */
    setClientSegment(tiles: PublishedPathTile[] | null): void {
        if (!active) {
            return;
        }
        active.clientSegment = tiles && tiles.length > 0 ? tiles.slice() : undefined;
    },

    clear(): void {
        active = null;
    },

    get(): PublishedPath | null {
        return active;
    }
};
