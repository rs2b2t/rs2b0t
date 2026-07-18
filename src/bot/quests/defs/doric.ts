import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Facts: quest_doric.rs2 (start :34-62, hand-in :68-89); ores.obj:13,27,59.
// Doric spawn npc 284 @ m46_53.jm2:5943 -> (2952,3451,0), indoors (door on hut;
// the walker's door handling covers it — LIVE-VERIFY the exact stand tile).
const DORIC: NpcStop = {
    npc: 'Doric', anchor: new Tile(2952, 3451, 0), leash: 6,
    prefer: ['I wanted to use your anvils.', 'Yes, I will get you materials.']
};

// Gather fallback: Rimmington surface mine — the one cluster with clay + copper
// + iron together (the quest scripts don't dictate a mine). Per-ore anchors are
// the real rock-cluster tiles found offline in the baked pack
// (tools/nav scan of loc ids Clay 2108/2109, Copper 2090/2091, Iron 2092/2093
// near Rimmington) and confirmed reachable/walkable via PathFinder on
// out/collision.lcnav.gz. The mineRock executor walks within 3 of the anchor
// then targets the nearest matching rock within 10. LIVE-VERIFY refines only if
// a rock's stand tile differs at runtime.
const ORE_ANCHORS: Record<'Clay' | 'Copper ore' | 'Iron ore', Tile> = {
    'Clay': new Tile(2986, 3240, 0),
    'Copper ore': new Tile(2978, 3247, 0),
    'Iron ore': new Tile(2972, 3239, 0)
};

function hasPickaxe(snap: QuestSnapshot): boolean {
    for (const name of snap.inv.keys()) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    for (const name of snap.worn) { // any pickaxe tier EQUIPPED counts too
        if (name.endsWith('pickaxe')) { return true; }
    }
    return false;
}

export function gatherOre(snap: QuestSnapshot, item: 'Clay' | 'Copper ore' | 'Iron ore', need: number): QuestStep {
    // SKILL GATE, not modeled in QuestSnapshot: iron rocks need Mining 15
    // (clay/copper are level 1). Below 15 the mine attempts fail silently and
    // the engine retries forever (failed steps never feed the watchdog) — the
    // 2026-07-16 acceptance runs prepped Mining 15 via account cheat. Banking
    // the iron ore instead also works (bank-first provisioning skips the mine).
    if (!hasPickaxe(snap)) {
        // Tutorial accounts carry a bronze pickaxe; without one the quest parks
        // visibly rather than half-starting (mustHave semantics would be wrong —
        // the ores themselves may be banked next time).
        return { kind: 'wait', reason: `need a pickaxe to mine ${need} ${item}` };
    }
    // rock carries the item display name; the executor maps ore->rock-type by
    // stripping a trailing ' ore' (MiningRocks.ROCK_TYPES keys are Copper/Iron).
    return { kind: 'mineRock', rock: item, item, qty: need, anchor: ORE_ANCHORS[item] };
}

/** Two talks total: stage 0 starts (dialogue ends, quest_doric.rs2:62); stage
 *  10 hand-in is automatic when >=6/>=4/>=2 held (:70-84). Provisioning has the
 *  ores gathered before the first talk, so decide is just "talk to Doric". */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    return { kind: 'talk', stop: DORIC };
}

export const doric: QuestModule = {
    record: QUESTS.find(r => r.id === 'doric')!,
    // any pickaxe tier is the mining tool the gather fallback checks for
    tools: ['pickaxe'],
    gather: {
        'clay': (s, n) => gatherOre(s, 'Clay', n),
        'copper ore': (s, n) => gatherOre(s, 'Copper ore', n),
        'iron ore': (s, n) => gatherOre(s, 'Iron ore', n)
    },
    decide
};
