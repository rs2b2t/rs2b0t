import { reader } from '../../adapter/ClientAdapter.js';
import { Npc } from '../entities/index.js';
import EntityQuery from './Query.js';

/**
 * NPC queries.
 * @see docs/API.md#entities--queries
 */
export function talkOp(actions: string[]): string | null {
    return actions.find(a => /^talk/i.test(a)) ?? null;
}

export const Npcs = {
    query(): EntityQuery<Npc> {
        return EntityQuery.fromSnapshots(
            () => reader.npcs(),
            s => new Npc(s)
        );
    },

    all(): Npc[] {
        return reader.npcs().map(s => new Npc(s));
    },

    nearest(count: number = 1): Npc[] {
        return Npcs.all()
            .sort((a, b) => a.distance() - b.distance())
            .slice(0, count);
    }
};

export { Npc };
