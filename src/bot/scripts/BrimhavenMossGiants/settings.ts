import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS } from '../../api/combat/CombatStyle.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { DROP_DB } from '../../data/dropdb.js';
import { STAFFS, ARROWS, BOLTS } from '../../api/combat/equipment.js';
import { RANGED_WEAPONS } from '../../api/combat/ranged.js';
import { FOOD_OPTIONS } from '../../api/combat/food.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { TARGET, FIELD_TILE, BANK_TILE } from './config.js';

const DROPS: string[] = DROP_DB[TARGET] ?? [];
export const DEFAULT_LOOT = DROPS.filter(n => !/\barrow\b|^coal$|spinach roll/i.test(n));

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage', 'range'], label: 'Combat style' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    staff: { type: 'string', default: 'Staff of air', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE, help: 'wielded staff, withdrawn from bank when missing' },
    spell: { type: 'string', default: 'Wind Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    bow: {
        type: 'string',
        default: 'Maple shortbow',
        options: RANGED_WEAPONS,
        label: 'Ranged weapon',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'bows use an arrow, crossbows use a bolt (see ammo); darts are both the weapon and the projectile stack'
    },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: {
        type: 'string',
        default: 'Iron arrow',
        options: [...ARROWS, ...BOLTS],
        label: 'Ammo (arrows / bolts)',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'arrows for bows, bolts for crossbows; ignored when the ranged weapon is a dart'
    },
    ammoWithdraw: {
        type: 'number',
        default: 500,
        min: 1,
        max: 5000,
        label: 'Projectiles per bank trip',
        group: 'Combat',
        showIf: SHOW_RANGE
    },
    lootAmmo: {
        type: 'boolean',
        default: true,
        label: 'Loot & re-equip ammo',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'pick up dropped arrows/bolts in the loot phase and re-equip them before fighting'
    },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    lootCake: { type: 'boolean', default: false, label: 'Loot & eat slice of cake', group: 'Food & healing', help: 'also grab and eat Slice of cake in addition to the selected food (looted when on)' },

    panicHp: { type: 'number', default: 25, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'retreat to the bank when HP drops this low (out of food, or damage outpacing eating)' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the moss giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'bury Big bones for Prayer xp instead of banking them (always looted when on)' },
    fieldTile: { type: 'tile', default: FIELD_TILE, label: 'Field / fight tile (Brimhaven island)', group: 'Location' },
    bankTile: { type: 'tile', default: BANK_TILE, label: 'Bank stand tile (Ardougne S, by the pier)', group: 'Location' }
};
