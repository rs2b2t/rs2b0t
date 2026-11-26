import { CASKET_IDS, CLUE_DB } from '../../api/ai/clues/data/cluedb.js';
import { clueRequirements, missingClueRequirements } from '../../api/ai/clues/requirements.js';
import { SUPERANTI } from '../../api/ai/clues/hardClueKit.js';
import { QUESTS } from '../../api/ai/quests/data/quests.js';
import type { QuestRecord } from '../../api/ai/quests/types.js';
import Tile from '../../geometry/Tile.js';
import { earlyMeleeStep, isMeleeSkill } from './priority.js';
import { methodFor, questPlan } from './methods.js';
import { meleeEquipment } from './equipment.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

export const HARD_CLUE_OBJECTIVE = 'hard-clues';
export const HARD_CLUE_FARM = 'hard-clue-hellhounds';
type Result = ActivityPlan | { reason: string };
const guardianWeapons = ['Dragon dagger(p)', 'Dragon dagger', 'Dragon longsword'];
const baseLevels = { attack: 60, strength: 60, defence: 60, hitpoints: 60, prayer: 43 };
const questPointOrder = ['runemysteries', 'cook', 'doric', 'sheep', 'priest', 'haunted', 'hetty', 'romeojuliet', 'prince', 'hunt', 'gobdip', 'blackknight', 'vampire', 'squire', 'arthur'];
const noWildQuests = new Set(['crest']);

const clueIds = Object.keys({ ...CLUE_DB, ...CASKET_IDS }).map(Number);

export function ownedClueId(stock: Record<string, number>, eligible: (id: number) => boolean = () => true): number | undefined {
    return clueIds.find(id => (stock[`#${id}`] ?? 0) > 0 && eligible(id));
}

function train(s: LevelerSnapshot, levels: Record<string, number>, memory: SessionMemory, random: () => number): Result | null {
    const missing = Object.entries(levels).find(([skill, level]) => (s.levels[skill] ?? 1) < level);
    if (!missing) return null;
    const step = isMeleeSkill(missing[0]) ? earlyMeleeStep(s.levels, missing[1]) : undefined;
    const skill = step?.skill ?? missing[0];
    const level = step && skill !== missing[0] ? step.level : Math.min(step?.level ?? missing[1], missing[1]);
    const plan = methodFor({ ...s, target: level, allowQuests: true }, skill, memory, random);
    return plan ? { ...plan, ...(!plan.quest && !plan.prerequisiteLevels ? { prerequisiteLevels: { [skill]: level } } : {}), settings: { ...plan.settings, solveClues: false } }
        : { reason: `No supported training method for ${skill} ${level}` };
}

function prepareQuest(s: LevelerSnapshot, quest: QuestRecord | undefined, memory: SessionMemory, random: () => number, chain: string[] = []): Result | null {
    if (!quest) return { reason: 'Clue prerequisite quest is not supported' };
    if (s.quests[quest.name]) return null;
    if (chain.includes(quest.id)) return { reason: `Quest prerequisite cycle: ${[...chain, quest.id].join(' -> ')}` };
    if (!s.wilderness && noWildQuests.has(quest.id)) return { reason: `${quest.name} requires the Wilderness` };
    if (Object.entries(memory.cooldowns).some(([id, until]) => (id === `quest-${quest.id}` || id.startsWith(`quest-${quest.id}-`)) && until > s.now)) return { reason: `${quest.name} is cooling down after a failed attempt` };
    const training = train(s, Object.fromEntries((quest.requirements.skills ?? []).map(req => [req.skill, req.level])), memory, random);
    if (training) return training;
    for (const id of quest.requirements.quests ?? []) {
        const prerequisite = prepareQuest(s, QUESTS.find(candidate => candidate.id === id || candidate.name === id), memory, random, [...chain, quest.id]);
        if (prerequisite) return prerequisite;
    }
    const points = s.questPoints ?? QUESTS.reduce((sum, candidate) => sum + (s.quests[candidate.name] ? candidate.questPoints : 0), 0);
    if (points < (quest.requirements.minQuestPoints ?? 0)) {
        const candidates = [...questPointOrder.map(id => QUESTS.find(candidate => candidate.id === id)!), ...QUESTS];
        for (const candidate of candidates) {
            if (!candidate || s.quests[candidate.name] || candidate.id === quest.id || chain.includes(candidate.id) || (candidate.requirements.minQuestPoints ?? 0) > points) continue;
            const plan = prepareQuest(s, candidate, memory, random, [...chain, quest.id]);
            if (plan && 'script' in plan) return plan;
        }
        return { reason: `No supported quest can supply ${quest.requirements.minQuestPoints} quest points for ${quest.name}` };
    }
    return questPlan(s, HARD_CLUE_OBJECTIVE, quest.id, quest.name, true);
}

