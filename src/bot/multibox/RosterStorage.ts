import { isRosterScript } from './RosterTypes.js';
import { boxKey, boxKeyTail, profileStorageKeys, readBoxItem, replaceBoxSettings } from '../runtime/box.js';
import { storeKeys } from '../runtime/desktopStorage.js';

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

function keys(id: string): string[] {
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
        const prefix = `set:${name}:`;
        for (const key of saved) {
            const setting = boxKeyTail(key, prefix, username);
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

export function replaceScriptSettings(username: string, script: string, values: Record<string, string>, select = false): void {
    script = requireScript(script);
    const previous = scriptEntries(username, script).map(({ suffix }) => suffix);
    replaceBoxSettings(username, script, previous, values, select);
}

export function storedScripts(usernames: string[]): string[] {
    const scripts = new Set(usernames.map(readProfileScript));
    for (const store of stores()) {
        const saved = storeKeys(store);
        for (const username of usernames) {
            for (const key of profileStorageKeys(store, username, saved)) {
                const suffix = boxKeyTail(key, 'set:', username);
                if (suffix === null) continue;
                const end = suffix.indexOf(':');
                if (end > 0) scripts.add(canonicalScript(suffix.slice(0, end)));
            }
        }
    }
    return [...scripts].filter(isRosterScript).sort();
}
