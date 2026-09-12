import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { RG_ITEM, RG_LOC, RG_NPC, RG_SULPHUR_LOCS, RG_TILE } from './areas.js';
import { RG_STAGE } from './journal.js';
import { walkTo } from './isafdar.js';

const GRIND_MS = 12_000;

// Why: `reachRectangle` requires a cardinal side; nearest otherwise ties the usable seep with an unreachable diagonal one.
// @see docs/decisions/quest-pitfalls-30.md
function reachableLoc(locIds: readonly number[]): Loc | null {
    const here = Game.tile();
    const found = Locs.query().where(loc => locIds.includes(loc.id)).within(10).results();
    if (here === null) {
        return found[0] ?? null;
    }
    const manhattan = (loc: Loc): number => Math.abs(loc.tile().x - here.x) + Math.abs(loc.tile().z - here.z);
    return found.slice().sort((a, b) => manhattan(a) - manhattan(b))[0] ?? null;
}

async function useHeldOnLoc(itemId: number, locIds: readonly number[], expect: () => boolean, log: (m: string) => void): Promise<boolean> {
    await settleScene();
    const target = reachableLoc(locIds);
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!target || !item) {
        log(`nothing to use ${itemId} on within reach`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await item.useOn(target))) {
        return false;
    }
    if (await driveUntil(expect, [], log, GRIND_MS)) {
        return true;
    }
    // Why: "I can't reach that!" is the server saying the pair is wrong, so swallowing it makes a reach failure read as a recipe that did nothing.
    const said = GameMessages.since(mark).map(m => m.text).slice(-2).join(' / ');
    const at = target.tile();
    const me = Game.tile();
    log(`using ${itemId} on ${target.id}@(${at.x},${at.z}) from (${me?.x},${me?.z}) changed nothing${said ? ` — it said: ${said}` : ''}`);
    return false;
}

/** An empty barrel off the floor of the elf camp. */
export async function takeBarrel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.BARREL_SPAWN, 6, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.BARREL.id);
    const barrel = GroundItems.query().where(item => item.id === RG_ITEM.BARREL.id).within(14).nearest();
    if (!barrel) {
        log('no barrel on the floor of the elf camp');
        return false;
    }
    if (!(await barrel.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.BARREL.id) > before, 10_000);
}

/** A pot off the floor of the elf camp; the quicklime dust needs somewhere to go. */
export async function takePot(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.POT_SPAWN, 4, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.POT.id);
    const pot = GroundItems.query().where(item => item.id === RG_ITEM.POT.id).within(12).nearest();
    if (!pot || !(await pot.interact('Take'))) {
        log('no pot on the floor of the elf camp');
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.POT.id) > before, 10_000);
}

// Why: `[oplocu,regicide_loom]` consumes four wool at once and rejects smaller amounts.

/** 4 balls of wool woven into the strip of cloth that becomes the fuse. */
export async function weaveCloth(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.LOOM, 2, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    return useHeldOnLoc(RG_ITEM.BALL_OF_WOOL.id, [RG_LOC.LOOM], () => heldId(RG_ITEM.CLOTH.id) > 0, log);
}

/** The barrel filled from the coal-tar seep in the southern swamp. */
export async function fillTar(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.TAR, 3, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    const before = heldId(RG_ITEM.BARREL_TAR.id);
    return useHeldOnLoc(RG_ITEM.BARREL.id, [RG_LOC.TAR], () => heldId(RG_ITEM.BARREL_TAR.id) > before, log);
}

/** A lump broken off one of the sulphur formations beside the swamp. */
export async function takeSulphur(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.SULPHUR, 4, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.SULPHUR.id);
    const rock = Locs.query().where(loc => RG_SULPHUR_LOCS.includes(loc.id)).action('Take').within(12).nearest();
    if (!rock || !(await rock.interact('Take'))) {
        log('no sulphur formation within reach of the swamp');
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.SULPHUR.id) > before, 10_000);
}

// Why: `[opheldu,regicide_sulphar]` and `[opheldu,regicide_quicklime]` are declared on the lump, so the pestle is the item used and the lump the target. The client can't tell which way round a pair was declared, so a refusal sends the other direction.

async function grind(fromId: number, toId: number, log: (m: string) => void): Promise<boolean> {
    const pestle = Inventory.items().find(item => item.id === RG_ITEM.PESTLE.id);
    const lump = Inventory.items().find(item => item.id === fromId);
    if (!pestle || !lump) {
        log(`missing ${pestle ? 'the lump' : 'the pestle and mortar'} to grind ${fromId}`);
        return false;
    }
    const before = heldId(toId);
    for (const [used, target] of [[pestle, lump], [lump, pestle]] as const) {
        if (!(await used.useOn(target))) {
            continue;
        }
        if (await driveUntil(() => heldId(toId) > before, [], log, GRIND_MS)) {
            return true;
        }
    }
    return false;
}

