import JString from '../../../client/datastruct/JString.js';
import { TAVERLEY_BLUE } from '../../api/combat/hunting/sites.js';
import { spotCrowded } from './crowding.js';
import { DRAGON_STAGE } from '../../api/ai/quests/defs/dragonslayer/journal.js';
import { QUEST_POINT_PRIORITY, questPoints } from './questPoints.js';
import { questRecord } from '../../api/ai/quests/data/quests.js';
import { DROP_DB } from '../../data/dropdb.js';
import type { QuestRecord } from '../../api/ai/quests/types.js';
import Tile from '../../geometry/Tile.js';
import { meleeEquipment } from './equipment.js';
import { babyDragonPrayerPlan } from './prayer.js';
import { foodFor } from './combat.js';
import { dragonTeleport } from './dragonTravel.js';
import { dragonMeleeStyle } from '../../api/combat/dragonStyle.js';
import { SECONDARY_LOOT } from './loot.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

const GREEN = { id: 'prayer-green-dragons', target: 'Green dragon', hide: 1753 };
const RED = { id: 'prayer-red-dragons', target: 'Red dragon', hide: 1749 };
const BLUE = { id: 'prayer-blue-dragons', target: 'Blue dragon', hide: 1751 };
export const ADULT_DRAGONS = [GREEN, RED, BLUE];
export const DRAGON_CAMPS = ADULT_DRAGONS.map(camp => camp.id);

export function dragonReady(s: LevelerSnapshot, minimum = 40): boolean {
    return ['attack', 'strength', 'defence', 'hitpoints'].every(skill => s.levels[skill] >= minimum);
}

export function dragonFoodLevels(s: LevelerSnapshot): Record<string, number> {
    return foodFor(s, 40) === 'Shark' || stockOf(s, 'Lobster') >= 40 ? {} : { fishing: 40, cooking: 40 };
}

export function dragonPlanks(s: LevelerSnapshot): number {
    if ((s.dragonStage ?? 0) >= DRAGON_STAGE.REPAIRED_SHIP) return 0;
    return s.dragonStage === DRAGON_STAGE.BOUGHT_SHIP && stockOf(s, 'Plank') > 0 ? Math.min(3, stockOf(s, 'Plank')) : 3;
}

export function nextDragonQuest(s: LevelerSnapshot, memory: SessionMemory): QuestRecord | null {
    if (s.quests['Dragon Slayer'] || !dragonReady(s) || !s.wilderness && stockOf(s, 'Plank') < dragonPlanks(s)) return null;
    const points = questPoints(s);
    return (points >= 32 ? [questRecord('dragon')] : QUEST_POINT_PRIORITY)
        .find(q => !s.quests[q.name] && (q.requirements.minQuestPoints ?? 0) <= points
            && (q.requirements.quests ?? []).every(name => s.quests[name])
            && !Object.entries(memory.cooldowns).some(([id, until]) => id.startsWith(`quest-${q.id}-`) && until > s.now)
            && (memory.cooldowns[`quest-${q.id}`] ?? 0) <= s.now) ?? null;
}

export function dragonSupplyLevels(s: LevelerSnapshot): Record<string, number> {
    if ((s.dragonStage ?? 0) >= DRAGON_STAGE.REPAIRED_SHIP) return {};
    return {
        ...(stockOf(s, 'Nails') < dragonPlanks(s) * 4 ? { smithing: 34, mining: 30 } : {}),
        ...(stockOf(s, 'Unfired bowl') < 1 ? { crafting: 8 } : {})
    };
}

export function dragonPrayer(s: LevelerSnapshot, memory: SessionMemory, random: () => number, purpose: 'prayer' | 'supply' = 'prayer'): ActivityPlan | null {
    const baby = purpose === 'prayer' ? babyDragonPrayerPlan(s, memory, random) : null;
    if (!dragonReady(s) || stockOf(s, 'Dragonfire shield') < 1) return baby;
    if (baby && DRAGON_CAMPS.includes(memory.recent.at(-1) ?? '')) return baby;
    const candidates = ADULT_DRAGONS.filter(camp => (memory.cooldowns[camp.id] ?? 0) <= s.now
        && (camp === BLUE ? !spotCrowded(TAVERLEY_BLUE.meleeAnchor, memory, s.now) : s.wilderness)
        && (camp !== RED || dragonReady(s, 70)));
    const fresh = candidates.filter(camp => !memory.recent.slice(-3).includes(camp.id));
    const choices = fresh.length ? fresh : candidates;
    if (!choices.length) return baby;
    let camp;
    if (purpose === 'supply') {
        const prefersRed = JString.toUserhash(s.accountName ?? '') / 5n % 4n === 1n;
        camp = candidates.find(site => site === (prefersRed ? RED : GREEN)) ?? candidates[0];
    } else {
        camp = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))];
    }
    const wild = camp !== BLUE;
    const { id, target } = camp;
    const gear = meleeEquipment(s);
    const weapon = gear[0].item;
    const food = foodFor(s, 40) === 'Shark' ? 'Shark' : 'Lobster';
    const escape = dragonTeleport(s, wild ? 'wilderness' : 'blue');
    const reservedSlots = gear.length + 2 + escape.needs.length;
    const foodWithdraw = Math.min(20, 28 - reservedSlots);
    return {
        id, objective: 'prayer', label: purpose === 'supply' ? `Bank ${target.toLowerCase()} hides and bones` : `${target}s for Prayer`, script: wild ? 'GreenDragon' : 'JiveDragons',
        combat: true, wilderness: wild, food, bankTeleport: escape.name, travel: wild ? new Tile(3094, 3493, 0) : new Tile(2946, 3368, 0),
        needs: [...gear, { item: 'Dragonfire shield', count: 1, carry: 1, equip: true }, { item: food, count: 40, carry: foodWithdraw }, { item: 'Coins', count: 200, carry: 200 }, ...escape.needs],
        settings: { combatStyle: 'melee', meleeStyle: dragonMeleeStyle('strength', weapon, [target]), weapon, loadout: '', food, foodWithdraw,
            usePotions: false, useSpecial: true, buryBones: true, solveClues: false, bankCommonJunk: false,
            loot: ['Dragon bones', 'Dragonhide', ...DROP_DB[target].filter(item => SECONDARY_LOOT.includes(item))],
            ...(wild ? { target, escape: escape.name === 'Off' ? 'Flee to bank' : 'Teleport to Varrock' } : { site: 'taverley-blue', leaveVia: escape.name === 'Off' ? 'walk' : 'teleport' }) }
    };
}
