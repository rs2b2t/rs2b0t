/**
 * Seeded PRNG + distribution helpers for humanization (PLAN.md §humanization).
 * mulberry32 keyed on the account name gives every bot a stable personality:
 * the same account always draws the same trajectory/delay quirks.
 */
export class Prng {
    private state: number;
    /** Spare normal deviate (Box-Muller produces pairs). */
    private spare: number | null = null;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /** Uniform [0, 1). */
    next(): number {
        this.state = (this.state + 0x6d2b79f5) | 0;
        let t = this.state ^ (this.state >>> 15);
        t = Math.imul(t, 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Uniform [min, max). */
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /** Uniform integer [min, max] inclusive. */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    /** Standard normal via Box-Muller. */
    gaussian(): number {
        if (this.spare !== null) {
            const v = this.spare;
            this.spare = null;
            return v;
        }

        let u = 0;
        let v = 0;
        while (u === 0) {
            u = this.next();
        }
        v = this.next();

        const mag = Math.sqrt(-2 * Math.log(u));
        this.spare = mag * Math.sin(2 * Math.PI * v);
        return mag * Math.cos(2 * Math.PI * v);
    }

    /**
     * Log-normal sample clamped to [min, max] — the shape human reaction and
     * dwell times follow (median = exp(mu), right-skewed heavy tail).
     */
    logNormal(mu: number, sigma: number, min: number, max: number): number {
        const v = Math.exp(mu + sigma * this.gaussian());
        return Math.min(max, Math.max(min, v));
    }
}

/** FNV-1a over the lowercased name — the per-account personality seed. */
export function seedFromName(name: string): number {
    let hash = 0x811c9dc5;
    const lower = name.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        hash ^= lower.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}
