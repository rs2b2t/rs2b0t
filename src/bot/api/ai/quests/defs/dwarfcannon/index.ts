import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { CAVE_HOPS, COMMANDER, FALADOR_WEST_BANK, MC_FOOD_TARGET, MC_OBJ, NULODION } from './areas.js';
import { MC_FLAG, MC_STAGE, readDwarfCannonProgress } from './journal.js';
import { fetchRemains, fixRailings, inCave, repairCannon, rescueChild } from './repair.js';

export { MCANNON_QUEST, MC_FLAG, MC_STAGE, parseDwarfCannonJournal, readDwarfCannonProgress } from './journal.js';
export { CANNON_PARTS, MC_OBJ, MC_TILE, RAILINGS } from './areas.js';

const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep => ({
    kind: 'custom',
    name,
    run
});

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? 0) >= MC_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Dwarf Cannon journal stage unavailable' };
    }

    if (stage === MC_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.RAILINGS) {
        return hasFlag(snap.progress, MC_FLAG.RAILINGS_DONE)
            ? { kind: 'talk', stop: COMMANDER }
            : custom('replace the six broken railings', fixRailings);
    }
    if (stage === MC_STAGE.GUARD_TOWER) {
        return heldId(snap, MC_OBJ.REMAINS.id) > 0
            ? { kind: 'talk', stop: COMMANDER }
            : custom('take the dwarf remains from the watchtower', fetchRemains);
    }
    if (stage === MC_STAGE.GOBLIN_CAVE || stage === MC_STAGE.FIND_CHILD) {
        return custom("search the goblin cave crate for Gilob's son", log => rescueChild(false, log));
    }
    if (stage === MC_STAGE.CHILD_RESCUED) {
        return inCave(snap.tile)
            ? custom('leave the goblin cave by the mud pile', log => rescueChild(true, log))
            : { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.FIX_CANNON) {
        // Why: the Commander hands out another toolkit on both the stage-6 and stage-7 branches, so a lost one is a talk rather than a wedge.
        return heldId(snap, MC_OBJ.TOOLKIT.id) > 0
            ? custom('repair the broken multicannon', repairCannon)
            : { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.CANNON_FIXED) {
        return { kind: 'talk', stop: COMMANDER };
    }
    if (stage === MC_STAGE.SEE_NULODION) {
        return { kind: 'talk', stop: NULODION };
    }
    if (stage === MC_STAGE.RETURN_NOTES) {
        // Why: Nulodion re-issues whichever of the two is missing, and the Commander refuses the hand-over without both.
        const complete = heldId(snap, MC_OBJ.NOTES.id) > 0 && heldId(snap, MC_OBJ.MOULD.id) > 0;
        return { kind: 'talk', stop: complete ? COMMANDER : NULODION };
    }
    return { kind: 'wait', reason: `unrecognized Dwarf Cannon stage ${stage}` };
}

function warnDwarfCannonReadiness(): string | null {
    const bits: string[] = [];
    if (Skills.level('crafting') < 40 && Skills.level('smithing') < 40) {
        bits.push('every railing and cannon part is a Crafting/Smithing roll — below 40 in both, expect repeated failures and self-damage');
    }
    if (Skills.level('hitpoints') < 30) {
        bits.push(`the goblin cave is twenty goblins deep (hp=${Skills.level('hitpoints')})`);
    }
    return bits.length > 0 ? `Dwarf Cannon: ${bits.join('; ')}` : null;
}

// Why: `tools` is read at one place in QuestEngine — the spillover keep list — and is never provisioned, so a resume mid-quest does not bank its own state.
// Why: the quest buys nothing, and the float otherwise walks at the pinned bank on every activation — which from inside the goblin cave is a route that does not exist, so a resume there spends a minute and a half proving it before starting.

export const dwarfcannon: QuestModule = {
    record: QUESTS.find(r => r.id === 'mcannon')!,
    bank: FALADOR_WEST_BANK,
    hops: [...CAVE_HOPS],
    food: MC_FOOD_TARGET,
    coinFloat: 0,
    tools: ['coins', 'tool kit', 'dwarf remains', "nulodion's notes", 'ammo mould', 'railing'],
    readProgress: readDwarfCannonProgress,
    sustain: { foods: ['Lobster', 'Trout', 'Bread'], eatBelowHp: 0.6 },
    warnReadiness: warnDwarfCannonReadiness,
    decide
};
