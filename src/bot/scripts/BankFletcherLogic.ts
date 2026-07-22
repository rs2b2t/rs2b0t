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

/** One attach product: use `inputs[0]` ON `inputs[1]`; the engine attaches
 *  min(count(a), count(b), 15) per click (content: skill_fletching/arrows.rs2)
 *  and refuses below `level` (fletching_table). Display names, exact. */
export interface AttachPlan {
    inputs: [string, string];
    product: string;
    level: number;
}

/** Attach products by lowercase option name — the engine's fletching_table
 *  (bronze 1 / iron 15 / steel 30 / mithril 45 / adamant 60 / rune 75). Inputs
 *  are DISPLAY names (what the pack/bank shows): arrowheads display as
 *  '<Metal> arrowtips' (obj debugname is <metal>_arrowheads — arrows.obj). */
export const ATTACH_PRODUCTS: Record<string, AttachPlan> = {
    'headless arrows': { inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 },
    'bronze arrows': { inputs: ['Bronze arrowtips', 'Headless arrow'], product: 'Bronze arrow', level: 1 },
    'iron arrows': { inputs: ['Iron arrowtips', 'Headless arrow'], product: 'Iron arrow', level: 15 },
    'steel arrows': { inputs: ['Steel arrowtips', 'Headless arrow'], product: 'Steel arrow', level: 30 },
    'mithril arrows': { inputs: ['Mithril arrowtips', 'Headless arrow'], product: 'Mithril arrow', level: 45 },
    'adamant arrows': { inputs: ['Adamant arrowtips', 'Headless arrow'], product: 'Adamant arrow', level: 60 },
    'rune arrows': { inputs: ['Rune arrowtips', 'Headless arrow'], product: 'Rune arrow', level: 75 }
};

/** The attach plan for a product option, or null for knife products. */
export function attachPlanFor(product: string): AttachPlan | null {
    return ATTACH_PRODUCTS[product.trim().toLowerCase()] ?? null;
}
