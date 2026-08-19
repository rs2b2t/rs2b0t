import { hasFlag, type QuestProgress, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { talkThrough } from '../../exec/primitives.js';
import type { NpcStop } from '../../exec/primitives.js';
import {
    ASKELADDEN,
    BRUNDT,
    FISHERMAN,
    FT_ID,
    MANNI,
    MERCHANT_FIRST,
    OLAF,
    PEER,
    SAILOR,
    SIGLI,
    SIGMUND,
    SKULGRIMEN,
    SWENSEN,
    THORA,
    THORVALD,
    YRSA
} from './areas.js';
import { gatherCoins, heldId, walkTo } from './supplies.js';

const ASKELADDEN_FEE = 5000;

// Why: every trade is one item in, one item out, so what is carried names the next councillor without any journal read.

/** The flower chain, carried backwards: hold this, hand it to that councillor. */
const HANDOVER: readonly { id: number; label: string; to: (prefer: string[]) => NpcStop }[] = [
    { id: FT_ID.FLOWER, label: 'Exotic flower', to: SIGMUND },
    { id: FT_ID.BALLAD, label: 'Fremennik ballad', to: SAILOR },
    { id: FT_ID.STURDY_BOOTS, label: 'Sturdy boots', to: OLAF },
    { id: FT_ID.FISCAL_STATEMENT, label: 'Fiscal statement', to: YRSA },
    { id: FT_ID.HUNTERS_MAP, label: 'Hunters map', to: BRUNDT },
    { id: FT_ID.BOWSTRING, label: 'Custom bow string', to: SIGLI },
    { id: FT_ID.UNUSUAL_FISH, label: 'Unusual fish', to: SKULGRIMEN },
    { id: FT_ID.SEA_MAP, label: 'Sea fishing map', to: FISHERMAN },
    { id: FT_ID.FORECAST, label: 'Weather forecast', to: SWENSEN },
    { id: FT_ID.WARRIORS_CONTRACT, label: "Warriors' contract", to: PEER },
    { id: FT_ID.CHAMPIONS_TOKEN, label: 'Champions token', to: THORVALD },
    { id: FT_ID.COCKTAIL, label: 'Legendary cocktail', to: MANNI },
    { id: FT_ID.PROMISSORY_NOTE, label: 'Promissory note', to: THORA }
];

/** Who to ask next, keyed by the councillor the journal says has been asked already. */
const ASK: Record<string, (prefer: string[]) => NpcStop> = {
    olaf: YRSA,
    yrsa: BRUNDT,
    chief: SIGLI,
    sigli: SKULGRIMEN,
    skul: FISHERMAN,
    fisherman: SWENSEN,
    swensen: PEER,
    seer: THORVALD,
    thorvald: MANNI,
    manni: THORA
};

function merchantAt(progress: QuestProgress | undefined): string | undefined {
    for (const flag of progress?.flags ?? []) {
        if (flag.startsWith('merchant-at:')) {
            return flag.slice('merchant-at:'.length);
        }
    }
    return undefined;
}

/** Sigmund's trial: trade a promissory note up eleven hands into the exotic flower. */
export function merchantStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'merchant-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'merchant-started')) {
        return { kind: 'talk', stop: SIGMUND(['Yes']) };
    }

    const carrying = HANDOVER.find(entry => heldId(snap, entry.id) > 0);
    if (carrying) {
        return { kind: 'talk', stop: carrying.to(MERCHANT_FIRST) };
    }

    const at = merchantAt(snap.progress);
    if (at === undefined) {
        return { kind: 'custom', name: 'ask the Sailor and then Olaf about the flower', run: openChain };
    }
    if (at === 'thora') {
        return gatherCoins(snap, ASKELADDEN_FEE)
            ?? { kind: 'talk', stop: ASKELADDEN([...MERCHANT_FIRST, 'Yes']) };
    }
    const next = ASK[at];
    if (!next) {
        return { kind: 'wait', reason: `the merchant trial is at an unmapped step '${at}'` };
    }
    return { kind: 'talk', stop: next(MERCHANT_FIRST) };
}

// Why: `sigmund_started` and `sigmund_spoke_sailor` render the same journal page, so the two openings are one step rather than two the module cannot tell apart.
async function openChain(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(SAILOR([]).anchor, 2, log))) {
        return false;
    }
    if (!(await talkThrough('Sailor', MERCHANT_FIRST, log))) {
        return false;
    }
    if (!(await walkTo(OLAF([]).anchor, 2, log))) {
        return false;
    }
    return talkThrough('Olaf the Bard', MERCHANT_FIRST, log);
}
