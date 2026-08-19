import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveUntil, heldId, settleScene, useOnLoc } from '../../exec/prompts.js';
import { gotoNpc, openDialogue, type NpcStop } from '../../exec/primitives.js';
import {
    ANITA,
    CHARLIE,
    FEMI,
    FOREMAN,
    GLOUGH,
    GT_HOPS,
    GT_LOC,
    GT_OBJ,
    GT_PILLARS,
    GT_ROOTS,
    GT_TILE,
    NARNODE,
    NARNODE_UNDER,
    PILOT,
    inCaves,
    inStronghold
} from './areas.js';

type Log = (m: string) => void;

const TALK_MS = 120_000;

function here(): Tile | null {
    const t = Game.tile();
    return t ? new Tile(t.x, t.z, t.level) : null;
}

// Why: several legs are one scripted chain that closes the dialogue, walks the player, teleports it and only then speaks again — `driveDialog` gives up in the 1.5s gaps, so the goal is what ends these, not the conversation.

/** Talk, then keep answering whatever the chain raises until `expect` lands. */
async function talkUntil(stop: NpcStop, expect: () => boolean, log: Log, ms = TALK_MS): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await gotoNpc(stop, GT_HOPS, log))) {
        return false;
    }
    if (!(await openDialogue(stop.npc, log))) {
        return false;
    }
    return driveUntil(expect, stop.prefer, log, ms);
}

function locAt(id: number, tile: Tile, within = 4): Loc | null {
    return Locs.query()
        .where(l => l.id === id && l.tile().level === tile.level && l.tile().distanceTo(tile) <= 1)
        .within(within)
        .nearest();
}

// Why: the King walks the player to his trapdoor, drops it into the foundations and climbs it back out, all inside one `opnpc` — so the bark sample landing is the only honest end of the talk.
// Why: a chain interrupted underground is resumable, because the second King spawn down there answers `not_started` with the same offer.

/** Start the quest and come away with the bark sample and the translation book. */
export async function startQuest(log: Log): Promise<boolean> {
    const stop = inCaves(here()) ? { ...NARNODE_UNDER, prefer: NARNODE.prefer } : NARNODE;
    return talkUntil(stop, () => heldId(GT_OBJ.BARK) > 0, log);
}

// Why: Glough calls the guards, marches the player to a ladder, jails it at the top of the tree, and the King then walks over and lets it out — one chain, ending with the player teleported one tile east of the cell.
// Why: an interrupted run resumes from inside the cell, where Charlie's own `apnpc1` runs the same chain from the middle.

// Why: the goal state — standing one tile east of the cell — is also where a chain that broke after the teleport leaves the player, so this leg never short-circuits on it.
// Why: a stage-70 pass that starts there walks back to Glough instead, who jails the player again and runs the chain again from the top.

/** Confront Glough with his journal and come out of the cage he answers with. */
export async function jailedByGlough(log: Log): Promise<boolean> {
    const released = (): boolean => {
        const t = here();
        return t !== null && t.level === 3 && t.z === GT_TILE.jail.z && t.x > GT_TILE.jail.x
            && !ChatDialog.isOpen() && !ChatDialog.canContinue();
    };
    const inCell = (): boolean => {
        const t = here();
        return t !== null && t.level === 3 && GT_TILE.jail.distanceTo(t) === 0;
    };
    const stop = inCell() ? CHARLIE : GLOUGH;
    if (!(await gotoNpc(stop, GT_HOPS, log))) {
        return false;
    }
    if (!(await openDialogue(stop.npc, log))) {
        return false;
    }
    return driveUntil(released, stop.prefer, log, TALK_MS);
}

