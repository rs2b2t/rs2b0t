import { reader } from '../../adapter/ClientAdapter.js';
import { Loc } from '../entities/index.js';
import EntityQuery from './Query.js';

export const Locs = {
    query(): EntityQuery<Loc> {
        return new EntityQuery(() => reader.locs().map(s => new Loc(s)));
    }
};

export { Loc };
