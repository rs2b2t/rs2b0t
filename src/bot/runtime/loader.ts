import { ScriptRunner } from './ScriptRunner.js';
import { isBotManifest, registerScript } from './defineBot.js';
import type { ScriptMeta } from './ScriptRegistry.js';

const dynamicImport = new Function('u', 'return import(u)') as (url: string) => Promise<Record<string, unknown>>;

export interface LoadResult {
    ok: boolean;
    name?: string;
    error?: string;
}

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

export function loadFromUrl(url: string): Promise<LoadResult> {
    const busted = `${url}${url.includes('?') ? '&' : '?'}lcb=${Date.now().toString(36)}`;
    return loadModule(busted, url);
}

export async function loadFromFile(file: File): Promise<LoadResult> {
    const blobUrl = URL.createObjectURL(file);
    try {
        return await loadModule(blobUrl, `file:${file.name}`);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}
