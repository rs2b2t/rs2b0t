/**
 * Session store for the active nav path (Microbot-style path publish).
 * Paint and recovery subscribe; walk never forges client path packets.
 */

export interface PublishedPathTile {
    x: number;
    z: number;
    level: number;
    /** True when this step is a transport hop (door/ladder/tele). */
    transport?: boolean;
    /**
     * Display text for a hop (e.g. "Open Door", "Varrock teleport").
     * Only set on transport tiles.
     */
    label?: string;
}

export interface PublishedPath {
    tiles: PublishedPathTile[];
    pathIdx: number;
    /** Optional next click target index for highlight. */
    clickIdx: number;
}

let active: PublishedPath | null = null;

/** SP-like hop caption from executor transport metadata. */
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
        active = {
            tiles: tiles.slice(),
            pathIdx,
            clickIdx
        };
    },

    update(pathIdx: number, clickIdx = -1): void {
        if (!active) {
            return;
        }
        active.pathIdx = pathIdx;
        active.clickIdx = clickIdx;
    },

    clear(): void {
        active = null;
    },

    get(): PublishedPath | null {
        return active;
    }
};
