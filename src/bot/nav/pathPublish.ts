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
}

export interface PublishedPath {
    tiles: PublishedPathTile[];
    pathIdx: number;
    /** Optional next click target index for highlight. */
    clickIdx: number;
}

let active: PublishedPath | null = null;

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
