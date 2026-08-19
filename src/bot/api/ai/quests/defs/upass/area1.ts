import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Locs } from '../../../../locs/Locs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { driveDialog } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { UP_ITEM, UP_LOC, UP_ORBS, UP_TILE, countHeld, type UpassItem } from './areas.js';
import { locById } from './bridge.js';
import { stalledJourney, type Stone } from './stall.js';

/** Where each orb of light is, and how it is taken. */
export const ORB_SITES: readonly { orb: UpassItem; tile: Tile; fromTrap: boolean }[] = [
    { orb: UP_ITEM.ORB1, tile: UP_TILE.LOGTRAP, fromTrap: true },
    { orb: UP_ITEM.ORB2, tile: UP_TILE.ORB2, fromTrap: false },
    { orb: UP_ITEM.ORB3, tile: UP_TILE.ORB3, fromTrap: false },
    { orb: UP_ITEM.ORB4, tile: UP_TILE.ORB4, fromTrap: false }
];

/** How many orbs the snapshot's pack holds. */
export function orbsHeld(snap: QuestSnapshot): number {
    return countHeld(snap, UP_ORBS);
}

// Why: `[timer,upass_trap]` is set to one tick across map squares 0_37_151 and 0_38_151 and hits for `hp/10 + 1` on a spear and `base_hp*8/100 + 1` on a spring whenever the player ends a tick on one. Routing round them is not open: a probe of every corridor route against the twenty trap tiles shows each tile alone severs one — the corridor is a single tile wide at every trap. So the corridor is crossed the same way as the spiked grid, on an op-click with the quest journal held open, which suspends the timer. Nothing may be a plain walk down here: `MoveClickHandler` clears the modal on any move that is not an op-click, and the walker re-clicks every few tiles.

// Why: an op-click can only name what the client already holds in its build area, and that area lags the player by up to two zones — a target forty tiles off reads as absent and the click never sends. So the corridor is walked over stepping stones: the traps' own `Search` and the two stone tablets, which are the only ops down here and happen to sit at every chokepoint. Standing on a trap costs nothing while the journal is up, so the journey holds it from the first leg to the last.
const STONES: readonly { id: number; op: string }[] = [
    { id: UP_LOC.SPEARTRAP, op: 'Search' },
    { id: UP_LOC.SPRINGTRAP, op: 'Search' },
    { id: UP_LOC.LOGTRAP_TRIGGER, op: 'Search' },
    { id: UP_LOC.TABLET_EAST, op: 'Read' },
    { id: UP_LOC.TABLET_WEST, op: 'Read' }
];

/** How near a stepping stone's target must bring the player before the leg is worth taking. */
const STONE_GAIN = 3;
const STONE_SEARCH = 40;

function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function near(tile: Tile, radius: number): boolean {
    const now = Game.tile();
    return now !== null && cheb(now, tile) <= radius;
}

function stoneToward(dest: Tile, spent: Set<string>, log: (m: string) => void): Stone | null {
    const from = Game.tile();
    if (!from) {
        return null;
    }
    const mine = cheb(from, dest);
    const reachable = STONES.flatMap(stone =>
        Locs.query()
            .where(loc => loc.id === stone.id)
            .action(stone.op)
            .within(STONE_SEARCH)
            .results()
            .map(loc => ({ loc, op: stone.op }))
    )
        .filter(({ loc }) => cheb(loc.tile(), dest) + STONE_GAIN <= mine)
        .filter(({ loc }) => !spent.has(`${loc.tile().x},${loc.tile().z}`))
        .sort((a, b) => cheb(a.loc.tile(), dest) - cheb(b.loc.tile(), dest));
    const pick = reachable[0];
    if (!pick) {
        return null;
    }
    const at = pick.loc.tile();
    spent.add(`${at.x},${at.z}`);
    log(`stall: stepping to ${pick.loc.name ?? pick.loc.id} at (${at.x},${at.z})`);
    return {
        send: async () => pick.loc.interact(pick.op),
        arrived: () => near(at, 1),
        what: `${pick.loc.name ?? pick.loc.id} at (${at.x},${at.z})`
    };
}

