import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Npcs } from '../queries/Npcs.js';
import { Inventory } from './Inventory.js';

/**
 * Ids discovered live against the dev engine (2026-07-05).
 * Every shop in the game (general store, sword shop,
 * ...) opens the same `shop_template`/`shop_template_side` interface pair
 * (content/scripts/shop/scripts/shop.rs2 `openshop`/`openshop_activenpc`),
 * so these are content-build constants, not per-shop values -- same
 * hardcode-after-discovery shape as `ClientAdapter.ts`'s `WELCOME_SCREEN`.
 * Re-verify after a Content upgrade.
 */
const SHOP_ROOT = 3824; // shop_template main modal
const SHOP_STOCK_COM = 3900; // shop_template:inv -- iop Value/Buy 1/Buy 5/Buy 10
const SHOP_PLAYER_COM = 3823; // shop_template_side:inv -- iop Value/Sell 1/Sell 5/Sell 10

/**
 * Shop access (read + component-button buy/sell) -- the first buy/sell
 * primitive in the bot. The shop screen is a main+side modal
 * exactly like the bank (`hud/Bank.ts`): the main panel is the shop's stock,
 * the side panel swaps the backpack to a Sell-* view while it's open.
 */
export const Shop = {
    isOpen(): boolean {
        return reader.modals().main === SHOP_ROOT;
    },

    /**
     * Trade with `npcName` -- walks nothing, the caller must already be near
     * (same contract as `Npc.interact`). False if no such npc offers Trade
     * nearby, or the shop window never opens.
     *
     * Retries the click up to 3 times (re-querying the npc each time, in
     * case it wandered or left the scene). Confirmed live
     * that a single 'Trade' click can silently not register -- attempt 1
     * dispatches fine (`interactNpc` returns true, a real OPNPC3 packet
     * goes out) but the shop never opens within a generous window, while an
     * identical second click moments later opens it right away. Same
     * "verify against game state, don't trust the click" principle as
     * `Equipment.equip`/`unequip`, just extended to cover a dropped click,
     * not only a slow one.
     */
    async open(npcName: string): Promise<boolean> {
        if (Shop.isOpen()) {
            return true;
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            const npc = Npcs.query().name(npcName).action('Trade').nearest();
            if (!npc) {
                return false;
            }

            await npc.interact('Trade');
            if (await Execution.delayUntil(() => Shop.isOpen(), 3000)) {
                return true;
            }
        }

        return false;
    },

    /** The open shop's stock (name/count/slot), or [] while no shop is open. */
    stock(): { name: string; count: number; slot: number }[] {
        if (!Shop.isOpen()) {
            return [];
        }

        const out: { name: string; count: number; slot: number }[] = [];
        for (const s of reader.shopInv(SHOP_STOCK_COM)) {
            if (s.name !== null) {
                out.push({ name: s.name, count: s.count, slot: s.slot });
            }
        }

        return out;
    },

    /**
     * Buy up to `n` of `name`, clicking the largest Buy-* step (10/5/1) that
     * fits the remainder each time. Stops the moment a click doesn't add any
     * -- out of stock or out of coins are both silent server no-ops
     * (`shop.rs2`'s `buy_item`), never an error -- and returns the count
     * actually bought (may be less than `n`, or 0; never throws).
     */
    async buy(name: string, n: number): Promise<number> {
        let bought = 0;
        while (bought < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_STOCK_COM).find(s => s.name?.toLowerCase() === name.toLowerCase());
            if (!it || it.count === 0) {
                break;
            }

            const opIndex = stepOpIndex(it.ops, 'Buy', n - bought);
            if (opIndex === -1) {
                break;
            }

            const before = countHeld(name);
            await ActionRouter.driver.invButton(it.id, it.slot, it.comId, opIndex + 1);
            await Execution.delayUntil(() => countHeld(name) !== before, 3000);
            const got = countHeld(name) - before;
            if (got <= 0) {
                break;
            }

            bought += got;
        }

        return bought;
    },

    /**
     * Sell up to `n` of `name` from the backpack to the open shop. Same
     * stop-on-no-progress contract as `buy()` (a full shop / unsellable item
     * are both silent no-ops server-side, per `shop.rs2`'s
     * `can_sell_obj`/`sell_item`).
     */
    async sell(name: string, n: number): Promise<number> {
        let sold = 0;
        while (sold < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_PLAYER_COM).find(s => s.name?.toLowerCase() === name.toLowerCase());
            if (!it) {
                break;
            }

            const opIndex = stepOpIndex(it.ops, 'Sell', n - sold);
            if (opIndex === -1) {
                break;
            }

            const before = countHeld(name);
            await ActionRouter.driver.invButton(it.id, it.slot, it.comId, opIndex + 1);
            await Execution.delayUntil(() => countHeld(name) !== before, 3000);
            const gone = before - countHeld(name);
            if (gone <= 0) {
                break;
            }

            sold += gone;
        }

        return sold;
    },

    /**
     * Close the shop window -- a real CLOSE_MODAL packet
     * (`actions.closeModal`), not just a local reset, so the server's
     * `[if_close,shop_template]` trigger actually stops transmitting stock
     * updates. No-op if already closed.
     */
    async close(): Promise<void> {
        if (!Shop.isOpen()) {
            return;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Shop.isOpen(), 3000);
    }
};

/**
 * Held count of `name` in the real backpack. Deliberately reads
 * `reader.inventory()` (the same source `Inventory.contains`/`first` use),
 * NOT `reader.shopInv(SHOP_PLAYER_COM)` -- the shop-mode side panel is a
 * second, independently-`inv_transmit`'d mirror of the same underlying
 * container, and empirically (probed live, both directions observed)
 * the two can each land a tick or so ahead of the other under load, with no
 * fixed winner. Buying/selling still *dispatches* against
 * `shopInv(SHOP_PLAYER_COM)`'s item (it's the only component exposing
 * Sell-* ops), but verifying progress against the same source a caller will
 * check afterward (`Inventory.contains`) avoids a spurious "0 transacted"
 * or "still holds it" read on the boundary tick.
 */
function countHeld(name: string): number {
    return Inventory.count(name);
}

/** Index of the largest `${verb} <10|5|1>` op that fits `remaining`, or -1 if none of the three is offered. */
function stepOpIndex(ops: (string | null)[], verb: 'Buy' | 'Sell', remaining: number): number {
    const step = remaining >= 10 ? `${verb} 10` : remaining >= 5 ? `${verb} 5` : `${verb} 1`;
    return ops.findIndex(o => o?.toLowerCase() === step.toLowerCase());
}
