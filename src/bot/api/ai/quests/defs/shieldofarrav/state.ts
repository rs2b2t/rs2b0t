import { reader } from '../../../../../adapter/ClientAdapter.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { SOA_ID } from './areas.js';
import type { ArravGang } from './config.js';

/** The half this gang can take for itself. */
export function ownHalf(gang: ArravGang): number {
    return gang === 'phoenix' ? SOA_ID.SHIELD_PHOENIX : SOA_ID.SHIELD_BLACKARM;
}

/** The half only the other gang can reach. */
export function otherHalf(gang: ArravGang): number {
    return gang === 'phoenix' ? SOA_ID.SHIELD_BLACKARM : SOA_ID.SHIELD_PHOENIX;
}

export function liveItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

// Why: `~objbox` and `~mesbox` build a main modal, not a chat line, so their text never reaches `GameMessages`.

/** Whether the open main modal says something. */
export function modalSaid(pattern: RegExp): boolean {
    return reader.mainModalTexts().some(line => pattern.test(line));
}
