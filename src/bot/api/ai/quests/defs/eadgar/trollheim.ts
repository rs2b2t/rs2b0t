import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import Tile from '../../../../../geometry/Tile.js';
import { ITEM as TROLL_ITEM, TILE as TROLL_TILE } from '../trollstronghold/areas.js';
import { stealCellKey, unlockCell } from '../trollstronghold/index.js';
import { ER_ITEM, ER_LOC, ER_NPC, ER_TILE, THISTLE_SPOTS, banked, held } from './areas.js';
import { markEadgarFreed } from './journal.js';
import { AEMAD, scanBank, sourceLogs, sourcePestle, sourceTinderbox, withdraw } from './supplies.js';

/** `fire` from the firemaking script — Eadgar's cooking pot also displays as "Fire". */
const FIRE_LOC = 2732;
const VIAL_PRICE = 10;
/** Middle of the five thistle hops; all of them are inside one loaded scene from here. */
const THISTLE_STAND = THISTLE_SPOTS[2]!;

const invById = (id: number): ReturnType<typeof Inventory.items>[number] | undefined =>
    Inventory.items().find(item => item.id === id);

const withdrawById = (snap: QuestSnapshot, id: number, name: string, qty = 1): QuestStep =>
    withdraw(snap, [{ name, id, qty }]);

/** Bank, then Aemad's counter beside the Ardougne zoo. */
function sourceVial(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.VIAL_WATER) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.VIAL_WATER) > 0) {
        return withdrawById(snap, ER_ITEM.VIAL_WATER.id, ER_ITEM.VIAL_WATER.name);
    }
    return { kind: 'buy', item: ER_ITEM.VIAL_WATER.name, qty: 1, shop: AEMAD, estGp: VIAL_PRICE };
}

async function mixIds(fromId: number, ontoId: number, productId: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(productId) > 0) {
        return true;
    }
    const from = invById(fromId);
    const onto = invById(ontoId);
    if (!from || !onto) {
        log(`mix: missing item ${!from ? fromId : ontoId}`);
        return false;
    }
    if (!(await from.useOn(onto))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(productId) > 0, 10_000);
}

// Why: every unfinished potion shares the display name "Unfinished potion", so this chain is
// addressed by object id — a name-keyed withdraw pulls whichever unf the bank happened to sort first.

/** A ranarr potion (unf): banked, or mixed from a banked ranarr weed and a vial. */
function sourceRanarrVial(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.RANARR_VIAL) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.RANARR_VIAL) > 0) {
        return withdrawById(snap, ER_ITEM.RANARR_VIAL.id, ER_ITEM.RANARR_VIAL.name);
    }
    if (held(snap, ER_ITEM.RANARR) === 0) {
        if (banked(snap, ER_ITEM.RANARR) === 0) {
            return {
                kind: 'wait',
                reason: 'no Ranarr weed and no Unfinished potion in the bank — no shop in 2004 sells either'
            };
        }
        return withdrawById(snap, ER_ITEM.RANARR.id, ER_ITEM.RANARR.name);
    }
    return sourceVial(snap) ?? {
        kind: 'custom',
        name: 'mix a ranarr potion (unf)',
        run: log => mixIds(ER_ITEM.RANARR.id, ER_ITEM.VIAL_WATER.id, ER_ITEM.RANARR_VIAL.id, log)
    };
}

/** Pick the Thistle npc, which hops to another of its five tiles after every pick. */
async function pickThistle(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(ER_ITEM.THISTLE.id) > 0) {
        return true;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
        const here = Game.tile();
        if (!here || THISTLE_STAND.distanceTo(here) > 14 || here.level !== 0) {
            if (!(await Traversal.walkResilient(THISTLE_STAND, { radius: 6, attempts: 3, timeoutMs: 240_000, log }))) {
                return false;
            }
            await settleScene();
        }
        const thistle = Npcs.query().name(ER_NPC.THISTLE).action('Pick').nearest();
        if (!thistle) {
            log('no Troll Thistle in the scene — walking the patch');
            await Traversal.walkResilient(THISTLE_SPOTS[attempt % THISTLE_SPOTS.length]!, { radius: 2, attempts: 2, log });
            continue;
        }
        if (await thistle.interact('Pick')) {
            if (await Execution.delayUntil(() => Inventory.countById(ER_ITEM.THISTLE.id) > 0, 15_000)) {
                return true;
            }
        }
        await Execution.delayTicks(2);
    }
    log('could not pick a Troll Thistle');
    return false;
}

// Why: the thistle dries on any `cooking_fire`, and the mountain has none — so the quest brings a
// spare log and a tinderbox and lights one where it stands.

