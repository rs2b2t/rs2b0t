import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../../grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { clearBoxes, crossTeleportDoor, promptLoc, settleScene } from '../../exec/prompts.js';
import { EXPERIMENT_IDS, WH_LOC, WH_OBJ, WH_TILE, inGarden, inShed } from './areas.js';
import { held } from './house.js';

const WALK_MS = 180_000;
/** 4 forms and 144 hitpoints between them, at the tick rate a live server runs. */
const FIGHT_MS = 300_000;
/** Ticks a transition may take before the chain counts as broken. */
const SPAWN_TICKS = 25;

const KILLED = /kill the shapeshifter once and for all/i;
const NOTHING_IN_FOUNTAIN = /nothing in the fountain/i;

export function experiment(): Npc | null {
    return Npcs.query().where(n => EXPERIMENT_IDS.includes(n.id)).action('Attack').within(14).nearest();
}

/** Check the fountain's secret compartment for the shed key. */
export async function fountainKey(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.SHED_KEY) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WH_TILE.FOUNTAIN, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        log(inGarden(Game.tile())
            ? 'stopped short of the fountain inside the garden'
            : 'never reached the garden. The witch throws a caught bot back to the boy');
        return false;
    }
    await settleScene();
    const took = await promptLoc({
        name: 'Fountain',
        op: 'Check',
        near: WH_TILE.FOUNTAIN,
        id: WH_LOC.FOUNTAIN,
        within: 6,
        expect: () => held(WH_OBJ.SHED_KEY) > 0,
        expectMs: 12_000,
        refused: NOTHING_IN_FOUNTAIN
    }, log);
    await Modals.close();
    return took && held(WH_OBJ.SHED_KEY) > 0;
}

// Why: Before stage 6, plain Open is locked; using the leaf key also spawns the shapeshifter.

/** Cross the shed door with the key, which is also what spawns the first form. */
async function enterShed(log: (m: string) => void): Promise<boolean> {
    if (inShed(Game.tile())) {
        return true;
    }
    if (held(WH_OBJ.SHED_KEY) === 0) {
        log('no shed key in the pack. The witch deletes it when she catches you');
        return false;
    }
    return crossTeleportDoor({
        id: WH_LOC.SHED_DOOR,
        stand: WH_TILE.SHED_DOOR,
        standRadius: 0,
        useItem: WH_OBJ.SHED_KEY,
        isFar: () => inShed(Game.tile()),
        log
    });
}

function ballDrop(): GroundItem | null {
    return GroundItems.query().where(g => g.id === WH_OBJ.BALL).within(10).nearest();
}

// Why: `opobj3,ball` re-adds a `shapeshifterglob` whenever the quest is short of stage 6 and none is in range, so touching the ball restarts an interrupted fight.

/** Touch the ball to bring a shapeshifter back. */
async function summonExperiment(log: (m: string) => void): Promise<boolean> {
    const ball = ballDrop();
    if (!ball) {
        log('no ball in the shed to draw the shapeshifter out with');
        return false;
    }
    if (!(await ball.interact('Take'))) {
        return false;
    }
    const came = await Execution.delayUntil(() => experiment() !== null, 8000);
    await clearBoxes();
    if (!came) {
        log('the ball raised no shapeshifter');
    }
    return came;
}

// Why: `Sustain` is call-driven, so this loop is what keeps food and Protect from Melee going.
// Why: the hook drops the prayer between forms, where nothing is hitting and every point burnt is one the wolf does not get.

/** Fight the shapeshifter through all 4 of its forms. */
export async function fightExperiment(log: (m: string) => void): Promise<boolean> {
    const mark = GameMessages.mark();
    const won = (): boolean => GameMessages.sawSince(mark, KILLED);
    Game.setAutoRetaliate(true);
    const deadline = performance.now() + FIGHT_MS;
    let attacking = -1;
    let idle = 0;
    let swings = 0;
    let forms = 0;
    let shape = -1;
    let reported = -1;
    while (performance.now() < deadline) {
        if (won()) {
            log(`the shapeshifter is dead after ${forms} transformations and ${swings} attacks`);
            return true;
        }
        if (EventSignal.pending()) {
            log('yielding the fight to a random event');
            return false;
        }
        await Sustain.run();
        const target = experiment();
        if (!target) {
            if (++idle > SPAWN_TICKS) {
                log(`no shapeshifter for ${SPAWN_TICKS} ticks and no kill message, so the chain broke`);
                return false;
            }
            await Execution.delayTicks(1);
            continue;
        }
        // Why: `ai_queue3` deletes one form and adds the next in the same tick, so a gap never appears and the npc id is the only thing that changes.
        if (shape !== -1 && target.id !== shape) {
            forms++;
        }
        shape = target.id;
        idle = 0;
        const tick = Game.tick();
        if (tick - reported >= 40) {
            reported = tick;
            log(`shapeshifter ${target.id}: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} attacks=${swings}`);
        }
        if (target.index !== attacking || !Game.inCombat()) {
            if (await target.interact('Attack')) {
                attacking = target.index;
                swings++;
            }
        }
        await Execution.delayTicks(1);
    }
    log(`the shapeshifter outlived ${FIGHT_MS / 1000}s of combat`);
    return false;
}

/** Unlock the shed and take the fight through to the kill message. */
export async function killExperiment(log: (m: string) => void): Promise<boolean> {
    if (!(await enterShed(log))) {
        return false;
    }
    await settleScene();
    if (!experiment() && !(await summonExperiment(log))) {
        return false;
    }
    return fightExperiment(log);
}

/** Take the ball, which only answers Take once the shapeshifter is dead. */
export async function takeBall(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.BALL) > 0) {
        return true;
    }
    if (!inShed(Game.tile())) {
        // Why: past stage 6 the shed door's own `oploc1` opens, so no second key is needed after a catch.
        if (!(await crossTeleportDoor({
            id: WH_LOC.SHED_DOOR,
            stand: WH_TILE.SHED_DOOR,
            standRadius: 0,
            isFar: () => inShed(Game.tile()),
            log
        }))) {
            return false;
        }
    }
    if (!(await Traversal.walkResilient(WH_TILE.BALL, { radius: 1, attempts: 2, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const ball = ballDrop();
    if (!ball) {
        log('no ball on the shed floor. It respawns on its map timer');
        return false;
    }
    if (!(await ball.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => held(WH_OBJ.BALL) > 0, 8000);
}