export function grindSulphur(log: (m: string) => void): Promise<boolean> {
    return grind(RG_ITEM.SULPHUR.id, RG_ITEM.SULPHUR_DUST.id, log);
}

export function grindQuicklime(log: (m: string) => void): Promise<boolean> {
    return grind(RG_ITEM.QUICKLIME.id, RG_ITEM.QUICKLIME_DUST.id, log);
}

// Why: `regicide_heat_quicklime` goes through the generic `use_furnace` switch, so any furnace does. The camp's is 6 crossings deeper into the forest and 6 back, and East Ardougne's is 60 tiles from the bank the run passes anyway.
// Why: it costs 8 damage without gloves (`inv_totalcat(worn, armour_hands)`), which the food float covers.

/** Limestone burned to quicklime at the East Ardougne furnace. */
export async function heatQuicklime(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_FURNACE, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const before = heldId(RG_ITEM.QUICKLIME.id);
    return useHeldOnLoc(
        RG_ITEM.LIMESTONE.id,
        [RG_LOC.FURNACE, RG_LOC.FURNACE_MAIN, RG_LOC.FURNACE_SIDE],
        () => heldId(RG_ITEM.QUICKLIME.id) > before,
        log
    );
}

function rabbitNear(): Npc | null {
    return Npcs.query()
        .where(npc => npc.id === RG_NPC.RABBIT || npc.id === 1193 || npc.id === 1194)
        .action('Attack')
        .within(14)
        .nearest();
}

/** How long the rabbit gets before the decide cycle takes its turn back. */
const RABBIT_MS = 45_000;
/** How long one attack is left to run before it is renewed. */
const RABBIT_RENEW_MS = 4_000;

function rabbitMeat(): GroundItem | null {
    return GroundItems.query().where(item => item.id === RG_ITEM.RAW_RABBIT.id).within(12).nearest();
}

// Why: the meat never enters the pack. `[ai_queue3,_rabbit]` is `obj_add(npc_coord, raw_rabbit, 1, ...)`, which drops it on the floor under the rabbit, gated on `npc_findhero`, so waiting on the pack waits for something that can't happen.
// Why: one `Attack` click isn't enough either: the rabbit has `wanderrange=5` and 5 hitpoints, so it walks out of the interaction as often as it dies in it, and the attack is renewed until the meat is on the ground.

