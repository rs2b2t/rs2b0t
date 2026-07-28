import { reader } from '../../adapter/ClientAdapter.js';
import { Loc } from '../entities/index.js';
import EntityQuery from './Query.js';

/**
 * Scenery queries. Empty for about a tick after a level change — blank does not
 * mean absent.
 * @see docs/API.md#entities--queries
 * @see docs/NAV.md#level-change-loc-lag
 */
export const Locs = {
    query(): EntityQuery<Loc> {
        return new EntityQuery(() => reader.locs().map(s => new Loc(s)));
    }
};

export { Loc };
