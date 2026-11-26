const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { lockSync } = require('proper-lockfile');

const profileKeys = ['rs2b0t:multibox:profiles', 'rs2b0t:multibox:accounts'];

function isEmptyRoster(value) {
    return typeof value === 'string' && /^[ \t\r\n]*\[[ \t\r\n]*\][ \t\r\n]*$/.test(value);
}

function recoverProfiles(data, sources) {
    if (profileKeys.some(key => key in data && !isEmptyRoster(data[key]))) return;
    for (const source of sources) {
        const saved = profileKeys.filter(key => typeof source[key] === 'string' && !isEmptyRoster(source[key]));
        if (!saved.length) continue;
        for (const key of profileKeys) delete data[key];
        for (const key of saved) data[key] = source[key];
        return;
    }
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
                if (state.initialized) {
                    if (recover) recoverProfiles(state.data, [values, fallback]);
                    return false;
                }
                for (const source of [values, fallback]) {
                    const hasProfiles = profileKeys.some(key => key in state.data);
                    for (const [key, value] of Object.entries(source)) {
                        if (hasProfiles && profileKeys.includes(key)) continue;
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
