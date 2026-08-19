import Tile from '../../../../../geometry/Tile.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Shop } from '../../../../shop/Shop.js';
import { Reach } from '../../../../walking/Reach.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { driveChoice, settleScene } from '../../exec/prompts.js';
import { QuestFood } from '../../food.js';
import { DIG_ID, DIG_ITEM, DIG_LOC, DIG_NPC, DIG_SOIL_IDS, DIG_TILE } from './areas.js';
import { dropSpoil, driveUntilHeld, heldId, locByIdAction, locByIds, npcById, talkToNpcId, walkTo } from './common.js';

/** Coin low-water mark and top-up. Nothing here costs more than 20gp; the float covers a death. */
const COIN_LOW = 200;
const COIN_FLOAT = 5000;
const FOOD_TARGET = 8;
const FOOD_LOW = 3;

export const SHOP = {
    GENERAL: { npc: 'Shop keeper', anchor: DIG_TILE.GENERAL_STORE },
    TEA: { npc: 'Tea seller', anchor: DIG_TILE.TEA_SELLER },
    /** The nearest herblore counter: nothing closer to Varrock stocks a vial or a pestle. */
    HERBLORE: { npc: 'Jatix', anchor: DIG_TILE.JATIX }
} as const;

// Why: the panning invite is a `%itexam_bits` bit the client never sees, and the guide's greeting wraps across components, so the pan attempt itself is the oracle: he steps in, or he does not.

/** What the last refused pan taught this session. */
export const DigsiteState = {
    teaWanted: false
};

export function resetDigsiteState(): void {
    DigsiteState.teaWanted = false;
}

// Why: `ownsInventory` opts the module out of the engine's coin and food withdrawal, so both are drawn here.

/** The coin and food top-up, or null when the pack is ready. */
export function kit(snap: QuestSnapshot): QuestStep | null {
    const coinsHeld = heldId(snap, DIG_ID.COINS);
    const coinsBanked = snap.bankKnown ? (snap.bankIds?.get(DIG_ID.COINS) ?? 0) : 0;
    const needCoins = coinsHeld < COIN_LOW && coinsBanked > 0;

    const foodName = QuestFood.name?.trim();
    const foodHeld = foodName ? (snap.inv.get(foodName.toLowerCase()) ?? 0) : 0;
    const foodBanked = foodName ? (snap.bank?.get(foodName.toLowerCase()) ?? 0) : 0;
    const needFood = Boolean(foodName) && foodHeld < FOOD_LOW && foodBanked > 0;

    if (!needCoins && !needFood) {
        return null;
    }
    const items: { name: string; qty: number; id?: number }[] = [];
    if (needCoins) {
        items.push({ name: DIG_ITEM.COINS, qty: Math.min(COIN_FLOAT, coinsBanked), id: DIG_ID.COINS });
    }
    if (needFood && foodName) {
        items.push({ name: foodName, qty: Math.min(FOOD_TARGET - foodHeld, foodBanked) });
    }
    return { kind: 'withdraw', items, bank: DIG_TILE.VARROCK_BANK };
}

export function buy(item: string, qty: number, shop: { npc: string; anchor: Tile }, estGp: number): QuestStep {
    return { kind: 'buy', item, qty, shop: { npc: shop.npc, anchor: shop.anchor }, estGp };
}

// Why: Jatix is four hundred tiles from the site and the only counter within reach that stocks either, so both are bought on one trip rather than one per `buy` step.

/** The vial and the pestle, from the nearest herblore counter, in a single visit. */
export function herbloreKit(needVial: boolean, needPestle: boolean): QuestStep {
    const wanted = [needVial ? DIG_ITEM.VIAL : '', needPestle ? DIG_ITEM.PESTLE : ''].filter(Boolean);
    return {
        kind: 'custom',
        name: `buy ${wanted.join(' and ')} from ${SHOP.HERBLORE.npc}`,
        run: async log => {
            if (!(await walkTo(SHOP.HERBLORE.anchor, 3, log))) {
                return false;
            }
            if (!(await Shop.open(SHOP.HERBLORE.npc))) {
                log(`no ${SHOP.HERBLORE.npc} shop at (${SHOP.HERBLORE.anchor.x},${SHOP.HERBLORE.anchor.z})`);
                return false;
            }
            if (needVial) {
                await Shop.buy(DIG_ITEM.VIAL, 1);
            }
            if (needPestle) {
                await Shop.buy(DIG_ITEM.PESTLE, 1);
            }
            await Shop.close();
            const gotVial = !needVial || Inventory.countById(DIG_ID.VIAL) > 0;
            const gotPestle = !needPestle || Inventory.countById(DIG_ID.PESTLE) > 0;
            if (!gotVial || !gotPestle) {
                log(`the herblore counter was short (vial=${gotVial}, pestle=${gotPestle})`);
            }
            return gotVial && gotPestle;
        }
    };
}

