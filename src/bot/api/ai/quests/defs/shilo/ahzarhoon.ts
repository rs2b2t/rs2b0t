import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { SV_ITEM, SV_LOC, SV_TILE } from './areas.js';
import { driveChoice, driveUntil, heldId, here, locNear, promptLoc, settleScene, useOnLoc } from './scene.js';

const YES_CRAWL = ["Yes, I'll give it a go!"];
const YES_SEARCH = ["Yes, I'm quite sure."];
const YES_CORPSE = ['Yes, I may find something else on the corpse.'];
const YES_PATH = ["Yes, I'll follow the path."];
const YES_READ = ['Yes please.'];
const YES_WRIGGLE = ["Yes, I'll wriggle through."];

function inCaves(): boolean {
    const area = here();
    return area === 'ahZaRhoonNorth' || area === 'ahZaRhoonSouth';
}

function fissure(): ReturnType<typeof locNear> {
    return locNear(SV_LOC.FISSURE, 'Search', 10);
}

// Why: the fissure is a 50-tick `loc_change` over the mound, so it evaporates between visits.
// Why: looking at the mound re-creates whichever fissure the stage has earned, so every fissure step goes through here first.

/** Make sure the stage's fissure exists before acting on it. */
async function ensureFissure(log: (m: string) => void): Promise<boolean> {
    if (fissure()) {
        return true;
    }
    return promptLoc(
        {
            name: SV_LOC.MOUND,
            op: 'Look-at',
            near: SV_TILE.MOUND_STAND,
            expect: () => fissure() !== null,
            expectMs: 10_000
        },
        log
    );
}

export async function digMound(log: (m: string) => void): Promise<boolean> {
    if (fissure()) {
        return true;
    }
    return useOnLoc(
        SV_ITEM.SPADE.id,
        { name: SV_LOC.MOUND, near: SV_TILE.MOUND_STAND },
        [],
        () => fissure() !== null,
        log
    );
}

/** The light source is burned by the fissure, so its disappearance is the receipt. */
export async function lightFissure(log: (m: string) => void): Promise<boolean> {
    const before = heldId(SV_ITEM.LIT_CANDLE.id);
    if (before === 0) {
        log('no lit candle to drop into the fissure');
        return false;
    }
    if (!(await ensureFissure(log))) {
        return false;
    }
    return useOnLoc(
        SV_ITEM.LIT_CANDLE.id,
        { name: SV_LOC.FISSURE, near: SV_TILE.MOUND_STAND },
        [],
        () => heldId(SV_ITEM.LIT_CANDLE.id) < before,
        log
    );
}

export async function ropeFissure(log: (m: string) => void): Promise<boolean> {
    const before = heldId(SV_ITEM.ROPE.id);
    if (before === 0) {
        log('no rope to tie to the fissure');
        return false;
    }
    if (!(await ensureFissure(log))) {
        return false;
    }
    return useOnLoc(
        SV_ITEM.ROPE.id,
        { name: SV_LOC.FISSURE, near: SV_TILE.MOUND_STAND },
        [],
        () => heldId(SV_ITEM.ROPE.id) < before,
        log
    );
}

export async function enterFissure(log: (m: string) => void): Promise<boolean> {
    if (inCaves()) {
        return true;
    }
    if (!(await ensureFissure(log))) {
        return false;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.FISSURE,
            op: 'Search',
            near: SV_TILE.MOUND_STAND,
            prefer: YES_CRAWL,
            expect: () => here() === 'ahZaRhoonNorth'
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * Getting to the south room from the surface is two crossings, not one — a death or
 * a restart puts us back on Karamja and every harvest step has to climb in again.
 */
async function inSouthRoom(log: (m: string) => void): Promise<boolean> {
    if (!inCaves() && !(await enterFissure(log))) {
        return false;
    }
    return crossCaveIn('ahZaRhoonSouth', log);
}

/** The two cave rooms are separate mapsquares joined only by this rubble squeeze. */
export async function crossCaveIn(to: 'ahZaRhoonNorth' | 'ahZaRhoonSouth', log: (m: string) => void): Promise<boolean> {
    if (here() === to) {
        return true;
    }
    const near = to === 'ahZaRhoonSouth' ? SV_TILE.CAVE_IN_NORTH : SV_TILE.CAVE_IN_SOUTH;
    const ok = await promptLoc(
        { name: SV_LOC.CAVE_IN, op: 'Search', near, prefer: YES_WRIGGLE, expect: () => here() === to },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

export async function takeTatteredScroll(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.TATTERED_SCROLL.id) > 0) {
        return true;
    }
    if (!(await inSouthRoom(log))) {
        return false;
    }
    // Why: a failed Agility roll drops the ceiling on you instead of yielding the scroll, and the step runs again.
    return promptLoc(
        {
            name: SV_LOC.LOOSE_ROCKS,
            op: 'Search',
            near: SV_TILE.LOOSE_ROCKS,
            prefer: YES_SEARCH,
            expect: () => heldId(SV_ITEM.TATTERED_SCROLL.id) > 0
        },
        log
    );
}

export async function takeCrumpledScroll(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.CRUMPLED_SCROLL.id) > 0) {
        return true;
    }
    if (!(await inSouthRoom(log))) {
        return false;
    }
    return promptLoc(
        {
            name: SV_LOC.OLD_SACKS,
            op: 'Search',
            near: SV_TILE.OLD_SACKS,
            expect: () => heldId(SV_ITEM.CRUMPLED_SCROLL.id) > 0
        },
        log
    );
}

