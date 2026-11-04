import { ITEM_DB } from '../../data/itemdb.js';
import type { ItemRecord } from '../../api/loadout/types.js';
import type { ItemStack } from './types.js';
import { WEAPON_STATS, type WeaponStats } from './equipmentData.js';

type GearResult = { kind: 'ready'; weapon: ItemRecord; items: number[] } | { kind: 'blocked'; reason: string };
const MATERIALS = ['Bronze', 'Iron', 'Steel', 'Black', 'Mithril', 'Adamant', 'Rune', 'Dragon'];
const LEVELS = [1, 1, 5, 10, 20, 30, 40, 60];
type Defences = { stab: number; slash: number; crush: number };
const NEUTRAL: Defences = { stab: 0, slash: 0, crush: 0 };

function legal(item: ItemRecord, levels: Record<string, number>, quests: readonly string[]): boolean {
    const material = MATERIALS.findIndex(m => item.name.startsWith(`${m} `));
    if (material < 0 || (levels[item.slot === 'righthand' ? 'attack' : 'defence'] ?? 0) < LEVELS[material]) return false;
    if (item.name === 'Rune platebody' && !quests.includes('Dragon Slayer')) return false;
    if (/^Dragon (longsword|dagger)/.test(item.name) && !quests.includes('Lost City')) return false;
    if (item.name === 'Dragon mace' || item.name === 'Dragon battleaxe') return quests.includes("Heroes' Quest");
    return material !== 7 || /^Dragon (longsword|dagger|med helm|platelegs|plateskirt)/.test(item.name);
}

export function selectEquipment(stock: readonly ItemStack[], levels: Record<string, number>, quests: readonly string[], shield: boolean, defences: Defences = NEUTRAL): GearResult {
    const owned = new Set(stock.filter(i => i.count > 0 && !i.noted).map(i => i.id));
    const gear = ITEM_DB.filter(i => owned.has(i.id) && legal(i, levels, quests));
    const weapons = ITEM_DB.filter(item => {
        const stats = WEAPON_STATS[item.id];
        return owned.has(item.id) && stats && (levels.attack ?? 0) >= stats.attackLevel && stats.quests.every(quest => quests.includes(quest));
    });
    const weapon = weapons.sort((a, b) => bestMode(WEAPON_STATS[b.id], defences, levels).score - bestMode(WEAPON_STATS[a.id], defences, levels).score)[0];
    if (!weapon) return { kind: 'blocked', reason: 'No usable owned one-handed melee weapon' };
    if (shield && !owned.has(1540)) return { kind: 'blocked', reason: 'Dragonfire shield is required' };
    const items = [weapon.id];
    for (const slot of ['torso', 'legs', 'hat'] as const) {
        const item = gear.filter(i => i.slot === slot).sort((a, b) => b.cost - a.cost)[0];
        if (!item) return { kind: 'blocked', reason: `Owned melee armour is missing: ${slot}` };
        items.push(item.id);
    }
    if (shield) items.push(1540);
    else {
        const item = gear.filter(i => i.slot === 'lefthand').sort((a, b) => b.cost - a.cost)[0];
        if (item) items.push(item.id);
    }
    return { kind: 'ready', weapon, items };
}

function bestMode(weapon: WeaponStats, defences: Defences, levels: Record<string, number> = {}) {
    return weapon.modes.map(mode => {
        const attack = ((levels.attack ?? 70) + 8 + mode.attackLevelBonus) * (64 + weapon.attack[mode.type]);
        const defence = 79 * (64 + defences[mode.type]);
        const accuracy = attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1));
        const maxHit = Math.floor(0.5 + ((levels.strength ?? 70) + 8 + mode.strengthLevelBonus) * (64 + weapon.strengthBonus) / 640);
        return { mode: mode.mode, score: accuracy * maxHit / weapon.attackRate };
    }).sort((a, b) => b.score - a.score || a.mode - b.mode)[0];
}

export function damageMode(name: string, defences: Defences): number {
    const weapon = Object.values(WEAPON_STATS).find(item => item.name === name);
    if (!weapon) throw new Error(`No verified melee modes for ${name}`);
    return bestMode(weapon, defences).mode;
}
