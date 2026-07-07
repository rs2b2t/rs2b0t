import type { Locatable } from '../entities/index.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

/**
 * RuneMate-shaped fluent filter over a snapshot supplier. Cheap: the supplier
 * runs once per terminal call (results/nearest/first/...).
 */
export default class EntityQuery<E extends QueryableEntity> {
    private filters: ((e: E) => boolean)[] = [];

    constructor(private readonly supplier: () => E[]) {}

    /** Case-insensitive exact name match against any of the given names. */
    name(...names: string[]): this {
        const wanted = names.map(n => n.toLowerCase());
        this.filters.push(e => e.name !== null && wanted.includes(e.name.toLowerCase()));
        return this;
    }

    /** Entity offers this action (case-insensitive). */
    action(action: string): this {
        const wanted = action.toLowerCase();
        this.filters.push(e => e.actions().some(a => a.toLowerCase() === wanted));
        return this;
    }

    /** Within `dist` tiles of the local player. */
    within(dist: number): this {
        this.filters.push(e => e.distance() <= dist);
        return this;
    }

    /** Within a rectangle (inclusive), e.g. a script's working area. */
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
