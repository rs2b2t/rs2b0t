const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { lockSync } = require('proper-lockfile');

const vaultKey = 'rs2b0t:multibox:profiles';
const accountsKey = 'rs2b0t:multibox:accounts';
const profileKeys = [vaultKey, accountsKey];
const gcmTagBytes = 16;

class InvalidLegacyProfiles extends Error {}

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
        return atob(value.iv).length > 0 && atob(value.ct).length >= gcmTagBytes + '[]'.length;
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
    let invalidKey;
    for (const source of sources) {
        const keys = !recover && isEmptyRoster(source[vaultKey]) ? [vaultKey] : profileKeys;
        const key = savedProfileKey(source, keys);
        if (key) {
            selected = [[key, source[key]]];
            invalidKey = undefined;
            break;
        }
        invalidKey ??= keys.find(key => typeof source[key] === 'string' && !isEmptyRoster(source[key]));
        if (firstMigration && !selected.length) selected = keys.filter(key => isEmptyRoster(source[key])).map(key => [key, source[key]]);
    }
    if (invalidKey) throw new InvalidLegacyProfiles(`Invalid legacy profile data in ${invalidKey}. Expected a saved vault or a roster with usernames, passwords and optional worlds 1, 2 or 3.`);
    if (!selected.length) return;
    for (const key of profileKeys) delete data[key];
    for (const [key, value] of selected) {
        // Why: a pending vault setup compares the profiles key before it replaces the roster.
        const destination = firstMigration ? key : vaultKey;
        data[destination] = value;
    }
}

function cancelProfileImport(state) {
    delete state.seededWithoutProfiles;
    if (!state.profileRetries) return;
    for (const [origin, removed] of Object.entries(state.profileRetries)) {
        if (!removed) delete state.profileRetries[origin];
    }
    if (!Object.keys(state.profileRetries).length) delete state.profileRetries;
}

function profileState(state) {
    return [state.profileRecovery, state.profileRevision ?? 0, ...profileKeys.map(key => state.data[key])];
}

function writeItem(state, key, value) {
    if (profileKeys.includes(key)) {
        state.profileRevision = (state.profileRevision ?? 0) + 1;
        delete state.profileRecovery;
        cancelProfileImport(state);
    }
    if (value === null) {
        delete state.data[key];
        const removals = Object.values(state.panelMigrations ?? {}).map(migration => migration.removed);
        for (const removed of [state.deletedDuringSettingsMigration, ...Object.values(state.profileRetries ?? {}), ...removals]) {
            if (removed && !removed.includes(key)) removed.push(key);
        }
    } else state.data[key] = value;
}

function decodeStore(document) {
    const state = JSON.parse(document);
    if (state.retryProfileOrigin) {
        state.profileRetries ??= {};
        state.profileRetries[state.retryProfileOrigin] = state.deletedDuringProfileRetry ?? null;
        delete state.retryProfileOrigin;
        delete state.deletedDuringProfileRetry;
    }
    // Why: older writers drop the trailing newline and cannot record setting deletions.
    if (state.initialized && !document.endsWith('\n')) {
        delete state.deletedDuringSettingsMigration;
        delete state.pendingPanelSettings;
        for (const origin of Object.keys(state.profileRetries ?? {})) state.profileRetries[origin] = null;
        for (const migration of Object.values(state.panelMigrations ?? {})) delete migration.removed;
    }
    const marker = state.seededWithoutProfiles;
    if (marker || state.profileRetries) {
        if (!marker || !profileKeys.every(key => Object.hasOwn(marker, key) && marker[key] === state.data[key])) {
            cancelProfileImport(state);
        }
    }
    if (state.profileRecovery && !profileKeys.every(key => Object.hasOwn(state.data, key))) delete state.profileRecovery;
    for (const key of profileKeys) if (state.data[key] === null) delete state.data[key];
    return state;
}

function encodeStore(state) {
    if (!state.seededWithoutProfiles && !state.profileRecovery) return state;
    // Why: older desktops read null as missing, but their saves and resets replace or remove the key.
    const marker = Object.fromEntries(profileKeys.map(key => [key, state.data[key] ?? null]));
    const encoded = { ...state, data: { ...marker, ...state.data } };
    if (state.seededWithoutProfiles) encoded.seededWithoutProfiles = marker;
    return encoded;
}

