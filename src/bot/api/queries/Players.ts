import { reader } from '../../adapter/ClientAdapter.js';
import { Player } from '../entities/index.js';
import EntityQuery from './Query.js';

export const Players = {
    query(): EntityQuery<Player> {
        return new EntityQuery(() => reader.players().map(s => new Player(s)));
    }
};

export { Player };