export async function takeZadimusCorpse(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.ZADIMUS_CORPSE.id) > 0 || heldId(SV_ITEM.BONE_SHARD.id) > 0 || heldId(SV_ITEM.BONE_KEY.id) > 0) {
        return true;
    }
    if (!(await inSouthRoom(log))) {
        return false;
    }
    return promptLoc(
        {
            name: SV_LOC.GALLOWS,
            op: 'Search',
            near: SV_TILE.GALLOWS,
            prefer: YES_CORPSE,
            expect: () => heldId(SV_ITEM.ZADIMUS_CORPSE.id) > 0
        },
        log
    );
}

// Why: reading sets the two bits that gate the Bervirius tomb and the necklace craft, and it is idempotent.
// Why: the journal stops rendering those flags once the Bervirius dolmen is searched, so the module reads on sight rather than on demand.

/** Read a scroll, setting the tomb and necklace bits. */
export function readScroll(itemId: number): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        const scroll = Inventory.items().find(item => item.id === itemId);
        if (!scroll) {
            log(`no scroll ${itemId} in the pack to read`);
            return false;
        }
        if (!(await scroll.interact('Read'))) {
            return false;
        }
        await Execution.delayTicks(2);
        if (!(await driveChoice(YES_READ, log))) {
            return false;
        }
        // Why: the scroll body is a main modal built with if_settext rather than a chat box, so driveChoice cannot see it.
        // Why: while it is up every journal read comes back empty, which reads as "stage unavailable" and parks the quest.
        await Execution.delayUntil(() => reader.modals().main !== -1, 6000);
        if (reader.modals().main !== -1) {
            actions.closeModal();
            await Execution.delayTicks(1);
        }
        return true;
    };
}

/** The waterfall path is the repeatable way out; the raft is a one-shot. */
export async function leaveAhZaRhoon(log: (m: string) => void): Promise<boolean> {
    if (!inCaves()) {
        return true;
    }
    if (!(await crossCaveIn('ahZaRhoonNorth', log))) {
        return false;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.WATERFALL_ROCKS,
            op: 'Search',
            near: SV_TILE.WATERFALL_ROCKS,
            prefer: YES_PATH,
            expect: () => !inCaves()
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/** Zadimus only rests on the sacred ground behind Trufitus's hut. */
export async function buryZadimus(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.BONE_SHARD.id) > 0 || heldId(SV_ITEM.BONE_KEY.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(SV_TILE.SACRED_GROUND, { radius: 1, attempts: 4, timeoutMs: 240_000, log }))) {
        return false;
    }
    const tile = Game.tile();
    if (!tile || tile.x < 2794 || tile.x > 2798 || tile.z < 3087 || tile.z > 3090) {
        log('not standing on the sacred ground yet');
        return false;
    }
    const corpse = Inventory.items().find(item => item.id === SV_ITEM.ZADIMUS_CORPSE.id);
    if (!corpse) {
        log('no Zadimus corpse to bury');
        return false;
    }
    if (!(await corpse.interact('Bury'))) {
        return false;
    }
    // Dig, apparition, speech, shard, closing box — a chain with gaps in it, so the
    // shard rather than a closed dialogue is what ends the step.
    return driveUntil(() => heldId(SV_ITEM.BONE_SHARD.id) > 0, [], log, 60_000);
}
