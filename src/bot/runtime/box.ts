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
const standalonePrefix = settingsStoragePrefix + 'standalone/';
const ordinaryProfileFields = new Set(['selectedScript', 'rendererEnabled', 'creds']);

function needsStandaloneNamespace(suffix: string): boolean {
    return suffix.startsWith('set:') && (suffix.includes(':set:') || ordinaryProfileFields.has(suffix.slice(suffix.lastIndexOf(':') + 1)));
}

// Why: every profile prefix contains another colon after rs2b0t:.
function encodeSuffix(suffix: string): string {
    return suffix.replaceAll('%', '%25').replaceAll(':', '%3A');
}

function nestedProfilePrefix(id: string): string {
    return settingsStoragePrefix + 'owner/' + encodeSuffix(id).replaceAll('/', '%2F') + '/';
}

export function isSetProfile(id: string): boolean {
    return id === 'set' || id.startsWith('set:');
}

export function boxKey(suffix: string, id = boxId()): string {
    if (id === 'set' && suffix.includes(':')) return setProfilePrefix + encodeSuffix(suffix);
    if (id.startsWith('set:')) return nestedProfilePrefix(id) + encodeSuffix(suffix);
    if (!id && needsStandaloneNamespace(suffix)) return standalonePrefix + encodeSuffix(suffix);
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

function decodeSuffix(suffix: string): string {
    return suffix.replaceAll('%3A', ':').replaceAll('%25', '%');
}

function decodeStandaloneKey(key: string): string {
    if (!key.startsWith(standalonePrefix) || !isEncodedSettingKey(key)) return key;
    return 'rs2b0t:' + decodeSuffix(key.slice(standalonePrefix.length));
}

export function boxKeyTail(key: string, prefix: string): string | null {
    key = decodeStandaloneKey(key);
    prefix = decodeStandaloneKey(prefix);
    if (!key.startsWith(prefix)) return null;
    const tail = key.slice(prefix.length);
    if (!isEncodedSettingKey(prefix)) return tail;
    return isEncodedSettingKey(key) ? decodeSuffix(tail) : null;
}

export function boxSuffix(key: string, prefix: string, id: string): string | null {
    if (id === 'set' && key.startsWith(setProfilePrefix)) return boxKeyTail(key, setProfilePrefix);
    if (id.startsWith('set:')) return isEncodedSettingKey(key) ? boxKeyTail(key, nestedProfilePrefix(id)) : null;
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    return key.slice(prefix.length);
}

export function isLegacySetProfileSetting(suffix: string): boolean {
    return /^set:[^:]+:/.test(suffix);
}

function migrationKey(id: string): string | null {
    if (id === 'set') return setProfileMigrationKey;
    return id.startsWith('set:') ? settingsStoragePrefix + 'migrated/' + encodeSuffix(id) : null;
}

export function disableLegacySetProfileSettings(store: Storage, id = 'set'): void {
    const marker = migrationKey(id);
    if (marker) store.setItem(marker, '1');
}

function legacyKey(suffix: string, id: string): string | null {
    if (!id && needsStandaloneNamespace(suffix)) return `rs2b0t:${suffix}`;
    if (isSetProfile(id) && isLegacySetProfileSetting(suffix)) return `rs2b0t:${id}:${suffix}`;
    return null;
}

function clearedKey(key: string): string {
    return settingsStoragePrefix + 'cleared/' + key.slice(settingsStoragePrefix.length);
}

export function allowsLegacyBoxItem(store: Storage, key: string, id: string): boolean {
    const cleared = clearedKey(key);
    const marker = migrationKey(id);
    if (marker) {
        if (store.getItem(marker) !== null) return false;
        if (typeof localStorage !== 'undefined' && store !== localStorage) {
            if (localStorage.getItem(marker) !== null) return false;
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
        if (legacy !== null && allowsLegacyBoxItem(store, key, id)) {
            const fallback = store.getItem(legacy);
            if (fallback !== null) return fallback;
        }
    }
    return null;
}

export function clearBoxItem(store: Storage, suffix: string, id: string): void {
    const key = boxKey(suffix, id);
    const legacy = legacyKey(suffix, id);
    if (legacy && allowsLegacyBoxItem(store, key, id)) {
        const savedOnDesktop = desktopStorage && id !== '' && store === localStorage && store.getItem(key) !== null;
        if (savedOnDesktop || store.getItem(legacy) !== null) store.setItem(clearedKey(key), '1');
    }
    store.removeItem(key);
}

export function legacyBoxSuffix(store: Storage, key: string, id: string): string | null {
    const prefix = id ? `rs2b0t:${id}:` : 'rs2b0t:';
    if (!key.startsWith(prefix)) return null;
    const suffix = key.slice(prefix.length);
    const ordinaryField = id.startsWith('set:') && ordinaryProfileFields.has(suffix);
    if (!ordinaryField && legacyKey(suffix, id) !== key) return null;
    return allowsLegacyBoxItem(store, boxKey(suffix, id), id) ? suffix : null;
}

export function profileStorageKeys(store: Storage, id: string, keys = storeKeys(store)): string[] {
    if (id !== '' && !isSetProfile(id)) return keys;
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
