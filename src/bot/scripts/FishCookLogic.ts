/** Pure helpers for Fisher cook-after-fish modes (no client deps). */

export const COOK_MODE_OPTIONS = ['Off', 'Cook then bank', 'Bank raw then cook'] as const;
export type CookModeLabel = (typeof COOK_MODE_OPTIONS)[number];
export type CookMode = 'off' | 'cook-then-bank' | 'bank-raw-then-cook';

export const BURNT_POLICY_OPTIONS = ['Drop', 'Bank'] as const;
export type BurntPolicyLabel = (typeof BURNT_POLICY_OPTIONS)[number];
export type BurntPolicy = 'drop' | 'bank';

/** After one cook cycle (cook load + bank cooked): stop the script or keep fishing. */
export const AFTER_COOK_OPTIONS = ['Stop', 'Continue'] as const;
export type AfterCookLabel = (typeof AFTER_COOK_OPTIONS)[number];
export type AfterCookCycle = 'stop' | 'continue';

/**
 * Which raw fish to cook. "All raw" cooks everything;
 * named options + Custom cover tuna-vs-swordfish style splits.
 */
export const COOK_FISH_OPTIONS = [
    'All raw',
    'Tuna',
    'Swordfish',
    'Lobster',
    'Shark',
    'Salmon',
    'Trout',
    'Shrimps',
    'Anchovies',
    'Custom'
] as const;

export function parseCookMode(label: string): CookMode {
    switch (label.trim().toLowerCase()) {
        case 'cook then bank':
            return 'cook-then-bank';
        case 'bank raw then cook':
            return 'bank-raw-then-cook';
        default:
            return 'off';
    }
}

export function parseBurntPolicy(label: string): BurntPolicy {
    return label.trim().toLowerCase() === 'bank' ? 'bank' : 'drop';
}

export function parseAfterCookCycle(label: string): AfterCookCycle {
    return label.trim().toLowerCase() === 'continue' ? 'continue' : 'stop';
}

/**
 * Resolve the contains-filter used against raw fish names.
 * Empty string = all raw fish.
 */
export function resolveCookFishFilter(option: string, custom: string): string {
    const o = option.trim().toLowerCase();
    if (o === '' || o === 'all raw' || o === 'all') {
        return '';
    }
    if (o === 'custom') {
        return custom.trim();
    }
    return option.trim();
}

/** Parse a free-form / number setting into a positive int (no artificial max). */
export function parsePositiveInt(raw: unknown, fallback: number): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(1, Math.floor(raw));
    }
    if (typeof raw === 'string') {
        const n = Number(raw.trim().replace(/[,_\s]/g, ''));
        if (Number.isFinite(n) && n > 0) {
            return Math.floor(n);
        }
    }
    return Math.max(1, Math.floor(fallback));
}

export function isRawFishName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return n.startsWith('raw ') || n.includes('raw fish');
}

export function isBurntFishName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return n.startsWith('burnt ') || n === 'burnt fish';
}

/** Cooked fish product (not raw, not burnt). Matches common RS names. */
export function isCookedFishName(name: string | null | undefined): boolean {
    if (isRawFishName(name) || isBurntFishName(name)) {
        return false;
    }
    const n = (name ?? '').toLowerCase();
    if (n.length === 0) {
        return false;
    }
    // Common cooked fish names in classic / 2004scape-style lists
    const cooked = [
        'shrimps',
        'anchovies',
        'sardine',
        'herring',
        'mackerel',
        'trout',
        'cod',
        'pike',
        'salmon',
        'tuna',
        'lobster',
        'bass',
        'swordfish',
        'shark',
        'manta ray',
        'sea turtle',
        'karambwan',
        'cooked'
    ];
    return cooked.some(k => n === k || n.includes(k));
}

/**
 * Does this raw fish match the cook filter?
 * Filter is a contains match; "raw " prefix on the filter is optional.
 * Empty filter = all raw.
 */
