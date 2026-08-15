import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BARTENDER, JOE_BEER, NED_ROPE, PA_ITEM, PA_LOC, PA_NPC, PA_TILE } from './areas.js';
import { PRINCE_STAGE } from './journal.js';
import { fromBank, held, heldItem } from './supplies.js';

/** joe_beer consumes one, then two more, in a single conversation. */
const BEERS_NEEDED = 3;
/** One to tie her, one spare: she respawns 100 ticks later inside the door's block. */
const ROPES_BEFORE_TIE = 2;
const ROPES_AFTER_TIE = 1;
/** Her spawn is five tiles from the door and oplocu refuses inside ten. */
const KELI_BLOCK_RADIUS = 12;

function stageOf(snap: QuestSnapshot): number {
    return snap.stage ?? PRINCE_STAGE.PREP_FINISHED;
}

export function sourceBeers(snap: QuestSnapshot): QuestStep | null {
    if (stageOf(snap) >= PRINCE_STAGE.GUARD_DRUNK || held(snap, PA_ITEM.BEER.id) >= BEERS_NEEDED) {
        return null;
    }
    return fromBank(snap, PA_ITEM.BEER, BEERS_NEEDED) ?? { kind: 'talk', stop: BARTENDER };
}

export function sourceRopes(snap: QuestSnapshot): QuestStep | null {
    const stage = stageOf(snap);
    if (stage >= PRINCE_STAGE.SAVED) {
        return null;
    }
    const want = stage >= PRINCE_STAGE.GUARD_DRUNK ? ROPES_AFTER_TIE : ROPES_BEFORE_TIE;
    if (held(snap, PA_ITEM.ROPE.id) >= want) {
        return null;
    }
    return fromBank(snap, PA_ITEM.ROPE, want) ?? { kind: 'talk', stop: NED_ROPE };
}

function missingKit(snap: QuestSnapshot): QuestStep | null {
    const absent: string[] = [];
    if (held(snap, PA_ITEM.PRINCE_KEY.id) === 0) {
        absent.push(PA_ITEM.PRINCE_KEY.name);
    }
    if (held(snap, PA_ITEM.BLOND_WIG.id) === 0) {
        absent.push('blond Wig');
    }
    if (held(snap, PA_ITEM.PINK_SKIRT.id) === 0) {
        absent.push(PA_ITEM.PINK_SKIRT.name);
    }
    if (held(snap, PA_ITEM.PASTE.id) === 0) {
        absent.push(PA_ITEM.PASTE.name);
    }
    if (held(snap, PA_ITEM.ROPE.id) === 0) {
        absent.push(PA_ITEM.ROPE.name);
    }
    return absent.length > 0 ? { kind: 'wait', reason: `the break-in needs ${absent.join(', ')}` } : null;
}

export function decideJailbreak(snap: QuestSnapshot): QuestStep {
    if (stageOf(snap) === PRINCE_STAGE.PREP_FINISHED) {
        return sourceBeers(snap) ?? { kind: 'talk', stop: JOE_BEER };
    }
    return (
        missingKit(snap)
        ?? { kind: 'custom', name: 'tie Lady Keli, unlock the cell and free the prince', run: breakOut }
    );
}

async function tieKeli(log: (m: string) => void): Promise<boolean> {
    const keli = Npcs.query().name(PA_NPC.KELI).within(KELI_BLOCK_RADIUS).nearest();
    if (!keli) {
        return true;
    }
    const rope = heldItem(PA_ITEM.ROPE.id);
    if (!rope) {
        log('tieKeli: Lady Keli is back and there is no rope left to tie her with');
        return false;
    }
    if (!(await Traversal.walkResilient(keli.tile(), { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const target = Npcs.query().name(PA_NPC.KELI).within(6).nearest();
    if (!target || !(await rope.useOn(target))) {
        return false;
    }
    const gone = (): boolean => Npcs.query().name(PA_NPC.KELI).within(KELI_BLOCK_RADIUS).nearest() === null;
    return driveUntil(gone, [], log, 12_000);
}

async function unlockCell(log: (m: string) => void): Promise<boolean> {
    const inCell = (): boolean => {
        const here = Game.tile();
        return here !== null && here.z <= PA_TILE.CELL.z && Math.abs(here.x - PA_TILE.CELL.x) <= 1;
    };
    if (inCell()) {
        return true;
    }
    if (!(await Traversal.walkResilient(PA_TILE.DOOR_STAND, { radius: 0, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const key = heldItem(PA_ITEM.PRINCE_KEY.id);
    const door = Locs.query().name(PA_LOC.PRISON_DOOR).within(4).nearest();
    if (!key || !door) {
        log('unlockCell: no key, or no Prison Door within four tiles of the north stand');
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    return Execution.delayUntil(inCell, 6000);
}

async function breakOut(log: (m: string) => void): Promise<boolean> {
    if (!(await tieKeli(log))) {
        return false;
    }
    if (!(await unlockCell(log))) {
        return false;
    }
    await settleScene();
    const handedOver = (): boolean => heldItem(PA_ITEM.BLOND_WIG.id) === null;
    if (!(await talkStrict(PA_NPC.PRINCE, [], log))) {
        log('breakOut: could not open a dialogue with Prince Ali');
    }
    return driveUntil(handedOver, [], log, 20_000);
}
