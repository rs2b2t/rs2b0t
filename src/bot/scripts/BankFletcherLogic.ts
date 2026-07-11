/** Pure product-matching helpers for BankFletcher (no client imports → plain bun test).
 *
 *  Knife-on-logs opens a "What would you like to make?" menu whose options may be
 *  exposed as ITEM NAMES (`Arrow shaft`, `Shortbow (u)`, `Longbow (u)`) or as
 *  LABEL TEXT (`15 Arrow Shafts`, `Short Bow`, `Long Bow`) depending on the build.
 *  So we never match an exact string — we match the distinguishing KEYWORD for the
 *  chosen product against each offered option. */

/** Distinguishing keywords per product setting (case-insensitive substring). The
 *  keywords are chosen so a product only ever matches its own menu option: a bow
 *  option never contains "shaft"/"arrow", and "short"/"long" never collide. */
const PRODUCT_KEYWORDS: Record<string, string[]> = {
    'arrow shafts': ['shaft', 'arrow'],
    'short bow': ['short'],
    'long bow': ['long']
};

/** The distinguishing keywords for `product`, or the product text itself as a
 *  single keyword when it isn't one of the known presets. */
export function productKeywords(product: string): string[] {
    const key = product.trim().toLowerCase();
    return PRODUCT_KEYWORDS[key] ?? (key.length > 0 ? [key] : []);
}

/**
 * Given the make-menu option strings and a product setting, return the FIRST
 * option that contains one of the product's distinguishing keywords, or null.
 * The returned string is one of `options` verbatim, so it can be fed straight
 * back to `ChatDialog.make()` (whose own substring match will re-find it).
 */
export function matchProduct(options: readonly string[], product: string): string | null {
    const keys = productKeywords(product);
    if (keys.length === 0) {
        return null;
    }
    for (const opt of options) {
        const lc = (opt ?? '').toLowerCase();
        if (keys.some(k => lc.includes(k))) {
            return opt;
        }
    }
    return null;
}