/** The lone panning tray spawn sits on a blocked tile, so the Take is clicked from the tile north of it. */
export async function takePanningTray(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(DIG_ID.TRAY_EMPTY) + Inventory.countById(DIG_ID.TRAY_MUD) > 0) {
        return true;
    }
    if (!(await walkTo(DIG_TILE.TRAY_SPAWN_STAND, 0, log))) {
        return false;
    }
    await settleScene();
    const tray = GroundItems.query().where(g => g.id === DIG_ID.TRAY_EMPTY).within(3).nearest();
    if (!tray) {
        log('no panning tray on the ground at (3369,3378) — it respawns, so this retries');
        await Execution.delayTicks(4);
        return false;
    }
    if (!(await tray.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(DIG_ID.TRAY_EMPTY) > 0, 8000);
}

/** The sacks beside the southern dig hold a specimen jar for anyone not already carrying one. */
export async function takeSpecimenJar(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(DIG_ID.SPECIMEN_JAR) > 0) {
        return true;
    }
    if (!(await walkTo(DIG_TILE.SACKS_STAND, 1, log))) {
        return false;
    }
    await settleScene();
    const sacks = locByIdAction([DIG_LOC.SAMPLE_SACKS], 'Search', 6);
    if (!sacks) {
        log('no sample sacks within six tiles of (3359,3399)');
        return false;
    }
    if (!(await sacks.interact('Search'))) {
        return false;
    }
    return driveUntilHeld(() => Inventory.countById(DIG_ID.SPECIMEN_JAR) > 0, [], log, 15_000);
}

const STEAL_SETTLED = /you steal|you find a specimen brush|you fail to pick|stunned/i;
const PICKPOCKET_MS = 8 * 60_000;
// Why: a pocket hands over four pairs of gloves and six brushes on the way to two ropes, and a leg that only tidies at four free slots hands the cave legs a full pack.
const SPOIL_FREE = 10;

// Why: the specimen brush has no other source in the game — "we have a bit of a shortage of those at the moment" — and the green student's rock sample is only ever a pocket.

/** Steal from digsite workmen until the goal lands, dropping the spade-and-bucket spoil as it comes. */
export async function pickpocketWorkman(
    want: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (want()) {
        return true;
    }
    if (!npcById(DIG_NPC.WORKMAN, 10) && !(await walkTo(DIG_TILE.WORKMEN, 5, log))) {
        return false;
    }
    const deadline = performance.now() + PICKPOCKET_MS;
    while (performance.now() < deadline && !want()) {
        if (EventSignal.pending()) {
            return want();
        }
        await Modals.closeIfOpen();
        await dropSpoil(log, SPOIL_FREE);
        if (!npcById(DIG_NPC.WORKMAN, 14)) {
            await walkTo(DIG_TILE.WORKMEN, 4, log);
            await settleScene();
            continue;
        }
        const mark = GameMessages.mark();
        const target = npcById(DIG_NPC.WORKMAN, 14);
        const status = await Reach.entityOp({
            find: () => npcById(DIG_NPC.WORKMAN, 14),
            op: 'Steal-from',
            expect: () => want() || Modals.isOpen() || GameMessages.sawSince(mark, STEAL_SETTLED),
            expectMs: 12_000,
            what: 'digsite workman',
            log
        });
        // Why: the nearest workman is often inside a fenced dig site, and the server refuses a pocket it cannot path to — walking at his own tile lets the baked graph find the gate.
        if (status === 'unreachable' && target) {
            await walkTo(target.tile() as Tile, 2, log);
        }
        if (GameMessages.sawSince(mark, /stunned/i)) {
            await Execution.delayTicks(9);
        }
        await Execution.delayTicks(1);
    }
    await Modals.closeIfOpen();
    await dropSpoil(log, SPOIL_FREE);
    if (want()) {
        return true;
    }
    log(`${Math.round(PICKPOCKET_MS / 60_000)}min of pickpocketing did not turn up what the quest needs`);
    return false;
}

const PAN_MS = 10 * 60_000;

