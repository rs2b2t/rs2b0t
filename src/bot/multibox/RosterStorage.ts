import { isRosterScript } from './RosterTypes.js';
import { desktopStorage } from '../runtime/desktopStorage.js';
import { boxStoragePrefix } from './ProfileTransfer.js';

function canonicalScript(script: string): string {
    return script === 'NatureCrafter' ? 'JiveRC' : script;
}

function requireScript(script: string): string {
    if (!isRosterScript(script)) throw new Error('Choose a script.');
    return canonicalScript(script);
}

function settingPrefixes(username: string, script: string): string[] {
    return (script === 'JiveRC' ? ['NatureCrafter', script] : [script]).map(name => `${boxStoragePrefix(username)}set:${name}:`);
}

function stores(): Storage[] {
    return [localStorage, sessionStorage];
}

function read(key: string): string | null {
    return desktopStorage ? localStorage.getItem(key) : sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

function keys(prefix: string): string[] {
    const result = new Set<string>();
    if (desktopStorage) {
        for (const key of desktopStorage.keys()) if (key.startsWith(prefix)) result.add(key);
    }
    for (const store of desktopStorage ? [sessionStorage] : stores()) {
        const length = store.length;
        for (let i = 0; i < length; i++) {
            const key = store.key(i);
            if (key?.startsWith(prefix)) result.add(key);
        }
    }
    return [...result];
}

export function readProfileScript(username: string): string {
    return canonicalScript(read(`${boxStoragePrefix(username)}selectedScript`) ?? '');
}

export function writeProfileScript(username: string, script: string): void {
    script = requireScript(script);
    for (const store of stores()) store.setItem(`${boxStoragePrefix(username)}selectedScript`, script);
}

export function readScriptSettings(username: string, script: string): Record<string, string> {
    script = requireScript(script);
    return Object.fromEntries(settingPrefixes(username, script).flatMap(prefix => keys(prefix).flatMap(key => {
        const value = read(key);
        return value === null ? [] : [[key.slice(prefix.length), value]];
    })));
}

export function replaceScriptSettings(username: string, script: string, values: Record<string, string>): void {
    script = requireScript(script);
    const prefix = `${boxStoragePrefix(username)}set:${script}:`;
    const previous = settingPrefixes(username, script).flatMap(keys);
    for (const store of stores()) {
        for (const key of previous) store.removeItem(key);
        for (const [key, value] of Object.entries(values)) store.setItem(prefix + key, value);
    }
}

export function storedScripts(usernames: string[]): string[] {
    const scripts = new Set<string>();
    const savedKeys = keys('rs2b0t:');
    for (const username of usernames) {
        const selected = readProfileScript(username);
        if (selected) scripts.add(selected);
        const prefix = `${boxStoragePrefix(username)}set:`;
        for (const key of savedKeys) {
            if (!key.startsWith(prefix)) continue;
            const suffix = key.slice(prefix.length);
            const end = suffix.indexOf(':');
            if (end > 0) scripts.add(canonicalScript(suffix.slice(0, end)));
        }
    }
    return [...scripts].filter(isRosterScript).sort();
}
