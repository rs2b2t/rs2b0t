import { isRosterScript } from './RosterTypes.js';
import { desktopStorage } from '../runtime/desktopStorage.js';
import { boxKey, boxSuffix, migrateSetProfileStorage } from '../runtime/box.js';

function canonicalScript(script: string): string {
    return script === 'NatureCrafter' ? 'JiveRC' : script;
}

function requireScript(script: string): string {
    if (!isRosterScript(script)) throw new Error('Choose a script.');
    return canonicalScript(script);
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
    return canonicalScript(read(boxKey('selectedScript', username)) ?? '');
}

export function writeProfileScript(username: string, script: string): void {
    script = requireScript(script);
    for (const store of stores()) store.setItem(boxKey('selectedScript', username), script);
}

function scriptEntries(username: string, script: string) {
    if (username === 'set') migrateSetProfileStorage();
    const names = script === 'JiveRC' ? ['NatureCrafter', script] : [script];
    return names.flatMap(name => {
        const prefix = boxKey(`set:${name}:`, username);
        return keys(prefix).flatMap(key => {
            const setting = boxSuffix(key, prefix, username);
            return setting === null ? [] : [{ key, setting }];
        });
    });
}

export function readScriptSettings(username: string, script: string): Record<string, string> {
    script = requireScript(script);
    return Object.fromEntries(scriptEntries(username, script).flatMap(({ key, setting }) => {
        const value = read(key);
        return value === null ? [] : [[setting, value]];
    }));
}

export function replaceScriptSettings(username: string, script: string, values: Record<string, string>): void {
    script = requireScript(script);
    const previous = scriptEntries(username, script);
    for (const store of stores()) {
        for (const { key } of previous) store.removeItem(key);
        for (const [key, value] of Object.entries(values)) store.setItem(boxKey(`set:${script}:${key}`, username), value);
    }
}

export function storedScripts(usernames: string[]): string[] {
    if (usernames.includes('set')) migrateSetProfileStorage();
    const scripts = new Set<string>();
    const savedKeys = keys('rs2b0t:');
    for (const username of usernames) {
        const selected = readProfileScript(username);
        if (selected) scripts.add(selected);
        const prefix = boxKey('set:', username);
        for (const key of savedKeys) {
            const suffix = boxSuffix(key, prefix, username);
            if (suffix === null) continue;
            const end = suffix.indexOf(':');
            if (end > 0) scripts.add(canonicalScript(suffix.slice(0, end)));
        }
    }
    return [...scripts].filter(isRosterScript).sort();
}
