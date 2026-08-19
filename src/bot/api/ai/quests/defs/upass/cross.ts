import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Navigator } from '../../../../../event/webwalk/Navigator.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { UPASS_AREAS, UPASS_CROSSINGS, type UpassCrossing } from './route.js';
import { verdictSince } from './verdict.js';

// Why: the search this replaces asked twenty questions a round — how much closer, is it walled, is it spent, does it gain — and got a cage thirty tiles off reporting a crossing, because none of them is "where am I". An area answers that once, and the answer names one action.

/** Item-uses that are crossings: the loc carries no op the client can send. */
const USED_ON: Record<number, { item: number; name: string }> = {
    2275: { item: 954, name: 'Rope' },
    2276: { item: 954, name: 'Rope' },
    3216: { item: 952, name: 'Spade' }
};

/** The level every area in the table sits on — the caverns. The platforms are `PLATFORM_LINKS`. */
const TABLE_LEVEL = 0;
/** How long a crossing gets to land once its script has spoken. */
const CROSS_MS = 12_000;
/** What a silent op gets — three ticks covers a teleport door end to end. */
const QUIET_MS = 1_800;

const here = (): { x: number; z: number; level: number } | null => Game.tile();

async function routes(from: { x: number; z: number; level: number }, to: Tile): Promise<boolean> {
    return (await Navigator.findPath(from, to, { policy: { useTeleports: false } })).ok;
}

/**
 * Which area the character is standing in, or null when they are off the walkable graph.
 * Why: a sweep once walked the character ONTO the ledge column — a tile the pack calls blocked — and every later question answered nonsense from there. Off the graph is an answer worth having.
 */
export async function areaAt(me: { x: number; z: number; level: number }): Promise<string | null> {
    for (const area of UPASS_AREAS) {
        if (await routes(me, area.anchor)) {
            return area.area;
        }
    }
    return null;
}

/** The first crossing along the shortest chain of areas from `from` to `goal`, or null when there is none. */
export function chainFrom(from: string, goal: string): UpassCrossing | null {
    if (from === goal) {
        return null;
    }
    const seen = new Set<string>([from]);
    let frontier: { area: string; first: UpassCrossing }[] = [];
    for (const edge of UPASS_CROSSINGS) {
        if (edge.from === from && !seen.has(edge.to)) {
            seen.add(edge.to);
            frontier.push({ area: edge.to, first: edge });
        }
    }
    while (frontier.length > 0) {
        const hit = frontier.find(step => step.area === goal);
        if (hit) {
            return hit.first;
        }
        const next: { area: string; first: UpassCrossing }[] = [];
        for (const step of frontier) {
            for (const edge of UPASS_CROSSINGS) {
                if (edge.from === step.area && !seen.has(edge.to)) {
                    seen.add(edge.to);
                    next.push({ area: edge.to, first: step.first });
                }
            }
        }
        frontier = next;
    }
    return null;
}

/** Send the crossing's op, or use the item it wants on the loc. */
async function operate(edge: UpassCrossing, log: (m: string) => void): Promise<boolean> {
    const loc = Locs.query().where(l => l.id === edge.loc).within(8).nearest();
    if (!loc) {
        log(`pass: loc ${edge.loc} is not in the scene from (${here()?.x},${here()?.z})`);
        return false;
    }
    const use = USED_ON[edge.loc];
    if (use) {
        const item = Inventory.items().find(inv => inv.id === use.item);
        if (!item) {
            log(`pass: the crossing at (${edge.stand.x},${edge.stand.z}) wants a ${use.name} and the pack has none`);
            return false;
        }
        return item.useOn(loc);
    }
    return loc.interact(edge.op);
}

/**
 * Take one crossing out of the area the character is standing in, toward `dest`.
 * Returns 'crossed' when the area changed, 'same' when it did not, and 'nowhere' when there is no chain.
 */
export async function crossOnce(dest: Tile, log: (m: string) => void): Promise<'crossed' | 'same' | 'nowhere'> {
    const me = here();
    if (!me) {
        return 'nowhere';
    }
    // Why: every area in the table is level 0 — the caverns. On the level-1 platforms no anchor can ever match, so the "off the walkable graph" branch fired on ground that is perfectly walkable and then walked at level-0 anchors from level 1. The table has nothing to say up there; `PLATFORM_LINKS` does.
    if (me.level !== TABLE_LEVEL || dest.level !== TABLE_LEVEL) {
        return 'nowhere';
    }
    const from = await areaAt(me);
    if (from === null) {
        // Why: standing on a tile the pack calls blocked. Nothing about the graph applies until the
        // character is back on it, and the nearest anchor is the shortest way back.
        log(`pass: (${me.x},${me.z}) is not on the walkable graph — stepping back onto it`);
        for (const area of UPASS_AREAS) {
            if (await Traversal.walkResilient(area.anchor, { radius: 2, attempts: 1, timeoutMs: 15_000 })) {
                return 'crossed';
            }
        }
        return 'nowhere';
    }
    const goal = await areaAt(dest);
    if (goal === null) {
        log(`pass: (${dest.x},${dest.z}) is in no area the route knows`);
        return 'nowhere';
    }
    if (from === goal) {
        return 'nowhere';
    }
    const edge = chainFrom(from, goal);
    if (!edge) {
        log(`pass: no chain of crossings from ${from} to ${goal}`);
        return 'nowhere';
    }
    log(`pass: in ${from}, heading for ${goal} — ${edge.op} ${edge.loc} from (${edge.stand.x},${edge.stand.z}), lands (${edge.lands.x},${edge.lands.z}) in ${edge.to}`);
    if (!(await Traversal.walkResilient(edge.stand, { radius: 0, attempts: 1, timeoutMs: 20_000 }))) {
        log(`pass: could not stand on (${edge.stand.x},${edge.stand.z})`);
        return 'same';
    }
    const mark = GameMessages.mark();
    if (!(await operate(edge, log))) {
        return 'same';
    }
    // Why: the script says what it did in the tick the op resolves, and only a crossing is worth waiting out.
    await Execution.delayUntil(() => verdictSince(mark) !== null, QUIET_MS);
    const said = verdictSince(mark);
    if (said === 'refused' || said === 'failed') {
        log(`pass: ${edge.op} ${edge.loc} ${said} — ${GameMessages.since(mark).map(m => m.text).slice(-2).join(' / ')}`);
        return 'same';
    }
    // Why: `delayUntil` polls every frame and cannot await, so the crossing is watched on the tile it
    // lands on — the area is asked once, after, where the answer is the verdict.
    await Execution.delayUntil(() => {
        const t = here();
        return t !== null && t.x === edge.lands.x && t.z === edge.lands.z && t.level === edge.lands.level;
    }, said === 'crossing' ? CROSS_MS : QUIET_MS);
    await settleScene();
    const now = here() ?? me;
    const landed = await areaAt(now);
    if (landed === edge.to) {
        log(`pass: ${edge.op} ${edge.loc} → (${now.x},${now.z}), now in ${landed}`);
        return 'crossed';
    }
    log(`pass: ${edge.op} ${edge.loc} left the character in ${landed ?? 'no area'} at (${now.x},${now.z}), wanted ${edge.to}`
        + ` — it said: ${GameMessages.since(mark).map(m => m.text).slice(-3).join(' / ') || 'nothing'}`);
    return 'same';
}
