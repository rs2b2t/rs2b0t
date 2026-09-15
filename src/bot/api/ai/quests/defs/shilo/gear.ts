import { ITEM_DB } from '../../../../../data/itemdb.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { QuestLoadout } from '../../gear.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { foodNames, scanBank, withdrawFrom } from './supplies.js';
import { SV_ITEM, SV_TILE } from './areas.js';

const TIERS = ['Rune', 'Adamant', 'Mithril', 'Black', 'Steel', 'Iron', 'Bronze'];
const SLOTS = [
    { slot: 'righthand', kinds: ['scimitar', 'longsword', 'sword', 'mace', 'battleaxe', 'warhammer'] },
    { slot: 'torso', kinds: ['chainbody', 'platebody'] },
    { slot: 'legs', kinds: ['platelegs', 'plateskirt'] },
    { slot: 'hat', kinds: ['full helm', 'med helm'] },
    { slot: 'lefthand', kinds: ['kiteshield', 'sq shield'] }
] as const;
const rejected = new Set<string>();

export function resetCombatGear(): void {
    rejected.clear();
}

function wanted(snap: QuestSnapshot): string[] {
    const worn = ITEM_DB.filter(item => snap.worn.has(item.name.toLowerCase()));
    const wornSlots = new Set(worn.map(item => item.slot));
    const declared = QuestLoadout.current?.worn ?? {};
    const twoHanded = worn.some(item => item.twoHanded)
        || ITEM_DB.some(item => item.twoHanded && item.name.toLowerCase() === declared.righthand?.toLowerCase());
    return SLOTS.flatMap(({ slot, kinds }) => {
        if (wornSlots.has(slot) || (slot === 'lefthand' && twoHanded)) return [];
        const names = declared[slot] ? [declared[slot]] : TIERS.flatMap(tier => kinds.map(kind => `${tier} ${kind}`));
        const usable = names.filter(name => !rejected.has(name.toLowerCase()));
        const pick = usable.find(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0)
            ?? usable.find(name => (snap.bank?.get(name.toLowerCase()) ?? 0) > 0);
        return pick ? [pick] : [];
    });
}

export function combatGear(snap: QuestSnapshot): QuestStep | null {
    const names = wanted(snap);
    const carried = names.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (carried.length > 0) {
        return {
            kind: 'custom',
            name: `wear ${carried.join(', ')}`,
            run: async log => {
                for (const name of carried) {
                    if (!Equipment.contains(name) && !(await Equipment.equip(name))) {
                        rejected.add(name.toLowerCase());
                        log(`could not wear ${name}; trying other combat gear`);
                    }
                }
                return true;
            }
        };
    }
    if (!snap.bankKnown) return scanBank();
    if (names.length === 0) return null;
    if (snap.freeSlots === 0) {
        const protectedNames = new Set([
            ...Object.values(SV_ITEM).map(item => item.name.toLowerCase()),
            ...(QuestLoadout.current?.carry ?? []).map(item => item.item.toLowerCase())
        ]);
        const food = new Set(foodNames().map(name => name.toLowerCase()));
        const stored = [...snap.inv.keys()].find(name => rejected.has(name) || food.has(name) || !protectedNames.has(name));
        return stored
            ? { kind: 'deposit', keep: [...snap.inv.keys()].filter(name => name !== stored), bank: SV_TILE.ARDOUGNE_BANK }
            : { kind: 'wait', reason: 'need a free inventory slot for combat gear' };
    }
    return withdrawFrom(names.slice(0, snap.freeSlots ?? names.length).map(name => ({ name, qty: 1 })));
}
