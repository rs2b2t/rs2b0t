import type { QuestSnapshot } from '../../engine/types.js';
import { selectTieredGear } from '../../tieredGear.js';

// Why: no weapon slot; Excalibur is the only sword that kills the titan and anything else loses the fight in silence.
// Why: chainbody outranks platebody, as rune plate wants Dragon Slayer complete and refuses without a message.
const SLOTS = [
    ['chainbody', 'platebody'],
    ['platelegs', 'plateskirt'],
    ['full helm', 'med helm'],
    ['kiteshield', 'sq shield']
] as const;

/** Every word a slot can pick, so the spillover deposit never banks the kit. */
export const ARMOUR_KEEP: readonly string[] = SLOTS.flat();

/** Refusals are silent, so a level-gated piece is remembered and skipped. */
export const unwearable = new Set<string>();

export function resetUnwearable(): void {
    unwearable.clear();
}

/** The best banked armour for the slots the account has not filled. */
export function armourWanted(snap: QuestSnapshot): string[] {
    return selectTieredGear(snap, SLOTS, unwearable);
}
