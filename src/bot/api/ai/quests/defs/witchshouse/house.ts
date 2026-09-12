import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { openContainer } from '../../exec/legs.js';
import { clearBoxes, driveBoxes, promptLoc, settleScene } from '../../exec/prompts.js';
import { WH_LOC, WH_NPC, WH_OBJ, WH_TILE, inPorch } from './areas.js';

const WALK_MS = 180_000;

/** Message shared by the pot and cupboard when their item already exists. */
const NOTHING_INTERESTING = /don't find anything interesting/i;
/** The mouse door is already open, which is the goal. */
const ALREADY_UNLOCKED = /already unlocked this door/i;

export function held(id: number): number {
    return Inventory.countById(id);
}

export function liveItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

/** `~mesbox` announces the key and the `inv_add` lands a tick behind it, so the count is the oracle. */
export async function takeDoorKey(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.DOOR_KEY) > 0) {
        return true;
    }
    const took = await promptLoc({
        name: 'Potted plant',
        op: 'Look-under',
        near: WH_TILE.POT,
        id: WH_LOC.POT,
        within: 6,
        expect: () => held(WH_OBJ.DOOR_KEY) > 0,
        expectMs: 12_000,
        refused: NOTHING_INTERESTING
    }, log);
    await Modals.close();
    return took && held(WH_OBJ.DOOR_KEY) > 0;
}

// Why: the cellar gate is a baked door edge, so the walk opens and crosses it, but `_ball_irongate` shocks a bare hand and leaves you on the near side, so the gloves go on first.

/** Search the cellar cupboard behind the electrified gate. */
export async function fetchMagnet(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.MAGNET) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WH_TILE.CUPBOARD, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        log('the cellar cupboard stand is unreachable. The iron gate only passes with the gloves worn');
        return false;
    }
    await settleScene();
    if (!(await openContainer('Cupboard', WH_LOC.CUPBOARD_SHUT, WH_LOC.CUPBOARD_OPEN, WH_TILE.CUPBOARD, log))) {
        return false;
    }
    const mark = GameMessages.mark();
    const found = await promptLoc({
        name: 'Cupboard',
        op: 'Search',
        near: WH_TILE.CUPBOARD,
        id: WH_LOC.CUPBOARD_OPEN,
        within: 6,
        expect: () => held(WH_OBJ.MAGNET) > 0,
        expectMs: 12_000,
        refused: NOTHING_INTERESTING
    }, log);
    await Modals.close();
    if (!found && GameMessages.sawSince(mark, NOTHING_INTERESTING)) {
        log('the cupboard is empty because a magnet already exists in the pack or the bank');
    }
    return held(WH_OBJ.MAGNET) > 0;
}

// Why: `magnetcbopen` gives a magnet only when the account owns none, so remove extras before stage 1.

/** Drop a magnet that stops the cupboard replacing it. */
export async function dropStaleMagnet(log: (m: string) => void): Promise<boolean> {
    const magnet = liveItem(WH_OBJ.MAGNET);
    if (!magnet) {
        return true;
    }
    if (!(await magnet.interact('Drop'))) {
        log('the stale magnet refused the Drop click');
        return false;
    }
    return Execution.delayUntil(() => held(WH_OBJ.MAGNET) === 0, 6000);
}

function mouse(): Npc | null {
    return Npcs.query().where(n => n.id === WH_NPC.MOUSE).within(4).nearest();
}

// Why: `opheld5,cheese` jumps to the same `ball_cheese` label from anywhere in the porch zone and never reaches the `inv_dropslot` under it.
// Why: that makes Drop a second way in, for when the client does not offer a wall decoration as a use target.

