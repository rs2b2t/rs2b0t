import type { WorldNumber } from '../../client/config/worlds.js';
import { WALK_OPTIONS } from '../api/map/WalkDestinations.js';
import type { SlotSnapshot } from './types.js';
import { isRosterScript, type RosterClient } from './RosterTypes.js';
import { readProfileScript, writeProfileScript, readScriptSettings, replaceScriptSettings, storedScripts } from './RosterStorage.js';

export interface RosterProfile {
    username: string;
    tab: string;
    world: WorldNumber;
    slot?: SlotSnapshot;
}

export type RosterCommand =
    | { kind: 'assign'; script: string }
    | { kind: 'copy'; script: string; source: string }
    | { kind: 'travel'; destination: string }
    | { kind: 'world'; world: WorldNumber }
    | { kind: 'start' | 'stop' };

export interface RosterResult {
    username: string;
    state: 'pending' | 'done' | 'skipped' | 'failed';
    message: string;
}

export interface RosterHooks {
    profiles(): RosterProfile[];
    client(profile: RosterProfile): RosterClient | null;
    setWorld(profile: RosterProfile, world: WorldNumber): Promise<boolean>;
}

function active(state: string): boolean {
    return state === 'running' || state === 'paused' || state === 'stopping';
}

export function rosterError(error: unknown): string {
    return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Action failed. Try again.';
}

export class RosterActions {
    private running = false;

    constructor(private hooks: RosterHooks) {}

    get busy(): boolean { return this.running; }

    profiles(): RosterProfile[] { return this.hooks.profiles(); }

    scripts(): string[] {
        const profiles = this.profiles();
        const names = new Set(storedScripts(profiles.map(p => p.username)));
        for (const profile of profiles) {
            for (const name of this.hooks.client(profile)?.scripts() ?? []) names.add(name);
        }
        return [...names].filter(isRosterScript).sort();
    }

    selectedScript(profile: RosterProfile): string {
        return this.hooks.client(profile)?.selectedScript() ?? readProfileScript(profile.username);
    }

    settings(source: string, script: string): Record<string, string> {
        if (!isRosterScript(script)) throw new Error('Choose a script.');
        const profile = this.profiles().find(p => p.username === source);
        if (!profile) throw new Error('Source profile is no longer available.');
        return this.hooks.client(profile)?.readSettings(script) ?? readScriptSettings(source, script);
    }

    async run(usernames: string[], command: RosterCommand, onResult?: (result: RosterResult) => void): Promise<RosterResult[]> {
        if (this.running) throw new Error('A roster action is already running.');
        if ((command.kind === 'assign' || command.kind === 'copy') && !this.scripts().includes(command.script)) throw new Error('Choose an available script.');
        if (command.kind === 'travel' && !WALK_OPTIONS.includes(command.destination)) throw new Error('Choose a named destination.');
        if (command.kind === 'world' && ![1, 2, 3].includes(command.world)) throw new Error('Choose World 1, 2, or 3.');
        const values = command.kind === 'copy' ? { ...this.settings(command.source, command.script) } : null;
        const targets = [...new Set(usernames)];
        const notify = (result: RosterResult): void => {
            try { onResult?.(result); }
            catch (err) { console.error('[rs2b0t] roster progress failed', err); }
        };
        this.running = true;
        try {
            for (const username of targets) notify({ username, state: 'pending', message: 'Waiting…' });
            return await Promise.all(targets.map(async username => {
                let result: RosterResult;
                try {
                    result = await this.apply(username, command, values);
                } catch (err) {
                    result = { username, state: 'failed', message: rosterError(err) };
                }
                notify(result);
                return result;
            }));
        } finally {
            this.running = false;
        }
    }

    private travel(profile: RosterProfile, client: RosterClient, destination: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (success: boolean, error?: unknown): void => {
                if (settled) return;
                settled = true;
                clearInterval(watcher);
                if (success) resolve();
                else reject(error);
            };
            const cancel = (message: string): void => {
                if (settled) return;
                const error = new Error(message);
                try { client.stopScript(); } catch { finish(false, error); return; }
                finish(false, error);
            };
            const current = (): boolean => {
                const target = this.profiles().find(target => target.username === profile.username);
                return !!target?.slot && target.slot.id === profile.slot?.id && this.hooks.client(target) === client;
            };
            const check = (): boolean => {
                let valid = false;
                try { valid = current(); } catch { valid = false; }
                if (!valid) cancel('Client was removed or replaced during travel.');
                return valid;
            };
            const deadline = Date.now() + 11_000;
            const watcher = setInterval(() => {
                if (Date.now() >= deadline) cancel('Timed out waiting for travel.');
                else check();
            }, 100);
            try {
                client.travelTo(destination).then(() => { if (!settled && check()) finish(true); }, error => finish(false, error));
            } catch (error) {
                finish(false, error);
            }
        });
    }

    private async apply(username: string, command: RosterCommand, values: Record<string, string> | null): Promise<RosterResult> {
        const done = (message: string): RosterResult => ({ username, state: 'done', message });
        const skip = (message: string): RosterResult => ({ username, state: 'skipped', message });
        const profile = this.profiles().find(p => p.username === username);
        if (!profile) return skip('Profile is no longer available.');
        if (command.kind === 'copy' && command.source === username) return skip('Source profile.');
        if (profile.slot?.switchingWorld !== null && profile.slot?.switchingWorld !== undefined) return skip('World switch in progress.');
        if (command.kind === 'world') {
            if (!await this.hooks.setWorld(profile, command.world)) throw new Error('Could not switch world. Check the bot.');
            return done(profile.slot ? `World ${command.world} switch requested.` : `World ${command.world} saved.`);
        }
        const client = profile.slot ? this.hooks.client(profile) : null;
        if (profile.slot && (!profile.slot.ready || !client)) return skip('Client is loading. Try again when ready.');
        if (command.kind === 'assign' || command.kind === 'copy') {
            if (profile.slot && active(profile.slot.scriptState)) return skip('Stop the script before changing its configuration.');
            if (command.kind === 'assign') {
                if (client) client.assignScript(command.script);
                else writeProfileScript(username, command.script);
                return done(`Selected ${command.script}.`);
            }
            if (client) client.copySettings(command.script, { ...values });
            else replaceScriptSettings(username, command.script, { ...values });
            return done(`Copied ${command.script} settings.`);
        }
        if (!client) return skip('Load this profile first.');
        if (command.kind === 'travel') {
            if (!profile.slot?.ingame) return skip('Log in before travelling.');
            await this.travel(profile, client, command.destination);
            return done(`WalkTo started: ${command.destination}.`);
        }
        if (command.kind === 'start') {
            if (profile.slot && active(profile.slot.scriptState)) return skip('Script is already active.');
            client.startScript();
            return done('Script started.');
        }
        client.stopScript();
        return done('Stop requested.');
    }
}