/** Open Glough's cupboard and search it for his journal. */
export async function searchCupboard(log: Log): Promise<boolean> {
    if (heldId(GT_OBJ.JOURNAL) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(GT_TILE.cupboardStand, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const cupboard = new Tile(2476, 3465, 1);
    const shut = locAt(GT_LOC.CUPBOARD_SHUT, cupboard);
    if (shut) {
        log('opening the cupboard in Glough\'s house');
        if (!(await shut.interact('Open'))) {
            return false;
        }
        // Why: a loc that transforms keeps its shut id for a tick, so the open half is polled for.
        await Execution.delayUntil(() => locAt(GT_LOC.CUPBOARD_OPEN, cupboard) !== null, 6000);
    }
    const open = locAt(GT_LOC.CUPBOARD_OPEN, cupboard);
    if (!open) {
        log(`no open cupboard at (${cupboard.x},${cupboard.z}) — the Open never landed`);
        return false;
    }
    if (!(await open.interact('Search'))) {
        return false;
    }
    return driveUntil(() => heldId(GT_OBJ.JOURNAL) > 0, [], log, 10_000);
}

// Why: the foreman closes the dialogue, walks the player thirty-five tiles across the yard and teleports it into his office before he asks the first question, so the generic talk step abandons him mid-walk and the next pass drags the player back out to his spawn.
// Why: once the chain has moved him, `[opnpc1,grandtree_foreman]` sees him inside the office zone and skips straight to the interrogation — so a Foreman already in the scene is talked to where he stands.

/** Answer the foreman's three questions about Glough and take the lumber order. */
export async function foremanOrder(log: Log): Promise<boolean> {
    if (heldId(GT_OBJ.LUMBER_ORDER) > 0) {
        return true;
    }
    // Why: the gate swaps itself for an inviswall for three ticks after it teleports the player through, so the client repaths off the tile it has landed on and a two-pass walk budget is spent on the recovery.
    const near = Npcs.query().name(FOREMAN.npc).within(8).nearest();
    if (!near && !(await Traversal.walkResilient(FOREMAN.anchor, { radius: 4, attempts: 5, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await openDialogue(FOREMAN.npc, log))) {
        return false;
    }
    return driveUntil(() => heldId(GT_OBJ.LUMBER_ORDER) > 0, FOREMAN.prefer, log, 180_000);
}

/** Take the King's glider out of the stronghold; it crash-lands in the Karamja jungle. */
export async function flyToKaramja(log: Log): Promise<boolean> {
    const landed = (): boolean => {
        const t = here();
        return t !== null && t.level === 0 && GT_TILE.karamjaCrash.distanceTo(t) <= 12;
    };
    return talkUntil(PILOT, landed, log, 60_000);
}

// Why: at stage 90 the gate guards turn the player away, and Femi's food cart is the only way back inside — she charges only the 1000gp branch, which the pay option answers.

/** Ride Femi's cart back into the stronghold. */
export async function femiCart(log: Log): Promise<boolean> {
    if (inStronghold(here())) {
        return true;
    }
    // Why: this leg starts in the Karamja jungle and ends outside the gnome gate — six hundred tiles, a log balance and a ship, which is more than `gotoNpc`'s two 45s passes.
    if (!(await Traversal.walkResilient(GT_TILE.femi, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
        return false;
    }
    return talkUntil(FEMI, () => inStronghold(here()), log, 60_000);
}

/** Climb to Anita's first floor and take Glough's chest key from her. */
export async function anitaKey(log: Log): Promise<boolean> {
    if (heldId(GT_OBJ.KEY) > 0) {
        return true;
    }
    const upstairs = (): boolean => {
        const t = here();
        return t !== null && t.level === 1 && GT_TILE.anitaFloor.distanceTo(t) <= 6;
    };
    if (!upstairs()) {
        // Why: this staircase has no baked edge, so the leg owns both directions of it.
        if (!(await Traversal.walkResilient(GT_TILE.anitaStairs, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        await settleScene();
        const stairs = Locs.query().name('Staircase').action('Climb-up').within(4).nearest();
        if (!stairs || !(await stairs.interact('Climb-up'))) {
            log(`no staircase up to Anita at (${GT_TILE.anitaStairs.x},${GT_TILE.anitaStairs.z})`);
            return false;
        }
        if (!(await Execution.delayUntil(upstairs, 8000))) {
            return false;
        }
        await settleScene();
    }
    if (!(await talkUntil(ANITA, () => heldId(GT_OBJ.KEY) > 0, log, 60_000))) {
        return false;
    }
    return descendAnita(log);
}

/** Anita's floor is a thirteen-tile pocket, so the key leg owns the way down too. */
export async function descendAnita(log: Log): Promise<boolean> {
    const t = here();
    if (!t || t.level !== 1 || GT_TILE.anitaFloor.distanceTo(t) > 6) {
        return true;
    }
    if (!(await Traversal.walkResilient(GT_TILE.anitaFloor, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const stairs = Locs.query().name('Staircase').action('Climb-down').within(4).nearest();
    if (!stairs || !(await stairs.interact('Climb-down'))) {
        log('no staircase down from Anita\'s floor');
        return false;
    }
    return Execution.delayUntil(() => here()?.level === 0, 8000);
}

/** Unlock Glough's chest with Anita's key and take the invasion plans. */
export async function openChest(log: Log): Promise<boolean> {
    return useOnLoc(
        GT_OBJ.KEY,
        { name: 'Closed chest', near: GT_TILE.chestStand, id: GT_LOC.CHEST_SHUT, within: 4 },
        [],
        () => heldId(GT_OBJ.INVASION_PLANS) > 0,
        log
    );
}

// Why: `grandtree_climbtree` is an Agility 25 climb with no baked edge, so both it and the tree back down belong to the legs that use the pillar floor.

/** Climb from Glough's first floor to the pillar floor above it. */
export async function climbToPillars(log: Log): Promise<boolean> {
    const upstairs = (): boolean => {
        const t = here();
        return t !== null && t.level === 2 && GT_TILE.pillarFloor.distanceTo(t) <= 6;
    };
    if (upstairs()) {
        return true;
    }
    if (!(await Traversal.walkResilient(GT_TILE.climbTreeStand, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const tree = Locs.query().where(l => l.id === GT_LOC.CLIMB_TREE).action('Climb-up').within(4).nearest();
    if (!tree || !(await tree.interact('Climb-up'))) {
        log(`no climbable tree at (${GT_TILE.climbTreeStand.x},${GT_TILE.climbTreeStand.z})`);
        return false;
    }
    if (!(await Execution.delayUntil(upstairs, 10_000))) {
        return false;
    }
    await settleScene();
    return true;
}

// Why: the pillar floor is a seven-tile pocket whose only ways off are the tree back down and the trapdoor, and neither is a baked edge — so a bank step decided up here has no route and spends its budget down to nothing proving it.

/** Climb out of Glough's tree, back to the ground the bank is on. */
export async function descendGloughTree(log: Log): Promise<boolean> {
    const t = here();
    if (!t || t.level === 0) {
        return true;
    }
    if (t.level >= 2) {
        if (!(await Traversal.walkResilient(GT_TILE.downTreeStand, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        await settleScene();
        const tree = Locs.query().where(l => l.id === GT_LOC.DOWN_TREE).action('Climb-down').within(4).nearest();
        if (!tree || !(await tree.interact('Climb-down'))) {
            log(`no tree down from the pillar floor at (${GT_TILE.downTreeStand.x},${GT_TILE.downTreeStand.z})`);
            return false;
        }
        if (!(await Execution.delayUntil(() => (here()?.level ?? 2) < 2, 10_000))) {
            return false;
        }
        await settleScene();
    }
    // Glough's own ladder is baked, so the last leg down is an ordinary walk.
    return Traversal.walkResilient(GT_TILE.gloughHouseFoot, { radius: 2, attempts: 3, timeoutMs: 90_000, log });
}

/** Lay each twig on the pillar the trapdoor's own `obj_find` checks for it. */
export function placeTwig(index: number): (log: Log) => Promise<boolean> {
    const pillar = GT_PILLARS[index]!;
    return async log => {
        if (!(await climbToPillars(log))) {
            return false;
        }
        return useOnLoc(
            pillar.obj,
            { name: 'Pillar', near: pillar.stand, id: pillar.loc, within: 4 },
            [],
            () => heldId(pillar.obj) === 0,
            log
        );
    };
}

// Why: the roots are searched in a fixed order rather than at random, so a resumed run walks the shortest remaining leg instead of re-rolling.
let rootCursor = 0;

/** Test hook: the search order is module state so the sweep survives a re-decide. */
export function resetRootCursor(): void {
    rootCursor = 0;
}

// Why: fourteen of the fifteen roots answer "You search the root but don't find anything", which is a search that worked — reporting it as a failed step would spend the sweep printing failures at the operator.

/** Search one root for the Daconia rock. */
export async function searchNextRoot(log: Log): Promise<boolean> {
    if (heldId(GT_OBJ.DACONIA) > 0) {
        return true;
    }
    const index = rootCursor % GT_ROOTS.length;
    const root = GT_ROOTS[index]!;
    rootCursor++;
    if (!(await Traversal.walkResilient(root.stand, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: both root models render "Root" and the closest pair stands three tiles apart, so the match is the placement rather than the name.
    const loc = Locs.query()
        .name('Root')
        .action('Search')
        .where(l => l.tile().distanceTo(root.sw) <= 1)
        .within(6)
        .nearest();
    if (!loc) {
        log(`no Root at (${root.sw.x},${root.sw.z})`);
        return false;
    }
    if (!(await loc.interact('Search'))) {
        return false;
    }
    const found = await driveUntil(() => heldId(GT_OBJ.DACONIA) > 0, [], log, 6000);
    log(`root ${index + 1}/${GT_ROOTS.length} at (${root.sw.x},${root.sw.z}): ${found ? 'the Daconia rock' : 'nothing'}`);
    return true;
}

/** Hand the rock over; the King's reward queue ends the quest. */
export function giveRock(log: Log): Promise<boolean> {
    return talkUntil(NARNODE_UNDER, () => heldId(GT_OBJ.DACONIA) === 0, log, 60_000);
}

/** Climb out of the root caves so the finished quest can walk to a bank. */
export async function leaveCaves(log: Log): Promise<boolean> {
    if (!inCaves(here())) {
        return true;
    }
    if (!(await Traversal.walkResilient(GT_TILE.caveLadder, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action('Climb-up').within(4).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        log(`no ladder out of the caves at (${GT_TILE.caveLadder.x},${GT_TILE.caveLadder.z})`);
        return false;
    }
    return Execution.delayUntil(() => !inCaves(here()), 10_000);
}
