import { ITEM_DB } from '../../../data/itemdb.js';
import { Skills } from '../../skills/Skills.js';
import type { QuestSnapshot } from './engine/types.js';
import { questDone } from './weapons.js';

const TIERS = [
    ['Rune', 40], ['Adamant', 30], ['Mithril', 20], ['Black', 10],
    ['Steel', 5], ['Iron', 1], ['Bronze', 1]
] as const;

const SHAPES = {
    torso: ['chainbody', 'platebody'],
    legs: ['platelegs', 'plateskirt'],
    hat: ['full helm', 'med helm'],
    lefthand: ['kiteshield', 'sq shield']
} as const;

export type ArmourSlot = keyof typeof SHAPES;

const METAL_ARMOUR = TIERS.flatMap(([tier, defence]) =>
    Object.values(SHAPES).flatMap(shapes => shapes.flatMap(shape => {
        const item = ITEM_DB.find(record => record.name === `${tier} ${shape}`);
        return item ? [{ id: item.id, name: item.name, slot: item.slot, defence, ranged: 0 }] : [];
    })));

const RANGED_ARMOUR = [
    ['studded_body', 20, 20], ['hardleather_body', 10, 0], ['leather_armour', 0, 1],
    ['studded_chaps', 0, 20], ['leather_chaps', 0, 1], ['coif', 0, 20], ['leather_cowl', 0, 1]
] as const;

export const QUEST_ARMOUR = [...METAL_ARMOUR, ...RANGED_ARMOUR.flatMap(([obj, defence, ranged]) => {
    const item = ITEM_DB.find(record => record.obj === obj);
    return item ? [{ id: item.id, name: item.name, slot: item.slot, defence, ranged }] : [];
})];

export function armourWorn(snap: QuestSnapshot, item: { readonly id: number; readonly name: string }): boolean {
    return Boolean(snap.wornIds?.has(item.id) || snap.worn.has(item.name.toLowerCase()));
}

export function armourHeld(snap: QuestSnapshot, item: { readonly id: number; readonly name: string }): boolean {
    return (snap.invIds?.get(item.id) ?? snap.inv.get(item.name.toLowerCase()) ?? 0) > 0;
}

export function armourChoice(snap: QuestSnapshot, slot: ArmourSlot | 'front') {
    const equipped = ITEM_DB.find(item => item.slot === slot && armourWorn(snap, item));
    if (equipped) {
        return equipped;
    }
    const defence = Skills.level('defence');
    const ranged = snap.ranged ?? Skills.level('ranged');
    const usable = QUEST_ARMOUR.filter(item => item.slot === slot && item.defence <= defence
        && item.ranged <= ranged
        && (item.name !== 'Rune platebody' || questDone('Dragon Slayer')));
    return usable.find(item => armourHeld(snap, item))
        ?? (snap.bankKnown ? usable.find(item =>
            (snap.bankIds?.get(item.id) ?? snap.bank?.get(item.name.toLowerCase()) ?? 0) > 0) : undefined)
        ?? null;
}
