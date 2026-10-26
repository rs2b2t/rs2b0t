import { isRosterScript } from './RosterTypes.js';
import { desktopStorage } from '../runtime/desktopStorage.js';
import { boxStoragePrefix } from './ProfileTransfer.js';

function requireScript(script: string): void {
    if (!isRosterScript(script)) throw new Error('Choose a script.');
}

function stores(): Storage[] {
    return [localStorage, sessionStorage];
}

function read(key: string): string | null {
    return desktopStorage ? localStorage.getItem(key) : sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

function keys(prefix: string): string[] {
    const result = new Set<string>();
    for (const store of stores()) {
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key?.startsWith(prefix)) result.add(key);
        }
    }
    return [...result];
}

export function readProfileScript(username: string): string {
    return read(`${boxStoragePrefix(username)}selectedScript`) ?? '';
}

export function writeProfileScript(username: string, script: string): void {
    requireScript(script);
    for (const store of stores()) store.setItem(`${boxStoragePrefix(username)}selectedScript`, script);
}

export function readScriptSettings(username: string, script: string): Record<string, string> {
    requireScript(script);
    const prefix = `${boxStoragePrefix(username)}set:${script}:`;
    return Object.fromEntries(keys(prefix).flatMap(key => {
        const value = read(key);
        return value === null ? [] : [[key.slice(prefix.length), value]];
    }));
}

export function replaceScriptSettings(username: string, script: string, values: Record<string, string>): void {
    requireScript(script);
    const prefix = `${boxStoragePrefix(username)}set:${script}:`;
    const previous = keys(prefix);
    for (const store of stores()) {
        for (const key of previous) store.removeItem(key);
        for (const [key, value] of Object.entries(values)) store.setItem(prefix + key, value);
    }
}

export function storedScripts(usernames: string[]): string[] {
    const scripts = new Set<string>();
    for (const username of usernames) {
        const selected = readProfileScript(username);
        if (selected) scripts.add(selected);
        const prefix = `${boxStoragePrefix(username)}set:`;
        for (const key of keys(prefix)) {
            const suffix = key.slice(prefix.length);
            const end = suffix.indexOf(':');
            if (end > 0) scripts.add(suffix.slice(0, end));
        }
    }
    return [...scripts].filter(isRosterScript).sort();
}
