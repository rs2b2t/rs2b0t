// docs/reference/quest-provisioning.md
import { ITEM_DB } from '../../../data/itemdb.js';
import { Quests } from '../../ui/questlog/Quests.js';
import { Skills } from '../../skills/Skills.js';
import { Inventory } from '../../inventory/Inventory.js';
import { Equipment } from '../../equipment/Equipment.js';
import type { QuestSnapshot } from './engine/types.js';

export interface MeleeWeapon {
    id: number;
    name: string;
    /** Metal tier, which is what the Attack level buys. */
    tier: string;
    /** Attack level the tier needs. */
    attack: number;
    /** Journal that must read complete before the engine allows the wield. */
    quest?: string;
}

/** What each metal tier costs in Attack, best first. */
const TIERS: readonly { tier: string; attack: number }[] = [
    { tier: 'Dragon', attack: 60 },
    { tier: 'Rune', attack: 40 },
    { tier: 'Adamant', attack: 30 },
    { tier: 'Mithril', attack: 20 },
    { tier: 'Black', attack: 10 },
    { tier: 'Steel', attack: 5 },
    { tier: 'Iron', attack: 1 },
    { tier: 'Bronze', attack: 1 }
];

// Why: one-handed only; a two-hander takes the shield slot, and every quest that arms itself also wears one.
/** Melee types within a tier, best first. */
const TYPES: readonly string[] = ['scimitar', 'longsword', 'battleaxe', 'sword', 'mace', 'dagger', 'warhammer'];

// Why: `tier60.rs2` gates dragon melee on a quest as well as Attack 60, so a level check alone withdraws a weapon that can't be wielded.
const QUEST_GATE: Readonly<Record<string, string>> = {
    'Dragon longsword': 'Lost City',
    'Dragon dagger': 'Lost City',
    'Dragon battleaxe': "Hero's Quest",
    'Dragon mace': "Hero's Quest"
};

function build(): MeleeWeapon[] {
    const out: MeleeWeapon[] = [];
    for (const { tier, attack } of TIERS) {
        for (const type of TYPES) {
            const name = `${tier} ${type}`;
            const record = ITEM_DB.find(r => r.name === name && r.slot === 'righthand' && !r.twoHanded);
            if (record) {
                out.push({ id: record.id, name, tier, attack, quest: QUEST_GATE[name] });
            }
        }
    }
    return out;
}

/** Every one-handed melee weapon the item db knows, best tier first. */
export const MELEE_WEAPONS: readonly MeleeWeapon[] = build();

// Why: `tier40.rs2` gates a rune pickaxe on Attack 40, so a pickaxe rides the same tiers as a scimitar; it's kept out of `MELEE_WEAPONS` so nothing goes to a fight holding one.

/** Every pickaxe the item db knows, best tier first. */
export const PICKAXES: readonly MeleeWeapon[] = TIERS
    .map(({ tier, attack }) => ({ tier, attack, record: ITEM_DB.find(r => r.name === `${tier} pickaxe`) }))
    .filter((entry): entry is typeof entry & { record: NonNullable<typeof entry.record> } => entry.record !== undefined)
    .map(({ tier, attack, record }) => ({ id: record.id, name: record.name, tier, attack }));

/** The best pickaxe this account may wield and has banked. */
export function bankedPickaxe(banked: ReadonlyMap<number, number> | undefined, attack: number): MeleeWeapon | null {
    return PICKAXES.find(p => attack >= p.attack && (banked?.get(p.id) ?? 0) > 0) ?? null;
}

/** Weapons this account may wield right now, best first. */
export function wieldable(attack: number, questDone: (quest: string) => boolean): MeleeWeapon[] {
    return MELEE_WEAPONS.filter(w => attack >= w.attack && (w.quest === undefined || questDone(w.quest)));
}

/** The best wieldable weapon the pack or the worn set already has. */
export function heldWeapon(
    held: ReadonlyMap<number, number> | undefined,
    worn: ReadonlySet<number> | undefined,
    attack: number,
    questDone: (quest: string) => boolean
): MeleeWeapon | null {
    return wieldable(attack, questDone).find(w => (held?.get(w.id) ?? 0) > 0 || (worn?.has(w.id) ?? false)) ?? null;
}

/** The best wieldable weapon the last bank read saw. */
export function bankedWeapon(
    banked: ReadonlyMap<number, number> | undefined,
    attack: number,
    questDone: (quest: string) => boolean
): MeleeWeapon | null {
    return wieldable(attack, questDone).find(w => (banked?.get(w.id) ?? 0) > 0) ?? null;
}

/** True when the journal reads complete, which is what the dragon gates test. */
export function questDone(quest: string): boolean {
    return Quests.status(quest) === 'complete';
}

function attackOf(snap: QuestSnapshot): number {
    return snap.attack ?? Skills.level('attack');
}

/** The best weapon this account can wield and already holds or wears. */
export function bestHeld(snap: QuestSnapshot): MeleeWeapon | null {
    return heldWeapon(snap.invIds, snap.wornIds, attackOf(snap), questDone);
}

/** The weapon already wielded, when it is one this account may use. */
export function wieldedWeapon(snap: QuestSnapshot): MeleeWeapon | null {
    return heldWeapon(undefined, snap.wornIds, attackOf(snap), questDone);
}

/** The best wieldable weapon sitting in the pack. */
export function packWeapon(snap: QuestSnapshot): MeleeWeapon | null {
    return heldWeapon(snap.invIds, undefined, attackOf(snap), questDone);
}

/** The best weapon this account can wield and has banked; null until a bank read lands. */
export function bestBanked(snap: QuestSnapshot): MeleeWeapon | null {
    return snap.bankKnown ? bankedWeapon(snap.bankIds, attackOf(snap), questDone) : null;
}

// Why: some fight loops resolve a weapon with no snapshot to hand, so the live pack, worn set and bank stand in for one.

/** The best weapon this account may wield, read from the live pack and worn set. */
export function liveBestWeapon(): MeleeWeapon | null {
    const attack = Skills.level('attack');
    const held = new Map(Inventory.items().map(i => [i.id, i.count]));
    const worn = new Set(Equipment.items().map(i => i.id));
    return heldWeapon(held, worn, attack, questDone);
}
