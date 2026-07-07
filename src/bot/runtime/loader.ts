import { ScriptRunner } from './ScriptRunner.js';
import { isBotManifest, registerScript } from './defineBot.js';
import type { ScriptMeta } from './ScriptRegistry.js';

// Indirect import() so Bun's bundler can't try to resolve the (runtime-only)
// specifier at build time.
const dynamicImport = new Function('u', 'return import(u)') as (url: string) => Promise<Record<string, unknown>>;

export interface LoadResult {
    ok: boolean;
    name?: string;
    error?: string;
}

/**
 * External script loading (Slice 7). Trusted code, no sandbox in v1 — a
 * loaded script runs with full page access, same as a built-in. The module's
 * default export must be a defineBot(...) manifest.
 */
async function loadModule(url: string, origin: string): Promise<LoadResult> {
    let mod: Record<string, unknown>;
    try {
        mod = await dynamicImport(url);
    } catch (err) {
        return { ok: false, error: `import failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const manifest = mod.default;
    if (!isBotManifest(manifest)) {
        return { ok: false, error: 'module default export is not a defineBot(...) manifest' };
    }

    // hot-reload guard: never swap the implementation under a live run
    const state = ScriptRunner.state;
    if (ScriptRunner.meta?.name === manifest.name && (state === 'running' || state === 'paused' || state === 'stopping')) {
        return { ok: false, error: `'${manifest.name}' is ${state} — stop it before reloading` };
    }

    let meta: ScriptMeta;
    try {
        meta = registerScript(manifest, origin);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    return { ok: true, name: meta.name };
}

/** Load (or hot-reload) a script from a URL; cache-busted per call. */
export function loadFromUrl(url: string): Promise<LoadResult> {
    const busted = `${url}${url.includes('?') ? '&' : '?'}lcb=${Date.now().toString(36)}`;
    return loadModule(busted, url);
}

/** Load a script from a local file (file picker). */
export async function loadFromFile(file: File): Promise<LoadResult> {
    const blobUrl = URL.createObjectURL(file);
    try {
        return await loadModule(blobUrl, `file:${file.name}`);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}
