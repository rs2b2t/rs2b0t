// docs/QUESTS.md
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import {
    BANK,
    BONES_OBJ,
    FEED,
    FEED_OBJ,
    HALGRIVE,
    JACKET,
    JACKET_OBJ,
    ORBON,
    PROD,
    PROD_OBJ,
    SHEEP,
    TROUSERS,
    TROUSERS_OBJ,
    type SheepIndex
} from './areas.js';
import { SH_STAGE, readSheepHerderProgress } from './journal.js';
import { fetchProd, incinerate, penAndKill } from './pen.js';

/** Doctor Orbon's price for the protective suit. */
const SUIT_GP = 100;

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const held = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
const wearing = (snap: QuestSnapshot, id: number): boolean => snap.wornIds?.has(id) ?? false;

/** Both halves of the suit have to be worn: `prod_sheep` and the gate each read `worn`. */
function dressed(snap: QuestSnapshot): QuestStep | null {
    for (const [id, name] of [[JACKET_OBJ, JACKET], [TROUSERS_OBJ, TROUSERS]] as const) {
        if (wearing(snap, id)) {
            continue;
        }
        // Why: the suit is untradeable and has no shop, so a lost half is re-bought from Orbon rather than withdrawn.
        return held(snap, id) > 0 ? { kind: 'equip', item: name } : { kind: 'talk', stop: ORBON };
    }
    return null;
}

function armed(snap: QuestSnapshot): QuestStep | null {
    if (wearing(snap, PROD_OBJ)) {
        return null;
    }
    return custom(`fetch the ${PROD} from the barn`, log => fetchProd(log));
}

function nextSheep(snap: QuestSnapshot): SheepIndex | null {
    return SHEEP.find(n => !hasFlag(snap.progress, `burnt-${n}`)) ?? null;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: HALGRIVE }; }

    const stage = snap.progress?.stage;
    if (stage === undefined) { return { kind: 'wait', reason: 'Sheep Herder journal stage unavailable' }; }
    if (stage === SH_STAGE.COMPLETE) { return { kind: 'done' }; }
    if (stage === SH_STAGE.NOT_STARTED) { return { kind: 'talk', stop: HALGRIVE }; }

    if (stage === SH_STAGE.NEED_SUIT) {
        return (snap.inv.get('coins') ?? 0) >= SUIT_GP
            ? { kind: 'talk', stop: ORBON }
            : { kind: 'withdraw', items: [{ name: 'Coins', qty: SUIT_GP * 10 }], bank: BANK };
    }

    const n = nextSheep(snap);
    if (n === null) { return { kind: 'talk', stop: HALGRIVE }; }

    // Why: the incinerator stands inside the enclosure and the gate reads `worn`, so the suit comes before the burn as well as before the herd.
    const suit = dressed(snap);
    if (suit) { return suit; }
    // Why: the remains are already in hand, so the prod and the feed cannot block the burn.
    if (held(snap, BONES_OBJ[n]) > 0) {
        return custom(`incinerate the remains of sheep ${n}`, log => incinerate(n, log));
    }

    const prod = armed(snap);
    if (prod) { return prod; }
    // Why: the feed is untradeable and never consumed, so one is enough — and Halgrive hands out another whenever the pack has none.
    if (held(snap, FEED_OBJ) === 0) { return { kind: 'talk', stop: HALGRIVE }; }

    return custom(`herd and kill sheep ${n}`, log => penAndKill(n, log));
}

export const sheepherder: QuestModule = {
    record: QUESTS.find(record => record.id === 'sheepherder')!,
    bank: BANK,
    food: 4,
    tools: ['coins', PROD.toLowerCase(), FEED.toLowerCase(), JACKET.toLowerCase(), TROUSERS.toLowerCase(), 'bones'],
    readProgress: readSheepHerderProgress,
    decide
};
