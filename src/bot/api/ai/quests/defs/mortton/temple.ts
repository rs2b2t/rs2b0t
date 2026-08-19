import { reader } from '../../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { isTempleWall, SM_ID, SM_LOC, SM_LOC_ID, SM_TILE, SM_VARP } from './areas.js';
import { permSerumVialId, serumVialId } from './supplies.js';

const REPAIR = 'Repair';
const REINFORCE = 'Reinforce';
const WALL_RADIUS = 8;
const EAT_AT_MISSING = 12;
/** Ticks one visit to the temple is given before the step reports back. */
const BUILD_GUARD = 3000;
/** Consecutive idle ticks that mean the server-side build loop has stopped. */
const IDLE_TO_RECLICK = 3;
// Why: the leg builds sanctity before it strikes, and climbing from a cold start to the target is about two hundred ticks on its own — a budget that only covers the climb spends itself and reports a flame that never caught.
/** Ticks the sanctity climb and the altar's own three-tick firemaking loop share. */
const LIGHT_GUARD = 500;
const OUT_OF_RESOURCES = /material resource pool/i;

export const templeRepaired = (): number => reader.varp(SM_VARP.TEMPLE_REPAIRED);
export const templeResources = (): number => reader.varp(SM_VARP.TEMPLE_RESOURCES);
export const templeSanctity = (): number => reader.varp(SM_VARP.TEMPLE_SANCTITY);

/** Sanctity the altar needs before it will light or sanctify oil. */
export const SANCTITY_TO_LIGHT = 10;
/** Sanctity the flame needs before it will make the serum permanent. */
export const SANCTITY_TO_SANCTIFY_SERUM = 20;
// Why: the walls are world state and stay rebuilt for 9000 ticks, so a bot can arrive at a finished temple with none of its own sanctity — which the altar wants, and which only its own building earns.
/** Sanctity the light leg builds toward, leaving room for the oil and the serum to spend some. */
const SANCTITY_TARGET = 25;

// Why: carried material is not pool — it only becomes points on a successful build tick, so "the pool reads zero" is not "there is nothing left to build with".
/** Sets of plank, brick and five paste in the pack. */
export function materialSets(): number {
    return Math.min(
        Inventory.countById(SM_ID.PLANK),
        Inventory.countById(SM_ID.LIMESTONE_BRICK),
        Math.floor(Inventory.countById(SM_ID.SWAMP_PASTE) / 5)
    );
}

const wallOffering = (op: string): Loc | null =>
    Locs.query().where(l => isTempleWall(l.id)).action(op).within(WALL_RADIUS).nearest();

const wallAt = (tile: { x: number; z: number }): Loc | null =>
    Locs.query()
        .where(l => isTempleWall(l.id) && l.tile().x === tile.x && l.tile().z === tile.z)
        .within(WALL_RADIUS)
        .nearest();

const altar = (id: number, op?: string): Loc | null => {
    const query = Locs.query().where(l => l.id === id).within(WALL_RADIUS);
    return (op === undefined ? query : query.action(op)).nearest();
};

export const altarUnlit = (): Loc | null => altar(SM_LOC_ID.ALTAR_UNLIT, 'Light');
export const altarLit = (): Loc | null => altar(SM_LOC_ID.ALTAR_LIT);

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

// Why: the temple refuses in `~mesbox`, which is `if_openchat` and ends in `p_pausebutton` — it is not a main modal, and the paused script holds the player until it is answered.

/** Whatever box is up, and what it said. */
function boxText(): string | null {
    if (reader.modals().chat === -1 && reader.modals().main === -1) {
        return null;
    }
    return [...reader.chatModalTexts(), ...reader.mainModalTexts()].join(' ');
}

/** Answer the open box, whichever kind it is. */
async function clearBox(): Promise<void> {
    if (ChatDialog.canContinue()) {
        await ChatDialog.continue();
        return;
    }
    await Modals.closeIfOpen();
}

