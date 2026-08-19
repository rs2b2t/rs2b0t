import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import type Tile from '../../../../../geometry/Tile.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { WalkExecutor } from '../../../../../event/webwalk/WalkExecutor.js';
import { driveDialog, talkThrough } from '../../exec/primitives.js';
import { unwearable } from './armour.js';
import {
    FISHERMAN,
    FISHER_KING,
    GRAIL_TILE,
    ITEM,
    MERLIN,
    MERLIN_ID,
    SIR_PERCIVAL,
    TITAN_ID,
    WHISTLE_DOOR_ID,
    eastOfTitan,
    inBlightedRealm,
    inCastleUpstairs,
    inFisherRealm
} from './areas.js';

const WALK = { attempts: 4, timeoutMs: 180_000 } as const;

// Why: the castle's floor plan interleaves with the ground outside it, so the only cheap way to know which side of its wall we are on is to remember the bell landing.

/** Latched by the bell, cleared the moment the player is outside the blighted realm. */
let insideCastle = false;

async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === dest.level && dest.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(dest, { ...WALK, radius, log });
}

function chebyshev(a: WorldTile, b: WorldTile): number {
    return a.level === b.level ? Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) : Number.POSITIVE_INFINITY;
}

/** Drain a mesbox or a one-sided chat without answering an option. */
async function drain(): Promise<void> {
    for (let i = 0; i < 20 && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.options().length > 0) {
            return;
        }
        await Execution.delayTicks(1);
    }
    await Modals.closeIfOpen();
}

async function climbAt(stand: Tile, op: string, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    const stair = Locs.query().name('Staircase').action(op).within(5).nearest();
    if (!stair) {
        log(`no Staircase offering '${op}' near (${stand.x},${stand.z})`);
        return false;
    }
    const before = Game.tile()?.level ?? stand.level;
    if (!(await stair.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => (Game.tile()?.level ?? before) !== before, 8000);
}

// Why: `merlin2` and the `merlin` that Merlin's Crystal frees both render as "Merlin", and only the workshop one carries the Grail dialogue.

/** Open the workshop door — which is what spawns Merlin — and take his advice. */
export async function merlinLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(GRAIL_TILE.MERLIN_WORKSHOP, 2, log))) {
        return false;
    }
    const merlin = Npcs.query().where(n => n.id === MERLIN_ID).action('Talk-to').within(8).nearest();
    if (!merlin) {
        log('no Merlin in the workshop — the door spawns him, so open it again');
        const door = Locs.query().name('Door').action('Open').within(6).nearest();
        if (door) {
            await door.interact('Open');
            await Execution.delayTicks(3);
        }
        return false;
    }
    if (!(await merlin.interact('Talk-to'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return false;
    }
    return driveDialog(MERLIN.prefer, log);
}

/** Strip every worn piece so the Entrana monk's search passes. */
export async function unequipAll(log: (m: string) => void): Promise<boolean> {
    for (const item of Equipment.items()) {
        if (item.name && !(await Equipment.unequip(item.name))) {
            log(`could not remove ${item.name}`);
            return false;
        }
    }
    return Equipment.items().length === 0;
}

/** Wear what the armour planner picked, remembering anything the account may not hold. */
export async function wearArmour(names: readonly string[], log: (m: string) => void): Promise<boolean> {
    for (const name of names) {
        if (Equipment.contains(name)) {
            continue;
        }
        if (!(await Equipment.equip(name))) {
            log(`cannot wear ${name} — level or quest requirement; leaving it behind`);
            unwearable.add(name.toLowerCase());
        }
        await Execution.delayTicks(1);
    }
    return true;
}

// Why: the door checks the napkin and the whistle count itself, so opening it while carrying the cloth is all there is to it.
// Why: the pair despawns after 100 ticks — a fifth of a minute on a doubled tick rate — so both are taken inside one step rather than one per engine tick.

/** Open Draynor Manor's top-floor door and pick up the whistles it drops. */
export async function draynorWhistles(want: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(ITEM.WHISTLE) >= want) {
        return true;
    }
    if (!Inventory.contains(ITEM.NAPKIN)) {
        log('no Holy table napkin in the pack — the whistles will not appear');
        return false;
    }
    if (!(await walkTo(GRAIL_TILE.WHISTLE_STAND, 0, log))) {
        return false;
    }
    for (let round = 0; round < 3 && Inventory.count(ITEM.WHISTLE) < want; round++) {
        const door = Locs.query().where(l => l.id === WHISTLE_DOOR_ID).action('Open').within(6).nearest();
        if (door) {
            await door.interact('Open');
            await Execution.delayTicks(2);
        }
        for (let take = 0; take < 4 && Inventory.count(ITEM.WHISTLE) < want; take++) {
            const drop = GroundItems.query().name(ITEM.WHISTLE).within(8).nearest();
            if (!drop) {
                break;
            }
            const before = Inventory.count(ITEM.WHISTLE);
            if (!(await drop.interact('Take'))) {
                break;
            }
            await Execution.delayUntil(() => Inventory.count(ITEM.WHISTLE) > before, 6000);
        }
    }
    const got = Inventory.count(ITEM.WHISTLE);
    if (got < want) {
        log(`Draynor Manor gave ${got} of ${want} Magic whistles`);
    }
    return got >= want;
}

