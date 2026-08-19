import { Execution } from '../../../../execution/Execution.js';
import Tile from '../../../../../geometry/Tile.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { OBS_ID, OBS_ITEM, OBS_LOC_NAME, OBS_TILE, PLANKS_NEEDED } from './areas.js';

/** A bronze pickaxe is 1gp; this covers it with room to spare. */
const SHOP_GP = 200;

/** Port Khazard's counter — the only shop within fifty tiles of the copper and tin. */
export const KHAZARD_SHOP = { npc: 'Shop keeper', anchor: new Tile(2641, 3171, 0) };

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

const withdraw = (items: { name: string; qty: number; id?: number }[]): QuestStep =>
    ({ kind: 'withdraw', items });

const scanBank: QuestStep = { kind: 'scanBank' };

// Why: `snap.bankIds` is empty until a booth has been opened, so a bare `banked(...) > 0` answers "no" on the first decide tick and sends the bot mining for something it already owns.

/** Withdraw from the bank when it can help, before any trip to fetch one. */
export function fromBank(snap: QuestSnapshot, id: number, name: string, qty: number): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank;
    }
    const banked = bankedId(snap, id);
    if (banked <= 0) {
        return null;
    }
    return withdraw([{ name, qty: Math.min(qty, banked), id }]);
}

/** Four spawns lie in a five-tile square, so the nearest bare one is still the right walk. */
function nearestPlankSpawn(): Tile {
    const here = Game.tile();
    if (!here) {
        return OBS_TILE.PLANK_SPAWNS[0];
    }
    return [...OBS_TILE.PLANK_SPAWNS].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
}

/** The tripod's three planks: the Barbarian Outpost spawns, as no shop sells one. */
export function planks(snap: QuestSnapshot): QuestStep {
    const need = PLANKS_NEEDED - heldId(snap, OBS_ID.PLANK);
    return fromBank(snap, OBS_ID.PLANK, OBS_ITEM.PLANK, need)
        ?? { kind: 'grabGround', item: OBS_ITEM.PLANK, anchor: nearestPlankSpawn(), waitIfMissing: true };
}

// Why: no shop this side of the Karamja ferry stocks a bronze bar, and the Fight Arena seam carries copper and tin in one radius.

/** The pickaxe, then one copper and one tin — everything the bar needs before the furnace. */
export function ore(snap: QuestSnapshot): QuestStep {
    if (![...snap.inv.keys()].some(name => name.includes('pickaxe'))) {
        return fromBank(snap, OBS_ID.BRONZE_PICKAXE, OBS_ITEM.BRONZE_PICKAXE, 1)
            ?? { kind: 'buy', item: OBS_ITEM.BRONZE_PICKAXE, qty: 1, shop: KHAZARD_SHOP, estGp: SHOP_GP };
    }
    return heldId(snap, OBS_ID.COPPER_ORE) > 0
        ? { kind: 'mineRock', rock: OBS_ITEM.TIN_ORE, item: OBS_ITEM.TIN_ORE, qty: 1, anchor: OBS_TILE.MINE }
        : { kind: 'mineRock', rock: OBS_ITEM.COPPER_ORE, item: OBS_ITEM.COPPER_ORE, qty: 1, anchor: OBS_TILE.MINE };
}

/** True while the ore for the bar is still in the ground. */
export function oreShort(snap: QuestSnapshot): boolean {
    return heldId(snap, OBS_ID.COPPER_ORE) === 0 || heldId(snap, OBS_ID.TIN_ORE) === 0;
}

// Why: both the Range and the Furnace carry `forceapproach=east`, which names the only side that works and rotates with the placement.
// Why: standing anywhere else has the use-on silently dropped — no refusal, no message, a loc that never answers, which is what a radius-2 walk turns into a coin flip.

/** Use a held item on a loc from an exact tile. */
async function useOnLocFrom(
    stand: Tile,
    itemId: number,
    locName: string,
    done: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (done()) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 4, timeoutMs: 300_000, log }))) {
        log(`observatory: could not stand on (${stand.x},${stand.z}) to use the ${locName}`);
        return false;
    }
    await Execution.delayTicks(2);
    const loc = Locs.query().name(locName).within(6).nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!loc || !item) {
        log(`observatory: no ${locName} in reach, or nothing to use on it`);
        return false;
    }
    if (!(await item.useOn(loc))) {
        return false;
    }
    return Execution.delayUntil(done, 12_000);
}

// Why: an ore used on a furnace runs `smelt_ore_single`, which reads the bar off the ore's own `smeltsto` param — one bar, no quantity panel, and copper and tin each name bronze.
const smeltBronzeRun = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    OBS_TILE.FURNACE,
    OBS_ID.COPPER_ORE,
    OBS_LOC_NAME.FURNACE,
    () => Inventory.countById(OBS_ID.BRONZE_BAR) > 0,
    log
);

export const smeltBronze: QuestStep = { kind: 'custom', name: 'smelt a bronze bar', run: smeltBronzeRun };

/** The `bucket_sand` spawn twenty-five tiles from the reception, which skips both the bucket and the Yanille pit. */
export function sand(snap: QuestSnapshot): QuestStep {
    return fromBank(snap, OBS_ID.BUCKET_OF_SAND, OBS_ITEM.BUCKET_OF_SAND, 1)
        ?? { kind: 'grabGround', item: OBS_ITEM.BUCKET_OF_SAND, anchor: OBS_TILE.SAND_SPAWN, waitIfMissing: true };
}

/** `cooking_generic_seaweed` always succeeds and burns to the same ash, so one weed is one soda ash. */
const cookSeaweed = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    OBS_TILE.RANGE_STAND,
    OBS_ID.SEAWEED,
    OBS_LOC_NAME.RANGE,
    () => Inventory.countById(OBS_ID.SODA_ASH) > 0,
    log
);

// Why: nothing in the game sells soda ash or seaweed, and the shore Horror from the Deep already walks to is the nearest that is not on an islet.
// Why: it cooks down on the Ardougne range the furnace leg passes on the way home.

/** Seaweed off the shore, then the range that turns it into soda ash. */
export function sodaAsh(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, OBS_ID.SEAWEED) > 0) {
        return { kind: 'custom', name: 'cook seaweed into soda ash', run: cookSeaweed };
    }
    return fromBank(snap, OBS_ID.SEAWEED, OBS_ITEM.SEAWEED, 1)
        ?? { kind: 'grabGround', item: OBS_ITEM.SEAWEED, anchor: OBS_TILE.SEAWEED_SPAWN, waitIfMissing: true };
}

/** Sand and soda ash used on a furnace run `smelt_glass`. */
const smeltGlassRun = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    OBS_TILE.FURNACE,
    OBS_ID.BUCKET_OF_SAND,
    OBS_LOC_NAME.FURNACE,
    () => Inventory.countById(OBS_ID.MOLTEN_GLASS) > 0,
    log
);

export const smeltGlass: QuestStep = { kind: 'custom', name: 'smelt molten glass', run: smeltGlassRun };
