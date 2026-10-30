import { Execution } from '../../../execution/Execution.js';
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { Game } from '../../../game/Game.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Reach } from '../../../walking/Reach.js';
import { Traversal } from '../../../walking/Traversal.js';
import Tile from '../../../../geometry/Tile.js';
import { driveDialog, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { Quests } from '../../../ui/questlog/Quests.js';

const SIR_AMIK: NpcStop = { npc: 'Sir Amik Varze', anchor: new Tile(2962, 3338, 2), leash: 6, prefer: ['I seek a quest!', 'I laugh in the face of danger!'] };
const IRON_CHAINBODY = 'Iron chainbody';
const BRONZE_MED_HELM = 'Bronze med helm';
const CABBAGE = 1965;
const cabbage = () => Inventory.items().find(item => item.id === CABBAGE && !item.noted);

const GRILL = new Tile(3025, 3507, 0);
const HOLE = new Tile(3031, 3508, 1);
const CABBAGE_FIELD = new Tile(3053, 3295, 0);

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

function sourceItem(snap: QuestSnapshot, item: string): QuestStep {
    if (!snap.bankKnown) return { kind: 'scanBank' };
    const banked = item === 'Cabbage' && snap.bankIds ? snap.bankIds.get(CABBAGE) ?? 0 : snap.bank?.get(item.toLowerCase()) ?? 0;
    if (banked > 0) return { kind: 'withdraw', items: [{ name: item, ...(item === 'Cabbage' ? { id: CABBAGE } : {}), qty: 1 }] };
    if (item === IRON_CHAINBODY) return { kind: 'buy', item, qty: 1, shop: { npc: 'Wayne', anchor: new Tile(2973, 3312, 0) }, estGp: 300 };
    if (item === BRONZE_MED_HELM) return { kind: 'buy', item, qty: 1, shop: { npc: 'Peksa', anchor: new Tile(3076, 3429, 0) }, estGp: 50 };
    return { kind: 'custom', name: 'pick cabbage', run: pickCabbage };
}

async function readStage(): Promise<number | undefined> {
    const status = Quests.status("Black Knight's Fortress");
    if (status === 'complete') return 4;
    if (status === 'notStarted') return 0;
    if (status !== 'inProgress') return undefined;
    const text = (await Quests.journal("Black Knight's Fortress")).join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').toLowerCase();
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (text.includes('quest complete!')) return 4;
    if (text.includes("now that i have sabotaged the witch's potion")) return 3;
    if (text.includes('i eavesdropped on a witch')) return 2;
    if (text.includes('asked me to investigate')) return 1;
    return undefined;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted' || snap.stage === 3) return { kind: 'talk', stop: SIR_AMIK };
    if (snap.stage === undefined) return { kind: 'wait', reason: 'fortress journal stage unavailable' };
    for (const item of [IRON_CHAINBODY, BRONZE_MED_HELM]) {
        if (!worn(snap, item)) return has(snap, item) ? { kind: 'equip', item } : sourceItem(snap, item);
    }
    if (!(snap.invIds ? (snap.invIds.get(CABBAGE) ?? 0) > 0 : has(snap, 'Cabbage'))) return sourceItem(snap, 'Cabbage');
    return { kind: 'custom', name: snap.stage === 1 ? 'listen at the grill' : 'sabotage the potion', run: log => infiltrate(log, snap.stage === 1) };
}

async function infiltrate(log: (m: string) => void, listen: boolean): Promise<boolean> {
    if (!cabbage()) { return true; }
    Game.setAutoRetaliate(false);

    if (listen) {
        log('infiltrating the fortress to eavesdrop at the grill');
        const grill = await Reach.locOp({
            name: 'Grill', op: 'Listen-at', near: GRILL,
            expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
            log
        });
        if (grill === 'unreachable') { log('bkf: Grill unreachable — re-planning'); return false; }
        if (grill !== 'done') { return false; }
        return driveDialog([], log);
    }

    if (!(await Traversal.walkResilient(HOLE, { radius: 1, attempts: 6, timeoutMs: 120_000, log }))) return false;
    const hole = Locs.query().name('Hole').within(8).nearest();
    const item = cabbage();
    if (!hole || !item || !(await item.useOn(hole))) return false;
    if (!(await Execution.delayUntil(() => ChatDialog.texts().some(text => text.includes('successfully sabotaged')), 15_000))) return false;
    return driveDialog([], log);
}

async function pickCabbage(log: (m: string) => void): Promise<boolean> {
    if (cabbage()) { return true; }
    if (!(await Traversal.walkResilient(CABBAGE_FIELD, { radius: 2, attempts: 4, timeoutMs: 120_000, log }))) return false;
    const plant = Locs.query().name('Cabbage').action('Pick').within(10).nearest();
    if (!plant) return false;
    log('picking an ordinary cabbage from the Falador farm');
    if (!(await plant.interact('Pick'))) { return false; }
    return Execution.delayUntil(() => !!cabbage(), 6000);
}

export const blackknight: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackknight')!,
    bank: new Tile(2946, 3369, 0),
    readStage,
    grind: ['black knight', 'aggressive black knight'],
    gather: {
        'iron chainbody': snap => sourceItem(snap, IRON_CHAINBODY),
        'bronze med helm': snap => sourceItem(snap, BRONZE_MED_HELM),
        'cabbage': snap => sourceItem(snap, 'Cabbage')
    },
    decide
};
