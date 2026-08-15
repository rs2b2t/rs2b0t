import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Npc } from '../../../../model/Npc.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { heldId, settleScene } from '../../exec/prompts.js';
import { NS_ID, NS_TILE } from './areas.js';
import { pickable, standBeside } from './camp.js';

const GHAST = 'Ghast';

/** Pear, stem and fungus all count; three of any of them fill a pouch. */
const POUCH_ITEMS: readonly number[] = [NS_ID.PEAR, NS_ID.STEM, NS_ID.FUNGI];

const harvestHeld = (): number => POUCH_ITEMS.reduce((sum, id) => sum + heldId(id), 0);

// Why: `Cast Bloom` costs prayer points and affects the eight tiles around the caster, choosing one loc at random, so the loop stands beside a bloomable and re-casts until something answers.

/** Bloom and harvest until the pouch has three items to eat. */
export async function bloomWithSickle(log: (m: string) => void): Promise<boolean> {
    if (Skills.level('prayer') > 0 && Skills.effective('prayer') === 0) {
        log('no prayer points left — the blessed sickle cannot bloom');
        return false;
    }
    for (let cycle = 0; cycle < 12 && harvestHeld() < 3; cycle++) {
        const ready = pickable();
        if (ready) {
            const before = harvestHeld();
            const loc = Locs.query().name(ready.name).action(ready.op).within(10).nearest();
            if (loc && (await loc.interact(ready.op))) {
                await Execution.delayUntil(() => harvestHeld() > before, 6000);
            }
            continue;
        }
        if (!(await standBeside(log))) {
            return false;
        }
        const sickle = Inventory.items().find(i => i.id === NS_ID.SICKLE_BLESSED);
        if (!sickle) {
            log('no Silver sickle(b) held');
            return false;
        }
        if (!(await sickle.interact('Cast Bloom'))) {
            return false;
        }
        await Execution.delayUntil(() => pickable() !== null, 6000);
    }
    return harvestHeld() >= 3;
}

/** Three blossomed items into the pouch. */
export async function fillPouch(log: (m: string) => void): Promise<boolean> {
    if (harvestHeld() < 3) {
        log(`only ${harvestHeld()} harvest item(s) held — the pouch takes three`);
        return false;
    }
    const pouch = Inventory.items().find(i => i.id === NS_ID.POUCH_EMPTY || i.id === NS_ID.POUCH);
    if (!pouch) {
        log('no druid pouch held');
        return false;
    }
    const before = heldId(NS_ID.POUCH);
    if (!(await pouch.interact('Fill'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(NS_ID.POUCH) > before, 6000);
}

// Why: a ghast is invisible until a pouch charge is spent on it, and `Attack` is refused outright below the pouch stage.
// Why: the pouch use is an `opnpcu` refused only while something else already has you in combat, so the loop pops the ghast itself rather than waiting to be hit.

/** Pop one invisible ghast with the pouch and kill what appears. */
export async function killGhast(log: (m: string) => void): Promise<boolean> {
    if (heldId(NS_ID.POUCH) === 0) {
        log('no charged druid pouch — nothing can make a ghast visible');
        return false;
    }
    const visible = (): Npc | null => Npcs.query().name(GHAST).action('Attack').within(12).nearest();
    if (!visible()) {
        const hidden = Npcs.query().name(GHAST).within(12).nearest();
        if (!hidden) {
            if (!(await Traversal.walkResilient(NS_TILE.GHAST_HUNT, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
                return false;
            }
            await settleScene();
            log('no ghast in the scene — moving through the swamp until one hunts');
            return false;
        }
        const pouch = Inventory.items().find(i => i.id === NS_ID.POUCH);
        if (!pouch || !(await pouch.useOn(hidden))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => visible() !== null, 8000))) {
            log('the pouch charge did not make a ghast visible');
            return false;
        }
    }
    const ghast = visible();
    if (!ghast) {
        return false;
    }
    const index = ghast.index;
    if (!(await ghast.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat(), 6000))) {
        return false;
    }
    return Execution.delayUntil(() => !Npcs.all().some(n => n.index === index), 90_000);
}
