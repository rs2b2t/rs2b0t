import { Execution } from '../../../../execution/Execution.js';
import { Locs } from '../../../../locs/Locs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { hasFlag } from '../../engine/types.js';
import { gotoNpc, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { driveChoice, settleScene } from '../../exec/prompts.js';
import { SALESMAN, type LocStop, type Suspect } from './areas.js';
import { POISON_PROVED, readMurderProgress } from './journal.js';

const BOX_MS = 6000;

// Why: the anchor walk is a hint; everyone here drifts 5 tiles off spawn, and `Reach` finds and chases whoever is in the scene when the walk falls short.
async function ask(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    await gotoNpc(stop, [], log);
    return talkThrough(stop.npc, stop.prefer, log);
}

// Why: The loc emits a game message before the poison interview and a mesbox afterward; no item confirms progress.
async function investigate(loc: LocStop, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(loc.near, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const target = Locs.query().where(l => l.id === loc.id).action('Investigate').within(6).nearest();
    if (!target) {
        log(`murder: no ${loc.name} at (${loc.near.x},${loc.near.z})`);
        return false;
    }
    if (!(await target.interact('Investigate'))) {
        return false;
    }
    await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), BOX_MS);
    return driveChoice([], log);
}

async function proved(): Promise<boolean> {
    return hasFlag(await readMurderProgress(), POISON_PROVED);
}

// Why: only the murderer's own answer moves the quest on, and asking anyone else is a no-op, so the sweep is safe to repeat from any point.

/** The salesman names the family, the suspect explains the purchase, and their loc gives the lie away. */
export async function provePoison(order: readonly Suspect[], log: (m: string) => void): Promise<boolean> {
    if (!(await ask(SALESMAN, log))) {
        return false;
    }
    for (const suspect of order) {
        log(`murder: asking ${suspect.stop.npc} about the poison`);
        await ask(suspect.stop, log);
        await investigate(suspect.poison, log);
        if (await proved()) {
            return true;
        }
    }
    return false;
}