/** Reach `dest` and do its op-click, stepping over the traps with the journal held open throughout. */
async function corridorHop(
    dest: Tile,
    what: string,
    inRange: () => boolean,
    send: () => Promise<boolean>,
    arrived: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (arrived()) {
        return true;
    }
    await settleScene();
    const spent = new Set<string>();
    return stalledJourney({
        goal: { send, arrived, what, inRange },
        nextStone: () => stoneToward(dest, spent, log),
        log
    });
}

// Why: the disarm is a `stat_random(thieving, 160, 300)` roll and a failed one springs the log — a stun, a forced move and damage — so it is retried inside the step rather than once per decide cycle, which would walk back across the corridor between every roll.
const DISARM_ATTEMPTS = 5;

/** The hanging-log trap yields the first orb when it is disarmed rather than sprung. */
export async function takeTrappedOrb(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.ORB1.id) > 0) {
        return true;
    }
    const findTrigger = () => locById(UP_LOC.LOGTRAP_TRIGGER, null, STONE_SEARCH);
    const arrived = await corridorHop(
        UP_TILE.LOGTRAP,
        'the hanging-log trigger',
        () => findTrigger() !== null,
        async () => {
            const trigger = findTrigger();
            const op = trigger?.actions()[0];
            return trigger !== null && op !== undefined && trigger.interact(op);
        },
        () => near(UP_TILE.LOGTRAP, 1),
        log
    );
    if (!arrived) {
        // Why: the trigger is deleted for fifty ticks once its orb is taken, so absent while standing on
        // top of it means burned — absent from across the corridor only means out of the build area.
        if (near(UP_TILE.LOGTRAP, 8) && findTrigger() === null) {
            log('no hanging-log trigger rock at the orb — already burned');
            return true;
        }
        return false;
    }
    // Why: springing the log blows the player five tiles west and no further, which is clear of every trap
    // tile — so the retries stay local and never pay another corridor crossing.
    for (let attempt = 0; attempt < DISARM_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            const trigger = findTrigger();
            const op = trigger?.actions()[0];
            if (!trigger || !op || !(await trigger.interact(op))) {
                log('the log trap trigger stopped answering');
                return false;
            }
        }
        // Why: the trap opens with `~mesbox`, which is a MAIN modal, not a chat line — `driveDialog` cannot dismiss one and waits out its timeout, so the "do you want to disarm it?" choice underneath is never answered and the disarm never runs. The modal is closed first, then the choice is driven.
        const mark = GameMessages.mark();
        await Modals.closeIfOpen();
        await driveDialog(["Yes, I'll give it a go"], log);
        if (await driveUntil(() => heldId(UP_ITEM.ORB1.id) > 0, [], log, 12_000)) {
            return true;
        }
        // Why: the trap keeps its orb once that orb's bit is set, and answers "you hear it resetting" instead — the only way to tell "already burned" from "the roll failed", since the bit is not on the wire and the trap respawns fifty ticks after it is taken.
        if (GameMessages.sawSince(mark, /resetting/i)) {
            log('the log trap has already given up its orb');
            return true;
        }
        log(`the log trap sprang on attempt ${attempt + 1}`);
        await Execution.delayTicks(3);
    }
    return false;
}

// Why: nothing records which orbs are already dark — the varp is untransmitted and the journal only says "after destroying four orbs" once the well has been used. An orb that is neither in the pack nor on its own floor tile has therefore already gone into the furnace, and the sweep steps past it.
export async function takeGroundOrb(orb: UpassItem, tile: Tile, log: (m: string) => void): Promise<boolean> {
    if (heldId(orb.id) > 0) {
        return true;
    }
    // Why: all four orbs display as "Orb of light", so the ground pile is matched on the exact id.
    const findDrop = () => GroundItems.query().where(item => item.id === orb.id).within(STONE_SEARCH).nearest();
    const took = await corridorHop(
        tile,
        `the Orb of light at (${tile.x},${tile.z})`,
        () => findDrop() !== null,
        async () => {
            const drop = findDrop();
            return drop !== null && drop.interact('Take');
        },
        () => heldId(orb.id) > 0,
        log
    );
    if (took) {
        return true;
    }
    // Why: an orb absent from its own floor tile has already gone into the furnace — absent from across
    // the corridor only means the client has not loaded that far.
    if (near(tile, 8) && findDrop() === null) {
        log(`no Orb of light on the floor at (${tile.x},${tile.z}) — already burned`);
        return true;
    }
    return false;
}

