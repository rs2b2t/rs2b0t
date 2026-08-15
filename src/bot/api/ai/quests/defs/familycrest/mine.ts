import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Reach } from '../../../../walking/Reach.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { FC_ID, FC_ITEM, FC_LOC, inPerfectGoldZone } from './areas.js';

const LEVER_UP = /^the lever is now up\.?$/i;
const LEVER_DOWN = /^the lever is now down\.?$/i;
const DOOR_LOCKED = /this door is locked/i;

/** Loc ids of the mine's three levers, down variant then up variant. */
const LEVER_LOC = {
    north: { down: 2421, up: 2422 },
    south: { down: 2423, up: 2424 },
    northRoom: { down: 2425, up: 2426 }
} as const;

type MineRegion = 'main' | 'south' | 'northRoom' | 'gold' | 'outside';

// Why: these are the four components the lever doors cut the mine into, from a flood over the baked collision pack with all four doors removed.
// Why: their z-ranges are disjoint and the gold room is the only thing east of x=2727, so a tile alone names the region.

/** Which of the mine's four lever-door regions a tile is in. */
export function mineRegion(tile: { x: number; z: number; level: number } | null | undefined): MineRegion {
    if (!tile || tile.level !== 0 || tile.x < 2688 || tile.x > 2751 || tile.z < 9664 || tile.z > 9727) {
        return 'outside';
    }
    if (tile.x >= 2728) {
        return 'gold';
    }
    if (tile.z <= 9671) {
        return 'south';
    }
    if (tile.z >= 9711) {
        return 'northRoom';
    }
    return 'main';
}

interface LeverSpot {
    /** The lever's own tile; the walker gets within one of it. */
    at: Tile;
    stand: Tile;
    ids: { down: number; up: number };
}

const LEVER: Record<'north' | 'south' | 'northRoom', LeverSpot> = {
    north: { at: new Tile(2722, 9710, 0), stand: new Tile(2722, 9709, 0), ids: LEVER_LOC.north },
    south: { at: new Tile(2724, 9669, 0), stand: new Tile(2723, 9670, 0), ids: LEVER_LOC.south },
    northRoom: { at: new Tile(2722, 9718, 0), stand: new Tile(2723, 9717, 0), ids: LEVER_LOC.northRoom }
};

interface DoorSpot {
    label: string;
    /** Stand tile on each side; opening teleports the player to the other. */
    sides: Record<string, { stand: Tile; to: MineRegion }>;
}

const DOOR = {
    /** N up, S down. */
    g2h1: {
        label: 'north-up/south-down door',
        sides: {
            main: { stand: new Tile(2722, 9672, 0), to: 'south' as MineRegion },
            south: { stand: new Tile(2722, 9671, 0), to: 'main' as MineRegion }
        }
    },
    /** N up, S up. */
    h2: {
        label: 'both-levers-up door',
        sides: {
            main: { stand: new Tile(2719, 9672, 0), to: 'south' as MineRegion },
            south: { stand: new Tile(2719, 9671, 0), to: 'main' as MineRegion }
        }
    },
    /** N down, S up. */
    h2g1: {
        label: 'north-down/south-up door',
        sides: {
            main: { stand: new Tile(2723, 9710, 0), to: 'northRoom' as MineRegion },
            northRoom: { stand: new Tile(2723, 9711, 0), to: 'main' as MineRegion }
        }
    },
    /**
     * N up, S down, north-room lever up — the gold room. The same combination
     * still holds on the way back out, so the far side is a normal crossing.
     */
    i2h1: {
        label: 'gold-room door',
        sides: {
            main: { stand: new Tile(2727, 9690, 0), to: 'gold' as MineRegion },
            gold: { stand: new Tile(2728, 9690, 0), to: 'main' as MineRegion }
        }
    }
} satisfies Record<string, DoorSpot>;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

// Why: the loc model is an unreliable read — `loc_change(..., 500)` reverts the lever to its down model after five minutes while leaving the varp bit set, so a lever that looks down may be up.
// Why: the chat line the pull emits is emitted when the bit changes, so it is the oracle.

