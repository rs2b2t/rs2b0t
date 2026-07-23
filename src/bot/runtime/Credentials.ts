const hasStorage = typeof localStorage !== 'undefined';
const KEY = 'rs2b0t:creds';

export interface Creds {
    username: string;
    password: string;
}

export const Credentials = {
    get(): Creds | null {
        if (!hasStorage) {
            return null;
        }
        const raw = localStorage.getItem(KEY);
        if (!raw) {
            return null;
        }
        try {
            const c = JSON.parse(raw) as Creds;
            return typeof c.username === 'string' && typeof c.password === 'string' && c.username.length > 0 ? c : null;
        } catch {
            return null;
        }
    },

    save(username: string, password: string): void {
        if (hasStorage) {
            localStorage.setItem(KEY, JSON.stringify({ username, password }));
        }
    },

    clear(): void {
        if (hasStorage) {
            localStorage.removeItem(KEY);
        }
    }
};
