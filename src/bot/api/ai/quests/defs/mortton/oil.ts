import { Inventory } from '../../../../inventory/Inventory.js';
import { SM_ID } from './areas.js';

export const DOSES_PER_PYRE_LOG = 2;

const OIL_VIALS = [
    { doses: 4, olive: SM_ID.OLIVE_OIL4, sacred: SM_ID.SACRED_OIL4 },
    { doses: 3, olive: SM_ID.OLIVE_OIL3, sacred: SM_ID.SACRED_OIL3 },
    { doses: 2, olive: SM_ID.OLIVE_OIL2, sacred: SM_ID.SACRED_OIL2 },
    { doses: 1, olive: SM_ID.OLIVE_OIL1, sacred: SM_ID.SACRED_OIL1 }
] as const;

export const PYRE_OIL_VIALS = OIL_VIALS.filter(vial => vial.doses >= DOSES_PER_PYRE_LOG);

export function countSacredDoses(count: (id: number) => number): number {
    return OIL_VIALS.reduce((total, vial) => total + count(vial.sacred) * vial.doses, 0);
}

export function sacredOilDoses(): number {
    return countSacredDoses(id => Inventory.countById(id));
}