export function rawMatchesCookFilter(name: string | null | undefined, filter: string): boolean {
    if (!isRawFishName(name)) {
        return false;
    }
    const f = filter.trim().toLowerCase();
    if (f.length === 0) {
        return true;
    }
    const n = (name ?? '').toLowerCase();
    const bare = f.replace(/^raw\s+/, '');
    return n.includes(f) || (bare.length > 0 && n.includes(bare));
}

export function countMatching(items: readonly { name: string | null }[], pred: (n: string | null) => boolean): number {
    return items.filter(i => pred(i.name)).length;
}

export function lastMatchingIndex(items: readonly { name: string | null }[], pred: (n: string | null) => boolean): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (pred(items[i].name)) {
            return i;
        }
    }
    return -1;
}

/** Sum stack counts of matching raw fish in a bank snapshot (API truth). */
export function countRawInBank(
    items: readonly { name: string | null; count: number }[],
    filter: string
): number {
    return items
        .filter(i => rawMatchesCookFilter(i.name, filter))
        .reduce((sum, i) => sum + (Number.isFinite(i.count) ? i.count : 0), 0);
}

/** Cook-then-bank: full pack with cookable raw → cook before banking. */
export function shouldCookThenBank(mode: CookMode, inventoryFull: boolean, cookableRawCount: number): boolean {
    return mode === 'cook-then-bank' && inventoryFull && cookableRawCount > 0;
}

/** Still mid cook load (cookable raw left). */
export function shouldFinishCookLoad(mode: CookMode, cooking: boolean, cookableRawCount: number): boolean {
    return mode !== 'off' && cooking && cookableRawCount > 0;
}

/**
 * Bank-raw-then-cook: start a cook batch once the bank's live raw total
 * (for the cook filter) reaches the threshold.
 */
export function shouldStartBankRawCookBatch(mode: CookMode, bankRawTotal: number, target: number): boolean {
    return mode === 'bank-raw-then-cook' && target > 0 && bankRawTotal >= target;
}

/**
 * Once a cook batch is committed, keep withdrawing/cooking until the bank
 * has no cookable raw left — do NOT re-check the N threshold after each
 * 28-slot load (that would thrash: withdraw → bank now &lt; N → fish again).
 */
export function shouldKeepDrainingCookBatch(inCookBatch: boolean, bankRawRemaining: number): boolean {
    return inCookBatch && bankRawRemaining > 0;
}

/**
 * End-of-load decision for bank-raw-then-cook.
 * - remaining &gt; 0 → stay in batch (another withdraw)
 * - remaining === 0 + stop → halt script
 * - remaining === 0 + continue → back to fishing for the next +N
 */
export type CookBatchLoadOutcome = 'drain-more' | 'stop' | 'fish-again';

export function cookBatchAfterLoad(
    bankRawRemaining: number,
    afterCook: AfterCookCycle
): CookBatchLoadOutcome {
    if (bankRawRemaining > 0) {
        return 'drain-more';
    }
    return afterCook === 'continue' ? 'fish-again' : 'stop';
}

/** Human-ish pause between individual cook uses (ms). */
export function cookHumanDelayMs(rand: () => number = Math.random): number {
    // ~1–3 ticks of jitter without looking robotic
    return 180 + Math.floor(rand() * 520);
}

/** Human-ish pause after a bank open / before withdraw (ms). */
export function bankHumanDelayMs(rand: () => number = Math.random): number {
    return 250 + Math.floor(rand() * 700);
}

export function cookedNameFromRaw(rawName: string): string {
    const n = rawName.trim();
    if (/^raw\s+/i.test(n)) {
        return n.replace(/^raw\s+/i, '');
    }
    return n;
}

/** Paint / log label for the cook filter. */
export function cookFilterLabel(filter: string): string {
    return filter.trim().length === 0 ? 'all raw' : filter.trim();
}
