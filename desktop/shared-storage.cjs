const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { lockSync } = require('proper-lockfile');

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
    function write(state) {
        const temporary = join(dir, `${randomUUID()}.tmp`);
        try {
            fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
            fs.renameSync(temporary, file);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }
    function setValue(state, key, value) {
        if (state.data[key] === value) return;
        state.data[key] = value;
        write(state);
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
    return {
        initialized: () => read().initialized,
        snapshot: () => read().data,
        getItem: key => (valid(key) ? (read().data[key] ?? null) : null),
        getItems(keys) {
            const { data } = read();
            return keys.map(key => valid(key) ? data[key] ?? null : null);
        },
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
            if (valid(key))
                withLockedState(state => {
                    if (!(key in state.data)) return;
                    delete state.data[key];
                    write(state);
                });
        },
        seed(values) {
            withLockedState(state => {
                if (state.initialized) return;
                for (const [key, value] of Object.entries(values)) {
                    if (valid(key) && typeof value === 'string' && !(key in state.data)) state.data[key] = value;
                }
                state.initialized = true;
                write(state);
            });
        }
    };
}

module.exports = { sharedStorage };
