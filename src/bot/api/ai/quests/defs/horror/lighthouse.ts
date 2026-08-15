import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Reach } from '../../../../walking/Reach.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { settleScene } from '../../exec/prompts.js';
import { HD_ID, HD_ITEM, HD_LOC, HD_TILE } from './areas.js';
import { HD_FLAG } from './journal.js';

export function inQuestLighthouse(tile: { x: number; z: number; level: number } | null): boolean {
    return tile !== null && tile.x >= 2432 && tile.x <= 2495 && tile.z >= 4544 && tile.z <= 4607;
}

export function inBasement(tile: { x: number; z: number; level: number } | null): boolean {
    return tile !== null && tile.level === 1 && tile.x >= 2496 && tile.x <= 2559 && tile.z >= 4608 && tile.z <= 4671;
}

/** `~mesbox` puts a modal message box up; nothing else advances until it is cleared. */
async function clearMesbox(): Promise<void> {
    for (let i = 0; i < 4 && (ChatDialog.canContinue() || ChatDialog.isOpen()); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        }
        await Execution.delayTicks(1);
    }
}

// Why: the two spots sit on opposite banks of one gap, so the walk between them is the `Cross` op the navigator already knows about.
// Why: success is read off the plank count, as `oplocu` deletes the plank and the nails together and the refusals ("You need 4 steel nails", "already fixed this half") delete nothing.

/** Repair both halves of the storm-broken bridge — a plank and four nails each. */
export async function repairBridge(log: (m: string) => void): Promise<boolean> {
    const spots: readonly [string, Tile][] = [['west', HD_TILE.BRIDGE_WEST], ['east', HD_TILE.BRIDGE_EAST]];
    for (const [side, stand] of spots) {
        if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 4, timeoutMs: 300_000, log }))) {
            log(`could not stand on the ${side} bridge spot`);
            return false;
        }
        await settleScene();
        const spot = Locs.query().name(HD_LOC.BRIDGE).where(l => l.tile().equals(stand)).nearest();
        if (!spot) {
            log(`no bridge spot at (${stand.x},${stand.z})`);
            return false;
        }
        const plank = Inventory.first(HD_ITEM.PLANK);
        if (!plank) {
            log('no plank left for the bridge');
            return false;
        }
        const before = Inventory.countById(HD_ID.PLANK);
        if (!(await plank.useOn(spot))) {
            return false;
        }
        const built = await Execution.delayUntil(() => Inventory.countById(HD_ID.PLANK) < before, 10_000);
        await clearMesbox();
        if (!built) {
            // Already-built halves refuse without consuming, which is the normal
            // resume path — carry on to the other side rather than failing.
            log(`the ${side} half took no plank (already built, or nails short)`);
        } else {
            log(`${side} half of the bridge built`);
        }
    }
    return true;
}

/**
 * Walk through the lighthouse doorway. `oploc1` teleports the player into the
 * broken copy in mapsquare 38_71 — nothing walks between the two lighthouses.
 */
export async function enterLighthouse(log: (m: string) => void): Promise<boolean> {
    if (inQuestLighthouse(Game.tile())) {
        return true;
    }
    const status = await Reach.locOp({
        name: HD_LOC.DOORWAY,
        op: 'Walk-through',
        near: HD_TILE.LIGHTHOUSE_DOOR,
        expect: () => inQuestLighthouse(Game.tile()),
        log
    });
    await settleScene();
    return status === 'done' && inQuestLighthouse(Game.tile());
}

async function climb(name: string, op: string, near: Tile, arrive: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (arrive()) {
        return true;
    }
    const status = await Reach.locOp({ name, op, near, expect: arrive, log });
    if (status !== 'done') {
        return false;
    }
    await settleScene();
    return arrive();
}

const atLevel = (level: number) => (): boolean => (Game.tile()?.level ?? -1) === level;

// Why: the middle staircase's op1 raises a Climb Up / Climb Down choice whose down branch teleports two tiles sideways on the same floor once the light is repaired, so both hops take the explicit ops instead.

