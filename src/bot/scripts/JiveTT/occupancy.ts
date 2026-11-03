export interface OccupancyClaim {
    account: string;
    instance: string;
    world: number;
    site: string;
    subarea: string;
    until: number;
}
export interface OccupancyChannel {
    onmessage: ((event: MessageEvent<unknown>) => unknown) | null;
    postMessage(data: unknown): void;
    close(): void;
}
interface OccupancyOptions { channel?: OccupancyChannel | null; now?: () => number; heartbeat?: boolean }
const TTL = 30000;

export class Occupancy {
    private readonly instance = crypto.randomUUID();
    private readonly channel: OccupancyChannel | null;
    private readonly now: () => number;
    private readonly claims = new Map<string, OccupancyClaim>();
    private current: OccupancyClaim | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly account: string, options: OccupancyOptions = {}) {
        this.now = options.now ?? Date.now;
        this.channel = options.channel === undefined ? typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('rs2b0t:jivett:occupancy') : options.channel;
        if (this.channel) {
            this.channel.onmessage = event => this.receive(event.data);
            this.channel.postMessage({ kind: 'query' });
        }
        if (options.heartbeat !== false) this.timer = setInterval(() => this.refresh(), 5000);
    }

    claim(world: number, site: string, subarea = 'main'): void {
        this.current = { account: this.account, instance: this.instance, world, site, subarea, until: this.now() + TTL };
        this.refresh();
    }

    count(world: number, site: string): number {
        return new Set(this.snapshot().filter(value => value.instance !== this.instance && value.world === world && value.site === site).map(value => value.account)).size;
    }

    snapshot(): OccupancyClaim[] {
        for (const [key, value] of this.claims) if (value.until <= this.now()) this.claims.delete(key);
        return [...this.claims.values()].map(value => ({ ...value }));
    }

    release(): void {
        this.current = null;
        this.claims.delete(this.instance);
        this.channel?.postMessage({ kind: 'release', instance: this.instance });
    }

    close(): void {
        this.release();
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.channel?.close();
    }

    private refresh(): void {
        if (!this.current) return;
        this.current.until = this.now() + TTL;
        this.claims.set(this.instance, this.current);
        this.channel?.postMessage({ kind: 'claim', claim: this.current });
    }

    private receive(data: unknown): void {
        if (!data || typeof data !== 'object' || !('kind' in data)) return;
        if (data.kind === 'query') { this.refresh(); return; }
        if (data.kind === 'release' && 'instance' in data && typeof data.instance === 'string') { this.claims.delete(data.instance); return; }
        if (data.kind !== 'claim' || !('claim' in data) || !data.claim || typeof data.claim !== 'object') return;
        const claim = data.claim as Partial<OccupancyClaim>;
        if (typeof claim.account !== 'string' || typeof claim.instance !== 'string' || typeof claim.world !== 'number'
            || typeof claim.site !== 'string' || typeof claim.subarea !== 'string' || typeof claim.until !== 'number'
            || !Number.isFinite(claim.until) || claim.until <= this.now() || claim.until > this.now() + TTL + 1000) return;
        if (this.claims.size < 1000 || this.claims.has(claim.instance)) this.claims.set(claim.instance, claim as OccupancyClaim);
    }
}
