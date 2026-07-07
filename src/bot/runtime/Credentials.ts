/**
 * Locally-saved login credentials so the bot can (re)log in by itself — on a
 * fresh page load and after a disconnect that drops to the title screen
 * (Client.logout() clears the in-memory loginUser/loginPass).
 *
 * SECURITY: stored in localStorage in plaintext, on this machine only. Fine
 * for a private/dev server with throwaway accounts (the dev server doesn't
 * even check passwords); do not save a password you care about on a shared
 * machine. Clear it from the panel.
 */
const hasStorage = typeof localStorage !== 'undefined';
const KEY = 'lcb:creds';

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