/** Pull a lever until the server confirms the wanted state. */
async function setLever(
    key: 'north' | 'south' | 'northRoom',
    want: 'up' | 'down',
    log: (m: string) => void
): Promise<boolean> {
    const spot = LEVER[key];
    for (let attempt = 0; attempt < 4; attempt++) {
        await Sustain.run();
        if (!(await Traversal.walkResilient(spot.stand, { radius: 1, attempts: 4, timeoutMs: 90_000, log }))) {
            log(`could not reach the ${key} lever stand`);
            return false;
        }
        await settleScene();
        const lever = Locs.query()
            .where(l => l.id === spot.ids.down || l.id === spot.ids.up)
            .action('Pull')
            .within(3)
            .nearest();
        if (!lever) {
            log(`no ${key} lever in the scene at (${spot.at.x},${spot.at.z})`);
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await lever.interact('Pull'))) {
            continue;
        }
        const settled = await Execution.delayUntil(
            () => GameMessages.sawSince(mark, LEVER_UP) || GameMessages.sawSince(mark, LEVER_DOWN),
            6000
        );
        if (!settled) {
            continue;
        }
        const now = GameMessages.sawSince(mark, LEVER_UP) ? 'up' : 'down';
        log(`${key} lever is now ${now}`);
        if (now === want) {
            return true;
        }
    }
    log(`could not force the ${key} lever ${want}`);
    return false;
}

// Why: `open_and_close_door2` teleports the player through and shuts the door behind them, so the tell is the region change rather than the door's own state.
// Why: `'locked'` means the server refused because the lever combination is not the one this door wants, which the caller uses to re-plan.

/** Open one of the mine's doors and confirm the crossing. */
async function crossDoor(
    door: DoorSpot,
    from: MineRegion,
    log: (m: string) => void
): Promise<'crossed' | 'locked' | 'failed'> {
    const side = door.sides[from];
    if (!side) {
        return 'failed';
    }
    if (!(await Traversal.walkResilient(side.stand, { radius: 0, attempts: 4, timeoutMs: 90_000, log }))) {
        log(`could not reach the ${door.label} stand (${side.stand.x},${side.stand.z})`);
        return 'failed';
    }
    await settleScene();
    const shut = Locs.query().name('Door').action('Open').within(3).nearest();
    if (!shut) {
        log(`no ${door.label} in the scene`);
        return 'failed';
    }
    const mark = GameMessages.mark();
    if (!(await shut.interact('Open'))) {
        return 'failed';
    }
    await Execution.delayUntil(
        () => mineRegion(here()) === side.to || GameMessages.sawSince(mark, DOOR_LOCKED),
        6000
    );
    if (mineRegion(here()) === side.to) {
        log(`crossed the ${door.label} into ${side.to}`);
        return 'crossed';
    }
    if (GameMessages.sawSince(mark, DOOR_LOCKED)) {
        return 'locked';
    }
    return 'failed';
}

// Why: the plan is fixed, being the shortest chain a BFS over the collision pack found.
// Why: each leg is written so a restart anywhere in the mine converges — levers are set rather than read.
// Why: the only regions the bot can be stranded in are ones it can only have entered with the lever state that opens the way back.

/** Walk the levers-and-doors chain from wherever we are to the gold room. */
async function reachPerfectGold(log: (m: string) => void): Promise<boolean> {
    for (let pass = 0; pass < 3; pass++) {
        // Ogres line the lever route and hellhounds guard the rocks; a custom
        // step this long has to pump the eat hook itself.
        await Sustain.run();
        let region = mineRegion(here());
        if (region === 'gold') {
            return true;
        }
        if (region === 'outside') {
            log('not in the gold mine');
            return false;
        }

        // Recovery: the only way into these rooms is with the lever state that
        // opens the door back out, so a single attempt is enough.
        if (region === 'northRoom') {
            if ((await crossDoor(DOOR.h2g1, 'northRoom', log)) !== 'crossed') {
                return false;
            }
            region = 'main';
        }
        if (region === 'south') {
            const back = (await crossDoor(DOOR.g2h1, 'south', log)) === 'crossed'
                || (await crossDoor(DOOR.h2, 'south', log)) === 'crossed';
            if (!back) {
                return false;
            }
            region = 'main';
        }

        // Why: which of the two doors opens depends on the south lever, which cannot be seen from here, so trying both is what tells us where it stands.
        if (!(await setLever('north', 'up', log))) {
            return false;
        }
        let southLever: 'up' | 'down';
        if ((await crossDoor(DOOR.g2h1, 'main', log)) === 'crossed') {
            southLever = 'down';
        } else if ((await crossDoor(DOOR.h2, 'main', log)) === 'crossed') {
            southLever = 'up';
        } else {
            log('neither south door opened with the north lever up');
            return false;
        }
        log(`south lever was ${southLever}`);

        // 2. south lever up, back north through the both-up door.
        if (!(await setLever('south', 'up', log))) {
            return false;
        }
        if ((await crossDoor(DOOR.h2, 'south', log)) !== 'crossed') {
            return false;
        }

        // 3. north lever down opens the north room.
        if (!(await setLever('north', 'down', log))) {
            return false;
        }
        if ((await crossDoor(DOOR.h2g1, 'main', log)) !== 'crossed') {
            return false;
        }

        // 4. north-room lever up, and back out the way we came in.
        if (!(await setLever('northRoom', 'up', log))) {
            return false;
        }
        if ((await crossDoor(DOOR.h2g1, 'northRoom', log)) !== 'crossed') {
            return false;
        }

        // 5. north lever back up, south again, south lever down.
        if (!(await setLever('north', 'up', log))) {
            return false;
        }
        if ((await crossDoor(DOOR.h2, 'main', log)) !== 'crossed') {
            return false;
        }
        if (!(await setLever('south', 'down', log))) {
            return false;
        }
        if ((await crossDoor(DOOR.g2h1, 'south', log)) !== 'crossed') {
            return false;
        }

        // 6. north up, south down, north-room up — the gold-room door.
        if ((await crossDoor(DOOR.i2h1, 'main', log)) === 'crossed') {
            return true;
        }
        log('gold-room door refused — re-running the lever chain');
    }
    return false;
}