async function blow(log: (m: string) => void): Promise<boolean> {
    const whistle = Inventory.first(ITEM.WHISTLE);
    if (!whistle) {
        log('no Magic whistle in the pack');
        return false;
    }
    const before = Game.tile();
    if (!(await whistle.interact('Blow'))) {
        return false;
    }
    const moved = await Execution.delayUntil(() => {
        const now = Game.tile();
        return now !== null && before !== null && (now.x !== before.x || now.z !== before.z);
    }, 10_000);
    await drain();
    return moved;
}

/** Blow the whistle on Karamja's six heads to cross into the Realm of the Fisher King. */
export async function whistleIn(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(GRAIL_TILE.SIX_HEADS, 1, log))) {
        return false;
    }
    if (!(await blow(log))) {
        return false;
    }
    return inFisherRealm(Game.tile());
}

/** Blow the whistle anywhere in the realm to land back on Karamja. */
export async function whistleOut(log: (m: string) => void): Promise<boolean> {
    if (!(await blow(log))) {
        return false;
    }
    if (inFisherRealm(Game.tile())) {
        return false;
    }
    insideCastle = false;
    return true;
}

const TITAN_GUARD_TICKS = 900;
/** A lobster's worth of damage is enough to eat on; waiting spends the margin. */
const EAT_AT_MISSING = 15;

const PROTECT_MELEE = 'protect from melee';
export const PROTECT_LEVEL = 43;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

// Why: the titan attacks in melee and nothing else, so Protect from Melee zeroes the fight for as long as the points last.

/** True when melee protection is worth the tick's one action. */
export function shouldProtect(prayerLevel: number, points: number, up: boolean): boolean {
    return prayerLevel >= PROTECT_LEVEL && points > 0 && !up;
}

// Why: the titan full-heals and drops the stage to 7 for anyone who kills him without Excalibur worn, so the check is a refusal rather than a warning.
// Why: the win is a p_teleport past him, so leaving the pocket is the only proof the fight was the winning one.

