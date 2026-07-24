import { boxKey } from './box.js';

// Per-instance: sessionStorage (per tab; per iframe in the MultiBox via ?box=),
// never the origin-shared localStorage — else every tab logs in as whichever
// tab saved last.
const hasStorage = typeof sessionStorage !== 'undefined';

export interface Creds {
    username: string;
    password: string;
}

export const Credentials = {
    get(): Creds | null {
        if (!hasStorage) {
            return null;
        }
        const raw = sessionStorage.getItem(boxKey('creds'));
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
            sessionStorage.setItem(boxKey('creds'), JSON.stringify({ username, password }));
        }
    },

    clear(): void {
        if (hasStorage) {
            sessionStorage.removeItem(boxKey('creds'));
        }
    }
};