async function standInside(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && SM_TILE.TEMPLE_INSIDE.distanceTo(here) <= 2) {
        return true;
    }
    if (!(await Traversal.walkResilient(SM_TILE.TEMPLE_INSIDE, { radius: 2, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    return true;
}

// Why: one click on a wall starts a server-side `p_oploc(3)` loop that keeps building on its own, so the bot re-clicks only once that loop has stopped.
// Why: that loop never leaves the loc it was started on, and a wall at level 10 has no next stage — left alone it drains the resource pool into a wall that is already finished, which is what held the temple at one repaired wall for four thousand points.
// Why: so the target is followed by tile, and dropped the moment it stops offering Repair.

/** Build the temple shell until the fire altar appears. */
export async function repairTemple(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SM_ID.HAMMER) === 0) {
        log('no hammer in the pack — the temple refuses every repair');
        return false;
    }
    if (!(await standInside(log))) {
        return false;
    }
    Game.setAutoRetaliate(true);
    let idle = 0;
    let lastTick = -1;
    let reported = -1;
    let target: { x: number; z: number } | null = null;
    // Why: the walls are world state, so a temple another run left finished reads 100% before this character has built anything — and it is a build tick, not the reading, that moves `%morttonquest` on.
    let built = false;
    let lastSanctity = templeSanctity();
    let lastPool = templeResources();
    for (let i = 0; i < BUILD_GUARD; i++) {
        if (EventSignal.pending()) {
            log('yielding to a random event mid-build');
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        built = built || templeSanctity() > lastSanctity || templeResources() < lastPool;
        lastSanctity = templeSanctity();
        lastPool = templeResources();
        if (built && templeRepaired() >= 100 && altarUnlit() !== null) {
            log(`temple rebuilt — sanctity ${templeSanctity()}%, pool ${templeResources()}%`);
            return true;
        }
        const box = boxText();
        if (box !== null) {
            const dry = OUT_OF_RESOURCES.test(box);
            await clearBox();
            if (dry) {
                // The refusal comes as two boxes; leave neither on the screen.
                await Execution.delayTicks(1);
                await clearBox();
                log(`out of building materials at ${templeRepaired()}% repaired, pool ${templeResources()}%`);
                return false;
            }
            idle = 0;
            continue;
        }
        if (hungry()) {
            await Sustain.run();
            idle = 0;
            continue;
        }
        if (now - reported >= 100) {
            reported = now;
            log(`building: repaired ${templeRepaired()}% pool ${templeResources()}% sanctity ${templeSanctity()}%`
                + ` bricks ${Inventory.countById(SM_ID.LIMESTONE_BRICK)} planks ${Inventory.countById(SM_ID.PLANK)}`
                + ` paste ${Inventory.countById(SM_ID.SWAMP_PASTE)}`);
        }
        // Why: Reinforce is only worth staying on when every piece is finished and the loop is holding the overlay open until the stage flips.
        const anyRepair = wallOffering(REPAIR);
        const held = target === null ? null : wallAt(target);
        const heldOp = held === null ? null
            : held.actions().includes(REPAIR) ? REPAIR
                : anyRepair === null && held.actions().includes(REINFORCE) ? REINFORCE
                    : null;
        if (held !== null && heldOp !== null) {
            if (Game.inCombat() || Game.animating()) {
                idle = 0;
                continue;
            }
            if (++idle < IDLE_TO_RECLICK) {
                continue;
            }
            idle = 0;
            await held.interact(heldOp);
            await Execution.delayTicks(2);
            continue;
        }
        // The target is finished, or there never was one: move to whatever still wants work.
        const wall = anyRepair ?? wallOffering(REINFORCE);
        if (!wall) {
            if (!(await standInside(log))) {
                return false;
            }
            continue;
        }
        idle = 0;
        target = { x: wall.tile().x, z: wall.tile().z };
        await wall.interact(anyRepair === null ? REINFORCE : REPAIR);
        await Execution.delayTicks(2);
    }
    log(`build guard hit at ${templeRepaired()}% repaired`);
    return templeRepaired() >= 100;
}

// Why: lighting is its own 3-tick server loop with a firemaking roll, so one click is enough and the wait is on the loc changing type.
// Why: the altar is `loc_change(templefire_altar_nofire, 99)` — a build tick arms it and it reverts 99 ticks later, so any errand between the rebuild and the strike comes back to a broken altar that only more building brings back.

/** Strike the rebuilt altar until the sacred flame catches, re-arming it when it has gone cold. */
export async function lightAltar(log: (m: string) => void): Promise<boolean> {
    if (altarLit() !== null) {
        return true;
    }
    if (Inventory.countById(SM_ID.TINDERBOX) === 0) {
        log('no tinderbox in the pack — the altar cannot be lit');
        return false;
    }
    if (!(await standInside(log))) {
        return false;
    }
    let lastTick = -1;
    let reported = -1;
    for (let i = 0; i < LIGHT_GUARD; i++) {
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        if (altarLit() !== null) {
            await clearBox();
            return true;
        }
        // The refusals are `~mesbox`, so the loop answers boxes rather than sitting behind them.
        if (boxText() !== null) {
            await clearBox();
            continue;
        }
        if (now - reported >= 100) {
            reported = now;
            log(`lighting: sanctity ${templeSanctity()}% pool ${templeResources()}%`);
        }
        // A cold altar means the arming timer ran out, and low sanctity means this character has not built enough of the temple itself; a build tick answers both.
        const dry = templeResources() === 0 && materialSets() === 0;
        const sanctity = templeSanctity();
        const ready = sanctity >= SANCTITY_TARGET || (sanctity >= SANCTITY_TO_LIGHT && dry);
        const cold = ready ? altarUnlit() : null;
        // Why: the wall's own build loop animates the player without pause, so gating the strike on "not animating" never fires it — only the build re-click waits for a quiet tick.
        if (cold) {
            await cold.interact('Light');
            await Execution.delayTicks(2);
            continue;
        }
        if (dry && sanctity < SANCTITY_TO_LIGHT) {
            log(`sanctity is ${sanctity}% with an empty pool — the altar wants ${SANCTITY_TO_LIGHT}%`);
            return false;
        }
        if (Game.animating() || Game.inCombat()) {
            continue;
        }
        // Why: Repair first — shades knock the shell back down while the bot is away, and only a rebuilt shell arms the altar at all.
        const wall = wallOffering(REPAIR) ?? wallOffering(REINFORCE);
        if (!wall) {
            log('the altar is broken and no wall is in reach to re-arm it');
            return false;
        }
        await wall.interact(wall.actions().includes(REPAIR) ? REPAIR : REINFORCE);
        await Execution.delayTicks(2);
    }
    await clearBox();
    log('the sacred flame never caught');
    return false;
}

/** Put a vial of olive oil into the sacred flame. */
export async function sanctifyOil(log: (m: string) => void): Promise<boolean> {
    const oil = [SM_ID.OLIVE_OIL4, SM_ID.OLIVE_OIL3, SM_ID.OLIVE_OIL2]
        .find(id => Inventory.countById(id) > 0);
    if (oil === undefined) {
        log('no olive oil of two doses or more in the pack');
        return false;
    }
    const before = sacredOilDoses();
    return useOnLoc(
        oil,
        { name: SM_LOC.ALTAR_LIT, near: SM_TILE.TEMPLE_INSIDE, id: SM_LOC_ID.ALTAR_LIT, within: WALL_RADIUS },
        [],
        () => sacredOilDoses() > before,
        log
    );
}

export function sacredOilDoses(): number {
    return Inventory.countById(SM_ID.SACRED_OIL4) * 4
        + Inventory.countById(SM_ID.SACRED_OIL3) * 3
        + Inventory.countById(SM_ID.SACRED_OIL2) * 2
        + Inventory.countById(SM_ID.SACRED_OIL1);
}

// Why: sanctifying converts every dose in the vial at no cost, and one dose of the result sets a villager's permanent bit, so the endgame conversation never needs another serum.

/** Turn a vial of serum 207 into serum 207(p) in the sacred flame. */
export async function sanctifySerum(log: (m: string) => void): Promise<boolean> {
    if (permSerumVialId() !== null) {
        return true;
    }
    const vial = serumVialId();
    if (vial === null) {
        log('no serum 207 left to sanctify');
        return false;
    }
    if (templeSanctity() < SANCTITY_TO_SANCTIFY_SERUM) {
        log(`sanctity is ${templeSanctity()}% — the flame wants ${SANCTITY_TO_SANCTIFY_SERUM}% for the serum`);
        return false;
    }
    return useOnLoc(
        vial,
        { name: SM_LOC.ALTAR_LIT, near: SM_TILE.TEMPLE_INSIDE, id: SM_LOC_ID.ALTAR_LIT, within: WALL_RADIUS },
        [],
        () => permSerumVialId() !== null,
        log
    );
}
