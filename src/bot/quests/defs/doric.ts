import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const DORIC: NpcStop = {
    npc: 'Doric', anchor: new Tile(2952, 3451, 0), leash: 6,
    prefer: ['I wanted to use your anvils.', 'Yes, I will get you materials.']
};

const ORE_ANCHORS: Record<'Clay' | 'Copper ore' | 'Iron ore', Tile> = {
    'Clay': new Tile(2986, 3240, 0),
    'Copper ore': new Tile(2978, 3247, 0),
    'Iron ore': new Tile(2972, 3239, 0)
};

function hasPickaxe(snap: QuestSnapshot): boolean {
    for (const name of snap.inv.keys()) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    for (const name of snap.worn) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    return false;
}

export function gatherOre(snap: QuestSnapshot, item: 'Clay' | 'Copper ore' | 'Iron ore', need: number): QuestStep {
    if (!hasPickaxe(snap)) {
        return { kind: 'wait', reason: `need a pickaxe to mine ${need} ${item}` };
    }
    return { kind: 'mineRock', rock: item, item, qty: need, anchor: ORE_ANCHORS[item] };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    return { kind: 'talk', stop: DORIC };
}

export const doric: QuestModule = {
    record: QUESTS.find(r => r.id === 'doric')!,
    bank: new Tile(2946, 3369, 0),
    tools: ['pickaxe'],
    gather: {
        'clay': (s, n) => gatherOre(s, 'Clay', n),
        'copper ore': (s, n) => gatherOre(s, 'Copper ore', n),
        'iron ore': (s, n) => gatherOre(s, 'Iron ore', n)
    },
    decide
};
