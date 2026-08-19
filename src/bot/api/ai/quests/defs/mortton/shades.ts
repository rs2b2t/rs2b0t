import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { settleScene } from '../../exec/prompts.js';
import { SM_ID, SM_NPC_ID, SM_TILE } from './areas.js';

/** Razmire wants five sets of remains in one pack before he takes any. */
export const REMAINS_WANTED = 5;

const SEARCH_RADIUS = 15;
const LOOT_RADIUS = 12;
const EAT_AT_MISSING = 12;
/** Ticks a single shade is given before the loop gives the step back. */
const FIGHT_GUARD = 220;

// Why: a Loar Shadow becomes a Loar Shade the moment anything attacks it, keeping its index, so the pair is one target rather than two.
const SHADE_IDS: readonly number[] = [SM_NPC_ID.SHADOW, SM_NPC_ID.SHADE];

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

function target(): Npc | null {
    return Npcs.query()
        .where(n => SHADE_IDS.includes(n.id))
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(SEARCH_RADIUS)
        .nearest();
}

const remainsOnFloor = () =>
    GroundItems.query().where(g => g.id === SM_ID.REMAINS).within(LOOT_RADIUS).nearest();

/** Take one set of remains off the floor. */
async function loot(): Promise<boolean> {
    const drop = remainsOnFloor();
    if (!drop) {
        return false;
    }
    const before = Inventory.countById(SM_ID.REMAINS);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.REMAINS) > before, 6000);
}

// Why: the kill and the loot are one step, since `decide` cannot see the floor and a set of remains left there is a sixth shade to kill.

/** Kill one shade and pocket what it leaves. */
export async function huntShade(log: (m: string) => void): Promise<boolean> {
    if (await loot()) {
        return true;
    }
    let shade = target();
    if (!shade) {
        if (!(await Traversal.walkResilient(SM_TILE.TOWN, { radius: 4, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        shade = target();
        if (!shade) {
            log('no Loar Shadow in the streets yet — they respawn on their own timer');
            await Execution.delayTicks(4);
            return false;
        }
    }
    Game.setAutoRetaliate(true);
    const index = shade.index;
    let swings = 0;
    let lastTick = -1;
    for (let i = 0; i < FIGHT_GUARD; i++) {
        if (EventSignal.pending()) {
            log('yielding to a random event mid-shade');
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        if (!Npcs.all().some(n => n.index === index)) {
            // The corpse drops on the tile it sank on; give the server a tick to place it.
            await Execution.delayTicks(1);
            return (await loot()) || swings > 0;
        }
        if (hungry()) {
            await Sustain.run();
            continue;
        }
        if (Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        const live = Npcs.all().find(n => n.index === index);
        if (live && (await live.interact('Attack'))) {
            swings++;
        }
        await Execution.delayTicks(1);
    }
    log(`gave up on Loar Shadow ${index} after ${swings} attacks`);
    return false;
}