export async function enterGoldMine(log: (m: string) => void): Promise<boolean> {
    if (mineRegion(here()) !== 'outside') {
        return true;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-down',
        near: FC_LOC.MINE_LADDER,
        expect: () => mineRegion(here()) !== 'outside',
        log
    });
    if (status !== 'done') {
        return false;
    }
    await settleScene();
    return mineRegion(here()) !== 'outside';
}

export async function leaveGoldMine(log: (m: string) => void): Promise<boolean> {
    const region = mineRegion(here());
    if (region === 'outside') {
        return true;
    }
    if (region !== 'main') {
        log(`cannot climb out from the ${region} room — walking back to the ladder side first`);
        if (region === 'gold') {
            await crossDoor(DOOR.i2h1, 'gold', log);
        } else if (region === 'northRoom') {
            await crossDoor(DOOR.h2g1, 'northRoom', log);
        } else {
            // Which of the two south doors is open depends on the south lever,
            // which cannot be seen from here — try both, as the entry does.
            if ((await crossDoor(DOOR.g2h1, 'south', log)) !== 'crossed') {
                await crossDoor(DOOR.h2, 'south', log);
            }
        }
    }
    if (mineRegion(here()) !== 'main') {
        return false;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near: FC_LOC.MINE_LANDING,
        expect: () => mineRegion(here()) === 'outside',
        log
    });
    return status === 'done' && mineRegion(here()) === 'outside';
}

export const PERFECT_ORE_NEEDED = 2;

// Why: `inzone` tests the player's tile, so the stand matters as much as the rock — mining a boundary rock from outside the box hands out ordinary gold ore and the smelt downstream silently makes the wrong bar.