/** Spend a cheese to bring the mouse out of its hole. */
async function lureMouse(log: (m: string) => void): Promise<boolean> {
    const there = (): boolean => mouse() !== null;
    const hole = Locs.query().where(l => l.id === WH_LOC.MOUSE_HOLE).within(4).nearest();
    const cheese = liveItem(WH_OBJ.CHEESE);
    if (!cheese) {
        log('no cheese in the pack to lure the mouse with');
        return false;
    }
    if (hole && (await cheese.useOn(hole)) && (await driveBoxes(there, 8000, [], log))) {
        await clearBoxes();
        return true;
    }
    const spare = liveItem(WH_OBJ.CHEESE);
    if (!spare) {
        log('the cheese was spent and no mouse came out of the hole');
        return false;
    }
    if (!(await spare.interact('Drop'))) {
        return false;
    }
    const came = await driveBoxes(there, 8000, [], log);
    await clearBoxes();
    return came;
}

/** Lure the mouse and fit the magnet, which is what unlocks the back door. */
export async function unlockBackDoor(log: (m: string) => void): Promise<boolean> {
    if (!inPorch(Game.tile())
        && !(await Traversal.walkResilient(WH_TILE.PORCH, { radius: 0, attempts: 3, timeoutMs: WALK_MS, log }))) {
        log('the back porch is unreachable. The front door needs the door key in the pack');
        return false;
    }
    await settleScene();
    if (!mouse() && !(await lureMouse(log))) {
        return false;
    }
    const target = mouse();
    const magnet = liveItem(WH_OBJ.MAGNET);
    if (!target || !magnet) {
        log(`nothing to fit: mouse=${target !== null} magnet=${magnet !== null}`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await magnet.useOn(target))) {
        log('the mouse refused the magnet');
        return false;
    }
    const fitted = await driveBoxes(() => held(WH_OBJ.MAGNET) === 0, 12_000, [], log);
    await clearBoxes();
    if (fitted) {
        return true;
    }
    if (GameMessages.sawSince(mark, ALREADY_UNLOCKED)) {
        log('the back door was already unlocked');
        return true;
    }
    log('the magnet is still in the pack, so the harness is unfitted and the back door still locked');
    return false;
}

// Why: `witch.rs2` rewinds the quest only while the varp sits at 3, and reading the diary moves it to 5.

/** Diary progress the journal cannot show: stages 3 and 5 render one page. */
export const DiaryState = { read: false, tries: 0 };

const MAX_DIARY_TRIES = 3;

export function resetDiaryState(): void {
    DiaryState.read = false;
    DiaryState.tries = 0;
}

export function diaryWanted(): boolean {
    return !DiaryState.read && DiaryState.tries < MAX_DIARY_TRIES;
}

export async function fetchDiary(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.DIARY) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WH_TILE.DIARY, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        DiaryState.tries++;
        log(`the upstairs bedroom is unreachable (try ${DiaryState.tries} of ${MAX_DIARY_TRIES})`);
        return false;
    }
    await settleScene();
    const drop = GroundItems.query().where(g => g.id === WH_OBJ.DIARY).within(6).nearest();
    if (!drop) {
        DiaryState.tries++;
        log(`no diary on the bedroom floor (try ${DiaryState.tries} of ${MAX_DIARY_TRIES}); it respawns in 30 ticks`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        DiaryState.tries++;
        return false;
    }
    return Execution.delayUntil(() => held(WH_OBJ.DIARY) > 0, 8000);
}

/** Read the diary; the book modal opening is the only proof the script ran. */
export async function readDiary(log: (m: string) => void): Promise<boolean> {
    const diary = liveItem(WH_OBJ.DIARY);
    if (!diary) {
        return false;
    }
    if (!(await diary.interact('Read'))) {
        log('the diary refused the Read click');
        return false;
    }
    const opened = await Execution.delayUntil(() => Modals.isOpen(), 6000);
    await Modals.close();
    if (!opened) {
        DiaryState.tries++;
        log(`the diary opened no book (try ${DiaryState.tries} of ${MAX_DIARY_TRIES})`);
        return false;
    }
    DiaryState.read = true;
    log('diary read, so being caught now costs the shed key and not the back door');
    return true;
}
