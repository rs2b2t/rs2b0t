/**
 * Shared basemap manifest + coordinate helpers for the walkable map picker. Deploy bake (schema ≥ 2) produces a terrain-only basemap (no Key icons, labels or zone tints) plus pre-baked transparent overlays (Key icons, multi, free) generated once.
 * Why: the picker composites overlays at paint time, so toggling Key / multi / free costs no MapView run; walkability still comes from collision.lcnav.gz.
 */

/** Bump when bake layout / overlay contract changes. */
export const BASEMAP_SCHEMA = 2;

/** Filename served next to botclient (not fingerprinted — points at fingerprinted assets). */
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
    /** Relative URL of the terrain raster (no Key icons / labels / tints). */
    basemapUrl: string;
    /**
     * Pre-baked composite of all Key icons (optional convenience). Prefer
     * `keyTypeOverlayUrls` for per-type toggles.
     */
    keyOverlayUrl?: string;
    /**
     * Per-type placement index (names + pixel centres). Used with per-type overlays.
     */
    keyIndexUrl?: string;
    /**
     * Mapfunction type id → transparent PNG of only that Key legend type
     * (Bank, Altar, …). Generated once at deploy; picker composites selected types free.
     */
    keyTypeOverlayUrls?: Record<string, string>;
    /** Pre-baked place-name / town labels (transparent). */
    labelsOverlayUrl?: string;
    /** Pre-baked multicombat tint overlay (transparent). */
    multiOverlayUrl?: string;
    /** Pre-baked free-to-play tint overlay (transparent). */
    freeOverlayUrl?: string;
    /**
     * Classic media `mapmarker` sprite (you-are-here pin) as a small PNG.
     * Optional; picker falls back to a drawn yellow X if missing.
     */
    playerMarkerUrl?: string;
    /** Byte length of source worldmap.jag used for the bake (debug). */
    jagBytes?: number;
};

/** key-index JSON next to the basemap (fingerprinted). */
export type WorldmapKeyIndex = {
    schema: 1;
    /** Same order as MapView.KEY_NAMES / classic Key legend. */
    names: string[];
    /**
     * Mapfunction type id → basemap pixel centres `[px, py]` (sprite is drawn
     * centred with a −7,−7 offset like MapView.plotSprite).
     */
    placements: Record<string, [number, number][]>;
    /** Optional sprite strip for runtime per-type draw (width = cell * n). */
    spriteStripUrl?: string;
    spriteCell?: number;
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
