const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { lockSync } = require('proper-lockfile');

const vaultKey = 'rs2b0t:multibox:profiles';
const accountsKey = 'rs2b0t:multibox:accounts';
const profileKeys = [vaultKey, accountsKey];

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
        if (key !== vaultKey || value?.v !== 1) return false;
        if (!Number.isInteger(value.iter) || value.iter <= 0 || value.iter > 0xffffffff) return false;
        if (typeof value.salt !== 'string' || typeof value.iv !== 'string' || typeof value.ct !== 'string') return false;
        atob(value.salt);
        return atob(value.iv).length > 0 && atob(value.ct).length > 16;
    } catch {
        return false;
    }
}

function savedProfileKey(source, keys = profileKeys) {
    return keys.find(key => hasSavedProfiles(key, source[key]));
}

function migrateProfiles(data, sources, { firstMigration, recover }) {
    if (recover && !firstMigration && isEmptyRoster(data[vaultKey]) && hasSavedProfiles(accountsKey, data[accountsKey])) {
        data[vaultKey] = data[accountsKey];
        delete data[accountsKey];
        return;
    }
    if (profileKeys.some(key => key in data && (firstMigration || !isEmptyRoster(data[key])))) return;
    let selected = [];
    for (const source of sources) {
        const keys = !recover && isEmptyRoster(source[vaultKey]) ? [vaultKey] : profileKeys;
        const key = savedProfileKey(source, keys);
        if (key) {
            selected = [[key, source[key]]];
            break;
        }
        if (firstMigration && !selected.length) selected = keys.filter(key => isEmptyRoster(source[key])).map(key => [key, source[key]]);
    }
    if (!selected.length) return;
    for (const key of profileKeys) delete data[key];
    for (const [key, value] of selected) {
        // Why: a pending vault setup compares the profiles key before it replaces the roster.
        const destination = firstMigration ? key : vaultKey;
        data[destination] = value;
    }
}

function writeItem(state, key, value) {
    if (profileKeys.includes(key)) {
        delete state.seededWithoutProfiles;
        delete state.retryProfileOrigin;
    }
    if (value === null) {
        delete state.data[key];
        const removed = state.deletedDuringSettingsMigration;
        if (removed && !removed.includes(key)) removed.push(key);
    } else state.data[key] = value;
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
    function importSettings(data, source, removed = []) {
        for (const [key, value] of Object.entries(source)) {
            if (profileKeys.includes(key) || removed.includes(key)) continue;
            if (valid(key) && typeof value === 'string' && !(key in data)) data[key] = value;
        }
    }
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
        migrationStatus() {
            const state = read();
            return { initialized: state.initialized, retrySettings: !!state.deletedDuringSettingsMigration, retryProfileOrigin: state.retryProfileOrigin };
        },
        snapshot: () => read().data,
        getItem: key => (valid(key) ? (read().data[key] ?? null) : null),
        keys: () => Object.keys(read().data),
        setItem(key, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            update(state => writeItem(state, key, value));
        },
        compareAndSet(key, expected, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            return update(state => {
                if ((state.data[key] ?? null) !== expected) return false;
                writeItem(state, key, value);
                return true;
            });
        },
        removeItem(key) {
            if (valid(key)) update(state => writeItem(state, key, null));
        },
        seed(values, { fallback, recover = false, readError, profileOrigin } = {}) {
            return update(state => {
                if (state.deletedDuringSettingsMigration && fallback) {
                    importSettings(state.data, fallback, state.deletedDuringSettingsMigration);
                    importSettings(state.data, state.pendingPanelSettings ?? {}, state.deletedDuringSettingsMigration);
                    delete state.deletedDuringSettingsMigration;
                    delete state.pendingPanelSettings;
                }
                if (state.initialized && !recover && !state.seededWithoutProfiles) return false;
                if (!state.initialized && !profileKeys.some(key => key in state.data)) state.seededWithoutProfiles = true;
                migrateProfiles(state.data, [values ?? {}, fallback ?? {}], { firstMigration: !state.initialized, recover });
                if (values && profileOrigin === state.retryProfileOrigin) delete state.retryProfileOrigin;
                if (profileKeys.some(key => key in state.data && !isEmptyRoster(state.data[key]))) {
                    delete state.seededWithoutProfiles;
                    delete state.retryProfileOrigin;
                }
                if (!state.initialized && fallback) importSettings(state.data, fallback);
                if (readError && (!state.initialized || recover) && !savedProfileKey(state.data)) {
                    const hasSettings = Object.keys(state.data).some(key => !profileKeys.includes(key));
                    if (state.initialized || !fallback || !hasSettings) throw readError;
                }
                if (values === null && state.seededWithoutProfiles) state.retryProfileOrigin = profileOrigin;
                if (state.initialized) return false;
                if (fallback === null) {
                    state.deletedDuringSettingsMigration = [];
                    state.pendingPanelSettings = {};
                    importSettings(state.pendingPanelSettings, values ?? {});
                } else importSettings(state.data, values ?? {});
                state.initialized = true;
                return true;
            });
        }
    };
}

module.exports = { profileKeys, savedProfileKey, sharedStorage };
