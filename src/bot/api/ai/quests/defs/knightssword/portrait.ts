import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { locNear, settleScene } from '../../exec/prompts.js';
import { KS_ID, KS_TILE, VYVIN_APPROACHES } from './areas.js';

/**
 * `~vyvin_distracted` is `npc_find(coord, sir_vyvin, 1, 0)` against the player's
 * own coord, so the guard is proximity rather than a timer.
 */
const VYVIN_LEASH = 1;

const ATTEMPTS = 60;

// Why: Vyvin has `wanderrange=8` in a room barely wider than that, so he is adjacent most of the time.
// Why: treating the position check as a blocker spins until the watchdog parks, so it is a hint that saves a wasted click rather than a gate.

// How many passes may be skipped on Vyvin's position alone.
const MAX_SKIPS = 4;

/** Consecutive refused searches before vacating the approach entirely. */
const REFUSALS_BEFORE_RETREAT = 3;

export function vyvinTooClose(here: WorldTile | null, vyvin: WorldTile | null): boolean {
    if (!here || !vyvin) {
        return false;
    }
    return Tile.from(here).distanceTo(vyvin) <= VYVIN_LEASH;
}

/** Bounded by construction: after `MAX_SKIPS` passes the search happens regardless. */
export function shouldWaitOut(skips: number, here: WorldTile | null, vyvin: WorldTile | null): boolean {
    return skips < MAX_SKIPS && vyvinTooClose(here, vyvin);
}

// Why: both approaches sit south of the cupboard, so when Sir Vyvin stands directly south neither is clear and only time helps.
// Why: off to one side the far tile is clear and the near one is not, so the far one is always taken.

/** Pick the approach tile furthest from Sir Vyvin. */
export function bestApproach(approaches: readonly Tile[], vyvin: WorldTile | null): Tile {
    if (!vyvin) {
        return approaches[0];
    }
    return [...approaches].sort((a, b) => b.distanceTo(vyvin) - a.distanceTo(vyvin))[0];
}

function vyvinTile(): WorldTile | null {
    return Npcs.query().name('Sir Vyvin').nearest()?.tile() ?? null;
}

// Why: the engine dedupes identical sub-log lines within a step, so a fixed message would hide every repeat — hence the varying text.
// Why: a silent cupboard stuck at 2271 is what an illegal approach looks like, and this line is how that gets diagnosed.

/** The refusal line for one search pass. */
function describe(pass: number): string {
    const here = Game.tile();
    const vyvin = vyvinTile();
    const cupboards = Locs.query().name('Cupboard').within(8).results()
        .map(c => `${c.tile().x},${c.tile().z}:${c.id}:${c.actions().filter(Boolean).join('/')}`);
    return `pass ${pass} me=${here ? `${here.x},${here.z},${here.level}` : '?'}`
        + ` vyvin=${vyvin ? `${vyvin.x},${vyvin.z}` : 'absent'}`
        + ` cupboards=[${cupboards.join(' ')}]`;
}

/** A caught search leaves a mesbox up; it must go before the next click. */
async function dismissRefusal(): Promise<void> {
    for (let i = 0; i < 4 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
}

// Why: `vyvincupboardshut` is `forceapproach=east` at rotation 1, so the only legal approach is its south side.
// Why: Open turns it into `vyvincupboardopen`, which is the one that Searches.
// Why: the oracle is whether the portrait lands rather than whether Vyvin looks far enough away, as his position is read a tick before the click and re-evaluated server-side after the walk.

/** Search Sir Vyvin's cupboard for the portrait. */
export async function fetchPortrait(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(KS_ID.PORTRAIT) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(KS_TILE.VYVIN_ROOM, { radius: 1, attempts: 4, timeoutMs: 300_000, log }))) {
        log("could not reach Sir Vyvin's room");
        return false;
    }
    await settleScene();
    let skips = 0;
    let refusals = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
        // Why: he wanders on a timer and can camp the tile south of the cupboard, where both approaches are within his one-tile reach.
        // Why: vacating the approach gives him somewhere to go, where standing on it does not.
        if (refusals >= REFUSALS_BEFORE_RETREAT) {
            refusals = 0;
            log('stepping away to give Sir Vyvin room to wander');
            await Traversal.walkResilient(KS_TILE.VYVIN_RETREAT, { radius: 1, attempts: 2, timeoutMs: 90_000, log });
            await Execution.delayTicks(10);
        }
        const stand = bestApproach(VYVIN_APPROACHES, vyvinTile());
        const here = Game.tile();
        if (!here || stand.distanceTo(here) !== 0 || here.level !== stand.level) {
            await Traversal.walkResilient(stand, { radius: 0, attempts: 3, timeoutMs: 90_000, log });
            await settleScene();
        }
        if (Inventory.countById(KS_ID.PORTRAIT) > 0) {
            return true;
        }
        await dismissRefusal();
        const shut = locNear('Cupboard', 'Open', 5);
        if (shut) {
            await shut.interact('Open');
            await Execution.delayTicks(2);
            continue;
        }
        const open = locNear('Cupboard', 'Search', 5);
        if (!open) {
            log('no Cupboard in reach of the stand');
            await Execution.delayTicks(2);
            continue;
        }
        if (shouldWaitOut(skips, Game.tile(), vyvinTile())) {
            skips++;
            await Execution.delayTicks(2);
            continue;
        }
        skips = 0;
        await open.interact('Search');
        if (await Execution.delayUntil(() => Inventory.countById(KS_ID.PORTRAIT) > 0, 5000)) {
            return true;
        }
        refusals++;
        // Why: Vyvin is only blamed when he is in range, as a search can fail to land yet and mislabelling that sends the next reader hunting him.
        const blocked = vyvinTooClose(Game.tile(), vyvinTile());
        log(`${blocked ? 'Sir Vyvin was watching' : 'search did not land'} — ${describe(i)}`);
        await Execution.delayTicks(4);
    }
    log('never got a clear look at the cupboard');
    return false;
}
