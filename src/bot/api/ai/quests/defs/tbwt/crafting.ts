import { CANT_LIGHT } from '../../../../firemaking/Firemaking.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Shop } from '../../../../shop/Shop.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { TB_ID, TB_LOC, TB_NAME, TB_NPC, TB_TILE } from './areas.js';
import { foodNames } from './supplies.js';
import { type Log, walkTo } from './talk.js';

const heldId = (id: number): number => Inventory.items().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

/** Use one carried item on another and wait for the product to land. */
export async function combine(useId: number, targetId: number, productId: number, log: Log): Promise<boolean> {
    if (heldId(productId) > 0) {
        return true;
    }
    const use = Inventory.items().find(i => i.id === useId);
    const target = Inventory.items().find(i => i.id === targetId);
    if (!use || !target) {
        log(`pack is missing item ${use ? targetId : useId}`);
        return false;
    }
    if (!(await use.useOn(target))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(productId) > 0, 10_000);
}

const heldAny = (ids: readonly number[]): number => ids.reduce((n, id) => n + heldId(id), 0);
const foodHeld = (): number => foodNames().reduce((n, name) => n + Inventory.count(name), 0);

/** Take the nearest drop matching any of `ids`; false when there is nothing to take yet. */
export async function takeGround(ids: readonly number[], name: string, log: Log): Promise<boolean> {
    const drop = GroundItems.query().where(g => ids.includes(g.id)).within(14).nearest();
    if (!drop) {
        log(`no '${name}' on the ground within 14 tiles`);
        return false;
    }
    const before = heldAny(ids);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldAny(ids) > before, 8000);
}

// Why: the shoal is an NPC with `op1=Net`, and each cast is a fresh interaction rather than a held loop.

/** Net Karambwanji until the pack holds `want` of them, or has no room left. */
export function fishKarambwanji(want: number): (log: Log) => Promise<boolean> {
    return async log => {
        if (heldId(TB_ID.RAW_KARAMBWANJI) >= want) {
            return true;
        }
        if (!(await walkTo(TB_TILE.KARAMBWANJI_SHOAL, 5, log))) {
            return false;
        }
        await settleScene();
        for (let cast = 0; cast < 60; cast++) {
            await Sustain.run();
            // The shoal yields shrimp as well, and a pack of them is a pack with no room for bait.
            const shrimp = Inventory.first(TB_NAME.RAW_SHRIMP);
            if (shrimp) {
                await shrimp.interact('Drop');
                await Execution.delayTicks(1);
                continue;
            }
            if (heldId(TB_ID.RAW_KARAMBWANJI) >= want || Inventory.free() < 1) {
                break;
            }
            const spot = Npcs.query().name(TB_NPC.FISHING_SPOT).action('Net').within(8).nearest();
            if (!spot) {
                log('no Karambwanji shoal in reach of the Holy Lake stand');
                return false;
            }
            const before = heldId(TB_ID.RAW_KARAMBWANJI);
            if (!(await spot.interact('Net'))) {
                return false;
            }
            await Execution.delayUntil(() => heldId(TB_ID.RAW_KARAMBWANJI) > before, 20_000);
        }
        return heldId(TB_ID.RAW_KARAMBWANJI) > 0;
    };
}

// Why: a raw Karambwan burns three times in ten, and the shoal is a hundred and sixty tiles from
// the Holy Lake the bait comes from, a spare caught on this visit is cheaper than a second round trip.

/** Lower the loaded vessel at Lubufu's spot until `want` Karambwan come up, or the bait runs out. */
export function fishKarambwan(want = 2): (log: Log) => Promise<boolean> {
    return async log => {
        if (heldId(TB_ID.RAW_KARAMBWAN) >= want) {
            return true;
        }
        if (!(await walkTo(TB_TILE.KARAMBWAN_SHOAL, 5, log))) {
            return false;
        }
        await settleScene();
        for (let attempt = 0; attempt < 24 && heldId(TB_ID.RAW_KARAMBWAN) < want; attempt++) {
            await Sustain.run();
            if (heldId(TB_ID.VESSEL_LOADED) === 0 && !(await loadVessel(log))) {
                break;
            }
            const spot = Npcs.query().name(TB_NPC.FISHING_SPOT).action('Fish').within(8).nearest();
            if (!spot) {
                log("no Karambwan shoal in reach of Lubufu's stand");
                return false;
            }
            if (!(await spot.interact('Fish'))) {
                return false;
            }
            await Execution.delayUntil(
                () => heldId(TB_ID.RAW_KARAMBWAN) >= want || heldId(TB_ID.VESSEL_LOADED) === 0,
                20_000
            );
        }
        return heldId(TB_ID.RAW_KARAMBWAN) > 0;
    };
}

