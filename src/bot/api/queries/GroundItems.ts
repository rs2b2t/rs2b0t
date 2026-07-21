/** Query facade over ground-item snapshots (builder: where/name/within/nearest). */
import { reader } from '../../adapter/ClientAdapter.js';
import { GroundItem } from '../entities/index.js';
import EntityQuery from './Query.js';

export const GroundItems = {
    query(): EntityQuery<GroundItem> {
        return new EntityQuery(() => reader.groundItems().map(s => new GroundItem(s)));
    }
};

export { GroundItem };
