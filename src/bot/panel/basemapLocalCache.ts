/**
 * Persist the map picker's basemap across sessions, invalidating on the same /crc table the client loads at login (`Client.getJagChecksums` → nine g4s + trailer) and on the bake prefs fingerprint; either mismatch is a miss and the deploy PNG is used.
 * Why: opening the picker never runs MapView — only Rebuild map… regenerates.
 */
import type { BasemapManifest } from './worldMapBasemap.js';
import { prefsFingerprint, type BasemapBakePrefs } from './basemapRegen.js';

const DB_NAME = 'rs2b0t-map-picker';
const DB_VERSION = 1;
const STORE = 'basemap';
const ROW_KEY = 'current';

type BasemapLocalRecord = {
    /** Hex of the 9×u32 jag checksums from `/crc` (login CRC table). */
    crcKey: string;
    prefsKey: string;
    manifest: BasemapManifest;
    /** PNG (or other) blob of the raster. */
    imageBlob: Blob;
    savedAt: number;
};

export type LoadedBasemap = {
    manifest: BasemapManifest;
    image: CanvasImageSource;
    /** deploy | local-cache | regenerated */
    source: 'deploy' | 'local-cache' | 'regenerated';
    crcKey: string | null;
};

/** Same `/crc` the client fetches before jag downloads / login. */
export async function fetchClientCrcKey(): Promise<string | null> {
    try {
        const res = await fetch(new URL('/crc', typeof location !== 'undefined' ? location.origin : 'http://localhost'));
        if (!res.ok) {
            return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Client reads 9×g4 + 1×g4 expected; key off the nine checksums (36 bytes).
        if (bytes.length < 36) {
            return null;
        }
        let key = '';
        for (let i = 0; i < 36; i++) {
            key += bytes[i]!.toString(16).padStart(2, '0');
        }
        return key;
    } catch {
        return null;
    }
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('indexedDB unavailable'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error ?? new Error('idb open failed'));
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
    });
}

export async function readBasemapLocalCache(): Promise<BasemapLocalRecord | null> {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(ROW_KEY);
            req.onsuccess = () => {
                const v = req.result as BasemapLocalRecord | undefined;
                resolve(v && v.imageBlob && v.crcKey ? v : null);
            };
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    } catch {
        return null;
    }
}

async function writeBasemapLocalCache(rec: BasemapLocalRecord): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec, ROW_KEY);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

export async function clearBasemapLocalCache(): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(ROW_KEY);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* ignore */
    }
}

async function imageSourceToPngBlob(
    image: CanvasImageSource,
    width: number,
    height: number
): Promise<Blob> {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) {
        throw new Error('2d context unavailable');
    }
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
    if (!blob) {
        throw new Error('toBlob failed');
    }
    return blob;
}

export async function blobToImage(blob: Blob): Promise<CanvasImageSource> {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(blob);
    }
    const url = URL.createObjectURL(blob);
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('image decode failed'));
            el.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function prefsKeyFromBakePrefs(prefs: BasemapBakePrefs): string {
    return prefsFingerprint(prefs);
}

/**
 * Persist a regenerated basemap under the current client CRC key + prefs fingerprint.
 * Call after a successful manual **Rebuild map…**.
 */
export async function saveRegeneratedBasemapLocally(
    crcKey: string,
    prefs: BasemapBakePrefs,
    manifest: BasemapManifest,
    image: CanvasImageSource
): Promise<void> {
    const w = manifest.sizeTiles.w * manifest.pixelsPerTile;
    const h = manifest.sizeTiles.h * manifest.pixelsPerTile;
    const imageBlob = await imageSourceToPngBlob(image, w, h);
    await writeBasemapLocalCache({
        crcKey,
        prefsKey: prefsKeyFromBakePrefs(prefs),
        manifest: { ...manifest, basemapUrl: 'local-cache' },
        imageBlob,
        savedAt: Date.now()
    });
}
