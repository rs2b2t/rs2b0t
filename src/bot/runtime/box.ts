import { botFrameUrl } from '../../client/config/worlds.js';
import { desktopStorage, isEncodedSettingKey, setProfileMigrationKey, settingsStoragePrefix, storeKeys } from './desktopStorage.js';

// docs/decisions/architecture.md#per-instance-storage
// Why: same-origin multibox frames share sessionStorage, so `?box=<account>` namespaces each bot.
// Standalone tabs use the empty box id and their own sessionStorage.
export function boxId(): string {
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

const setProfilePrefix = settingsStoragePrefix + 'profile/';

// Why: every profile prefix contains another colon after rs2b0t:.
function encodeSuffix(suffix: string): string {
    return suffix.replaceAll('%', '%25').replaceAll(':', '%3A');
}

export function boxKey(suffix: string, id = boxId()): string {
    if (id === 'set' && suffix.includes(':')) return setProfilePrefix + encodeSuffix(suffix);
    if (!id && suffix.startsWith('set:set:')) return settingsStoragePrefix + 'standalone/' + encodeSuffix(suffix);
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

export function boxKeyTail(key: string, prefix: string): string | null {
    if (!key.startsWith(prefix)) return null;
    const tail = key.slice(prefix.length);
    if (!isEncodedSettingKey(prefix)) return tail;
    return isEncodedSettingKey(key) ? tail.replaceAll('%3A', ':').replaceAll('%25', '%') : null;
}

export function boxSuffix(key: string, prefix: string, id: string): string | null {
    if (id === 'set' && key.startsWith(setProfilePrefix)) return boxKeyTail(key, setProfilePrefix);
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    return key.slice(prefix.length);
}

export function isLegacySetProfileSetting(suffix: string): boolean {
    return /^set:[^:]+:/.test(suffix);
}

export function disableLegacySetProfileSettings(store: Storage): void {
    store.setItem(setProfileMigrationKey, '1');
}

function legacyKey(suffix: string, id: string): string | null {
    if (!id && suffix.startsWith('set:set:')) return `rs2b0t:${suffix}`;
    if (id === 'set' && isLegacySetProfileSetting(suffix)) return `rs2b0t:set:${suffix}`;
    return null;
}

function clearedKey(key: string): string {
    return settingsStoragePrefix + 'cleared/' + key.slice(settingsStoragePrefix.length);
}

function allowsLegacy(store: Storage, key: string, id: string): boolean {
    const cleared = clearedKey(key);
    if (id === 'set') {
        if (store.getItem(setProfileMigrationKey) !== null) return false;
        if (typeof localStorage !== 'undefined' && store !== localStorage) {
            if (localStorage.getItem(setProfileMigrationKey) !== null) return false;
            if (desktopStorage && localStorage.getItem(cleared) !== null) return false;
        }
    }
    return store.getItem(cleared) === null;
}

export function readBoxItem(suffix: string, id: string): string | null {
    const live = !desktopStorage && typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
    const durable = typeof localStorage !== 'undefined' ? localStorage : undefined;
    const key = boxKey(suffix, id);
    const legacy = legacyKey(suffix, id);
    for (const store of [live, durable]) {
        if (!store) continue;
        const value = store.getItem(key);
        if (value !== null) return value;
        if (legacy !== null && allowsLegacy(store, key, id)) {
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
        store.setItem(clearedKey(key), '1');
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