/** Kill the Black Knight Titan wearing Excalibur; the win teleports us across his crossing. */
async function fightTitan(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(ITEM.EXCALIBUR)) {
        log('refusing to fight the titan without Excalibur wielded — an unarmed kill heals him and sets the quest back');
        return false;
    }
    if (!(await walkTo(GRAIL_TILE.TITAN_STAND, 0, log))) {
        return false;
    }
    if (Skills.level('prayer') < PROTECT_LEVEL) {
        log(`prayer below ${PROTECT_LEVEL} — the titan will land hits this fight`);
    }
    Game.setAutoRetaliate(true);
    Game.setCombatStyle('strength');
    let lastTick = -1;
    let reported = -1;
    let swings = 0;
    let attacking = -1;
    try {
        for (let i = 0; i < TITAN_GUARD_TICKS; i++) {
            if (EventSignal.pending()) {
                log('titan: yielding to a runtime event');
                return false;
            }
            if (!eastOfTitan(Game.tile())) {
                log(`titan: down after ${swings} attacks — teleported past his crossing`);
                await drain();
                return true;
            }
            const now = Game.tick();
            if (now === lastTick) {
                await Execution.delayTicks(1);
                continue;
            }
            lastTick = now;
            if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                await drain();
                continue;
            }
            // Why: the server takes one op a tick and drops the rest, so the order is pray, eat, swing — a re-arm skipped for food never comes back while the damage keeps coming.
            if (shouldProtect(Skills.level('prayer'), Prayer.points(), Prayer.active(PROTECT_MELEE))) {
                await Prayer.set(PROTECT_MELEE, true);
                continue;
            }
            if (hungry()) {
                await Sustain.run();
                continue;
            }
            const titan = Npcs.query().where(n => n.id === TITAN_ID).action('Attack').nearest();
            if (!titan) {
                await Execution.delayTicks(1);
                continue;
            }
            if (now - reported >= 40) {
                reported = now;
                log(`titan: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                    + ` prayer=${Prayer.points()} attacks=${swings}`);
            }
            // Melee keeps swinging on its own; re-clicking spends the tick's one action on re-targeting.
            if (titan.index === attacking && Game.inCombat()) {
                await Execution.delayTicks(1);
                continue;
            }
            if (await titan.interact('Attack')) {
                attacking = titan.index;
                swings++;
            }
            await Execution.delayTicks(1);
        }
        log(`titan: gave up after ${TITAN_GUARD_TICKS} ticks (${swings} attacks)`);
        return false;
    } finally {
        // Why: the win is a teleport out of his reach, but a yield leaves him swinging — dropping the prayer there hands back the hits it was bought to stop.
        if (!Game.inCombat() && Prayer.active(PROTECT_MELEE)) {
            await Prayer.set(PROTECT_MELEE, false);
        }
    }
}

const RING_ATTEMPTS = 12;

/** Ring the Grail bell beside a maiden; the answer is a teleport into the castle. */
async function ringBell(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(GRAIL_TILE.RING_STAND, 1, log))) {
        // Why: the ring stand is outside the castle wall, so an unreachable verdict is the bot telling us it is already in.
        if (WalkExecutor.lastOutcome === 'unreachable') {
            log('bell: the ring stand is unreachable — already inside the castle');
            insideCastle = true;
            return true;
        }
        return false;
    }
    for (let i = 0; i < RING_ATTEMPTS; i++) {
        const here = Game.tile();
        const maiden = Npcs.query().name('Grail Maiden').nearest();
        if (!here || !maiden || chebyshev(here, maiden.tile()) > 4) {
            // The maidens wander inside the castle; one drifts back into earshot.
            await Execution.delayTicks(2);
            continue;
        }
        const bell = Inventory.first(ITEM.BELL);
        if (!bell) {
            log('no Grail bell in the pack');
            return false;
        }
        if (!(await bell.interact('Ring'))) {
            return false;
        }
        const landed = await Execution.delayUntil(() => {
            const now = Game.tile();
            return now !== null && GRAIL_TILE.CASTLE_LANDING.distanceTo(now) <= 2 && now.level === 0;
        }, 8000);
        await drain();
        if (landed) {
            log('bell: inside the Grail castle');
            insideCastle = true;
            return true;
        }
    }
    log('bell: no Grail Maiden came within four tiles of the ring stand');
    return false;
}

async function takeBell(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.BELL)) {
        return true;
    }
    if (GroundItems.query().name(ITEM.BELL).within(12).nearest() === null) {
        if (!(await walkTo(GRAIL_TILE.BELL_SPAWN, 1, log))) {
            return false;
        }
        await Execution.delayTicks(2);
    }
    const drop = GroundItems.query().name(ITEM.BELL).within(12).nearest();
    if (!drop) {
        log('no Grail bell on the ground — the Fisherman spawns it for 500 ticks, so ask him again');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(ITEM.BELL), 8000);
}

// Why: one step, not five — every stage inside the realm is read off the player's tile and the scene, so an interrupted run re-enters wherever it stopped.

/** Everything inside the blighted realm: the titan, the bell, and the Fisher King. */
export async function realmLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!inBlightedRealm(here)) {
        insideCastle = false;
        log('realmLeg: not in the Realm of the Fisher King');
        return false;
    }
    if (eastOfTitan(here)) {
        return fightTitan(log);
    }
    if (inCastleUpstairs(here)) {
        insideCastle = true;
        if (!(await walkTo(GRAIL_TILE.FISHER_KING_DOOR, 1, log))) {
            return false;
        }
        // Reach opens the diagonal door in front of the hall when the server refuses.
        return talkThrough(FISHER_KING.npc, FISHER_KING.prefer, log);
    }
    if (insideCastle) {
        return climbAt(GRAIL_TILE.CASTLE_STAIR, 'Climb-up', log);
    }
    if (!Inventory.contains(ITEM.BELL) && GroundItems.query().name(ITEM.BELL).within(16).nearest() === null) {
        if (!(await walkTo(FISHERMAN.anchor, 1, log))) {
            return false;
        }
        if (!(await talkThrough(FISHERMAN.npc, FISHERMAN.prefer, log))) {
            return false;
        }
    }
    if (!(await takeBell(log))) {
        return false;
    }
    return ringBell(log);
}

// Why: `oploc2,percy_sacks` gates on the stage alone, so King Arthur's golden feather is a hint the bot does not need.

/** Open the Goblin Village sacks and hand the freed Sir Percival a whistle. */
export async function freePercival(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains(ITEM.WHISTLE)) {
        log('no Magic whistle to give Sir Percival');
        return false;
    }
    if (!(await walkTo(GRAIL_TILE.SACKS_STAND, 2, log))) {
        return false;
    }
    if (Npcs.query().name('Sir Percival').action('Talk-to').within(8).nearest()) {
        return talkThrough(SIR_PERCIVAL.npc, SIR_PERCIVAL.prefer, log);
    }
    const sacks = Locs.query().name('Sacks').action('Open').within(6).nearest();
    if (!sacks) {
        log('no Sacks to Open at the Goblin Village');
        return false;
    }
    if (!(await sacks.interact('Open'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return false;
    }
    return driveDialog(SIR_PERCIVAL.prefer, log);
}

/** Climb the renewed castle's tower and lift the Grail off the round table. */
export async function takeGrail(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.GRAIL)) {
        return true;
    }
    // Why: radius 0 — the Grail is on a round table, and only the cardinal neighbour south of it counts as adjacent.
    if (!(await walkTo(GRAIL_TILE.GRAIL_STAND, 0, log))) {
        return false;
    }
    const grail = GroundItems.query().name(ITEM.GRAIL).within(4).nearest();
    if (!grail) {
        log('no Holy grail on the table — LIVE-VERIFY the tower route');
        return false;
    }
    if (!(await grail.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.contains(ITEM.GRAIL), 8000);
    await drain();
    return took;
}
