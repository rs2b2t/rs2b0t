import type Tile from '../../geometry/Tile.js';

/** Live scenery target the raw batch clicks. */
export type Tree = {
    id: number;
    snap: { ops: (string | null)[] };
    tile(): Tile;
    distance(): number;
    interact(action: string): boolean | Promise<boolean>;
};

/** One PLAYER_INFO snapshot; the only phase source the controller may read. */
export type Observation = {
    tick: number;
    at: number;
    anim: number;
    gapMs: number;
};