/** A rabbit out of the forest, for the guard who cannot catch one himself. */
export async function catchRabbit(log: (m: string) => void): Promise<boolean> {
    if (heldId(RG_ITEM.RAW_RABBIT.id) > 0) {
        return true;
    }
    if (rabbitMeat() !== null) {
        return takeRabbitCorpse(log);
    }
    if (!rabbitNear() && !(await walkTo(RG_TILE.RABBITS, 5, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const deadline = performance.now() + RABBIT_MS;
    let renewAt = 0;
    let sent = 0;
    while (performance.now() < deadline) {
        if (rabbitMeat() !== null) {
            return takeRabbitCorpse(log);
        }
        const rabbit = rabbitNear();
        if (!rabbit) {
            log(`no rabbit within 14 of (${Game.tile()?.x},${Game.tile()?.z}) after ${sent} attack(s) — they wander five tiles and respawn on a fifty-tick timer`);
            return false;
        }
        if (performance.now() >= renewAt) {
            if (!(await rabbit.interact('Attack'))) {
                return false;
            }
            sent++;
            renewAt = performance.now() + RABBIT_RENEW_MS;
        }
        await Execution.delayTicks(1);
    }
    log(`the rabbit outlasted ${Math.round(RABBIT_MS / 1000)}s and ${sent} attack(s) with no meat on the ground`);
    return false;
}

async function takeRabbitCorpse(log: (m: string) => void): Promise<boolean> {
    const meat = rabbitMeat();
    if (!meat) {
        log('no raw rabbit on the forest floor to pick up');
        return false;
    }
    if (!(await meat.interact('Take'))) {
        return false;
    }
    log('picked the rabbit up off the forest floor');
    return Execution.delayUntil(() => heldId(RG_ITEM.RAW_RABBIT.id) > 0, 8_000);
}

/** Cooked on the range beside the Ardougne bank, on the way through to the still. */
export async function cookRabbit(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_BANK, { radius: 12, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_RANGE, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const before = heldId(RG_ITEM.COOKED_RABBIT.id);
    return useHeldOnLoc(RG_ITEM.RAW_RABBIT.id, [RANGE_LOC], () => heldId(RG_ITEM.COOKED_RABBIT.id) > before, log);
}

/** The plain `range` loc; the nearest to the bank is a dozen tiles from it. */
const RANGE_LOC = 2728;

// The fractionalising still

// Why: `%regicide_still_total` and `%regicide_still_settings` are the 2 varps in this quest with `transmit=yes`, so the still is the one part the bot reads directly. `%temp` isn't among them, so the control law reads the heat needle.

// Why: resolved by the label the client puts in its own menu. The packed ids in `interface.pack` are the server's, and pressing one the client disagrees with is silent: `com_130` sent 600 times and the pressure valve never moved off bit 26.
const STILL_LABELS = {
    valveShut: 'Turn pressure valve down',
    valveOpen: 'Turn pressure valve up',
    regulatorDown: 'Turn tar flow valve down',
    regulatorUp: 'Turn tar valve up',
    coal: 'Click this to add coal.',
    close: 'Close'
} as const;

type StillButton = keyof typeof STILL_LABELS;

/** `regicide_still`, the interface the tar barrel opens. */
const STILL_ROOT = 4919;

function stillButtonId(which: StillButton): number {
    return reader.buttonByText(STILL_ROOT, STILL_LABELS[which]);
}

const VARP_STILL_TOTAL = 330;
const VARP_STILL_SETTINGS = 331;
/** `if_close` hands over the naphtha at this tally. */
const STILL_TARGET = 26;
// Why: the tar regulator at full flow is +2 pressure a tick and the valve one step open is -2, the only pairing that holds the gauge still: shut is +2 a tick and blows in 6, wide open falls to 0 and the regulator has to come back down.
const VALVE_HOLD = 1;
const REGULATOR_FULL = 2;
// Why: the needle climbs 1 step a tick while `%temp` is 51-79 and 3 while it's over 80, and passing bit 25 resets the tally to 0. Coal at 6 or below peaks at 9, 2 clear of the ceiling, and the 4-tick gap stops 2 lumps landing inside one softtimer period.
const COAL_BELOW = 6;
const COAL_GAP_TICKS = 4;
/** Green zone for the progress check, heat needle bits 19 to 24. */
const HEAT_MIN = 6;
const HEAT_MAX = 11;

function needle(settings: number, base: number, max: number): number {
    for (let bit = base; bit <= max; bit++) {
        if (((settings >>> bit) & 1) === 1) {
            return bit - base;
        }
    }
    return -1;
}

interface StillView {
    total: number;
    heat: number;
    valve: number;
    regulator: number;
}

function readStill(): StillView {
    const settings = reader.varp(VARP_STILL_SETTINGS);
    return {
        total: reader.varp(VARP_STILL_TOTAL),
        heat: needle(settings, 13, 25),
        valve: needle(settings, 26, 28),
        regulator: needle(settings, 29, 31)
    };
}

/** The next button the control law wants, or null when this tick is a wait. */
export function stillButton(view: StillView, sinceCoal: number, coal: number): StillButton | null {
    if (view.valve < VALVE_HOLD) {
        return 'valveOpen';
    }
    if (view.valve > VALVE_HOLD) {
        return 'valveShut';
    }
    if (view.regulator < REGULATOR_FULL) {
        return 'regulatorUp';
    }
    if (coal > 0 && view.heat <= COAL_BELOW && sinceCoal >= COAL_GAP_TICKS) {
        return 'coal';
    }
    return null;
}

export { HEAT_MIN, HEAT_MAX, STILL_LABELS, STILL_ROOT, STILL_TARGET, readStill, type StillButton, type StillView };

const STILL_TIMEOUT_TICKS = 600;
/** How often the gauges are printed, so a stalled run says which needle stalled it. */
const STILL_TRACE_TICKS = 20;

/** Pour a barrel of tar into the still and work the valves until it yields naphtha. */
export async function distilNaphtha(log: (m: string) => void): Promise<boolean> {
    if (heldId(RG_ITEM.BARREL_NAPHTHA.id) > 0) {
        return true;
    }
    if (reader.modals().main !== STILL_ROOT) {
        if (!(await Traversal.walkResilient(RG_TILE.STILL, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
            return false;
        }
        if (!(await useHeldOnLoc(RG_ITEM.BARREL_TAR.id, [RG_LOC.STILL], () => reader.modals().main === STILL_ROOT, log))) {
            log('the still would not take the barrel of coal tar');
            return false;
        }
    }
    let sinceCoal = COAL_GAP_TICKS;
    let best = 0;
    for (let tick = 0; tick < STILL_TIMEOUT_TICKS; tick++) {
        if (reader.modals().main !== STILL_ROOT) {
            log('the still interface closed early');
            break;
        }
        const view = readStill();
        if (view.total >= STILL_TARGET) {
            break;
        }
        if (view.total > best) {
            best = view.total;
        } else if (view.total === 0 && best > 0) {
            log(`the still blew its gauge at ${best}/${STILL_TARGET} and reset — starting the run again`);
            best = 0;
        }
        const button = stillButton(view, sinceCoal, Inventory.count(RG_ITEM.COAL.name));
        if (button === 'coal') {
            sinceCoal = 0;
        } else {
            sinceCoal++;
        }
        if (button !== null) {
            const comId = stillButtonId(button);
            if (comId === -1) {
                log(`the still has no '${STILL_LABELS[button]}' button — the interface is not the one this expects`);
                break;
            }
            actions.ifButton(comId);
        }
        // Why: the gauges are the only feedback here, and without them a run that makes no progress looks like one that never opened.
        if (tick % STILL_TRACE_TICKS === 0) {
            log(`still: total ${view.total}/${STILL_TARGET} heat ${view.heat} valve ${view.valve} reg ${view.regulator} → button ${button}`);
        }
        await Execution.delayTicks(1);
    }
    const finished = readStill().total >= STILL_TARGET;
    // Why: `[if_close,regicide_still]` swaps the empty barrel for the naphtha and the tally alone hands over nothing, so the run finishes once the interface is shut.
    if (!(await closeStill())) {
        log('the still interface would not close');
        return false;
    }
    if (!finished) {
        log(`the still stopped at ${readStill().total}/${STILL_TARGET}`);
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.BARREL_NAPHTHA.id) > 0, 10_000);
}

async function closeStill(): Promise<boolean> {
    if (await Modals.close()) {
        return true;
    }
    // Why: the generic close is a CLOSE_BUTTON menu action and this root's own shut is `com_89`, `[if_button,regicide_still:com_89] if_close`.
    const close = stillButtonId('close');
    if (close !== -1) {
        actions.ifButton(close);
    }
    return Execution.delayUntil(() => reader.modals().main !== STILL_ROOT, 5_000);
}

// Why: the 2 powders go into the naphtha in either order and the barrel seals itself on the second, so one step pours whatever it still has and nothing needs sequencing.

/** Both powders into the naphtha, which seals the barrel into a bomb. */
export async function mixBomb(log: (m: string) => void): Promise<boolean> {
    for (const dust of [RG_ITEM.QUICKLIME_DUST, RG_ITEM.SULPHUR_DUST]) {
        if (heldId(RG_ITEM.BARREL_LID.id) > 0) {
            return true;
        }
        const powder = Inventory.items().find(item => item.id === dust.id);
        const barrel = Inventory.items().find(
            item => item.id === RG_ITEM.BARREL_NAPHTHA.id || item.id === RG_ITEM.MIX_QUICKLIME.id || item.id === RG_ITEM.MIX_SULPHUR.id
        );
        if (!barrel) {
            log('nothing left to mix the powders into');
            return false;
        }
        if (!powder) {
            // Why: the barrel seals on the second powder, so a pack with one of them retries this step forever without saying which one the forest still owes.
            log(`no ${dust.name} to mix in — the bomb needs both powders`);
            return false;
        }
        const before = heldId(dust.id);
        if (!(await powder.useOn(barrel))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(dust.id) < before, [], log, GRIND_MS))) {
            log(`the naphtha would not take the ${dust.name}`);
            return false;
        }
    }
    return heldId(RG_ITEM.BARREL_LID.id) > 0;
}

/** The woven cloth stuffed through the barrel's hole as a fuse. */
export async function fuseBomb(log: (m: string) => void): Promise<boolean> {
    const cloth = Inventory.items().find(item => item.id === RG_ITEM.CLOTH.id);
    const barrel = Inventory.items().find(item => item.id === RG_ITEM.BARREL_LID.id);
    if (!cloth || !barrel) {
        log(`missing ${cloth ? 'the sealed barrel' : 'the cloth'} for the fuse`);
        return false;
    }
    if (!(await cloth.useOn(barrel))) {
        return false;
    }
    return driveUntil(() => heldId(RG_ITEM.BARREL_FUSED.id) > 0, [], log, GRIND_MS);
}
