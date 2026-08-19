import type { Profile } from './ProfileVault.js';

export const PROFILE_FILE_KIND = 'rs2b0t-multibox-profiles';
export const PROFILE_FILE_VERSION = 1;
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
    v: typeof PROFILE_FILE_VERSION;
}

const MAIN_TAB = 'Main';

export function serializeProfileFile(data: ProfileSnapshot): string {
    const file: ProfileFile = {
        kind: PROFILE_FILE_KIND,
        v: PROFILE_FILE_VERSION,
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
    if (obj.v !== PROFILE_FILE_VERSION) {
        throw new Error(`profile file version is ${JSON.stringify(obj.v)}, expected ${PROFILE_FILE_VERSION}`);
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
        storage: parseStorage(obj.storage)
    };
}

export function boxStoragePrefix(username: string): string {
    return `rs2b0t:${username}:`;
}

export function collectBoxStorage(usernames: string[]): BoxStorageMap {
    const out: BoxStorageMap = {};
    if (typeof localStorage !== 'undefined') {
        readStore(localStorage, usernames, out);
    }
    if (typeof sessionStorage !== 'undefined') {
        readStore(sessionStorage, usernames, out);
    }
    return out;
}

export function applyBoxStorage(storage: BoxStorageMap, wipe: string[]): void {
    const users = [...new Set([...wipe, ...Object.keys(storage)])];
    const stores: Storage[] = [];
    if (typeof localStorage !== 'undefined') {
        stores.push(localStorage);
    }
    if (typeof sessionStorage !== 'undefined') {
        stores.push(sessionStorage);
    }
    for (const store of stores) {
        const remove: string[] = [];
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key && users.some(user => key.startsWith(boxStoragePrefix(user)))) {
                remove.push(key);
            }
        }
        for (const key of remove) {
            store.removeItem(key);
        }
        for (const [user, entries] of Object.entries(storage)) {
            const prefix = boxStoragePrefix(user);
            for (const [suffix, value] of Object.entries(entries)) {
                store.setItem(prefix + suffix, value);
            }
        }
    }
}

function readStore(store: Storage, usernames: string[], out: BoxStorageMap): void {
    for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) {
            continue;
        }
        for (const user of usernames) {
            const prefix = boxStoragePrefix(user);
            if (!key.startsWith(prefix)) {
                continue;
            }
            const value = store.getItem(key);
            if (value === null) {
                continue;
            }
            out[user] ??= {};
            out[user][key.slice(prefix.length)] = value;
        }
    }
}

function parseStorage(raw: unknown): BoxStorageMap {
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
        if (typeof p.tab === 'string' && p.tab !== MAIN_TAB) {
            entry.tab = p.tab;
        } else if (p.tab !== undefined && p.tab !== MAIN_TAB) {
            throw new Error(`invalid profile tab on '${p.username}': ${JSON.stringify(p.tab)}`);
        }
        out.push(entry);
    }
    return out;
}
