import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const SIR_AMIK: NpcStop = { npc: 'Sir Amik Varze', anchor: new Tile(2962, 3338, 2), leash: 6, prefer: ['I seek a quest!', 'I laugh in the face of danger!'] };
const IRON_CHAINBODY = 'Iron chainbody';
const BRONZE_MED_HELM = 'Bronze med helm';

const GRILL = new Tile(3025, 3507, 0);
const HOLE = new Tile(3031, 3507, 1);
const CABBAGE_FIELD = new Tile(3053, 3306, 0);

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const nearTile = (t: Tile, r: number): boolean => {
    const me = Game.tile();
    return me !== null && me.level === t.level && Math.max(Math.abs(me.x - t.x), Math.abs(me.z - t.z)) <= r;
};

let listened = false;

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { listened = false; return { kind: 'talk', stop: SIR_AMIK }; }

    if (!worn(snap, IRON_CHAINBODY) && has(snap, IRON_CHAINBODY)) { return { kind: 'equip', item: IRON_CHAINBODY }; }
    if (!worn(snap, BRONZE_MED_HELM) && has(snap, BRONZE_MED_HELM)) { return { kind: 'equip', item: BRONZE_MED_HELM }; }

    if (has(snap, 'Cabbage')) { return { kind: 'custom', name: 'infiltrate', run: infiltrate }; }
    return { kind: 'talk', stop: SIR_AMIK };
}

async function infiltrate(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains('Cabbage')) { return true; }

    if (!listened) {
        log('infiltrating the fortress to eavesdrop at the grill');
        const grill = await Reach.locOp({
            name: 'Grill', op: 'Listen-at', near: GRILL,
            expect: () => ChatDialog.isOpen() || ChatDialog.canContinue() || nearTile(GRILL, 1),
            log
        });
        if (grill === 'unreachable') { log('bkf: Grill unreachable — re-planning'); return false; }
        if (grill !== 'done') { return false; }
        await Execution.delayUntil(() => ChatDialog.isOpen(), 2500);
        for (let i = 0; i < 40 && ChatDialog.isOpen(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
            await Execution.delayTicks(1);
        }
        listened = true;
        return false;
    }

    await Traversal.walkResilient(HOLE, { radius: 1, attempts: 6, timeoutMs: 120_000, log });
    const hole = Locs.query().name('Hole').within(8).nearest();
    const cabbage = Inventory.first('Cabbage');
    if (hole && cabbage) {
        const before = Inventory.count('Cabbage');
        await cabbage.useOn(hole);
        await Execution.delayUntil(() => Inventory.count('Cabbage') < before, 6000);
    }
    return false;
}

async function pickCabbage(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Cabbage')) { return true; }
    const plant = Locs.query().name('Cabbage').action('Pick').within(10).nearest();
    if (!plant) {
        await Traversal.walkResilient(CABBAGE_FIELD, { radius: 4, attempts: 4, timeoutMs: 120_000, log });
        return false;
    }
    const before = Inventory.count('Cabbage');
    log('picking a cabbage from the Draynor Manor field');
    if (!(await plant.interact('Pick'))) { return false; }
    await Execution.delayUntil(() => Inventory.count('Cabbage') > before, 6000);
    return false;
}

export const blackknight: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackknight')!,
    bank: new Tile(2946, 3369, 0),
    food: 4,
    grind: ['black knight', 'aggressive black knight'],
    gather: {
        'cabbage': () => ({ kind: 'custom', name: 'pick cabbage', run: pickCabbage })
    },
    decide
};
