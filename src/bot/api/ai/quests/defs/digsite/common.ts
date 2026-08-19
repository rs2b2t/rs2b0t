import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { driveChoice, settleScene } from '../../exec/prompts.js';
import { driveDialog } from '../../exec/primitives.js';
import { QuestFood } from '../../food.js';
import { DIG_ID, DIG_TILE, inDigCave } from './areas.js';

export const WALK_MS = 180_000;
const DIALOGUE_MS = 12_000;
const CLIMB_MS = 15_000;

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

/** An unread bank is not an empty bank, and a bare count sends the bot to a booth for something it never saw. */
export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? (snap.bankIds?.get(id) ?? 0) : 0;
}

export function heldOrBanked(snap: QuestSnapshot, id: number): number {
    return heldId(snap, id) + bankedId(snap, id);
}

export async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === dest.level && dest.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: WALK_MS, log });
}

export function npcById(id: number, within = 16): Npc | null {
    return Npcs.query().where(n => n.id === id).within(within).nearest();
}

export function locByIds(ids: readonly number[], within = 12, extra?: (l: Loc) => boolean): Loc | null {
    const set = new Set(ids);
    return Locs.query().where(l => set.has(l.id) && (extra === undefined || extra(l))).within(within).nearest();
}

export function locByIdAction(ids: readonly number[], op: string, within = 12): Loc | null {
    const set = new Set(ids);
    return Locs.query().where(l => set.has(l.id)).action(op).within(within).nearest();
}

// Why: every Digsite student is displayed as "Student" and both workmen as "Digsite workman", so `Reach.npcDialog` would open the wrong conversation whichever one it found first.

/** Walk to an anchor and drive one NPC's dialogue, matched by server id. */
export async function talkToNpcId(
    npcId: number,
    anchor: Tile,
    prefer: readonly string[],
    log: (m: string) => void,
    guessWhenUnmatched = false
): Promise<boolean> {
    if (!npcById(npcId, 12) && !(await walkTo(anchor, 4, log))) {
        return false;
    }
    await settleScene();
    const find = (): Npc | null => npcById(npcId, 16);
    if (!find()) {
        log(`no npc ${npcId} within sixteen tiles of (${anchor.x},${anchor.z})`);
        return false;
    }
    const status = await Reach.entityOp({
        find,
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        openWhenUnreachable: true,
        expectMs: DIALOGUE_MS,
        what: `npc ${npcId}`,
        log
    });
    if (status !== 'done') {
        log(`npc ${npcId} never opened a dialogue (${status})`);
        return false;
    }
    // Why: the Examiner's exams offer a different wrong-answer set for every errand the bot has not run, and abandoning mid-exam leaves the conversation open forever.
    return guessWhenUnmatched ? driveDialog([...prefer], log) : driveChoice([...prefer], log);
}

/** Drive prompts until a goal lands, answering mesboxes as well as chat. */
export async function driveUntilHeld(
    expect: () => boolean,
    prefer: readonly string[],
    log: (m: string) => void,
    ms = 45_000
): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline && !expect()) {
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await driveChoice([...prefer], log);
            continue;
        }
        if (Modals.isOpen()) {
            await Modals.close();
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    await Modals.closeIfOpen();
    return expect();
}

