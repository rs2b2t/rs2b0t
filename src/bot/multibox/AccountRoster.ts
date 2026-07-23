import type { Account } from './types.js';

const KEY = 'rs2b0t:multibox:accounts';

export class AccountRoster {
    private accounts: Account[] = [];
    private assigned = new Set<string>();

    constructor(private storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
        this.load();
    }

    list(): Account[] {
        return [...this.accounts];
    }

    add(a: Account): void {
        if (this.accounts.some(x => x.username === a.username)) {
            return;
        }
        this.accounts.push(a);
        this.save();
    }

    remove(username: string): void {
        this.accounts = this.accounts.filter(a => a.username !== username);
        this.assigned.delete(username);
        this.save();
    }

    claimNext(): Account | null {
        const free = this.accounts.find(a => !this.assigned.has(a.username));
        if (!free) {
            return null;
        }
        this.assigned.add(free.username);
        return free;
    }

    release(username: string): void {
        this.assigned.delete(username);
    }

    private load(): void {
        const raw = this.storage?.getItem(KEY);
        if (!raw) {
            return;
        }
        try {
            const parsed = JSON.parse(raw) as Account[];
            if (Array.isArray(parsed)) {
                this.accounts = parsed.filter(a => typeof a?.username === 'string' && typeof a?.password === 'string');
            }
        } catch {
        }
    }

    private save(): void {
        this.storage?.setItem(KEY, JSON.stringify(this.accounts));
    }
}
