/**
 * Pure decisions for VialFiller, kept out of the game-touching bot so the
 * restock cadence and the buy size can be tested without a client.
 */

/** Empty vials do not stack, so a restock can only be as big as the free pack. */
export function vialsToBuy(freeSlots: number, want: number): number {
    return Math.max(0, Math.min(freeSlots, want));
}

/**
 * A shop run happens every Nth completed trip, never on the very first one —
 * the first trip proves the bank/fountain loop before walking to Taverley.
 */
export function isShopRun(runs: number, buyVials: boolean, everyN: number): boolean {
    if (!buyVials || runs <= 0 || everyN <= 0) {
        return false;
    }
    return runs % everyN === 0;
}
