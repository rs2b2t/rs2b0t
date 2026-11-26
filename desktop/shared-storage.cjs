const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { lockSync } = require('proper-lockfile');

const vaultKey = 'rs2b0t:multibox:profiles';
const profileKeys = [vaultKey, 'rs2b0t:multibox:accounts'];

function isEmptyRoster(value) {
    return typeof value === 'string' && /^[ \t\r\n]*\[[ \t\r\n]*\][ \t\r\n]*$/.test(value);
}

function hasSavedProfiles(key, raw) {
    if (typeof raw !== 'string') return false;
    try {
        const value = JSON.parse(raw);
        if (Array.isArray(value)) {
            const profiles = value.filter(p => typeof p?.username === 'string' && p.username.length > 0 && typeof p.password === 'string');
            return profiles.length > 0 && profiles.every(p => p.world === undefined || [1, 2, 3].includes(p.world));
        }
        if (key !== vaultKey || value?.v !== 1 || (value.kdf !== undefined && value.kdf !== 'PBKDF2-SHA256')) return false;
        if (!Number.isInteger(value.iter) || value.iter <= 0 || value.iter > 0xffffffff) return false;
        return typeof value.salt === 'string' && atob(value.salt).length === 16
            && typeof value.iv === 'string' && atob(value.iv).length === 12
            && typeof value.ct === 'string' && atob(value.ct).length > 16;
    } catch {
        return false;
    }
}

function migrateProfiles(data, sources, firstMigration) {
    if (profileKeys.some(key => key in data && (firstMigration || !isEmptyRoster(data[key])))) return;
    let selected = [];
    for (const source of sources) {
        const entries = profileKeys.map(key => [key, source[key]]);
        const populated = entries.filter(([key, value]) => hasSavedProfiles(key, value));
        if (populated.length) {
            selected = populated;
            break;
        }
        if (firstMigration && !selected.length) selected = entries.filter(([, value]) => isEmptyRoster(value));
    }
    if (!selected.length) return;
    for (const key of profileKeys) delete data[key];
    for (const [key, value] of selected) data[key] = value;
}

function sharedStorage(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'storage.json');
    const read = () => {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') return { initialized: false, data: {} };
            throw error;
        }
    };
    const valid = key => typeof key === 'string' && key.startsWith('rs2b0t:');
    function update(change) {
        const deadline = Date.now() + 15000;
        let release;
        while (!release) {
            try {
                release = lockSync(file, { realpath: false });
            } catch (error) {
                if (error.code !== 'ELOCKED' || Date.now() >= deadline) throw error;
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
        }
        const temporary = join(dir, `${randomUUID()}.tmp`);
        try {
            const state = read();
            const result = change(state);
            fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
            fs.renameSync(temporary, file);
            return result;
        } finally {
            fs.rmSync(temporary, { force: true });
            release();
        }
    }
    return {
        initialized: () => read().initialized,
        snapshot: () => read().data,
        getItem: key => (valid(key) ? (read().data[key] ?? null) : null),
        keys: () => Object.keys(read().data),
        setItem(key, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            update(state => {
                state.data[key] = value;
            });
        },
        compareAndSet(key, expected, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            return update(state => {
                if ((state.data[key] ?? null) !== expected) return false;
                state.data[key] = value;
                return true;
            });
        },
        removeItem(key) {
            if (valid(key))
                update(state => {
                    delete state.data[key];
                });
        },
        seed(values, { fallback = {}, recover = false } = {}) {
            return update(state => {
                const sources = [values, fallback];
                if (state.initialized && !recover) return false;
                migrateProfiles(state.data, sources, !state.initialized);
                if (state.initialized) return false;
                for (const source of sources) {
                    for (const [key, value] of Object.entries(source)) {
                        if (profileKeys.includes(key)) continue;
                        if (valid(key) && typeof value === 'string' && !(key in state.data)) state.data[key] = value;
                    }
                }
                state.initialized = true;
                return true;
            });
        }
    };
}

module.exports = { sharedStorage };
