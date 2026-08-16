import { CANT_REACH, GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { bankedId, heldId, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { GARLIC, takeGarlic } from '../../exec/garlic.js';
import { heldId as liveHeldId, settleScene } from '../../exec/prompts.js';
import { FC_ID, FC_TILE, HARRY_SHOP, nearestSpade, RED_VINE_LOCS } from './areas.js';
import { claimPass } from './contest.js';

export const ITEM = {
    PASS: 'Fishing pass',
    ROD: 'Fishing rod',
    SPADE: 'Spade',
    WORM: 'Red vine worm',
    TROPHY: 'Fishing trophy',
    COINS: 'Coins'
} as const;

/** Bonzo's entrance fee. */
export const ENTRY_FEE = 5;
// Why: three casts win the contest, and the spare two cover a cast the server refused and a death on the way in.

/** Worms carried into the contest. */
export const WORM_TARGET = 5;
/** Harry sells a rod for 5gp; the float is one bank trip's worth of margin. */
const ROD_GP = 60;
const COIN_TRIP = 200;
const DIG_MS = 10_000;

function fromBank(snap: QuestSnapshot, id: number, name: string, qty: number): QuestStep | null {
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    const banked = bankedId(snap, id);
    return banked > 0 ? { kind: 'withdraw', items: [{ name, qty: Math.min(qty, banked), id }] } : null;
}

export function sourcePass(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FC_ID.PASS) > 0) {
        return null;
    }
    return fromBank(snap, FC_ID.PASS, ITEM.PASS, 1)
        ?? { kind: 'custom', name: 'ask the dwarf for another competition pass', run: claimPass };
}

export function sourceGarlic(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FC_ID.GARLIC) > 0) {
        return null;
    }
    return fromBank(snap, FC_ID.GARLIC, GARLIC, 1)
        ?? { kind: 'custom', name: "take garlic from Morgan's cupboard", run: takeGarlic };
}

export function sourceRod(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FC_ID.FISHING_ROD) > 0) {
        return null;
    }
    return fromBank(snap, FC_ID.FISHING_ROD, ITEM.ROD, 1)
        ?? { kind: 'buy', item: ITEM.ROD, qty: 1, shop: HARRY_SHOP, estGp: ROD_GP };
}

export function sourceSpade(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FC_ID.SPADE) > 0) {
        return null;
    }
    return fromBank(snap, FC_ID.SPADE, ITEM.SPADE, 1)
        // Why: the spawn respawns, so waiting on a taken one beats walking to the other side of the world for the next spade.
        ?? { kind: 'grabGround', item: ITEM.SPADE, anchor: nearestSpade(snap.tile), waitIfMissing: true };
}

export function sourceFee(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FC_ID.COINS) >= ENTRY_FEE) {
        return null;
    }
    return fromBank(snap, FC_ID.COINS, ITEM.COINS, COIN_TRIP)
        ?? { kind: 'wait', reason: `no coins for the ${ENTRY_FEE}gp contest entry fee` };
}

// Why: `need` is 1 once the contest is under way — topping a half-spent pack back to five would walk out of Hemenster mid-round and lose the entry at the gate.

/** Top the pack back to {@link WORM_TARGET} whenever it holds fewer than `need`. */
export function sourceWorms(snap: QuestSnapshot, need: number): QuestStep | null {
    const held = heldId(snap, FC_ID.RED_VINE_WORM);
    if (held >= need) {
        return null;
    }
    const banked = fromBank(snap, FC_ID.RED_VINE_WORM, ITEM.WORM, WORM_TARGET - held);
    if (banked) {
        return banked;
    }
    return sourceSpade(snap)
        ?? { kind: 'custom', name: `dig ${WORM_TARGET - held} red vine worm(s)`, run: log => digWorms(WORM_TARGET, log) };
}

// Why: the wood is a sealed pocket whose one entrance, the loose railing, is already a baked transport, so the walk needs no leg of its own.
// Why: the patch is twenty-odd vines and the server can path to only some of them from any given tile — the nearest one answered "I can't reach that!" from a tile one step away while its neighbour dug fine — so the leg walks the ring rather than re-clicking the nearest.

/** Dig the red-worm patch in McGrubor's Wood up to `target` worms. */
async function digWorms(target: number, log: (m: string) => void): Promise<boolean> {
    const held = (): number => liveHeldId(FC_ID.RED_VINE_WORM);
    if (held() >= target) {
        return true;
    }
    if (!(await Traversal.walkResilient(FC_TILE.VINES, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: reachability is a property of the pair, so a refusal is only evidence until the next dig moves the character.
    const refused = new Set<string>();
    while (held() < target) {
        if (EventSignal.pending()) {
            return false;
        }
        const vine = Locs.query()
            .where(l => RED_VINE_LOCS.includes(l.id))
            .action('Check')
            .within(8)
            .results()
            .filter(l => !refused.has(`${l.tile().x},${l.tile().z}`))
            .sort((a, b) => a.distance() - b.distance())[0];
        if (!vine) {
            log(`no reachable red-worm Vine at (${FC_TILE.VINES.x},${FC_TILE.VINES.z}) — ${refused.size} refused`);
            return false;
        }
        const before = held();
        const mark = GameMessages.mark();
        if (!(await vine.interact('Check'))) {
            return false;
        }
        await Execution.delayUntil(() => held() > before || GameMessages.sawSince(mark, CANT_REACH), DIG_MS);
        if (held() > before) {
            refused.clear();
            continue;
        }
        refused.add(`${vine.tile().x},${vine.tile().z}`);
    }
    return true;
}
