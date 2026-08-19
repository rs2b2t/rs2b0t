import type { QuestSnapshot } from '../../engine/types.js';

const TIERS = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

// Why: no weapon slot — Excalibur is the only sword that kills the titan, and anything else in the hand loses the fight in silence.
// Why: chainbody outranks platebody, as rune plate wants Dragon Slayer complete and refuses without a message.
const SLOTS: readonly { readonly kinds: readonly string[] }[] = [
    { kinds: ['chainbody', 'platebody'] },
    { kinds: ['platelegs', 'plateskirt'] },
    { kinds: ['full helm', 'med helm'] },
    { kinds: ['kiteshield', 'sq shield'] }
];

/** Every word a slot can pick, so the spillover deposit never banks the kit. */
export const ARMOUR_KEEP: readonly string[] = SLOTS.flatMap(s => s.kinds);

/** Refusals are silent, so a level-gated piece is remembered rather than re-picked. */
export const unwearable = new Set<string>();

export function resetUnwearable(): void {
    unwearable.clear();
}

function wearingKind(snap: QuestSnapshot, kinds: readonly string[]): boolean {
    for (const name of snap.worn) {
        if (kinds.some(kind => name.endsWith(kind))) {
            return true;
        }
    }
    return false;
}

function bestForSlot(snap: QuestSnapshot, kinds: readonly string[]): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            const name = `${tier} ${kind}`;
            if (unwearable.has(name)) {
                continue;
            }
            if ((snap.bank?.get(name) ?? 0) > 0 || (snap.inv.get(name) ?? 0) > 0) {
                return name[0]!.toUpperCase() + name.slice(1);
            }
        }
    }
    return null;
}

/** The best banked armour for the slots the account has not filled. */
export function armourWanted(snap: QuestSnapshot): string[] {
    const out: string[] = [];
    for (const { kinds } of SLOTS) {
        if (wearingKind(snap, kinds)) {
            continue;
        }
        const pick = bestForSlot(snap, kinds);
        if (pick) {
            out.push(pick);
        }
    }
    return out;
}