function farm(s: LevelerSnapshot, clueId?: number, abandon = false): ActivityPlan {
    const anti = SUPERANTI.find(dose => stockOf(s, dose.name) > 0)?.name ?? 'Superantipoison(3)';
    const ownedWeapon = guardianWeapons.find(name => stockOf(s, name) > 0);
    const weapon = ownedWeapon ?? 'Dragon dagger';
    const gear = meleeEquipment(s).slice(1);
    return {
        id: HARD_CLUE_FARM, label: 'Taverley hellhounds for hard clues', objective: HARD_CLUE_OBJECTIVE, script: 'AutoFighter', combat: true, food: 'Shark',
        travel: clueId === undefined ? new Tile(2861, 9841, 0) : undefined,
        needs: [...(!ownedWeapon ? [{ item: 'Diamond', count: 1 }, { item: 'Dramen staff', count: 1 }] : []), ...gear, { item: weapon, count: 1, carry: 1, equip: true }, { item: 'Dragonfire shield', count: 1, carry: 1, equip: true },
            { item: 'Dusty key', count: 1, carry: 1 }, { item: 'Shark', count: 30, carry: 15 }, { item: anti, count: 1 }, { item: 'Coins', count: 1000, carry: 1000 },
            ...(clueId === undefined ? [] : [{ item: CLUE_DB[clueId] ? 'Clue scroll' : 'Casket', id: clueId, count: 1, carry: 1 }])],
        settings: { target: 'Hellhound', spot: 'Custom coordinates', coordinates: new Tile(2861, 9841, 0), leashRadius: 8,
            combatStyle: 'melee', meleeStyle: 'strength', useSpecial: true, solveClues: true, prepareClueRequirements: true, allowClueWilderness: s.wilderness,
            abandonClueId: abandon ? clueId : -1, banking: 'Auto', food: 'Shark', foodWithdraw: 15, panicHp: 25, buryBones: false,
            loot: ['Clue scroll'], avoidHerbs: [], loadout: '', travelCoins: 1000, travelItems: ['Dusty key'], bankAtLootSlots: 27 }
    };
}

export function hardCluePlan(s: LevelerSnapshot, memory: SessionMemory, random: () => number = Math.random): Result {
    const base = train(s, baseLevels, memory, random);
    if (base) return base;
    const lostCity = prepareQuest(s, QUESTS.find(quest => quest.id === 'zanaris'), memory, random);
    if (lostCity) return lostCity;
    const needsWeapon = !guardianWeapons.some(name => stockOf(s, name) > 0);
    if (needsWeapon && stockOf(s, 'Dramen staff') < 1) return { reason: 'Need a Dramen staff to buy the hard clue guardian weapon; Lost City staff recovery is not supported' };
    const clueId = ownedClueId(s.stock);
    let abandon = clueId !== undefined && !s.wilderness && clueRequirements(clueId).wilderness;
    if (clueId !== undefined && !abandon) {
        const requirements = missingClueRequirements(clueId, s);
        const training = train(s, requirements.skills, memory, random);
        if (training && 'script' in training) return training;
        abandon = !!training;
        for (const name of requirements.quests) {
            const plan = prepareQuest(s, QUESTS.find(quest => quest.name === name), memory, random);
            if (plan && 'script' in plan) return plan;
            if (plan) { abandon = true; break; }
        }
    }
    const supplies = train(s, { ...(stockOf(s, 'Shark') < 30 ? { fishing: 76, cooking: 80 } : {}),
        ...(!SUPERANTI.some(dose => stockOf(s, dose.name) > 0) ? { herblore: 48 } : {}),
        ...(needsWeapon && stockOf(s, 'Diamond') < 1 ? { crafting: 43 } : {}) }, memory, random);
    if (supplies) return supplies;
    if (stockOf(s, 'Dragonfire shield') < 1 && !s.quests['Dragon Slayer']) {
        const dragon = prepareQuest(s, QUESTS.find(quest => quest.id === 'dragon'), memory, random);
        if (dragon && (!('script' in dragon) || dragon.quest !== 'Dragon Slayer')) return dragon;
    }
    if (stockOf(s, 'Dusty key') < 1 || stockOf(s, 'Dragonfire shield') < 1) {
        const key = stockOf(s, 'Dusty key') < 1;
        const id = key ? 'hard-clue-dusty-key' : 'hard-clue-shield';
        if ((memory.cooldowns[id] ?? 0) > s.now) return { reason: 'Hard clue access preparation is cooling down after a failed attempt' };
        return { id, label: key ? 'Fetch Dusty key from Velrak' : 'Replace Dragonfire shield', objective: HARD_CLUE_OBJECTIVE,
            script: 'HardClueAccess', settings: { item: key ? 'Dusty key' : 'Dragonfire shield' }, combat: true, food: 'Shark',
            needs: [...meleeEquipment(s), { item: 'Shark', count: 20, carry: 20 }], output: { item: key ? 'Dusty key' : 'Dragonfire shield', count: 1 } };
    }
    if ((memory.cooldowns[HARD_CLUE_FARM] ?? 0) > s.now) return { reason: 'Hard clue camp is cooling down after a failed attempt' };
    return farm(s, clueId, abandon);
}