/** Pan and search the tray until the wanted object lands. */
export async function panUntil(want: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (want()) {
        return true;
    }
    if (!(await takePanningTray(log))) {
        return false;
    }
    if (!(await walkTo(DIG_TILE.PANNING_STAND, 1, log))) {
        return false;
    }
    const deadline = performance.now() + PAN_MS;
    while (performance.now() < deadline && !want()) {
        if (EventSignal.pending()) {
            return want();
        }
        // Why: every pan and every search ends in an objbox, and leaving it up makes the next click's "did a dialogue open?" read the last one.
        for (let i = 0; i < 4 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
        }
        await Modals.closeIfOpen();
        await dropSpoil(log, SPOIL_FREE);

        const mud = Inventory.items().find(i => i.id === DIG_ID.TRAY_MUD);
        if (mud) {
            if (await mud.interact('Search')) {
                await Execution.delayUntil(() => Inventory.countById(DIG_ID.TRAY_MUD) === 0, 10_000);
            }
            await Execution.delayTicks(1);
            continue;
        }
        if (Inventory.countById(DIG_ID.TRAY_EMPTY) === 0) {
            if (!(await takePanningTray(log))) {
                return want();
            }
            continue;
        }
        await settleScene();
        const point = locByIdAction([DIG_LOC.PANNING_POINT], 'Look', 8);
        if (!point) {
            await walkTo(DIG_TILE.PANNING_STAND, 1, log);
            continue;
        }
        if (!(await point.interact('Look'))) {
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayUntil(
            () => Inventory.countById(DIG_ID.TRAY_MUD) > 0 || ChatDialog.isOpen() || ChatDialog.canContinue(),
            12_000
        );
        // Why: a filled tray is the success oracle and it lands before the objbox, so the dialogue test only means anything once the tray is still empty.
        if (Inventory.countById(DIG_ID.TRAY_MUD) > 0) {
            continue;
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            const teaBefore = Inventory.countById(DIG_ID.CUP_OF_TEA);
            await driveChoice(['So how do I become invited then?', "I've some here that you can have."], log);
            await Modals.closeIfOpen();
            if (Inventory.countById(DIG_ID.CUP_OF_TEA) < teaBefore) {
                DigsiteState.teaWanted = false;
                log('the panning guide took the tea at the water');
                continue;
            }
            DigsiteState.teaWanted = true;
            log('the panning guide refused the pan — he wants a cup of tea');
            return want();
        }
    }
    await Modals.closeIfOpen();
    await dropSpoil(log, SPOIL_FREE);
    return want();
}

const DIG_MS = 12 * 60_000;
const DUG_THROUGH = /you dig through the earth/i;
/** Every branch of every dig loot table opens with "You find", including the empty one. */
const DIG_SETTLED = /you find/i;

export interface DigZone {
    stand: Tile;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

// Why: `[oplocu,_digsite_soil]` picks the exam level from the SOIL's own coordinate, not the player's, so a soil loc a tile outside the zone is a different site with a different refusal.

/** Use the trowel on soil inside one dig zone until the wanted object lands. */
export async function digUntil(zone: DigZone, want: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (want()) {
        return true;
    }
    if (!(await walkTo(zone.stand, 0, log))) {
        return false;
    }
    const deadline = performance.now() + DIG_MS;
    let refusals = 0;
    while (performance.now() < deadline && !want()) {
        if (EventSignal.pending()) {
            return want();
        }
        await driveChoice([], log);
        await Modals.closeIfOpen();
        await dropSpoil(log, SPOIL_FREE);
        const trowel = Inventory.items().find(i => i.id === DIG_ID.TROWEL);
        if (!trowel) {
            log('no trowel in the pack to dig with');
            return false;
        }
        await settleScene();
        const soil = locByIds(DIG_SOIL_IDS, 2, l => {
            const t = l.tile();
            return t.x >= zone.minX && t.x <= zone.maxX && t.z >= zone.minZ && t.z <= zone.maxZ;
        });
        if (!soil) {
            log(`no diggable soil inside x ${zone.minX}..${zone.maxX}, z ${zone.minZ}..${zone.maxZ}`);
            await walkTo(zone.stand, 0, log);
            continue;
        }
        const mark = GameMessages.mark();
        if (!(await trowel.useOn(soil))) {
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayUntil(
            () => want() || Modals.isOpen() || ChatDialog.isOpen() || ChatDialog.canContinue()
                || GameMessages.sawSince(mark, DUG_THROUGH),
            15_000
        );
        // Why: a workman within ten tiles turns every refusal into a `~chatnpcnoturn` line rather than a message, so the absence of "You dig through the earth" is what says the pack is short a jar, a brush or a certificate.
        if (want() || GameMessages.sawSince(mark, DUG_THROUGH)) {
            refusals = 0;
            // Why: the find lands six ticks after that message and the player is delayed until it does, so a trowel clicked on the message is dropped and the loop pays a full timeout for the next one.
            await Execution.delayUntil(() => want() || GameMessages.sawSince(mark, DIG_SETTLED), 12_000);
        } else if (++refusals >= 3) {
            for (const line of GameMessages.since(mark)) {
                log(`dig refused: ${line.text}`);
            }
            log(`three digs at (${zone.stand.x},${zone.stand.z}) turned no earth — the site refused them`);
            await driveChoice([], log);
            await Modals.closeIfOpen();
            return false;
        }
        await Execution.delayTicks(1);
    }
    await Modals.closeIfOpen();
    await dropSpoil(log, SPOIL_FREE);
    return want();
}

export { talkToNpcId };
