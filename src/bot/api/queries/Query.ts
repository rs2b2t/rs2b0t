import type { Locatable } from '../entities/index.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

export function matchesEntityName(actual: string | null, configured: string): boolean {
    return actual !== null && actual.trim().toLowerCase() === configured.trim().toLowerCase();
}

/**
 * Chainable filter over scene entities; a terminal evaluates it against the
 * current scene.
 * @see docs/API.md#entityquery
 */
export default class EntityQuery<E extends QueryableEntity> {
    private filters: ((e: E) => boolean)[] = [];

    constructor(private readonly supplier: () => E[]) {}

    name(...names: string[]): this {
        const wanted = names.map(n => n.trim().toLowerCase());
        this.filters.push(e => e.name !== null && wanted.includes(e.name.trim().toLowerCase()));
        return this;
    }

    action(action: string): this {
        const wanted = action.toLowerCase();
        this.filters.push(e => e.actions().some(a => a.toLowerCase() === wanted));
        return this;
    }

    within(dist: number): this {
        this.filters.push(e => e.distance() <= dist);
        return this;
    }

    /**
     * Chebyshev disk around an arbitrary tile (camp pin, booth stand, furnace).
     * Prefer this over hand-rolling `tile.distanceTo(stand) <= leash` in scripts.
     */
    withinOf(origin: WorldTile, dist: number): this {
        const r = Math.max(0, Math.floor(dist));
        this.filters.push(e => {
            const t = e.tile();
            return Math.max(Math.abs(t.x - origin.x), Math.abs(t.z - origin.z)) <= r;
        });
        return this;
    }

    inside(area: { minX: number; maxX: number; minZ: number; maxZ: number }): this {
        this.filters.push(e => {
            const t: WorldTile = e.tile();
            return t.x >= area.minX && t.x <= area.maxX && t.z >= area.minZ && t.z <= area.maxZ;
        });
        return this;
    }

    where(pred: (e: E) => boolean): this {
        this.filters.push(pred);
        return this;
    }

    results(): E[] {
        return this.supplier().filter(e => this.filters.every(f => f(e)));
    }

    nearest(): E | null {
        let best: E | null = null;
        for (const e of this.results()) {
            if (!best || e.distance() < best.distance()) {
                best = e;
            }
        }

        return best;
    }

    /**
     * Nearest to the player among results; when any result is within
     * {@link preferRadius} of the player, only that local set is considered.
     * @see pickNearestPreferLocal in TargetPick.ts
     */
    nearestPreferLocal(preferRadius: number): E | null {
        const r = Math.max(0, Math.floor(preferRadius));
        const all = this.results();
        if (all.length === 0) {
            return null;
        }
        let pool = all;
        if (r > 0) {
            const local = all.filter(e => e.distance() <= r);
            if (local.length > 0) {
                pool = local;
            }
        }
        let best: E | null = null;
        for (const e of pool) {
            if (!best || e.distance() < best.distance()) {
                best = e;
            }
        }
        return best;
    }

    first(): E | null {
        return this.results()[0] ?? null;
    }

    exists(): boolean {
        return this.results().length > 0;
    }

    count(): number {
        return this.results().length;
    }
}