/** Climb from the ground floor to the lamp room of the broken copy. */
export async function climbToLight(log: (m: string) => void): Promise<boolean> {
    if (!(await climb(HD_LOC.STAIRS, 'Climb-up', HD_TILE.QUEST_STAIRS_BASE, atLevel(1), log))) {
        return false;
    }
    return climb(HD_LOC.STAIRS, 'Climb-up', HD_TILE.QUEST_STAIRS_L1, atLevel(2), log);
}

interface LightStep {
    item: string;
    id: number;
    flag: string;
    /** True once this application has landed. */
    done: () => boolean;
}

// Why: the torch refuses the tinderbox until it has been tarred ("The torch does not seem to be flammable..."), and whichever application is last teleports the player out into the live lighthouse.
// Why: tar and glass are read off their own consumption, and the tinderbox is not consumed, so the only proof it caught is leaving the broken copy.

/** Apply tar, glass and light to the lamp. */
export async function repairLight(flags: ReadonlySet<string>, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(HD_TILE.QUEST_LIGHT, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const steps: LightStep[] = [
        {
            item: HD_ITEM.SWAMP_TAR,
            id: HD_ID.SWAMP_TAR,
            flag: HD_FLAG.TAR,
            done: () => Inventory.countById(HD_ID.SWAMP_TAR) === 0
        },
        {
            item: HD_ITEM.MOLTEN_GLASS,
            id: HD_ID.MOLTEN_GLASS,
            flag: HD_FLAG.GLASS,
            done: () => Inventory.countById(HD_ID.MOLTEN_GLASS) === 0
        },
        {
            item: HD_ITEM.TINDERBOX,
            id: HD_ID.TINDERBOX,
            flag: HD_FLAG.LIGHT,
            done: () => !inQuestLighthouse(Game.tile())
        }
    ];
    for (const step of steps) {
        if (flags.has(step.flag) || Inventory.countById(step.id) === 0) {
            continue;
        }
        const mechanism = Locs.query().name(HD_LOC.LIGHT).within(8).nearest();
        const held = Inventory.first(step.item);
        if (!mechanism || !held) {
            log(`no lighting mechanism in reach, or no ${step.item} to use on it`);
            return false;
        }
        if (!(await held.useOn(mechanism))) {
            return false;
        }
        if (!(await Execution.delayUntil(step.done, 10_000))) {
            log(`the mechanism did not take the ${step.item}`);
            return false;
        }
        log(`${step.item} applied to the lighting mechanism`);
        if (!inQuestLighthouse(Game.tile())) {
            return true;
        }
    }
    await Execution.delayTicks(3);
    return !inQuestLighthouse(Game.tile());
}

// Why: repairing teleports into the live lighthouse's lamp room, its staircase routes back into the copy at level 1, and only the copy's ground floor has the iron ladder down.

/** Descend from wherever the repair left the player to the basement. */
export async function descendToBasement(log: (m: string) => void): Promise<boolean> {
    if (inBasement(Game.tile())) {
        return true;
    }
    const level = (): number => Game.tile()?.level ?? 0;
    if (level() === 2) {
        const stairs = inQuestLighthouse(Game.tile()) ? HD_TILE.QUEST_STAIRS_L2 : HD_TILE.REAL_STAIRS_L2;
        if (!(await climb(HD_LOC.STAIRS, 'Climb-down', stairs, atLevel(1), log))) {
            return false;
        }
    }
    if (level() === 1 && !inBasement(Game.tile())) {
        if (!(await climb(HD_LOC.STAIRS, 'Climb-down', HD_TILE.QUEST_STAIRS_L1, atLevel(0), log))) {
            return false;
        }
    }
    if (!inQuestLighthouse(Game.tile())) {
        // Back outside at ground level: the doorway is the only way in again.
        if (!(await enterLighthouse(log))) {
            return false;
        }
    }
    return climb(HD_LOC.LADDER, 'Climb', HD_TILE.QUEST_LADDER, () => inBasement(Game.tile()), log);
}
