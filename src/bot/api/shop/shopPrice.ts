/** The engine's own shop price curve, so a script can budget a buyout before it opens the counter.
 *  Why: `calc_shop_value` raises the price with every one bought, `max(100, sell - clamp(-bought * delta, -5000, 1000))` scaled by the base cost, so a full shelf costs far more than stock times cost and a trip funded on that arithmetic comes home with change and no goods. */

/** The `shop_sell_multiplier` and `shop_delta` a shopkeeper carries when its npc names neither. */
export const SHOP_SELL_MULTIPLIER = 100;
export const SHOP_DELTA = 10;

/** What the next one costs once `bought` have left the shelf. */
export function shopBuyPrice(
    baseCost: number,
    bought: number,
    sellMultiplier = SHOP_SELL_MULTIPLIER,
    delta = SHOP_DELTA
): number {
    const swing = Math.min(1000, Math.max(-5000, -bought * delta));
    return Math.max(1, Math.floor((Math.max(100, sellMultiplier - swing) * baseCost) / 1000));
}

/** Coins a full shelf costs, summed one at a time. */
export function buyoutCost(baseCost: number, stock: number, sellMultiplier?: number, delta?: number): number {
    let total = 0;
    for (let bought = 0; bought < stock; bought++) {
        total += shopBuyPrice(baseCost, bought, sellMultiplier, delta);
    }
    return total;
}
