import { botFrameUrl } from '../../client/config/worlds.js';
import { desktopStorage, storeKeys } from './desktopStorage.js';

// docs/decisions/architecture.md#per-instance-storage
// Why: same-origin multibox frames share sessionStorage, so `?box=<account>` namespaces each bot.
// Standalone tabs use the empty box id and their own sessionStorage.
export function boxId(): string {
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

export function boxKey(suffix: string, id = boxId()): string {
    // Why: every standalone setting under rs2b0t:set: contains a literal colon in its suffix.
    if (id === 'set') suffix = suffix.replaceAll('%', '%25').replaceAll(':', '%3A');
    if (!id && suffix.startsWith('set:set:')) return `rs2b0t::${suffix}`;
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

export function boxSuffix(key: string, prefix: string, id: string): string | null {
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    const suffix = key.slice(prefix.length);
    return id === 'set' ? suffix.replaceAll('%3A', ':').replaceAll('%25', '%') : suffix;
}

export function isLegacySetProfileSetting(suffix: string): boolean {
    return /^set:[^:]+:/.test(suffix);
}

const setProfileMigrationKey = 'rs2b0t:set-profile-settings-v1';

export function disableLegacySetProfileSettings(store: Storage): void {
    store.setItem(setProfileMigrationKey, '1');
}

function legacyKey(suffix: string, id: string): string | null {
    if (!id && suffix.startsWith('set:set:')) return `rs2b0t:${suffix}`;
    if (id === 'set' && isLegacySetProfileSetting(suffix)) return `rs2b0t:set:${suffix}`;
    return null;
}

function allowsLegacy(store: Storage, key: string, id: string): boolean {
    return (id !== 'set' || store.getItem(setProfileMigrationKey) === null) && store.getItem(`rs2b0t::cleared:${key}`) === null;
}

export function readBoxItem(suffix: string, id: string): string | null {
    const live = !desktopStorage && typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
    const durable = typeof localStorage !== 'undefined' ? localStorage : undefined;
    const key = boxKey(suffix, id);
    const value = live?.getItem(key) ?? durable?.getItem(key);
    if (value != null) return value;
    const legacy = legacyKey(suffix, id);
    if (legacy === null) return null;
    for (const store of [live, durable]) {
        if (store && allowsLegacy(store, key, id)) {
            const fallback = store.getItem(legacy);
            if (fallback !== null) return fallback;
        }
    }
    return null;
}

export function clearBoxItem(store: Storage, suffix: string, id: string): void {
    const key = boxKey(suffix, id);
    const legacy = legacyKey(suffix, id);
    if (legacy && allowsLegacy(store, key, id) && store.getItem(legacy) !== null) {
        store.setItem(`rs2b0t::cleared:${key}`, '1');
    }
    store.removeItem(key);
}

export function legacyBoxSuffix(store: Storage, key: string, id: string): string | null {
    const prefix = id ? `rs2b0t:${id}:` : 'rs2b0t:';
    if (!key.startsWith(prefix)) return null;
    const suffix = key.slice(prefix.length);
    return legacyKey(suffix, id) === key && allowsLegacy(store, boxKey(suffix, id), id) ? suffix : null;
}

export function profileStorageKeys(store: Storage, id?: string): string[] {
    const keys = storeKeys(store);
    if (id !== 'set' && id !== '') return keys;
    return keys.map(key => {
        const suffix = legacyBoxSuffix(store, key, id);
        return suffix === null ? key : boxKey(suffix, id);
    });
}

// Why: one build serves /rs2b0t/index.html and local dev's /bot.html, and a relative path resolves to a file beside either.
// Why: './wall' would only work under the hosted Caddy rewrite.
export function wallLinkHref(box: string, current?: URL): string | null {
    if (box !== '') return null;
    if (!current || !current.search) return './multibox.html';
    const url = botFrameUrl(current, '');
    url.searchParams.delete('box');
    return `./multibox.html${url.search}`;
}
