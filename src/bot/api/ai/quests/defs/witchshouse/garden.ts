import Tile from '../../../../../geometry/Tile.js';
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { atCover, castStrike, EXPERIMENT_COVER, EXPERIMENT_TRAP, readyStrikes, takeStrikeCover } from '../../strikeCombat.js';
import { strikeSpell } from '../../strike.js';
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
import { FOUNTAIN_STAND, GARDEN_ENTRY, GARDEN_SHED, walkGarden } from './patrol.js';

/** 4 forms and 144 hitpoints between them, at the tick rate a live server runs. */
const FIGHT_MS = 900_000;
/** Ticks a transition may take before the chain counts as broken. */
const SPAWN_TICKS = 25;

const KILLED = /kill the shapeshifter once and for all/i;
const NOTHING_IN_FOUNTAIN = /nothing in the fountain/i;

export function experiment(): Npc | null {
    return Npcs.query().where(n => EXPERIMENT_IDS.includes(n.id) && !n.targetsAnotherPlayer()).action('Attack').within(14).nearest();
}

/** Check the fountain's secret compartment for the shed key. */
export async function fountainKey(log: (m: string) => void): Promise<boolean> {
    if (held(WH_OBJ.SHED_KEY) > 0) {
        return true;
    }
    if (!(await walkGarden(FOUNTAIN_STAND, log))) {
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
    if (!(await walkGarden(GARDEN_SHED, log))) return false;
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

const BEAR_COVER = new Tile(2936, 3459, 0);
const CORNER_APPROACH = new Tile(2937, 3465, 0);

async function trapExperiment(log: (m: string) => void): Promise<Tile | null> {
    const target = experiment();
    if (!target) return null;
    if (target.size > 1) return await takeStrikeCover(BEAR_COVER, log) ? BEAR_COVER : null;
    if (EXPERIMENT_TRAP.equals(target.networkTile())) {
        return await takeStrikeCover(EXPERIMENT_COVER, log) ? EXPERIMENT_COVER : null;
    }
    if (!(await takeStrikeCover(EXPERIMENT_TRAP, log))) return null;
    const spell = strikeSpell(Skills.effective('magic'), rune => Inventory.count(rune));
    if (!spell) return null;
    if (!target.targetsMe()) {
        const before = Inventory.count('Mind rune');
        try {
            if (!(await Game.castOnNpc(spell, target))) return null;
            if (!(await Execution.delayUntilTicks(() => Inventory.count('Mind rune') < before, 8))) return null;
        } finally {
            await DirectNavigator.walk(EXPERIMENT_TRAP);
        }
    }
    for (let tick = 0; tick < 80; tick++) {
        if (EventSignal.pending()) return null;
        await Sustain.run();
        const current = experiment();
        if (!current || current.id !== target.id) return null;
        if (EXPERIMENT_TRAP.equals(current.networkTile()) && !atCover(EXPERIMENT_TRAP)) {
            return await takeStrikeCover(EXPERIMENT_COVER, log) ? EXPERIMENT_COVER : null;
        }
        const under = CORNER_APPROACH.equals(current.networkTile());
        await DirectNavigator.walk(under ? CORNER_APPROACH : EXPERIMENT_TRAP);
        await Execution.delayTicks(1);
    }
    log('experiment did not enter the northeast trap');
    return null;
}

export async function fightExperiment(log: (m: string) => void): Promise<boolean> {
    const mark = GameMessages.mark();
    const won = (): boolean => GameMessages.sawSince(mark, KILLED);
    if (!(await readyStrikes(log))) return false;
    const deadline = performance.now() + FIGHT_MS;
    let shape = -1;
    let cover: Tile | null = null;
    let idle = 0;
    while (performance.now() < deadline) {
        if (won()) return true;
        if (EventSignal.pending()) return false;
        await Sustain.run();
        const target = experiment();
        if (!target) {
            if (++idle > SPAWN_TICKS) return won();
            await Execution.delayTicks(1);
            continue;
        }
        idle = 0;
        if (target.id !== shape || !cover || !atCover(cover)) {
            shape = target.id;
            const here = Game.tile();
            cover = target.id === EXPERIMENT_IDS[0] || target.id === EXPERIMENT_IDS[1]
                ? (here ? new Tile(here.x, here.z, here.level) : null)
                : await trapExperiment(log);
            if (!cover) return won();
            continue;
        }
        if (!(await castStrike(cover, target, log))) return won();
    }
    return won();
}

/** Unlock the shed and take the fight through to the kill message. */
export async function killExperiment(log: (m: string) => void): Promise<boolean> {
    if (!(await readyStrikes(log))) return false;
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
        if (!(await walkGarden(GARDEN_SHED, log))) return false;
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

export async function leaveGarden(log: (message: string) => void): Promise<boolean> {
    if (inShed(Game.tile()) && !(await crossTeleportDoor({
        id: WH_LOC.SHED_DOOR,
        stand: WH_TILE.SHED_DOOR.translate(1, 0),
        standRadius: 0,
        isFar: () => inGarden(Game.tile()),
        log
    }))) return false;
    if (!(await walkGarden(GARDEN_ENTRY, log))) return false;
    return Traversal.walkResilient(WH_TILE.PORCH, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
}