// Why: `destroy_orboflight` is four ticks of messages before the orb leaves the pack, so a one-tick gap between uses fires the next one into a script still running and the loop drops out after a single orb.
// Why: the first orb doubles as the trip — using it on the furnace from across the corridor is an op-click, so the walk stalls, and the rest are thrown once the player is already standing there.

/** Every orb in the pack, thrown into the furnace one at a time. */
export async function burnOrbs(log: (m: string) => void): Promise<boolean> {
    const held = () => UP_ORBS.filter(orb => heldId(orb.id) > 0);
    const before = held().length;
    if (before === 0) {
        return true;
    }
    for (let pass = 0; pass < 3 && held().length > 0; pass++) {
        for (const orb of held()) {
            const findFurnace = () =>
                Locs.query().where(loc => loc.id === UP_LOC.FURNACE).within(STONE_SEARCH).nearest();
            const gone = await corridorHop(
                UP_TILE.FURNACE,
                `the ${orb.name} on the furnace`,
                () => findFurnace() !== null,
                async () => {
                    const furnace = findFurnace();
                    const item = Inventory.items().find(inv => inv.id === orb.id);
                    return furnace !== null && item !== undefined && item.useOn(furnace);
                },
                () => heldId(orb.id) === 0,
                log
            );
            if (!gone) {
                log(`the furnace would not take orb ${orb.id} on pass ${pass + 1}`);
            }
            await Execution.delayTicks(4);
        }
    }
    const left = held().length;
    log(`burned ${before - left} orb(s) in the furnace, ${left} still lit`);
    return left === 0;
}

// Why: which orbs are already dark is not answerable from a snapshot — the bit is not on the wire, a burned orb has left the pack, and both the trap and the ground spawns refuse a second one silently. So the sweep is one step from end to end that keeps its own tally, rather than one site per decide cycle re-picking the orb it has burned. The well at the end is the oracle: it descends only once all four are dark.

/** Take every orb the pack can hold, then burn the lot in one trip, then climb the well. */
export async function sweepOrbs(log: (m: string) => void): Promise<boolean> {
    for (const site of ORB_SITES) {
        const took = site.fromTrap
            ? await takeTrappedOrb(log)
            : await takeGroundOrb(site.orb, site.tile, log);
        if (!took) {
            log(`could not settle the orb at (${site.tile.x},${site.tile.z})`);
            return false;
        }
        // Why: two runs died mid-sweep with no sign of it in the log — the corridor traps are the only
        // damage source down here, so the sweep says what it has left after each site.
        log(`orb sweep: ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp, ${Inventory.free()} free`);
        // Why: a full pack cannot take the next orb, so the furnace trip happens early rather than losing one.
        if (Inventory.free() === 0 && !(await burnOrbs(log))) {
            return false;
        }
    }
    if (!(await burnOrbs(log))) {
        return false;
    }
    return enterWell(log);
}

/** The well only takes the player down once all four orbs are dark. */
export async function enterWell(log: (m: string) => void): Promise<boolean> {
    const down = () => (Game.tile()?.z ?? 9999) < 9664;
    const findWell = () => locById(UP_LOC.WELL, null, STONE_SEARCH);
    const climbed = await corridorHop(
        UP_TILE.WELL,
        'the well',
        () => findWell() !== null,
        async () => {
            const well = findWell();
            const op = well?.actions()[0];
            return well !== null && op !== undefined && well.interact(op);
        },
        down,
        log
    );
    // Why: `cave_well` runs three zero-tick delays before the teleport, so the descent can land a tick after
    // the journey has given up — reporting the timeout as "an orb is still lit" was a lie on a passing run.
    if (climbed || (await Execution.delayUntilTicks(down, 6))) {
        return true;
    }
    log(findWell() === null
        ? 'never got within sight of the well at the west end of the first cavern'
        : 'the well blasted the player back out — an orb is still lit');
    return false;
}
