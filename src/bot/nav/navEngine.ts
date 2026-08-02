/**
 * Classic (v1) vs Nav v2 walker selection for end users.
 *
 * Resolution order (first wins):
 * 1. Explicit WalkOptions.navEngine / PathFinder call site
 * 2. URL `?Global.navEngine=v2` (SettingsStore)
 * 3. Global settings panel value (localStorage / session)
 * 4. Default: classic
 */

import { SettingsStore } from '../runtime/Settings.js';

export type NavEngineId = 'classic' | 'v2';

export const NAV_ENGINE_CLASSIC: NavEngineId = 'classic';
export const NAV_ENGINE_V2: NavEngineId = 'v2';

export function parseNavEngine(raw: unknown): NavEngineId | null {
    if (raw === 'v2' || raw === 'nav-v2' || raw === 'navv2' || raw === true) {
        return NAV_ENGINE_V2;
    }
    if (raw === 'classic' || raw === 'v1' || raw === 'nav' || raw === false) {
        return NAV_ENGINE_CLASSIC;
    }
    if (typeof raw === 'string') {
        const t = raw.trim().toLowerCase();
        if (t === 'v2' || t === 'nav-v2' || t === 'navv2') {
            return NAV_ENGINE_V2;
        }
        if (t === 'classic' || t === 'v1' || t === 'nav') {
            return NAV_ENGINE_CLASSIC;
        }
    }
    return null;
}

/**
 * Active engine for walks that did not force an override.
 * Safe to call from the browser main thread (not the nav worker).
 */
export function resolveNavEngine(override?: NavEngineId | string | boolean | null): NavEngineId {
    const forced = parseNavEngine(override);
    if (forced) {
        return forced;
    }
    try {
        const fromGlobal = parseNavEngine(SettingsStore.globalBag().str('navEngine', NAV_ENGINE_CLASSIC));
        if (fromGlobal) {
            return fromGlobal;
        }
    } catch {
        // headless / tests without storage
    }
    return NAV_ENGINE_CLASSIC;
}

export function isNavV2(override?: NavEngineId | string | boolean | null): boolean {
    return resolveNavEngine(override) === NAV_ENGINE_V2;
}
