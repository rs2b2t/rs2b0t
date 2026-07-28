import { reader } from '../../adapter/ClientAdapter.js';
import { GroundItem } from '../entities/index.js';
import EntityQuery from './Query.js';

/**
 * Ground-item queries.
 * @see docs/API.md#entities--queries
 */
export const GroundItems = {
    query(): EntityQuery<GroundItem> {
        return new EntityQuery(() => reader.groundItems().map(s => new GroundItem(s)));
    }
};

export { GroundItem };
