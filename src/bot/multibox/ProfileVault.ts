import { indexSavedProfiles } from './profileUsername.js';
import { desktopStorage } from '../runtime/desktopStorage.js';
import type { WorldNumber } from '../../client/config/worlds.js';

// docs/reference/multibox.md#profiles-and-the-vault
export interface Profile {
    username: string;
    password: string;
    // rail tab this account lives in; absent = the Main tab
    tab?: string;
    world?: WorldNumber;
}

interface TabState {
    tabs: string[];
    activeTab: string;
}

export interface TabRename {
    from: string;
    to: string;
}

export type TabChange = TabRename | { from: string; fallbackByUser: ReadonlyMap<string, string> };

type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';
const ITER = 310000;
const MAIN_TAB = 'Main';

const hasLocal = typeof localStorage !== 'undefined';
type VaultStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

async function withBrowserLock<T>(change: () => T | Promise<T>): Promise<T> {
    if (!navigator.locks?.request) throw new Error('Saving profiles requires a browser with Web Locks support.');
    return navigator.locks.request(KEY, change);
}

interface StoredBlob {
    v: number;
    kdf: string;
    iter: number;
    salt: string;
    iv: string;
    ct: string;
}

// The decrypted payload. A bare Profile[] is the pre-tabs shape and still unlocks.
interface VaultPayload {
    profiles: Profile[];
    tabs: string[];
    activeTab: string;
    pendingWipe?: PendingWipe;
}

interface PendingWipe {
    names: string[];
    legacyId?: string;
}

interface RestoreStorage {
    usernames: string[];
    apply(wipe: string[]): void;
}

const legacyWipeKey = 'rs2b0t:pending-profile-wipe';

function wipeNames(value: unknown): string[] {
    if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !name)) {
        throw new Error('Invalid pending profile restore.');
    }
    return value;
}

function b64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) {
        s += String.fromCharCode(b);
    }
    return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

function parseBlob(raw: string | null): StoredBlob | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as StoredBlob;
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            return null;
        }
        return v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string' && typeof v.iter === 'number' ? v : null;
    } catch {
        return null;
    }
}

function profilesFrom(v: unknown[]): Profile[] {
    const out: Profile[] = [];
    for (const p of v as Record<string, unknown>[]) {
        if (typeof p?.username !== 'string' || p.username.length === 0 || typeof p?.password !== 'string') {
            continue;
        }
        const entry: Profile = { username: p.username, password: p.password };
        if (p.world !== undefined) {
            assertWorld(p.world);
            entry.world = p.world;
        }
        // Main is the absent-field canonical form, never stored explicitly
        if (typeof p.tab === 'string' && p.tab !== MAIN_TAB) {
            entry.tab = p.tab;
        }
        out.push(entry);
    }
    return out;
}

function parseLegacy(raw: string | null): Profile[] | null {
    if (!raw) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    return Array.isArray(parsed) ? profilesFrom(parsed) : null;
}

function assertWorld(world: unknown): asserts world is WorldNumber {
    if (world !== 1 && world !== 2 && world !== 3) {
        throw new Error('profile world must be 1, 2 or 3');
    }
}

function assertTabStateValid(tabs: string[], activeTab: string, profiles: Profile[]): void {
    if (tabs.some(t => t.trim().length === 0 || t === MAIN_TAB)) {
        throw new Error(`invalid tab list ${JSON.stringify(tabs)}`);
    }
    const all = [MAIN_TAB, ...tabs];
    if (new Set(all).size !== all.length) {
        throw new Error(`duplicate tab names in ${JSON.stringify(tabs)}`);
    }
    if (!all.includes(activeTab)) {
        throw new Error(`active tab '${activeTab}' is not a known tab`);
    }
    for (const p of profiles) {
        if (p.tab !== undefined && !tabs.includes(p.tab)) {
            throw new Error(`profile '${p.username}' points at missing tab '${p.tab}'`);
        }
    }
}

