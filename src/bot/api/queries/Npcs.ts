import { reader } from '../../adapter/ClientAdapter.js';
import { Npc } from '../entities/index.js';
import EntityQuery from './Query.js';

export const Npcs = {
    query(): EntityQuery<Npc> {
        return new EntityQuery(() => reader.npcs().map(s => new Npc(s)));
    },

    all(): Npc[] {
        return reader.npcs().map(s => new Npc(s));
    },

    /** The `count` nearest NPCs, nearest first. */
    nearest(count: number = 1): Npc[] {
        return Npcs.all()
            .sort((a, b) => a.distance() - b.distance())
            .slice(0, count);
    }
};

export { Npc };
