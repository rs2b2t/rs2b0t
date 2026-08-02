// docs/MULTIBOX.md#profiles-and-the-vault
export interface Profile {
    username: string;
    password: string;
    // rail tab this account lives in; absent = the Main tab
    tab?: string;
}

export interface TabState {
    tabs: string[];
    activeTab: string;
}

export type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';
const ITER = 310000;
const MAIN_TAB = 'Main';

const hasLocal = typeof localStorage !== 'undefined';

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
    for (const p of v as Profile[]) {
        if (typeof p?.username !== 'string' || p.username.length === 0 || typeof p?.password !== 'string') {
            continue;
        }
        const entry: Profile = { username: p.username, password: p.password };
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
    try {
        const v = JSON.parse(raw) as unknown;
        return Array.isArray(v) ? profilesFrom(v) : null;
    } catch {
        return null;
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
    const obj = parsed as { profiles?: unknown; tabs?: unknown; activeTab?: unknown };
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.profiles) || !Array.isArray(obj.tabs) || obj.tabs.some(t => typeof t !== 'string') || typeof obj.activeTab !== 'string') {
        throw new Error('vault decrypted, but its payload has an unrecognized shape');
    }
    const payload: VaultPayload = { profiles: profilesFrom(obj.profiles), tabs: obj.tabs as string[], activeTab: obj.activeTab };
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
    private key: CryptoKey | null = null;
    private salt: Uint8Array<ArrayBuffer> | null = null;
    private persistTail = Promise.resolve();
    private persistGeneration = 0;

    status(): VaultStatus {
        if (this.cache) {
            return 'unlocked';
        }
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        if (parseBlob(raw)) {
            return 'locked';
        }
        if (parseLegacy(raw)) {
            return 'plaintext-legacy';
        }
        if (hasLocal && parseLegacy(localStorage.getItem(LEGACY_KEY))) {
            return 'plaintext-legacy';
        }
        return 'empty';
    }

    async setup(pass: string): Promise<void> {
        if (this.status() === 'locked') {
            throw new Error('vault is locked — unlock or reset first');
        }
        this.persistGeneration++;
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        const legacy = parseLegacy(raw) ?? (hasLocal ? parseLegacy(localStorage.getItem(LEGACY_KEY)) : null) ?? [];
        this.salt = crypto.getRandomValues(new Uint8Array(16));
        this.key = await deriveKey(pass, this.salt, ITER);
        this.cache = legacy;
        this.customTabs = [];
        this.active = MAIN_TAB;
        if (hasLocal) {
            localStorage.removeItem(LEGACY_KEY);
        }
        await this.persist();
    }

    async unlock(pass: string): Promise<boolean> {
        const blob = parseBlob(hasLocal ? localStorage.getItem(KEY) : null);
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
        this.cache = payload.profiles;
        this.customTabs = payload.tabs;
        this.active = payload.activeTab;
        this.key = key;
        this.salt = salt;
        return true;
    }

    reset(): void {
        this.persistGeneration++;
        if (hasLocal) {
            localStorage.removeItem(KEY);
            localStorage.removeItem(LEGACY_KEY);
        }
        this.cache = null;
        this.customTabs = [];
        this.active = MAIN_TAB;
        this.key = null;
        this.salt = null;
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

    async upsert(p: Profile): Promise<void> {
        if (p.username.length === 0) {
            return;
        }
        const all = this.assertUnlocked();
        const i = all.findIndex(x => x.username === p.username);
        // tab membership changes flow only through saveTabState — a password
        // re-save (the in-game save prompt) must not move the account
        if (i >= 0) {
            all[i] = { ...all[i], password: p.password };
        } else {
            all.push({ username: p.username, password: p.password });
        }
        await this.persist();
    }

    async remove(username: string): Promise<void> {
        this.cache = this.assertUnlocked().filter(x => x.username !== username);
        await this.persist();
    }

    async reorder(usernames: string[]): Promise<void> {
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

    async saveTabState(tabs: string[], tabByUser: ReadonlyMap<string, string>, activeTab: string): Promise<void> {
        const all = this.assertUnlocked();
        const trimmed = tabs.map(t => t.trim());
        assertTabStateValid(trimmed, activeTab, []);
        for (const [username, tab] of tabByUser) {
            if (tab !== MAIN_TAB && !trimmed.includes(tab)) {
                throw new Error(`tab '${tab}' for '${username}' is not in the tab list`);
            }
        }
        this.customTabs = trimmed;
        this.active = activeTab;
        for (const p of all) {
            const next = tabByUser.get(p.username) ?? p.tab;
            // a profile not loaded in this wall keeps its stored tab; if that tab
            // was just deleted, it lands in Main — the deleting wall only knows
            // prior-tab targets for the bots it has loaded
            if (next !== undefined && next !== MAIN_TAB && trimmed.includes(next)) {
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

    private persist(): Promise<void> {
        if (!hasLocal || !this.key || !this.salt || !this.cache) {
            return Promise.resolve();
        }
        const key = this.key;
        const salt = this.salt;
        const payload: VaultPayload = { profiles: this.cache, tabs: this.customTabs, activeTab: this.active };
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        const generation = this.persistGeneration;
        const write = this.persistTail.then(async () => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
            if (generation !== this.persistGeneration) {
                return;
            }
            const blob: StoredBlob = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
            localStorage.setItem(KEY, JSON.stringify(blob));
        });
        this.persistTail = write.catch(() => {});
        return write;
    }
}

export const vault = new ProfileVault();
