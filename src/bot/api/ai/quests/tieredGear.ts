import type { QuestSnapshot } from './engine/types.js';

const TIERS = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

function bestForSlot(snap: QuestSnapshot, kinds: readonly string[], unwearable: ReadonlySet<string>): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            const name = `${tier} ${kind}`;
            if (unwearable.has(name)) continue;
            if ((snap.bank?.get(name) ?? 0) > 0 || (snap.inv.get(name) ?? 0) > 0) {
                return name[0]!.toUpperCase() + name.slice(1);
            }
        }
    }
    return null;
}

export function selectTieredGear(
    snap: QuestSnapshot,
    slots: readonly (readonly string[])[],
    unwearable: ReadonlySet<string>
): string[] {
    const wanted: string[] = [];
    const worn = [...snap.worn];
    for (const kinds of slots) {
        if (worn.some(name => kinds.some(kind => name.endsWith(kind)))) continue;
        const pick = bestForSlot(snap, kinds, unwearable);
        if (pick) wanted.push(pick);
    }
    return wanted;
}