/** Dry a picked thistle over a fire, lighting one first when there is none. */
async function dryThistle(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(ER_ITEM.DRIED_THISTLE.id) > 0) {
        return true;
    }
    if (Inventory.countById(ER_ITEM.THISTLE.id) === 0) {
        log('no Troll thistle to dry');
        return false;
    }
    const nearbyFire = (): Loc | null => Locs.query().where(loc => loc.id === FIRE_LOC).within(4).nearest();
    let fire = nearbyFire();
    // Why: `area_allow_loc_add` refuses a tile another loc already sits on and says so only in a
    // game message, so a refusal is answered by standing somewhere else rather than by retrying.
    for (let tile = 0; !fire && tile < 4; tile++) {
        const tinderbox = invById(ER_ITEM.TINDERBOX.id);
        const logs = invById(ER_ITEM.LOGS.id);
        if (!tinderbox || !logs) {
            log('no Tinderbox or no Logs to light a drying fire');
            return false;
        }
        if (tile > 0) {
            const here = Game.tile();
            if (here) {
                await Traversal.walkResilient(new Tile(here.x + 1, here.z + tile, here.level), { radius: 0, attempts: 2, log });
            }
        }
        if (await tinderbox.useOn(logs)) {
            await Execution.delayUntil(() => nearbyFire() !== null, 20_000);
        }
        fire = nearbyFire();
    }
    const thistle = invById(ER_ITEM.THISTLE.id);
    if (!fire || !thistle) {
        log('the logs never caught — nothing on this patch would take a fire');
        return false;
    }
    if (!(await thistle.useOn(fire))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(ER_ITEM.DRIED_THISTLE.id) > 0, 15_000);
}

/** Thistle → dried → ground → Troll potion. Null once the potion is in the pack. */
export function sourceTrollPotion(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.TROLL_POTION) > 0) {
        return null;
    }
    if (held(snap, ER_ITEM.GROUND_THISTLE) > 0) {
        return sourceRanarrVial(snap) ?? {
            kind: 'custom',
            name: 'mix the troll truth potion',
            run: log => mixIds(ER_ITEM.GROUND_THISTLE.id, ER_ITEM.RANARR_VIAL.id, ER_ITEM.TROLL_POTION.id, log)
        };
    }
    if (held(snap, ER_ITEM.DRIED_THISTLE) > 0) {
        return sourcePestle(snap) ?? {
            kind: 'custom',
            name: 'grind the dried thistle',
            run: log => mixIds(ER_ITEM.PESTLE.id, ER_ITEM.DRIED_THISTLE.id, ER_ITEM.GROUND_THISTLE.id, log)
        };
    }
    if (held(snap, ER_ITEM.THISTLE) > 0) {
        return sourceTinderbox(snap)
            ?? sourceLogs(snap, 1)
            ?? { kind: 'custom', name: 'dry the thistle over a fire', run: dryThistle };
    }
    // Why: the thistle only grows on Trollheim and everything that processes it is bought at the
    // bottom of the mountain, so the kit is assembled before the climb rather than after it.
    return sourceTinderbox(snap)
        ?? sourceLogs(snap, 1)
        ?? sourcePestle(snap)
        ?? sourceRanarrVial(snap)
        ?? { kind: 'custom', name: 'pick a Troll Thistle', run: pickThistle };
}

/** Outside Mad Eadgar's cell door on the prison floor. */
const EADGAR_CELL_STAND = new Tile(2833, 10082, 0);
const EADGAR_CELL_DOOR = new Tile(2832, 10082, 0);

// Why: Troll Stronghold finishes on Godric alone, so an account can arrive here with Mad Eadgar still in his cell and the Cave Entrance dropping it into an empty room.
// Why: Berry keeps handing out Cell key 2 for as long as the varbit is false, quest complete or not.

/** Open Mad Eadgar's cell so he goes home to his cave. */
export async function freeEadgar(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TROLL_TILE.PRISON_LANDING, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (!(await stealCellKey('Berry', TROLL_ITEM.CELL_KEY_2, EADGAR_CELL_STAND, log))) {
        return false;
    }
    if (!(await unlockCell(TROLL_ITEM.CELL_KEY_2, EADGAR_CELL_DOOR, EADGAR_CELL_STAND, log))) {
        return false;
    }
    markEadgarFreed();
    log('Mad Eadgar is free — he walks home to his cave');
    return true;
}

/** Hide the Drunk parrot under the torture rack in the troll prison. */
export function hideParrot(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        ER_ITEM.DRUNK_PARROT.id,
        { name: 'Rack', near: ER_TILE.RACK, id: ER_LOC.RACK },
        [],
        () => Inventory.countById(ER_ITEM.DRUNK_PARROT.id) === 0,
        log
    );
}
