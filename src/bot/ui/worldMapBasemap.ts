/**
 * Shared basemap manifest + coordinate helpers for the walkable map picker.
 *
 * Basemap is a baked full-world raster (1 px/tile by default) aligned to
 * MapView origin/size. Walkability still comes from collision.lcnav.gz.
 */

export const BASEMAP_SCHEMA = 1;

/** Filename served next to botclient (not fingerprinted — points at fingerprinted PNG). */
export const BASEMAP_MANIFEST_NAME = 'worldmap-basemap.manifest.json';

export type BasemapManifest = {
    schema: number;
    revision?: string;
    fingerprint: string;
    /** Absolute world origin of basemap pixel (0,0) tile corner. */
    origin: { x: number; z: number };
    /** Map extent in tiles (matches MapView mapWidth × mapHeight). */
    sizeTiles: { w: number; h: number };
    pixelsPerTile: number;
    /** Relative URL of the raster (e.g. ./worldmap-basemap.<fp>.png). */
    basemapUrl: string;
    /** Byte length of source worldmap.jag used for the bake (debug). */
    jagBytes?: number;
};

/** Defaults matching MapView.ts field initializers. */
export const DEFAULT_MAP_ORIGIN = { x: 32 << 6, z: 44 << 6 };
export const DEFAULT_MAP_SIZE = { w: 25 << 6, h: 19 << 6 };

/**
 * World tile → basemap pixel (image Y increases south, like MapView local Y).
 * Pixel is the top-left of the tile cell at 1 ppt.
 */
export function worldToBasemapPx(
    worldX: number,
    worldZ: number,
    origin: { x: number; z: number },
    sizeTiles: { w: number; h: number },
    pixelsPerTile: number
): { px: number; py: number } {
    const localX = worldX - origin.x;
    const localY = sizeTiles.h - (worldZ - origin.z);
    return { px: localX * pixelsPerTile, py: localY * pixelsPerTile };
}

/**
 * Basemap pixel → world tile (continuous).
 */
export function basemapPxToWorld(
    px: number,
    py: number,
    origin: { x: number; z: number },
    sizeTiles: { w: number; h: number },
    pixelsPerTile: number
): { x: number; z: number } {
    const localX = px / pixelsPerTile;
    const localY = py / pixelsPerTile;
    return {
        x: origin.x + localX,
        z: origin.z + sizeTiles.h - localY
    };
}

/**
 * Source rect in basemap pixels for a world viewport centred on (centreX, centreZ)
 * with `tilesAcross` tiles spanning the canvas width and aspect-matched height.
 */
export function basemapSourceRect(
    centreX: number,
    centreZ: number,
    tilesAcross: number,
    canvasW: number,
    canvasH: number,
    origin: { x: number; z: number },
    sizeTiles: { w: number; h: number },
    pixelsPerTile: number
): { sx: number; sy: number; sw: number; sh: number } {
    const tilesHigh = (canvasH / canvasW) * tilesAcross;
    const west = centreX - tilesAcross / 2;
    const north = centreZ + tilesHigh / 2;
    const { px: sx, py: sy } = worldToBasemapPx(west, north, origin, sizeTiles, pixelsPerTile);
    return {
        sx,
        sy,
        sw: tilesAcross * pixelsPerTile,
        sh: tilesHigh * pixelsPerTile
    };
}

export function isBasemapManifest(v: unknown): v is BasemapManifest {
    if (!v || typeof v !== 'object') {
        return false;
    }
    const m = v as BasemapManifest;
    return (
        typeof m.fingerprint === 'string' &&
        typeof m.basemapUrl === 'string' &&
        typeof m.pixelsPerTile === 'number' &&
        m.origin != null &&
        typeof m.origin.x === 'number' &&
        typeof m.origin.z === 'number' &&
        m.sizeTiles != null &&
        typeof m.sizeTiles.w === 'number' &&
        typeof m.sizeTiles.h === 'number'
    );
}