function sharedStorage(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'storage.json');
    const migrationId = randomUUID();
    const read = () => {
        try {
            return decodeStore(fs.readFileSync(file, 'utf8'));
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
    function finishProfileRetry(state, origin, values) {
        if (!values || !Object.hasOwn(state.profileRetries ?? {}, origin)) return false;
        const removed = state.profileRetries[origin];
        if (removed) importSettings(state.pendingPanelSettings ?? state.data, values, removed);
        delete state.profileRetries[origin];
        if (!Object.keys(state.profileRetries).length) delete state.profileRetries;
        return true;
    }
    function write(state) {
        const temporary = join(dir, `${randomUUID()}.tmp`);
        try {
            fs.writeFileSync(temporary, JSON.stringify(encodeStore(state)) + '\n', { mode: 0o600 });
            fs.renameSync(temporary, file);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }
    function withLockedState(change) {
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
        try {
            return change(read());
        } finally {
            release();
        }
    }
    function updateMigration(state, change) {
        const previous = JSON.stringify(state);
        // Why: a first launch can exit before seed() drops its deletion list.
        for (const [id, migration] of Object.entries(state.panelMigrations ?? {})) {
            try {
                process.kill(migration.pid, 0);
            } catch (error) {
                if (error.code === 'ESRCH') delete state.panelMigrations[id];
            }
        }
        const result = change(state);
        if (state.panelMigrations && !Object.keys(state.panelMigrations).length) delete state.panelMigrations;
        if (!state.profileRetries && !state.panelMigrations) delete state.seededWithoutProfiles;
        if (JSON.stringify(state) !== previous) write(state);
        return result;
    }
    function setValue(state, key, value) {
        if (state.seededWithoutProfiles || state.profileRetries || state.panelMigrations || state.deletedDuringSettingsMigration) {
            updateMigration(state, current => writeItem(current, key, value));
        } else if ((state.data[key] ?? null) !== value || (value === null && profileKeys.includes(key))) {
            writeItem(state, key, value);
            write(state);
        }
    }
    function update(change) {
        return withLockedState(state => updateMigration(state, change));
    }
    return {
        initialized: () => read().initialized,
        migrationStatus(trackPanel = false, recover = false) {
            let state = read();
            if ((!state.initialized && trackPanel) || recover) {
                state = update(current => {
                    if (recover && profileKeys.every(key => !(key in current.data) || isEmptyRoster(current.data[key]))) {
                        current.profileRecovery ??= migrationId;
                    }
                    if (!current.initialized && trackPanel) {
                        current.panelMigrations ??= {};
                        current.panelMigrations[migrationId] = { pid: process.pid, removed: [] };
                    }
                    return current;
                });
            }
            return {
                initialized: state.initialized,
                retrySettings: !!state.deletedDuringSettingsMigration,
                retryProfileOrigins: Object.keys(state.profileRetries ?? {}),
                expectedProfiles: recover ? profileState(state) : undefined
            };
        },
        snapshot: () => read().data,
        getItem: key => (valid(key) ? (read().data[key] ?? null) : null),
        keys: () => Object.keys(read().data),
        setItem(key, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            withLockedState(state => setValue(state, key, value));
        },
        compareAndSet(key, expected, value) {
            if (!valid(key) || typeof value !== 'string') throw new Error('Invalid saved setting');
            return withLockedState(state => {
                if ((state.data[key] ?? null) !== expected) return false;
                setValue(state, key, value);
                return true;
            });
        },
        removeItem(key) {
            if (valid(key)) withLockedState(state => setValue(state, key, null));
        },
        seed(values, { fallback, recover = false, expectedProfiles, readError, profileOrigin, retries = [] } = {}) {
            return update(state => {
                if (state.deletedDuringSettingsMigration && fallback) {
                    importSettings(state.data, fallback, state.deletedDuringSettingsMigration);
                    importSettings(state.data, state.pendingPanelSettings ?? {}, state.deletedDuringSettingsMigration);
                    delete state.deletedDuringSettingsMigration;
                    delete state.pendingPanelSettings;
                }
                const migration = state.panelMigrations?.[migrationId];
                if (migration) {
                    delete state.panelMigrations[migrationId];
                    if (state.initialized && values && migration.removed) {
                        importSettings(state.pendingPanelSettings ?? state.data, values, migration.removed);
                    }
                }
                const sources = [values ?? {}];
                finishProfileRetry(state, profileOrigin, values);
                for (const [origin, source] of retries) {
                    if (finishProfileRetry(state, origin, source)) sources.push(source);
                }
                const profilesChanged = expectedProfiles && profileState(state).some((value, i) => value !== expectedProfiles[i]);
                if (!profilesChanged && (!state.initialized || recover || state.seededWithoutProfiles)) {
                    if (!state.initialized && !profileKeys.some(key => key in state.data)) state.seededWithoutProfiles = true;
                    migrateProfiles(state.data, [...sources, fallback ?? {}], { firstMigration: !state.initialized, recover });
                }
                if (profileKeys.some(key => key in state.data && !isEmptyRoster(state.data[key]))) {
                    delete state.seededWithoutProfiles;
                    delete state.profileRecovery;
                }
                if (!state.initialized && fallback) importSettings(state.data, fallback);
                if (readError && (state.initialized ? recover && !profilesChanged : !fallback) && !savedProfileKey(state.data)) throw readError;
                if (values === null && (migration?.removed || state.seededWithoutProfiles)) {
                    state.profileRetries ??= {};
                    const removed = state.profileRetries[profileOrigin];
                    if (migration?.removed && removed !== null) {
                        state.profileRetries[profileOrigin] = [...new Set([...(removed ?? []), ...migration.removed])];
                    } else state.profileRetries[profileOrigin] = removed ?? null;
                }
                if (state.initialized) return false;
                if (fallback === null) {
                    state.deletedDuringSettingsMigration = [];
                    state.pendingPanelSettings = {};
                    importSettings(state.pendingPanelSettings, values ?? {}, migration?.removed);
                } else if (!migration) importSettings(state.data, values ?? {});
                state.initialized = true;
                return true;
            });
        }
    };
}

module.exports = { InvalidLegacyProfiles, profileKeys, savedProfileKey, sharedStorage };
