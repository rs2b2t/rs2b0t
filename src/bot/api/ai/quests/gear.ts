import type { Loadout } from '../../loadout/loadouts.js';
import { questRuneLegs } from './armour.js';
import type { QuestSnapshot } from './engine/types.js';

/** Current loadout resolved by AIOQuester for quest modules. */
export const QuestLoadout = { current: null as Loadout | null };

export function questWornGear(snap: QuestSnapshot): Loadout['worn'] {
    const worn = QuestLoadout.current?.worn ?? {};
    const legs = worn.legs && questRuneLegs(snap, worn.legs);
    return legs ? { ...worn, legs: legs.name } : worn;
}
