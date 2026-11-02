import { DRAGON_STAGE } from '../../api/ai/quests/defs/dragonslayer/journal.js';
import { QUESTS } from '../../api/ai/quests/data/quests.js';
import type { QuestRecord } from '../../api/ai/quests/types.js';
import Tile from '../../geometry/Tile.js';
import { meleeEquipment } from './equipment.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

const QUEST_ORDER = ['runemysteries', 'cook', 'doric', 'sheep', 'priest', 'haunted', 'hetty', 'romeojuliet', 'prince', 'hunt', 'gobdip', 'blackknight', 'vampire', 'squire', 'arthur'];
export const DRAGON_CAMPS = ['prayer-green-dragons', 'prayer-blue-dragons'];

export function dragonReady(s: LevelerSnapshot): boolean {
    return ['attack', 'strength', 'defence', 'hitpoints'].every(skill => s.levels[skill] >= 40);
}

export function dragonFoodLevels(s: LevelerSnapshot): Record<string, number> {
    return stockOf(s, 'Lobster') >= 40 ? {} : { fishing: 40, cooking: 40 };
}

export function dragonPlanks(s: LevelerSnapshot): number {
    if ((s.dragonStage ?? 0) >= DRAGON_STAGE.REPAIRED_SHIP) return 0;
    return s.dragonStage === DRAGON_STAGE.BOUGHT_SHIP && stockOf(s, 'Plank') > 0 ? Math.min(3, stockOf(s, 'Plank')) : 3;
}

export function nextDragonQuest(s: LevelerSnapshot, memory: SessionMemory): QuestRecord | null {
    if (s.quests['Dragon Slayer'] || !dragonReady(s) || !s.wilderness && stockOf(s, 'Plank') < dragonPlanks(s)) return null;
    const points = s.questPoints ?? QUESTS.reduce((sum, q) => sum + (s.quests[q.name] ? q.questPoints : 0), 0);
    return (points >= 32 ? ['dragon'] : QUEST_ORDER).map(id => QUESTS.find(q => q.id === id)!)
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

export function dragonPrayer(s: LevelerSnapshot, memory: SessionMemory, random: () => number): ActivityPlan | null {
    if (!dragonReady(s) || stockOf(s, 'Dragonfire shield') < 1) return null;
    const candidates = DRAGON_CAMPS.filter(id => (id !== DRAGON_CAMPS[0] || s.wilderness) && (memory.cooldowns[id] ?? 0) <= s.now);
    const fresh = candidates.filter(id => !memory.recent.slice(-3).includes(id));
    const choices = fresh.length ? fresh : candidates;
    if (!choices.length) return null;
    const id = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))];
    const green = id === DRAGON_CAMPS[0];
    const gear = meleeEquipment(s);
    const weapon = gear[0].item;
    return {
        id, objective: 'prayer', label: `${green ? 'Green' : 'Blue'} dragons for Prayer`, script: green ? 'GreenDragon' : 'JiveDragons',
        combat: true, wilderness: green, food: 'Lobster', travel: green ? new Tile(3094, 3493, 0) : new Tile(2946, 3368, 0),
        needs: [...gear, { item: 'Dragonfire shield', count: 1, carry: 1, equip: true }, { item: 'Lobster', count: 40, carry: 20 }, { item: 'Coins', count: 200, carry: 200 }],
        settings: { combatStyle: 'melee', meleeStyle: 'strength', weapon, loadout: '', food: 'Lobster', foodWithdraw: 20,
            usePotions: false, useSpecial: false, buryBones: true, solveClues: false, bankCommonJunk: false,
            loot: ['Dragon bones', 'Dragonhide'],
            ...(green ? { escape: 'Flee to bank' } : { site: 'taverley-blue', leaveVia: 'walk' }) }
    };
}