/** Bait the vessel; needs one raw Karambwanji in the pack. */
export async function loadVessel(log: Log): Promise<boolean> {
    if (heldId(TB_ID.VESSEL_LOADED) > 0) {
        return true;
    }
    return combine(TB_ID.RAW_KARAMBWANJI, TB_ID.VESSEL, TB_ID.VESSEL_LOADED, log);
}

export async function pickBanana(log: Log): Promise<boolean> {
    if (heldId(TB_ID.BANANA) > 0 || heldId(TB_ID.SLICED_BANANA) > 0) {
        return true;
    }
    if (!(await walkTo(TB_TILE.BANANA_PLANTATION, 4, log))) {
        return false;
    }
    await settleScene();
    for (let tries = 0; tries < 8 && heldId(TB_ID.BANANA) === 0; tries++) {
        const tree = Locs.query().name(TB_LOC.BANANA_TREE).action('Search').within(10).nearest();
        if (!tree) {
            log('no Banana Tree with a Search op in the plantation');
            return false;
        }
        if (!(await tree.interact('Search'))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(TB_ID.BANANA) > 0, 6000);
    }
    return heldId(TB_ID.BANANA) > 0;
}

// Why: three different objects render as "Karamjan rum", so the purchase is counted by id rather than by `Inventory.count`.

/** Zambo's bar in Musa Point is the only Karamjan rum on the island. */
export async function buyRum(log: Log): Promise<boolean> {
    if (heldId(TB_ID.RUM) > 0 || heldId(TB_ID.RUM_SLICED) > 0) {
        return true;
    }
    if (!(await walkTo(TB_TILE.ZAMBO, 3, log))) {
        return false;
    }
    await settleScene();
    if (!(await Shop.open(TB_NPC.ZAMBO))) {
        log("could not open Zambo's shop");
        return false;
    }
    await Shop.buy(TB_NAME.RUM, 1);
    await Shop.close();
    return Execution.delayUntil(() => heldId(TB_ID.RUM) > 0, 6000);
}

/** Cook one item on the permanent jungle fire south of the village. */
export function cookOnFire(itemId: number, productId: number, what: string): (log: Log) => Promise<boolean> {
    return async log => {
        if (heldId(productId) > 0) {
            return true;
        }
        if (heldId(itemId) === 0) {
            log(`no ${what} in the pack to cook`);
            return false;
        }
        // Why: a raw Karambwan burns three times in ten, so the wait ends when the input is gone, not only when the product lands.
        await useOnLoc(
            itemId,
            { name: TB_LOC.FIRE, near: TB_TILE.FIRE, within: 8 },
            [],
            () => heldId(productId) > 0 || heldId(itemId) === 0,
            log
        );
        if (heldId(productId) > 0) {
            return true;
        }
        if (heldId(itemId) > 0) {
            log(`the fire did not answer the ${what}`);
            return false;
        }
        log(`the ${what} burned — sourcing another`);
        const ruined = Inventory.items().find(i => i.id === TB_ID.BURNT_KARAMBWAN);
        if (ruined) {
            await ruined.interact('Drop');
        }
        return false;
    };
}

/** Grind one carried item with the pestle and mortar. */
export function grind(itemId: number, productId: number): (log: Log) => Promise<boolean> {
    return log => combine(TB_ID.PESTLE, itemId, productId, log);
}

// Why: only `[opheldu,tbwt_poisonous_karambwan_paste]` answers, so the spear is the item used and
// the paste is what it lands on, the other way round hits `_weapon_spear`'s silent default.

/** Smear the poisonous paste over whichever spear the pack is carrying. */
export function poisonSpear(spear: { id: number; kpId: number }): (log: Log) => Promise<boolean> {
    return log => combine(spear.id, TB_ID.KARAMBWAN_POISON_PASTE, spear.kpId, log);
}

export function makeSandwich(log: Log): Promise<boolean> {
    return combine(TB_ID.SEAWEED, TB_ID.MONKEY_SKIN, TB_ID.SANDWICH, log);
}

export function pasteBones(log: Log): Promise<boolean> {
    return combine(TB_ID.BURNT_JOGRE_BONES, TB_ID.KARAMBWANJI_PASTE, TB_ID.PASTY_JOGRE_BONES, log);
}

// Why: the monkey deflects every melee swing while the quest is live (`opnpc2,monkey`), so the bow is worn from the start rather than swapped in here.

