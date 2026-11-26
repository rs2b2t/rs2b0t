import { isRosterScript } from './RosterTypes.js';
import { boxKey, boxKeyTail, clearBoxItem, profileStorageKeys, readBoxItem } from '../runtime/box.js';

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

function keys(id?: string): string[] {
    const saved = stores().flatMap(store => profileStorageKeys(store, id));
    return [...new Set(saved)];
}

export function readProfileScript(username: string): string {
    return canonicalScript(readBoxItem('selectedScript', username) ?? '');
}

export function writeProfileScript(username: string, script: string): void {
    script = requireScript(script);
    for (const store of stores()) store.setItem(boxKey('selectedScript', username), script);
}

function scriptEntries(username: string, script: string) {
    const names = script === 'JiveRC' ? ['NatureCrafter', script] : [script];
    const saved = keys(username);
    const entries = [];
    for (const name of names) {
        const prefix = boxKey(`set:${name}:`, username);
        for (const key of saved) {
            const setting = boxKeyTail(key, prefix);
            if (setting !== null) entries.push({ suffix: `set:${name}:${setting}`, setting });
        }
    }
    return entries;
}

export function readScriptSettings(username: string, script: string): Record<string, string> {
    script = requireScript(script);
    return Object.fromEntries(scriptEntries(username, script).flatMap(({ suffix, setting }) => {
        const value = readBoxItem(suffix, username);
        return value === null ? [] : [[setting, value]];
    }));
}

export function replaceScriptSettings(username: string, script: string, values: Record<string, string>): void {
    script = requireScript(script);
    const previous = scriptEntries(username, script);
    for (const store of stores()) {
        for (const { suffix } of previous) clearBoxItem(store, suffix, username);
        for (const [key, value] of Object.entries(values)) store.setItem(boxKey(`set:${script}:${key}`, username), value);
    }
}

export function storedScripts(usernames: string[]): string[] {
    const scripts = new Set<string>();
    const rawKeys = keys();
    const setKeys = usernames.includes('set') ? keys('set') : [];
    for (const username of usernames) {
        const selected = readProfileScript(username);
        if (selected) scripts.add(selected);
        const prefix = boxKey('set:', username);
        for (const key of username === 'set' ? setKeys : rawKeys) {
            const suffix = boxKeyTail(key, prefix);
            if (suffix === null) continue;
            const end = suffix.indexOf(':');
            if (end > 0) scripts.add(canonicalScript(suffix.slice(0, end)));
        }
    }
    return [...scripts].filter(isRosterScript).sort();
}
