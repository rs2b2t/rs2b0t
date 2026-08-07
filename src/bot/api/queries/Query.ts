import type { Locatable } from '../entities/index.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

/**
 * Minimal fields shared by Loc/Npc/GroundItem snapshots (and adapted players)
 * so name / action / distance filters can run before allocating entity wrappers.
 * Matches ClientAdapter snapshot shapes (`ops`, not `actions()`).
 */
export interface EntitySnapView {
    name: string | null;
    /** Menu ops; null/hidden slots ignored by {@link EntityQuery.action}. */
    ops: readonly (string | null)[];
    tile: WorldTile;
    distance: number;
}

export function matchesEntityName(actual: string | null, configured: string): boolean {
    return actual !== null && actual.trim().toLowerCase() === configured.trim().toLowerCase();
}

/**
 * Chainable filter over scene entities; a terminal evaluates it against the
 * current scene.
 *
 * Built via {@link EntityQuery.fromSnapshots} so name/action/within/withinOf
 * filters run on raw snapshots and only matching rows are wrapped into Loc/Npc
 * objects (hot gather loops used to allocate a Loc for every scenery tile).
 *
 * @see docs/API.md#entityquery
 */
export default class EntityQuery<E extends QueryableEntity> {
    private snapFilters: ((s: EntitySnapView) => boolean)[] = [];
    private entityFilters: ((e: E) => boolean)[] = [];

    private constructor(
        private readonly supplySnaps: () => readonly EntitySnapView[],
        private readonly wrap: (s: EntitySnapView) => E
    ) {}

    /**
     * Snapshot-first query: common filters run before `wrap`.
     * `S` must expose name/actions/tile/distance (LocSnapshot etc. already do).
     */
    static fromSnapshots<S extends EntitySnapView, E extends QueryableEntity>(
        supply: () => readonly S[],
        wrap: (s: S) => E
    ): EntityQuery<E> {
        return new EntityQuery<E>(
            () => supply(),
            s => wrap(s as S)
        );
    }

    name(...names: string[]): this {
        const wanted = names.map(n => n.trim().toLowerCase());
        this.snapFilters.push(
            s => s.name !== null && wanted.includes(s.name.trim().toLowerCase())
        );
        return this;
    }

    action(action: string): this {
        const wanted = action.toLowerCase();
        this.snapFilters.push(s =>
            s.ops.some(a => a != null && a !== 'hidden' && a.toLowerCase() === wanted)
        );
        return this;
    }

    within(dist: number): this {
        this.snapFilters.push(s => s.distance <= dist);
        return this;
    }

    /**
     * Chebyshev disk around an arbitrary tile (camp pin, booth stand, furnace).
     * Prefer this over hand-rolling `tile.distanceTo(stand) <= leash` in scripts.
     */
    withinOf(origin: WorldTile, dist: number): this {
        const r = Math.max(0, Math.floor(dist));
        this.snapFilters.push(s => {
            const t = s.tile;
            return Math.max(Math.abs(t.x - origin.x), Math.abs(t.z - origin.z)) <= r;
        });
        return this;
    }

    inside(area: { minX: number; maxX: number; minZ: number; maxZ: number }): this {
        this.snapFilters.push(s => {
            const t = s.tile;
            return t.x >= area.minX && t.x <= area.maxX && t.z >= area.minZ && t.z <= area.maxZ;
        });
        return this;
    }

    /** Entity-level predicate (runs after wrap). */
    where(pred: (e: E) => boolean): this {
        this.entityFilters.push(pred);
        return this;
    }

    results(): E[] {
        const snaps = this.supplySnaps();
        const out: E[] = [];
        for (const s of snaps) {
            if (this.snapFilters.length > 0 && !this.snapFilters.every(f => f(s))) {
                continue;
            }
            const e = this.wrap(s);
            if (this.entityFilters.length > 0 && !this.entityFilters.every(f => f(e))) {
                continue;
            }
            out.push(e);
        }
        return out;
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