// Wrong-passphrase decrypt failures are a normal `false`; a blob that DECRYPTS
// but does not parse is corruption and throws so it cannot be silently emptied.
function parsePayload(text: string): VaultPayload {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('vault decrypted, but its payload is not JSON');
    }
    if (Array.isArray(parsed)) {
        return { profiles: profilesFrom(parsed), tabs: [], activeTab: MAIN_TAB };
    }
    const obj = parsed as { profiles?: unknown; tabs?: unknown; activeTab?: unknown; restoreId?: unknown; pendingWipe?: PendingWipe };
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.profiles) || !Array.isArray(obj.tabs) || obj.tabs.some(t => typeof t !== 'string') || typeof obj.activeTab !== 'string') {
        throw new Error('vault decrypted, but its payload has an unrecognized shape');
    }
    const payload: VaultPayload = { profiles: profilesFrom(obj.profiles), tabs: obj.tabs as string[], activeTab: obj.activeTab };
    if (obj.pendingWipe !== undefined) {
        payload.pendingWipe = { names: wipeNames(obj.pendingWipe?.names), legacyId: obj.pendingWipe?.legacyId };
    } else if (typeof obj.restoreId === 'string') {
        payload.pendingWipe = { names: [], legacyId: obj.restoreId };
    }
    assertTabStateValid(payload.tabs, payload.activeTab, payload.profiles);
    return payload;
}

