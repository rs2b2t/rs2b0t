import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const ROMEO: NpcStop = { npc: 'Romeo', anchor: new Tile(3211, 3425, 0), leash: 8, prefer: ['Can I help find her for you?', 'Yes, I will tell her.', 'He sent me to the Apothecary.'] };
const JULIET: NpcStop = { npc: 'Juliet', anchor: new Tile(3158, 3425, 1), leash: 6, prefer: ['I guess I could find him.', 'Certainly, I will do so straight away!'] };
const LAWRENCE: NpcStop = { npc: 'Father Lawrence', anchor: new Tile(3254, 3475, 0), leash: 6, prefer: [] };
const APOTHECARY: NpcStop = { npc: 'Apothecary', anchor: new Tile(3195, 3404, 0), leash: 6, prefer: [] };

const BERRY_ANCHOR = new Tile(3272, 3369, 0);

const PROBES: NpcStop[] = [JULIET, LAWRENCE, APOTHECARY, ROMEO];

async function pickBerries(log: (m: string) => void): Promise<boolean> {
    const berry = GroundItems.query().name('Cadava berries').within(12).nearest();
    if (berry) {
        log('picking the Cadava berries');
        if (!(await berry.interact('Take'))) { return false; }
        return Execution.delayUntil(() => Inventory.contains('Cadava berries'), 8000);
    }
    log('walking to the Cadava berry bushes (waiting on a respawn if picked)');
    await Traversal.walkResilient(BERRY_ANCHOR, { radius: 3, attempts: 2, timeoutMs: 120_000, log });
    await Execution.delayUntil(
        () => GroundItems.query().name('Cadava berries').within(12).nearest() !== null,
        70_000
    );
    return false;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: ROMEO }; }
    if (snap.inv.has('cadava potion')) { return { kind: 'talk', stop: JULIET }; }
    if (snap.inv.has('message')) { return { kind: 'talk', stop: ROMEO }; }
    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const romeojuliet: QuestModule = {
    record: QUESTS.find(r => r.id === 'romeojuliet')!,
    bank: new Tile(3185, 3440, 0),
    tools: ['cadava', 'message'],
    gather: {
        'cadava berries': () => ({ kind: 'custom', name: 'pick cadava berries', run: pickBerries })
    },
    decide
};