/** Use a held item on a loc matched by id, then answer whatever prompt it raised. */
export async function useOnLocIds(
    itemId: number,
    locIds: readonly number[],
    stand: Tile,
    expect: () => boolean,
    log: (m: string) => void,
    prefer: readonly string[] = []
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    await settleScene();
    const target = locByIds(locIds, 8);
    const item = Inventory.items().find(entry => entry.id === itemId) ?? null;
    if (!target || !item) {
        log(`no loc ${locIds.join('/')} or no item ${itemId} at (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntilHeld(expect, prefer, log);
}

/** Use a held item on an NPC matched by id, then answer whatever prompt it raised. */
export async function useOnNpcId(
    itemId: number,
    npcId: number,
    anchor: Tile,
    expect: () => boolean,
    log: (m: string) => void,
    prefer: readonly string[] = []
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!npcById(npcId, 10) && !(await walkTo(anchor, 3, log))) {
        return false;
    }
    await settleScene();
    const target = npcById(npcId, 16);
    const item = Inventory.items().find(entry => entry.id === itemId) ?? null;
    if (!target || !item) {
        log(`no npc ${npcId} or no item ${itemId} near (${anchor.x},${anchor.z})`);
        return false;
    }
    // Why: `opnpcu` makes the server path to the npc, and a client-side chase of a wandering student spends the walk budget on a target that keeps moving.
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntilHeld(expect, prefer, log);
}

/**
 * Everything this quest ever carries. Anything else in the pack is dig spoil,
 * and the loops that fill the pack drop it rather than walk to a booth.
 */
const KEEP_IDS: ReadonlySet<number> = new Set<number>([
    DIG_ID.COINS, DIG_ID.TROWEL, DIG_ID.SPECIMEN_JAR, DIG_ID.SPECIMEN_BRUSH,
    DIG_ID.TRAY_EMPTY, DIG_ID.TRAY_MUD, DIG_ID.CHISEL, DIG_ID.TINDERBOX, DIG_ID.PESTLE,
    DIG_ID.VIAL, DIG_ID.CHARCOAL, DIG_ID.GROUND_CHARCOAL, DIG_ID.ARCENIA_ROOT,
    DIG_ID.CHEST_KEY, DIG_ID.ROPE, DIG_ID.CUP_OF_TEA, DIG_ID.OPAL, DIG_ID.UNCUT_OPAL,
    DIG_ID.POWDER, DIG_ID.AMMONIUM_NITRATE, DIG_ID.LIQUID, DIG_ID.NITROGLYCERIN,
    DIG_ID.PRE_CHARCOAL, DIG_ID.POST_CHARCOAL, DIG_ID.COMPOUND,
    DIG_ID.TALISMAN, DIG_ID.EXPERT_SCROLL, DIG_ID.STONE_TABLET,
    DIG_ID.PLAIN_LETTER, DIG_ID.STAMPED_LETTER,
    DIG_ID.CERT_1, DIG_ID.CERT_2, DIG_ID.CERT_3,
    DIG_ID.ROCK_SAMPLE_GREEN, DIG_ID.ROCK_SAMPLE_ORANGE, DIG_ID.ROCK_SAMPLE_PURPLE
]);

// Why: every volatile chemical answers Drop with an explosion for up to 65 damage, so this list denies by default and the chemicals are on it.

/** Whether an inventory slot is spoil this quest can throw away. */
export function isSpoil(item: InvItem): boolean {
    if (KEEP_IDS.has(item.id)) {
        return false;
    }
    const food = QuestFood.name?.trim().toLowerCase();
    return !food || item.name?.toLowerCase() !== food;
}

// Why: pickpocketing for one rock sample turns up five specimen brushes and three ropes on the way, and each surplus copy squats a slot the level 3 dig needs free.

/** How many of a kept item are worth carrying; anything past this is spoil. */
const KEEP_LIMIT: ReadonlyMap<number, number> = new Map<number, number>([
    [DIG_ID.SPECIMEN_BRUSH, 1], [DIG_ID.SPECIMEN_JAR, 1], [DIG_ID.TROWEL, 1],
    [DIG_ID.TRAY_EMPTY, 1], [DIG_ID.TRAY_MUD, 1], [DIG_ID.CHISEL, 1],
    [DIG_ID.TINDERBOX, 1], [DIG_ID.PESTLE, 1], [DIG_ID.VIAL, 1],
    [DIG_ID.CUP_OF_TEA, 1], [DIG_ID.ARCENIA_ROOT, 1], [DIG_ID.ROPE, 2]
]);

/** Drop dig and panning spoil so the next dig has a free slot. Nothing here throws. */
export async function dropSpoil(log: (m: string) => void, keepFree = 4): Promise<void> {
    if (Inventory.free() >= keepFree) {
        return;
    }
    const seen = new Map<number, number>();
    for (const item of Inventory.items()) {
        if (Inventory.free() >= keepFree) {
            return;
        }
        const nth = (seen.get(item.id) ?? 0) + 1;
        seen.set(item.id, nth);
        const surplus = nth > (KEEP_LIMIT.get(item.id) ?? Number.MAX_SAFE_INTEGER);
        if (!surplus && !isSpoil(item)) {
            continue;
        }
        if (await item.interact('Drop')) {
            log(`dropped ${surplus ? 'surplus' : 'spoil'}: ${item.name ?? item.id}`);
            await Execution.delayTicks(1);
        }
    }
}

/** Climb the shaft rope back to the surface. Both shafts' ropes are named "Rope". */
export async function climbOutOfCave(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!inDigCave(here)) {
        return true;
    }
    for (let attempt = 0; attempt < 3 && inDigCave(Game.tile()); attempt++) {
        const rope = Locs.query().name('Rope').action('Climb-up').within(40).nearest();
        if (!rope) {
            log('no shaft rope in the scene to climb');
            return false;
        }
        if (rope.distance() > 1 && !(await walkTo(rope.tile() as Tile, 1, log))) {
            continue;
        }
        const again = Locs.query().name('Rope').action('Climb-up').within(4).nearest();
        if (!again || !(await again.interact('Climb-up'))) {
            continue;
        }
        await Execution.delayUntil(() => !inDigCave(Game.tile()), CLIMB_MS);
        await settleScene();
    }
    if (!inDigCave(Game.tile())) {
        return true;
    }
    log('the climb out of the dig shaft never reached the surface');
    return false;
}

/** Where the character is, for the branches that must escape a shaft first. */
export function tileOf(snap: QuestSnapshot): WorldTile | null {
    return snap.tile ?? null;
}

export { DIG_TILE };
