import { WORLDS } from '../../../client/config/worlds.js';
import type { SettingsBag, SettingsSchema } from '../../runtime/Settings.js';
import { DEFAULT_KEEP_ITEMS, LOOT_CATALOG } from './loot.js';
import { SITES } from './sites.js';
import type { JiveSettings } from './types.js';

export const DEFAULT_SETTINGS: JiveSettings = {
    clueTier: 'hard', allowedSites: SITES.filter(site => site.validation !== null).map(site => site.id), allowedWorlds: WORLDS.map(world => world.number), shard: '', offensivePrayers: true, boostThreshold: 5,
    sharks: 12, prayerDoses: 12, superDoses: 3, stockSharks: 100, stockPrayerDoses: 120, stockSuperSets: 10, stockAntifireDoses: 12, stockAntipoisonDoses: 12,
    marketEnabled: true, priceBook: '', priceCeilings: {}, maxRestockSpend: 100000, coinReserve: 2000, marketBatch: 20, retrySeconds: 60,
    keepItems: DEFAULT_KEEP_ITEMS, dragonBones: 'bury', dragonHides: 'bank', ordinaryBones: 'leave', blockedClue: 'discard', eatHp: 65, retreatHp: 45, stopAfterDeath: true
};

export const SETTINGS: SettingsSchema = {
    clueTier: { type: 'string', default: 'hard', options: ['easy', 'medium', 'hard'], label: 'Clue difficulty', group: 'Goal', help: 'Hard only. Easy and medium stop before shopping, travel or combat.' },
    allowedSites: { type: 'string[]', default: DEFAULT_SETTINGS.allowedSites, options: SITES.map(site => site.id), optionLabels: Object.fromEntries(SITES.map(site => [site.id, site.label])), label: 'Allowed sites', group: 'Sites', help: 'A site also needs recorded local entry, melee, loot and exit validation.' },
    allowedWorlds: { type: 'string[]', default: DEFAULT_SETTINGS.allowedWorlds.map(String), options: WORLDS.map(world => String(world.number)), label: 'Allowed worlds', group: 'Sites' },
    shard: { type: 'string', default: '', label: 'Fleet shard seed', group: 'Sites' },
    offensivePrayers: { type: 'boolean', default: true, label: 'Offensive prayers', group: 'Combat' },
    boostThreshold: { type: 'number', default: 5, min: 1, max: 15, label: 'Refresh boosts below', group: 'Combat' },
    sharks: { type: 'number', default: 12, min: 8, max: 23, label: 'Trip sharks', group: 'Trip' },
    prayerDoses: { type: 'number', default: 12, min: 4, max: 40, label: 'Trip prayer doses', group: 'Trip' },
    superDoses: { type: 'number', default: 3, min: 1, max: 8, label: 'Trip doses per super potion', group: 'Trip' },
    stockSharks: { type: 'number', default: 100, min: 8, max: 10000, label: 'Bank shark target', group: 'Bank stock' },
    stockPrayerDoses: { type: 'number', default: 120, min: 4, max: 10000, label: 'Bank prayer dose target', group: 'Bank stock' },
    stockSuperSets: { type: 'number', default: 10, min: 1, max: 1000, label: 'Bank super sets target', group: 'Bank stock' },
    stockAntifireDoses: { type: 'number', default: 12, min: 1, max: 1000, label: 'Bank antifire doses', group: 'Bank stock' },
    stockAntipoisonDoses: { type: 'number', default: 12, min: 1, max: 1000, label: 'Bank superantipoison doses', group: 'Bank stock' },
    marketEnabled: { type: 'boolean', default: true, label: 'Buy consumables at Seers W1', group: 'Market' },
    priceBook: { type: 'string', default: '', optionsFrom: 'priceBooks', label: 'Price book', group: 'Market' },
    priceCeilings: { type: 'string', default: '{}', label: 'Per-item price ceilings', group: 'Market', help: 'JSON mapping market item names to maximum coins each. No ceiling means no purchase.' },
    maxRestockSpend: { type: 'number', default: 100000, min: 0, max: 10000000, label: 'Maximum restock spend', group: 'Market' },
    coinReserve: { type: 'number', default: 2000, min: 1000, max: 1000000, label: 'Travel coin reserve', group: 'Market' },
    marketBatch: { type: 'number', default: 20, min: 1, max: 1000, label: 'Maximum purchase batch', group: 'Market' },
    retrySeconds: { type: 'number', default: 60, min: 30, max: 3600, label: 'Market retry interval', group: 'Market' },
    keepItems: { type: 'string[]', default: DEFAULT_KEEP_ITEMS, options: LOOT_CATALOG.map(item => String(item.id)), optionLabels: Object.fromEntries(LOOT_CATALOG.map(item => [String(item.id), item.label])), label: 'Keep hunting loot', group: 'Loot', help: 'Bone and hide policies override this selection. All clue rewards are retained.' },
    dragonBones: { type: 'string', default: 'bury', options: ['bury', 'leave'], label: 'Dragon bones', group: 'Loot' },
    dragonHides: { type: 'string', default: 'bank', options: ['bank', 'leave'], label: 'Dragon hides', group: 'Loot' },
    ordinaryBones: { type: 'string', default: 'leave', options: ['bury', 'leave'], label: 'Ordinary bones', group: 'Loot' },
    blockedClue: { type: 'string', default: 'discard', options: ['discard', 'park'], label: 'Blocked acquired hard clues', group: 'Trails', help: 'Only hard clues acquired by JiveTT may be discarded. Pre-existing clues and caskets are retained.' },
    eatHp: { type: 'number', default: 65, min: 65, max: 99, label: 'Eat below HP', group: 'Safety' },
    retreatHp: { type: 'number', default: 45, min: 45, max: 90, label: 'Retreat below HP', group: 'Safety' },
    stopAfterDeath: { type: 'boolean', default: true, label: 'Stop after death', group: 'Safety' }
};

