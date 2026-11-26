import { botFrameUrl } from '../../client/config/worlds.js';
import { beginLegacySettingsCopy, commitDesktopSettings, desktopStorage, isEncodedSettingKey, legacyCopyStorage, setProfileMigrationKey, settingsStoragePrefix, storeKeys } from './desktopStorage.js';

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

function decodedSuffix(key: string, ownerPrefix: string): string | null {
    return key.startsWith(ownerPrefix) ? decodeSuffix(key.slice(ownerPrefix.length)) : null;
}

export function boxSuffix(key: string, prefix: string, id: string): string | null {
    if (id.startsWith('set:')) return isEncodedSettingKey(key) ? decodedSuffix(key, nestedProfilePrefix(id)) : null;
    if (id === 'set' && isEncodedSettingKey(key)) return decodedSuffix(key, setProfilePrefix);
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    return key.slice(prefix.length);
}

function standaloneSuffix(key: string): string | null {
    if (isEncodedSettingKey(key)) return decodedSuffix(key, standalonePrefix);
    if (!key.startsWith('rs2b0t:') || key === setProfileMigrationKey) return null;
    const suffix = key.slice('rs2b0t:'.length);
    return !suffix.includes(':') || /^set:[^:]*:/.test(suffix) ? suffix : null;
}

export function boxKeyTail(key: string, prefix: string, id: string): string | null {
    const suffix = id ? boxSuffix(key, `rs2b0t:${id}:`, id) : standaloneSuffix(key);
    return suffix !== null && suffix.startsWith(prefix) ? suffix.slice(prefix.length) : null;
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

function writeItem(store: Storage, key: string, value: string | null): void {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
}

export function clearBoxItem(store: Storage, suffix: string, id: string, write = writeItem): void {
    const key = boxKey(suffix, id);
    const legacy = legacyKey(suffix, id);
    if (legacy && allowsLegacyBoxItem(store, key, id)) {
        const savedOnDesktop = desktopStorage && id !== '' && store === localStorage && store.getItem(key) !== null;
        if (savedOnDesktop || store.getItem(legacy) !== null) write(store, clearedKey(key), '1');
    }
    write(store, key, null);
}

class SettingsSnapshotChanged extends Error {}

export function retrySettingsCopy<T>(copy: () => T): T {
    try {
        return copy();
    } catch (error) {
        if (!(error instanceof SettingsSnapshotChanged)) throw error;
        return copy();
    }
}

export function replaceBoxSettings(id: string, script: string, clearSuffixes: string[], values: Record<string, string>, select = false): void {
    const commit = localStorage[commitDesktopSettings];
    const discardMirrors = localStorage[beginLegacySettingsCopy]?.();
    const durableChanges: Record<string, string | null> = {};
    const legacy = localStorage[legacyCopyStorage];
    const undo: Array<() => void> = [];
    function write(store: Storage, key: string, value: string | null, previous = store.getItem(key)): void {
        const bridge = store === localStorage ? legacy : undefined;
        if (previous === value) return;
        undo.push(() => {
            if (bridge) bridge.swap(key, value, previous);
            else if (store.getItem(key) === value) writeItem(store, key, previous);
        });
        if (bridge) {
            if (!bridge.swap(key, previous, value)) {
                undo.pop();
                throw new Error('Saved settings changed during copy.');
            }
        } else writeItem(store, key, value);
    }
    try {
        for (const store of [sessionStorage, localStorage]) {
            const changes: Record<string, string | null> = store === localStorage ? durableChanges : {};
            const stage = (_store: Storage, key: string, value: string | null) => { changes[key] = value; };
            for (const suffix of clearSuffixes) clearBoxItem(store, suffix, id, stage);
            for (const [key, value] of Object.entries(values)) changes[boxKey(`set:${script}:${key}`, id)] = value;
            if (select) changes[boxKey('selectedScript', id)] = script;
            if (store === localStorage && (commit || legacy)) continue;

            const growing: [string, string][] = [];
            for (const [key, value] of Object.entries(changes)) {
                const previous = store.getItem(key);
                if (value !== null && (previous === null || value.length > previous.length)) growing.push([key, value]);
                else write(store, key, value, previous);
            }
            for (const [key, value] of growing) write(store, key, value);
        }
        if (legacy) {
            const entries = Object.entries(durableChanges).map(([key, value]) => ({ key, value, previous: legacy.read(key) }));
            for (const { key, previous, value } of entries) legacy.check(key, previous, value);
            for (const { key, previous, value } of entries) if (value === null) write(localStorage, key, null, previous);
            for (const { key, previous, value } of entries) if (value !== null) write(localStorage, key, value, previous);
        }
        if (commit?.(durableChanges) === false) throw new SettingsSnapshotChanged('Saved settings changed during copy.');
    } catch (error) {
        let rollbackError;
        for (const restore of undo.reverse()) {
            try { restore(); } catch (cause) { rollbackError = cause; }
        }
        discardMirrors?.(Object.keys(durableChanges));
        if (rollbackError) throw rollbackError;
        throw error;
    }
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
