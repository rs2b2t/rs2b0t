import type { OccupancyChannel } from './occupancy.js';

interface Ticket { id: string; at: number; until: number }
const TTL = 30000;
const staggered = new Set<string>();
export function marketStaggerMs(account: string): number {
    let hash = 2166136261;
    for (const char of account.trim().toLowerCase().replaceAll('_', ' ')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return ((hash >>> 0) % 61) * 500;
}
export class AdvisoryMarketQueue {
    private readonly ticket: Ticket;
    private readonly tickets = new Map<string, Ticket>();

    constructor(account: string, private readonly channel: OccupancyChannel | null, private readonly now = Date.now) {
        this.ticket = { id: `${account}:${crypto.randomUUID()}`, at: now(), until: now() + TTL };
        if (channel) {
            channel.onmessage = event => this.receive(event.data);
            channel.postMessage({ kind: 'query' });
        }
        this.touch();
    }

    touch(): void {
        this.ticket.until = this.now() + TTL;
        this.tickets.set(this.ticket.id, this.ticket);
        this.channel?.postMessage({ kind: 'ticket', ticket: this.ticket });
    }

    turn(): boolean {
        for (const [id, ticket] of this.tickets) if (ticket.until <= this.now()) this.tickets.delete(id);
        return [...this.tickets.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0]?.id === this.ticket.id;
    }

    close(): void {
        this.channel?.postMessage({ kind: 'release', id: this.ticket.id });
        this.channel?.close();
    }

    private receive(value: unknown): void {
        if (!value || typeof value !== 'object' || !('kind' in value)) return;
        if (value.kind === 'query') { this.touch(); return; }
        if (value.kind === 'release' && 'id' in value && typeof value.id === 'string') { this.tickets.delete(value.id); return; }
        if (value.kind !== 'ticket' || !('ticket' in value) || !value.ticket || typeof value.ticket !== 'object') return;
        const ticket = value.ticket as Partial<Ticket>;
        if (typeof ticket.id !== 'string' || typeof ticket.at !== 'number' || typeof ticket.until !== 'number'
            || !Number.isFinite(ticket.at) || !Number.isFinite(ticket.until) || ticket.until > this.now() + TTL + 1000 || ticket.until <= this.now()) return;
        if (this.tickets.size < 1000 || this.tickets.has(ticket.id)) this.tickets.set(ticket.id, ticket as Ticket);
    }
}

export async function withMarketTurn<T>(account: string, ready: () => boolean, wait: () => Promise<void>, work: () => Promise<T>): Promise<T | null> {
    if (!staggered.has(account)) {
        const start = Date.now() + marketStaggerMs(account);
        while (Date.now() < start) { if (!ready()) return null; await wait(); }
        staggered.add(account);
    }
    const deadline = Date.now() + 120000;
    if (typeof navigator !== 'undefined' && navigator.locks) {
        const abort = new AbortController();
        let acquired = false;
        let release: (() => void) | undefined;
        let error: unknown;
        const pending = navigator.locks.request('rs2b0t:seers-market:w1', { signal: abort.signal }, async () => {
            acquired = true;
            await new Promise<void>(resolve => { release = resolve; });
        }).catch(reason => { error = reason; });
        try {
            while (!acquired) {
                if (!ready() || error || Date.now() >= deadline) return null;
                await wait();
            }
            return ready() ? await work() : null;
        } finally {
            abort.abort();
            release?.();
            await pending;
        }
    }
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('rs2b0t:jivett:market');
    const queue = new AdvisoryMarketQueue(account, channel);
    const heartbeat = setInterval(() => queue.touch(), 5000);
    try {
        await wait();
        while (!queue.turn()) {
            if (!ready() || Date.now() >= deadline) return null;
            queue.touch();
            await wait();
        }
        return ready() ? await work() : null;
    } finally {
        clearInterval(heartbeat);
        queue.close();
    }
}