async function deriveKey(pass: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export class ProfileVault {
    private cache: Profile[] | null = null;
    private customTabs: string[] = [];
    private active: string = MAIN_TAB;
    private pendingWipe?: PendingWipe;
    private key: CryptoKey | null = null;
    private salt: Uint8Array<ArrayBuffer> | null = null;
    private persistTail = Promise.resolve();
    private persistGeneration = 0;
    private lastResetGeneration = 0;
    private worldTail = Promise.resolve();
    private pendingReplacement: Promise<void> | null = null;

    private sharedTail = Promise.resolve();
    private sharedTabs: string[] = [];

    constructor(private storage: VaultStorage | undefined = hasLocal ? localStorage : undefined) {}

    private get shared(): boolean {
        return hasLocal && this.storage === localStorage;
    }

    private enqueueShared<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.sharedTail.then(operation);
        this.sharedTail = result.then(() => {}, () => {});
        return result;
    }

    private async compareAndSet(expected: string | null, value: string): Promise<boolean> {
        if (desktopStorage) return desktopStorage.compareAndSet(KEY, expected, value);
        const generation = this.persistGeneration;
        return withBrowserLock(() => {
            if (generation !== this.persistGeneration || this.storage!.getItem(KEY) !== expected) return false;
            this.storage!.setItem(KEY, value);
            return true;
        });
    }

    async refresh(): Promise<void> {
        if (!this.shared) return;
        return this.enqueueShared(async () => {
            if (!this.key) return;
            const generation = this.persistGeneration;
            const raw = this.storage!.getItem(KEY);
            const blob = parseBlob(raw);
            if (!blob || !this.salt || blob.salt !== b64(this.salt)) {
                this.persistGeneration++;
                this.cache = null;
                this.key = null;
                return;
            }
            const payload = await this.decrypt(blob);
            if (generation !== this.persistGeneration || this.storage!.getItem(KEY) !== raw) return;
            this.adopt(payload);
        });
    }

    private adopt(payload: VaultPayload): void {
        this.cache = payload.profiles;
        this.customTabs = payload.tabs;
        this.active = payload.activeTab;
        this.pendingWipe = payload.pendingWipe;
    }

    private async decrypt(blob: StoredBlob): Promise<VaultPayload> {
        if (!this.key || !this.salt || blob.salt !== b64(this.salt)) throw new Error('Saved accounts changed; unlock the vault again.');
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, this.key, unb64(blob.ct));
        return parsePayload(new TextDecoder().decode(plaintext));
    }

    private sharedChange<T>(change: (draft: ProfileVault) => Promise<T>, retry = true): Promise<T> {
        const generation = this.persistGeneration;
        return this.enqueueShared(async () => {
            for (let attempt = 0; attempt < 8; attempt++) {
                this.assertUnlocked();
                const expected = this.storage!.getItem(KEY);
                const blob = parseBlob(expected);
                if (!blob) throw new Error('Saved accounts changed; unlock the vault again.');
                const payload = await this.decrypt(blob);
                const values = new Map<string, string>([[KEY, expected!]]);
                const draft = new ProfileVault({
                    getItem: key => values.get(key) ?? null,
                    setItem: (key, value) => {
                        values.set(key, value);
                    },
                    removeItem: key => {
                        values.delete(key);
                    }
                });
                draft.key = this.key;
                draft.salt = this.salt;
                draft.adopt(payload);
                const result = await change(draft);
                if (generation !== this.persistGeneration) throw new Error('Vault changed before the accounts were saved.');
                if (await this.compareAndSet(expected, values.get(KEY)!)) {
                    if (generation !== this.persistGeneration) throw new Error('Vault changed before the accounts were saved.');
                    this.cache = draft.cache;
                    this.customTabs = draft.customTabs;
                    this.active = draft.active;
                    this.pendingWipe = draft.pendingWipe;
                    return result;
                }
                if (!retry) break;
            }
            throw new Error('Saved accounts changed in another instance; try again.');
        });
    }

    status(): VaultStatus {
        if (this.cache) {
            return 'unlocked';
        }
        const raw = this.storage ? this.storage!.getItem(KEY) : null;
        if (parseBlob(raw)) {
            return 'locked';
        }
        if (parseLegacy(raw)) {
            return 'plaintext-legacy';
        }
        if (this.storage && parseLegacy(this.storage!.getItem(LEGACY_KEY))) {
            return 'plaintext-legacy';
        }
        return 'empty';
    }

    async setup(pass: string): Promise<void> {
        if (this.status() === 'locked') {
            throw new Error('vault is locked — unlock or reset first');
        }
        this.persistGeneration++;
        const raw = this.storage ? this.storage!.getItem(KEY) : null;
        const legacy = parseLegacy(raw) ?? (this.storage ? parseLegacy(this.storage!.getItem(LEGACY_KEY)) : null) ?? [];
        this.salt = crypto.getRandomValues(new Uint8Array(16));
        this.key = await deriveKey(pass, this.salt, ITER);
        this.cache = legacy;
        this.pendingWipe = undefined;
        this.customTabs = [];
        this.active = MAIN_TAB;
        try {
            await this.persist(raw);
        } catch (error) {
            this.cache = null;
            this.key = null;
            this.salt = null;
            throw error;
        }
        this.storage?.removeItem(LEGACY_KEY);
        this.adoptGroupState();
    }

    async unlock(pass: string): Promise<boolean> {
        if (this.pendingReplacement) return this.afterReplacement(() => this.unlock(pass));
        if (this.shared) return this.enqueueShared(() => this.unlockStored(pass));
        return this.unlockStored(pass);
    }

    private async unlockStored(pass: string): Promise<boolean> {
        const blob = parseBlob(this.storage ? this.storage!.getItem(KEY) : null);
        if (!blob) {
            return false;
        }
        const salt = unb64(blob.salt);
        const key = await deriveKey(pass, salt, blob.iter);
        let pt: ArrayBuffer;
        try {
            pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
        } catch {
            return false;
        }
        const payload = parsePayload(new TextDecoder().decode(pt));
        this.adopt(payload);
        this.key = key;
        this.salt = salt;
        this.adoptGroupState();
        return true;
    }

    async reset(): Promise<void> {
        const clear = () => {
            this.storage?.removeItem(LEGACY_KEY);
            this.storage?.removeItem(KEY);
            this.lastResetGeneration = ++this.persistGeneration;
            this.cache = null;
            this.customTabs = [];
            this.pendingWipe = undefined;
            this.active = MAIN_TAB;
            this.key = null;
            this.salt = null;
        };
        if (this.shared && !desktopStorage) await this.enqueueShared(() => withBrowserLock(clear));
        else clear();
    }

    list(): Profile[] {
        // absent-tab is only the storage form; readers always get an explicit
        // tab, so a restore can never confuse "Main" with "wherever is active"
        return this.assertUnlocked().map(p => ({ ...p, tab: p.tab ?? MAIN_TAB }));
    }

    tabState(): TabState {
        this.assertUnlocked();
        return { tabs: [...this.customTabs], activeTab: this.active };
    }

    adoptGroupState(): { tabs: string[]; assignments: Map<string, string> } {
        const assignments = new Map(this.assertUnlocked().map(p => [p.username, p.tab ?? MAIN_TAB]));
        this.sharedTabs = [...this.customTabs];
        return { tabs: this.sharedTabs, assignments };
    }

    snapshot(): { profiles: Profile[]; tabs: string[]; activeTab: string } {
        return { profiles: this.list(), ...this.tabState() };
    }

    private afterReplacement<T>(change: () => Promise<T>): Promise<T> {
        const generation = this.persistGeneration;
        return this.pendingReplacement!.then(() => {
            if (generation !== this.persistGeneration) throw new Error('Vault changed before the accounts were saved.');
            return change();
        });
    }

    async replaceAll(data: VaultPayload, restore?: RestoreStorage): Promise<string[]> {
        if (this.shared && !restore) {
            const previous = await this.sharedChange(draft => draft.replaceAll(data), false);
            this.adoptGroupState();
            return previous;
        }
        if (this.pendingReplacement) return this.afterReplacement(() => this.replaceAll(data, restore));
        this.assertUnlocked();
        const profiles = profilesFrom(data.profiles);
        if (profiles.length !== data.profiles.length) {
            throw new Error('profile list contains an invalid entry');
        }
        assertTabStateValid(data.tabs, data.activeTab, profiles);
        const payload = { profiles, tabs: [...data.tabs], activeTab: data.activeTab };
        const previous = await this.persistReplacement(() => payload, restore);
        if (this.shared) this.adoptGroupState();
        return previous.map(p => p.username);
    }

    private async persistReplacement(build: () => VaultPayload, restore?: RestoreStorage): Promise<Profile[]> {
        const generation = this.persistGeneration;
        const replace = async () => {
            if (generation !== this.persistGeneration) {
                if (restore) throw new Error('Vault changed before the accounts were saved.');
                return [];
            }
            const payload = { ...build(), pendingWipe: this.pendingWipe };
            if (restore) {
                if (this.shared && !desktopStorage) return withBrowserLock(() => this.restoreStorage(payload, restore, generation, true));
                return this.restoreStorage(payload, restore, generation);
            }
            const previous = this.assertUnlocked();
            await this.persist(undefined, payload);
            if (generation === this.persistGeneration) this.adopt(payload);
            return previous;
        };
        if (this.shared) return this.enqueueShared(replace);
        const write = Promise.all([this.worldTail, this.persistTail]).then(replace);
        this.pendingReplacement = write.then(() => {}, () => {});
        try {
            return await write;
        } finally {
            this.pendingReplacement = null;
        }
    }

    private async restoreStorage(payload: VaultPayload, restore: RestoreStorage, generation: number, browserLockHeld = false): Promise<Profile[]> {
        const expected = this.storage?.getItem(KEY) ?? null;
        const blob = parseBlob(expected);
        if (!blob) throw new Error('Saved accounts changed; unlock the vault again.');
        const previous = await this.decrypt(blob);
        if (generation !== this.persistGeneration) throw new Error('Vault changed before the accounts were saved.');

        const legacyId = previous.pendingWipe?.legacyId;
        const legacyKey = legacyId ? `${legacyWipeKey}/${legacyId}` : legacyWipeKey;
        const legacy = this.storage!.getItem(legacyKey);
        const names = [...new Set([
            ...(previous.pendingWipe?.names ?? []),
            ...(legacy === null ? [] : wipeNames(JSON.parse(legacy))),
            ...previous.profiles.map(p => p.username),
            ...payload.profiles.map(p => p.username),
            ...restore.usernames
        ])];
        const replacement = { ...payload, pendingWipe: { names, legacyId } };
        const written = await this.persist(expected, replacement, browserLockHeld);
        if (generation !== this.persistGeneration || !written) throw new Error('Vault changed before the accounts were saved.');
        this.adopt(replacement);
        if (legacy !== null) this.storage!.removeItem(legacyKey);
        restore.apply(names);
        await this.persist(written, { ...payload, pendingWipe: undefined }, browserLockHeld);
        if (generation !== this.persistGeneration) throw new Error('Vault changed before the accounts were saved.');
        this.pendingWipe = undefined;
        return previous.profiles;
    }

    async upsert(p: Profile): Promise<{ profile: Profile; created: boolean } | undefined> {
        if (this.shared) {
            const generation = this.persistGeneration;
            try {
                return await this.sharedChange(draft => draft.upsert(p));
            } catch (error) {
                if (desktopStorage || generation >= this.lastResetGeneration || this.status() !== 'empty') throw error;
            }
            return;
        }
        if (this.pendingReplacement) return this.afterReplacement(() => this.upsert(p));
        if (p.world !== undefined) {
            assertWorld(p.world);
        }
        if (p.username.length === 0) {
            return;
        }
        const all = this.assertUnlocked();
        const i = all.findIndex(x => x.username === p.username);
        const previous = all[i];
        const generation = this.persistGeneration;
        // tab membership changes flow only through saveTabState, a password
        // re-save (the in-game save prompt) must not move the account
        const entry: Profile = i >= 0 ? { ...all[i], password: p.password } : { username: p.username, password: p.password, ...(p.world === undefined ? {} : { world: p.world }) };
        if (i >= 0) {
            all[i] = entry;
        } else {
            all.push(entry);
        }
        try {
            await this.persist();
            return { profile: { ...entry, tab: entry.tab ?? MAIN_TAB }, created: i < 0 };
        } catch (error) {
            const index = this.cache?.indexOf(entry) ?? -1;
            if (generation === this.persistGeneration && this.cache && index >= 0) {
                if (previous) entry.password = previous.password;
                else this.cache.splice(index, 1);
                await this.persist().catch(() => {});
            }
            throw error;
        }
    }

    async setWorld(username: string, world: WorldNumber): Promise<void> {
        if (this.shared) return this.sharedChange(draft => draft.setWorld(username, world));
        if (this.pendingReplacement) return this.afterReplacement(() => this.setWorld(username, world));
        assertWorld(world);
        const generation = this.persistGeneration;
        const change = this.worldTail.then(async () => {
            if (generation !== this.persistGeneration) {
                throw new Error('vault changed before the world assignment was saved');
            }
            const profile = this.assertUnlocked().find(p => p.username === username);
            if (!profile) {
                throw new Error(`unknown profile '${username}'`);
            }
            const previous = profile.world;
            profile.world = world;
            try {
                await this.persist();
            } catch (error) {
                const current = this.cache?.find(p => p.username === username);
                if (generation === this.persistGeneration && current?.world === world) {
                    if (previous === undefined) delete current.world;
                    else current.world = previous;
                    await this.persist().catch(() => {});
                }
                throw error;
            }
        });
        this.worldTail = change.catch(() => {});
        return change;
    }

    async assignGroup(usernames: string[], name: string): Promise<void> {
        const tab = name.trim();
        if (!tab || !usernames.length) throw new Error('Choose profiles and enter a group name.');
        if (this.shared) {
            await this.sharedChange(draft => draft.assignGroup(usernames, tab));
            if (tab !== MAIN_TAB && !this.sharedTabs.includes(tab)) this.sharedTabs.push(tab);
            return;
        }
        if (this.pendingReplacement) return this.afterReplacement(() => this.assignGroup(usernames, tab));
        const { find } = indexSavedProfiles(this.assertUnlocked());
        const assignments = new Map<string, string>();
        for (const username of usernames) {
            const profile = find(username);
            if (!profile) throw new Error('Only saved profiles can be grouped.');
            assignments.set(profile.username, tab);
        }
        const tabs = [...this.customTabs];
        if (tab !== MAIN_TAB && !tabs.includes(tab)) tabs.push(tab);
        await this.saveTabState(tabs, assignments, this.active);
    }

    async remove(username: string): Promise<void> {
        if (this.shared) return this.sharedChange(draft => draft.remove(username));
        if (this.pendingReplacement) return this.afterReplacement(() => this.remove(username));
        await this.persistReplacement(() => ({
            profiles: this.assertUnlocked().filter(p => p.username !== username),
            tabs: this.customTabs,
            activeTab: this.active
        }));
    }

    async reorder(usernames: string[]): Promise<void> {
        if (this.shared) return this.sharedChange(draft => draft.reorder(usernames));
        if (this.pendingReplacement) return this.afterReplacement(() => this.reorder(usernames));
        const all = this.assertUnlocked();
        const byUsername = new Map(all.map(profile => [profile.username, profile]));
        const seen = new Set<string>();
        const ordered: Profile[] = [];

        for (const username of usernames) {
            const profile = byUsername.get(username);
            if (profile && !seen.has(username)) {
                ordered.push(profile);
                seen.add(username);
            }
        }
        for (const profile of all) {
            if (!seen.has(profile.username)) {
                ordered.push(profile);
                seen.add(profile.username);
            }
        }

        if (ordered.every((profile, index) => profile === all[index])) {
            return;
        }
        this.cache = ordered;
        await this.persist();
    }

    async saveTabState(tabs: string[], tabByUser: ReadonlyMap<string, string>, activeTab?: string, change?: TabChange, previousTabs?: string[]): Promise<void> {
        if (this.pendingReplacement) return this.afterReplacement(() => this.saveTabState(tabs, tabByUser, activeTab, change, previousTabs));
        const requested = tabs.map(tab => tab.trim());
        assertTabStateValid(requested, activeTab ?? MAIN_TAB, []);
        for (const [username, tab] of tabByUser) {
            if (tab !== MAIN_TAB && !requested.includes(tab)) {
                throw new Error(`tab '${tab}' for '${username}' is not in the tab list`);
            }
        }
        if (this.shared) {
            await this.sharedChange(async draft => {
                if (change && 'to' in change) {
                    if (!draft.customTabs.includes(change.from)) throw new Error(`Group '${change.from}' no longer exists.`);
                    if (draft.customTabs.includes(change.to)) throw new Error(`Group '${change.to}' already exists.`);
                }
                const { find } = indexSavedProfiles(draft.assertUnlocked());
                const resolveTabs = (moves: ReadonlyMap<string, string>, from?: string) => {
                    const resolved = new Map<string, string>();
                    for (const [username, tab] of moves) {
                        const profile = find(username);
                        if (profile && (from === undefined || profile.tab === from)) resolved.set(profile.username, tab);
                    }
                    return resolved;
                };
                const deletion = change && 'fallbackByUser' in change
                    ? { from: change.from, fallbackByUser: resolveTabs(change.fallbackByUser, change.from) }
                    : undefined;
                const fallbackTabs = new Set(deletion?.fallbackByUser.values());
                const previous = previousTabs ?? this.sharedTabs;
                const removed = new Set(previous.filter(tab => !requested.includes(tab)));
                const merged = draft.customTabs.filter(tab => !removed.has(tab));
                const ordered = requested.filter(tab => previous.includes(tab) && merged.includes(tab));
                const priorOrder = previous.filter(tab => ordered.includes(tab));
                if (ordered.some((tab, index) => tab !== priorOrder[index])) {
                    let index = 0;
                    for (let slot = 0; slot < merged.length; slot++) if (ordered.includes(merged[slot])) merged[slot] = ordered[index++];
                }
                for (const [index, tab] of requested.entries()) {
                    const liveDestination = fallbackTabs.has(tab) && !this.customTabs.includes(tab);
                    if (merged.includes(tab) || (previous.includes(tab) && !liveDestination)) continue;
                    const next = requested.slice(index + 1).find(candidate => merged.includes(candidate));
                    merged.splice(next ? merged.indexOf(next) : merged.length, 0, tab);
                }
                const selected = activeTab === undefined || merged.includes(activeTab) ? activeTab : MAIN_TAB;
                await draft.saveTabState(merged, resolveTabs(tabByUser), selected, deletion ?? change);
            });
            this.sharedTabs = requested;
            return;
        }
        const all = this.assertUnlocked();
        let selected = activeTab ?? this.active;
        if (activeTab === undefined && change?.from === selected) {
            selected = 'to' in change ? change.to : this.customTabs[this.customTabs.indexOf(selected) - 1] ?? MAIN_TAB;
        }
        this.customTabs = requested;
        this.active = requested.includes(selected) ? selected : MAIN_TAB;
        for (const p of all) {
            let next = p.tab;
            if (change && p.tab === change.from) {
                next = 'to' in change ? change.to : change.fallbackByUser.get(p.username);
            }
            next = tabByUser.get(p.username) ?? next;
            // a profile not loaded in this wall keeps its stored tab, landing in Main when that tab has been deleted
            // Why: the deleting wall only knows prior-tab targets for the bots it has loaded
            if (next !== undefined && next !== MAIN_TAB && requested.includes(next)) {
                p.tab = next;
            } else {
                delete p.tab;
            }
        }
        await this.persist();
    }

    private assertUnlocked(): Profile[] {
        if (!this.cache) {
            throw new Error('vault is not unlocked');
        }
        return this.cache;
    }

    private persist(expected?: string | null, replacement?: VaultPayload, browserLockHeld = false): Promise<string | undefined> {
        if (!this.storage || !this.key || !this.salt || !this.cache) {
            return Promise.resolve(undefined);
        }
        const key = this.key;
        const salt = this.salt;
        const payload = replacement ?? { profiles: this.cache, tabs: this.customTabs, activeTab: this.active, pendingWipe: this.pendingWipe };
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        const generation = this.persistGeneration;
        const save = async () => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
            if (generation !== this.persistGeneration) {
                return;
            }
            const blob: StoredBlob = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
            const encoded = JSON.stringify(blob);
            if (this.shared && !browserLockHeld) {
                if (!await this.compareAndSet(expected ?? null, encoded)) throw new Error('Saved accounts changed in another instance; unlock the vault again.');
            } else {
                if (expected !== undefined && this.storage!.getItem(KEY) !== expected) throw new Error('Saved accounts changed in another instance; try again.');
                this.storage!.setItem(KEY, encoded);
            }
            return encoded;
        };
        if (browserLockHeld) return save();
        const write = this.persistTail.then(save);
        this.persistTail = write.then(() => {}, () => {});
        return write;
    }
}

export const vault = new ProfileVault();