export function readSettings(bag: SettingsBag): JiveSettings {
    const tier = bag.str('clueTier', 'hard');
    if (tier !== 'hard') throw new Error(tier === 'easy' || tier === 'medium' ? `${tier[0].toUpperCase()}${tier.slice(1)} clues are not implemented in JiveTT` : `Unknown clue difficulty: ${tier}`);
    const settings: JiveSettings = { ...DEFAULT_SETTINGS, clueTier: tier, allowedSites: bag.list('allowedSites', DEFAULT_SETTINGS.allowedSites), allowedWorlds: bag.list('allowedWorlds', DEFAULT_SETTINGS.allowedWorlds.map(String)).map(Number), keepItems: bag.list('keepItems', DEFAULT_KEEP_ITEMS), shard: bag.str('shard'), priceBook: bag.str('priceBook') };
    for (const key of ['offensivePrayers', 'marketEnabled', 'stopAfterDeath'] as const) settings[key] = bag.bool(key, DEFAULT_SETTINGS[key]);
    for (const key of ['boostThreshold', 'sharks', 'prayerDoses', 'superDoses', 'stockSharks', 'stockPrayerDoses', 'stockSuperSets', 'stockAntifireDoses', 'stockAntipoisonDoses', 'maxRestockSpend', 'coinReserve', 'marketBatch', 'retrySeconds', 'eatHp', 'retreatHp'] as const) {
        const def = SETTINGS[key];
        settings[key] = Math.floor(Math.min(def.max!, Math.max(def.min!, bag.num(key, DEFAULT_SETTINGS[key]))));
    }
    settings.dragonBones = bag.str('dragonBones', 'bury') === 'leave' ? 'leave' : 'bury';
    settings.dragonHides = bag.str('dragonHides', 'bank') === 'leave' ? 'leave' : 'bank';
    settings.ordinaryBones = bag.str('ordinaryBones', 'leave') === 'bury' ? 'bury' : 'leave';
    settings.blockedClue = bag.str('blockedClue', 'discard') === 'park' ? 'park' : 'discard';
    const ceilings: unknown = JSON.parse(bag.str('priceCeilings', '{}'));
    if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings)) throw new Error('Price ceilings must be a JSON object');
    settings.priceCeilings = {};
    for (const [item, price] of Object.entries(ceilings)) {
        if (typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0) throw new Error(`Invalid price ceiling for ${item}`);
        settings.priceCeilings[item] = price;
    }
    settings.allowedWorlds = settings.allowedWorlds.filter(world => WORLDS.some(configured => configured.number === world));
    if (settings.marketEnabled && (settings.stockSharks < Math.max(15, settings.sharks) || settings.stockPrayerDoses < Math.max(8, settings.prayerDoses)
        || settings.stockSuperSets * 3 < settings.superDoses)) throw new Error('Bank stock targets must cover a complete hunting and hard-clue trip');
    return settings;
}
