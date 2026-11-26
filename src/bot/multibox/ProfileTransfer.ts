import { allowsLegacyBoxItem, boxKey, boxSuffix, disableLegacySetProfileSettings, isLegacyProfileSuffix, isSetProfile, legacyBoxSuffix } from '../runtime/box.js';
import type { Profile } from './ProfileVault.js';
import { desktopStorage, storeKeys } from '../runtime/desktopStorage.js';

export const PROFILE_FILE_KIND = 'rs2b0t-multibox-profiles';
export const PROFILE_FILE_VERSION = 2;
export const PROFILE_FILE_NAME = 'rs2b0t-profiles.json';

export type BoxStorageMap = Record<string, Record<string, string>>;

export interface ProfileSnapshot {
    profiles: Profile[];
    tabs: string[];
    activeTab: string;
    storage: BoxStorageMap;
}

export interface ProfileFile extends ProfileSnapshot {
    kind: typeof PROFILE_FILE_KIND;
    v: 1 | typeof PROFILE_FILE_VERSION;
}

const MAIN_TAB = 'Main';

export function serializeProfileFile(data: ProfileSnapshot): string {
    requireProfiles(data.profiles);
    const usernames = [...data.profiles.map(p => p.username), ...Object.keys(data.storage)];
    const file: ProfileFile = {
        kind: PROFILE_FILE_KIND,
        v: usernames.some(isSetProfile) ? PROFILE_FILE_VERSION : 1,
        profiles: data.profiles,
        tabs: data.tabs,
        activeTab: data.activeTab,
        storage: data.storage
    };
    return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseProfileFile(text: string): ProfileSnapshot {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('profile file is not JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('profile file has an unrecognized shape');
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.kind !== PROFILE_FILE_KIND) {
        throw new Error(`profile file kind is ${JSON.stringify(obj.kind)}, expected '${PROFILE_FILE_KIND}'`);
    }
    if (obj.v !== 1 && obj.v !== PROFILE_FILE_VERSION) {
        throw new Error(`profile file version is ${JSON.stringify(obj.v)}, expected 1 or ${PROFILE_FILE_VERSION}`);
    }
    if (!Array.isArray(obj.profiles) || !Array.isArray(obj.tabs) || typeof obj.activeTab !== 'string') {
        throw new Error('profile file is missing profiles, tabs, or activeTab');
    }
    if (obj.tabs.some(t => typeof t !== 'string')) {
        throw new Error('profile file tabs must be strings');
    }
    return {
        profiles: requireProfiles(obj.profiles),
        tabs: obj.tabs as string[],
        activeTab: obj.activeTab,
        storage: parseStorage(obj.storage, obj.v)
    };
}

export function boxStoragePrefix(username: string): string {
    return `rs2b0t:${username}:`;
}

export function collectBoxStorage(usernames: string[], includeLegacy?: (suffix: string) => boolean): BoxStorageMap {
    const out: BoxStorageMap = {};
    const legacy = includeLegacy && usernames.includes('set') ? new Map<string, Storage>() : null;
    if (typeof localStorage !== 'undefined') {
        readStore(localStorage, usernames, out, legacy);
    }
    if (typeof sessionStorage !== 'undefined') {
        readStore(sessionStorage, usernames, out, legacy, !!desktopStorage);
    }
    if (legacy && includeLegacy) {
        const preferred = desktopStorage ? globalThis.localStorage : globalThis.sessionStorage;
        for (const [suffix, store] of legacy) {
            if (out.set && Object.hasOwn(out.set, suffix) && (store !== preferred || store.getItem(boxKey(suffix, 'set')) !== null)) continue;
            const value = store.getItem(boxStoragePrefix('set') + suffix);
            if (value === null || !includeLegacy(suffix)) continue;
            out.set ??= {};
            out.set[suffix] = value;
        }
    }
    return out;
}

export function applyBoxStorage(storage: BoxStorageMap, wipe: string[]): void {
    const boxes = [...new Set([...wipe, ...Object.keys(storage)])].map(user => ({ user, prefix: boxStoragePrefix(user) }));
    const stores: Storage[] = [];
    if (typeof localStorage !== 'undefined') {
        stores.push(localStorage);
    }
    if (typeof sessionStorage !== 'undefined') {
        stores.push(sessionStorage);
    }
    for (const store of stores) {
        for (const key of storeKeys(store)) {
            if (boxes.some(({ user, prefix }) => boxSuffix(key, prefix, user) !== null)) {
                store.removeItem(key);
            }
        }
        for (const { user } of boxes) disableLegacySetProfileSettings(store, user);
        for (const [user, entries] of Object.entries(storage)) {
            for (const [suffix, value] of Object.entries(entries)) {
                store.setItem(boxKey(suffix, user), value);
            }
        }
    }
}

function readStore(store: Storage, usernames: string[], out: BoxStorageMap, legacy: Map<string, Storage> | null, desktopSession = false): void {
    for (const key of storeKeys(store)) {
        const candidate = legacy && legacyBoxSuffix(store, key, 'set');
        if (legacy && candidate !== null && (!desktopSession || !legacy.has(candidate))) legacy.set(candidate, store);
        for (const user of usernames) {
            const suffix = boxSuffix(key, boxStoragePrefix(user), user);
            if (suffix === null) {
                continue;
            }
            if (desktopSession && suffix === 'selectedScript') continue;
            if (desktopSession && user === 'set' && suffix.startsWith('set:')) {
                if (out.set && Object.hasOwn(out.set, suffix)) continue;
                if (!allowsLegacyBoxItem(store, key, user)) continue;
            }
            const value = store.getItem(key);
            if (value === null) {
                continue;
            }
            out[user] ??= {};
            out[user][suffix] = value;
        }
    }
}

function parseStorage(raw: unknown, version: number): BoxStorageMap {
    if (raw === undefined) {
        return {};
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('profile file storage must be an object');
    }
    const out: BoxStorageMap = {};
    for (const [user, entries] of Object.entries(raw as Record<string, unknown>)) {
        if (user.length === 0) {
            throw new Error('profile file storage has an empty username');
        }
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
            throw new Error(`profile file storage for '${user}' must be an object`);
        }
        const box: Record<string, string> = {};
        for (const [suffix, value] of Object.entries(entries as Record<string, unknown>)) {
            if (typeof value !== 'string') {
                throw new Error(`profile file storage '${user}.${suffix}' must be a string`);
            }
            if (version === 1 && !isLegacyProfileSuffix(user, suffix)) continue;
            box[suffix] = value;
        }
        out[user] = box;
    }
    return out;
}

function requireProfiles(v: unknown[]): Profile[] {
    const out: Profile[] = [];
    for (const raw of v) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`invalid profile entry ${JSON.stringify(raw)}`);
        }
        const p = raw as Record<string, unknown>;
        if (typeof p.username !== 'string' || p.username.length === 0 || typeof p.password !== 'string') {
            throw new Error(`invalid profile entry ${JSON.stringify(raw)}`);
        }
        const entry: Profile = { username: p.username, password: p.password };
        if (p.world !== undefined) {
            if (p.world !== 1 && p.world !== 2 && p.world !== 3) {
                throw new Error(`invalid profile world on '${p.username}': expected 1, 2 or 3`);
            }
            entry.world = p.world;
        }
        if (typeof p.tab === 'string' && p.tab !== MAIN_TAB) {
            entry.tab = p.tab;
        } else if (p.tab !== undefined && p.tab !== MAIN_TAB) {
            throw new Error(`invalid profile tab on '${p.username}': ${JSON.stringify(p.tab)}`);
        }
        out.push(entry);
    }
    return out;
}