/** Mine perfect gold. */
export async function minePerfectGold(log: (m: string) => void): Promise<boolean> {
    if (heldId(FC_ID.PERFECT_GOLD_ORE) >= PERFECT_ORE_NEEDED) {
        return true;
    }
    if (mineRegion(here()) !== 'gold' && !(await reachPerfectGold(log))) {
        return false;
    }
    for (let attempt = 0; attempt < 30; attempt++) {
        await Sustain.run();
        if (heldId(FC_ID.PERFECT_GOLD_ORE) >= PERFECT_ORE_NEEDED) {
            return true;
        }
        if (!inPerfectGoldZone(here())
            && !(await Traversal.walkResilient(FC_LOC.GOLD_STAND, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
            log('could not stand inside the perfect-gold zone');
            return false;
        }
        await settleScene();
        const rock = Locs.query()
            .where(l => l.id === 2098 || l.id === 2099)
            .action('Mine')
            .within(6)
            .nearest();
        if (!rock) {
            await Execution.delayTicks(3);
            continue;
        }
        const before = heldId(FC_ID.PERFECT_GOLD_ORE);
        if (!(await rock.interact('Mine'))) {
            continue;
        }
        await Execution.delayUntil(() => heldId(FC_ID.PERFECT_GOLD_ORE) > before, 20_000);
    }
    return heldId(FC_ID.PERFECT_GOLD_ORE) >= PERFECT_ORE_NEEDED;
}

// Why: East Ardougne's furnace is closer to the mine, but the moulds are Dommik's and the jewellery goes to Avan, both in Al Kharid, so smelting at Ardougne would walk the same 600 tiles twice.
// Why: this is the south side, as `furnace1` is `forceapproach=east` and the east stand never routes.
export const FURNACE_STAND = new Tile(3272, 3183, 0);

async function atFurnace(log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(FURNACE_STAND, { radius: 2, attempts: 4, timeoutMs: 180_000, log });
}

// Why: using an ore on a furnace smelts one bar outright with no interface, and `perfect_gold_ore` carries `smeltsto=perfect_gold_bar`, so the ordinary gold-bar path never gets a chance to pick the wrong metal.

/** Smelt the perfect gold ore into bars. */
export async function smeltPerfectBars(log: (m: string) => void): Promise<boolean> {
    if (heldId(FC_ID.PERFECT_GOLD_ORE) === 0) {
        return heldId(FC_ID.PERFECT_GOLD_BAR) > 0;
    }
    if (!(await atFurnace(log))) {
        return false;
    }
    for (let attempt = 0; attempt < 8 && heldId(FC_ID.PERFECT_GOLD_ORE) > 0; attempt++) {
        await settleScene();
        const ore = Inventory.items().find(i => i.id === FC_ID.PERFECT_GOLD_ORE);
        const furnace = Locs.query().name('Furnace').within(10).nearest();
        if (!ore || !furnace) {
            log('no Furnace in reach of the Ardougne stand');
            return false;
        }
        const before = heldId(FC_ID.PERFECT_GOLD_BAR);
        if (!(await ore.useOn(furnace))) {
            continue;
        }
        await Execution.delayUntil(() => heldId(FC_ID.PERFECT_GOLD_BAR) > before, 12_000);
    }
    log(`smelted ${heldId(FC_ID.PERFECT_GOLD_BAR)}x ${FC_ITEM.PERFECT_GOLD_BAR}`);
    return heldId(FC_ID.PERFECT_GOLD_ORE) === 0;
}

// Why: the panel lists a placeholder object per gem, and each placeholder carries the live product's display name, so "Ruby ring" matches.
// Why: `crafting_gold` substitutes the perfect bar for the ordinary one whenever a perfect bar is held, which is why the ordinary ruby ring is the thing to click.

/** Craft the jewellery Avan asked for. */
export async function craftPerfectJewellery(log: (m: string) => void): Promise<boolean> {
    const wants: { product: string; id: number }[] = [
        { product: 'Ruby ring', id: FC_ID.PERFECT_RUBY_RING },
        { product: 'Ruby necklace', id: FC_ID.PERFECT_RUBY_NECKLACE }
    ];
    for (const want of wants) {
        if (heldId(want.id) > 0) {
            continue;
        }
        if (heldId(FC_ID.PERFECT_GOLD_BAR) === 0) {
            log(`no ${FC_ITEM.PERFECT_GOLD_BAR} left to make the ${want.product}`);
            return false;
        }
        if (Inventory.countById(FC_ID.RUBY) === 0) {
            log(`no ${FC_ITEM.RUBY} left to set into the ${want.product}`);
            return false;
        }
        if (!(await atFurnace(log))) {
            return false;
        }
        await settleScene();
        const bar = Inventory.items().find(i => i.id === FC_ID.PERFECT_GOLD_BAR);
        const furnace = Locs.query().name('Furnace').within(10).nearest();
        if (!bar || !furnace) {
            log('no Furnace in reach of the Ardougne stand');
            return false;
        }
        if (!(await bar.useOn(furnace))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 8000))) {
            log('the gold-crafting panel did not open — are both moulds in the pack?');
            return false;
        }
        if (!(await ChatDialog.makeFromPanel(want.product, 'Make'))) {
            log(`'${want.product}' is not on the panel — products: [${ChatDialog.mainMakeProducts().join(', ')}]`);
            return false;
        }
        if (!(await Execution.delayUntil(() => heldId(want.id) > 0, 12_000))) {
            log(`making the ${want.product} did not produce a perfect one`);
            return false;
        }
        log(`made the perfect ${want.product.toLowerCase()}`);
    }
    return heldId(FC_ID.PERFECT_RUBY_RING) > 0 && heldId(FC_ID.PERFECT_RUBY_NECKLACE) > 0;
}