// Why: `kills` separates a drop from a hunt. Jogre bones fall from every corpse; a spear falls 4
// times in 129, and giving up after one kill would fail its way through thirty decide() passes.

/** Kill up to `kills` of one NPC, stopping as soon as one of `dropIds` is in the pack. */
export function killFor(
    npcName: string,
    anchor: Tile,
    dropIds: readonly number[],
    dropName: string,
    kills = 1
): (log: Log) => Promise<boolean> {
    return async log => {
        for (let kill = 0; kill < kills; kill++) {
            if (heldAny(dropIds) > 0) {
                return true;
            }
            if (await takeGround(dropIds, dropName, () => undefined)) {
                return true;
            }
            // A hunt that outlives the food is how an account dies in the jungle.
            if (kill > 0 && foodHeld() === 0) {
                log(`out of food ${kill} kills into the ${npcName} hunt — banking before the next one`);
                return false;
            }
            if (!(await walkTo(anchor, 5, log))) {
                return false;
            }
            await settleScene();
            const victim = Npcs.query().name(npcName).action('Attack')
                .where(n => !n.targetsAnotherPlayer()).within(12).nearest();
            if (!victim) {
                log(`no ${npcName} within 12 tiles of the stand`);
                return false;
            }
            const index = victim.index;
            if (!(await victim.interact('Attack'))) {
                return false;
            }
            // Hold this one until it dies: `Game.inCombat()` reads our own bar, so a
            // decoy landing a hit would otherwise end the wait.
            const deadline = performance.now() + 120_000;
            while (performance.now() < deadline) {
                await Sustain.run();
                if (!Npcs.all().some(n => n.index === index)) {
                    break;
                }
                await Execution.delayTicks(1);
            }
            await Execution.delayTicks(2);
            await takeGround(dropIds, dropName, () => undefined);
        }
        if (heldAny(dropIds) > 0) {
            return true;
        }
        log(kills === 1
            ? `the ${npcName} left no '${dropName}' within 14 tiles`
            : `${kills} ${npcName}s died without dropping '${dropName}'`);
        return false;
    };
}

// Why: `light_jogre_bones_inv` drops the bones at the player's tile, lights them 3 ticks later, then burns for 25-50 ticks before `obj_addall` puts the burnt bones back on the ground.
// Why: a walktrigger clears the timer, so nothing may move until the fire catches.

/** Burn Jogre bones with the tinderbox and pick the burnt ones back up. */
export async function burnJogreBones(log: Log): Promise<boolean> {
    if (heldId(TB_ID.BURNT_JOGRE_BONES) > 0) {
        return true;
    }
    if (await takeGround([TB_ID.BURNT_JOGRE_BONES], TB_NAME.BURNT_JOGRE_BONES, () => undefined)) {
        return true;
    }
    // Why: lighting drops the bones on the floor first, so a run that lost the roll left them there rather than in the pack.
    if (heldId(TB_ID.JOGRE_BONES) === 0) {
        await takeGround([TB_ID.JOGRE_BONES], TB_NAME.JOGRE_BONES, () => undefined);
    }
    const bones = Inventory.items().find(i => i.id === TB_ID.JOGRE_BONES);
    const tinderbox = Inventory.items().find(i => i.id === TB_ID.TINDERBOX);
    if (!bones || !tinderbox) {
        log('need both Jogre bones and a Tinderbox to burn them');
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await bones.useOn(tinderbox))) {
        return false;
    }
    // Why: a tile that already carries a loc refuses with a chat line and nothing else, so the
    // refusal is read rather than waited out, a minute and a half per attempt otherwise.
    if (await Execution.delayUntil(() => GameMessages.sawSince(mark, CANT_LIGHT), 3000)) {
        const here = Game.tile();
        log(`cannot light a fire at (${here?.x},${here?.z}) — stepping aside`);
        if (here) {
            await Traversal.walkResilient(new Tile(here.x + 2, here.z + 1, here.level), { radius: 0, attempts: 1, log });
        }
        return false;
    }
    const at = Game.tile();
    const lit = await Execution.delayUntil(
        () => GroundItems.query().where(g => g.id === TB_ID.BURNT_JOGRE_BONES).within(6).exists(),
        90_000
    );
    if (!lit) {
        log(`the bones never caught at (${at?.x},${at?.z}) — the roll never landed`);
        return false;
    }
    return takeGround([TB_ID.BURNT_JOGRE_BONES], TB_NAME.BURNT_JOGRE_BONES, log);
}
