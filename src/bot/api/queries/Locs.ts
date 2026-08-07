import { reader } from '../../adapter/ClientAdapter.js';
import { Loc } from '../entities/index.js';
import EntityQuery from './Query.js';

/**
 * Scenery queries. Empty for about a tick after a level change — blank does not
 * mean absent.
 *
 * Uses snapshot-first filtering so name/action/within do not allocate a Loc for
 * every piece of scenery in the scene.
 * @see docs/API.md#entities--queries
 * @see docs/NAV.md#level-change-loc-lag
 */
export const Locs = {
    query(): EntityQuery<Loc> {
        return EntityQuery.fromSnapshots(
            () => reader.locs(),
            s => new Loc(s)
        );
    }
};

export { Loc };
