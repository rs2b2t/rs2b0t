

export const COOK_MODE_OPTIONS = ['Off', 'Cook then bank', 'Bank raw then cook'] as const;
export type CookMode = 'off' | 'cook-then-bank' | 'bank-raw-then-cook';

export const BURNT_POLICY_OPTIONS = ['Drop', 'Bank'] as const;
export type BurntPolicy = 'drop' | 'bank';

export const AFTER_COOK_OPTIONS = ['Stop', 'Continue'] as const;
export type AfterCookCycle = 'stop' | 'continue';

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

const COOKED_FISH_NAMES = new Set([
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
    'karambwan'
]);

export function isCookedFishName(name: string | null | undefined): boolean {
    if (isRawFishName(name) || isBurntFishName(name)) {
        return false;
    }
    const n = (name ?? '').trim().toLowerCase();
    if (n.length === 0) {
        return false;
    }
    if (COOKED_FISH_NAMES.has(n)) {
        return true;
    }
    if (n.startsWith('cooked ')) {
        const rest = n.slice('cooked '.length);
        return COOKED_FISH_NAMES.has(rest) || rest === 'fish';
    }
    return false;
}

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

export function countRawInBank(
    items: readonly { name: string | null; count: number }[],
    filter: string
): number {
    return items
        .filter(i => rawMatchesCookFilter(i.name, filter))
        .reduce((sum, i) => sum + (Number.isFinite(i.count) ? i.count : 0), 0);
}

export function shouldCookThenBank(mode: CookMode, inventoryFull: boolean, cookableRawCount: number): boolean {
    return mode === 'cook-then-bank' && inventoryFull && cookableRawCount > 0;
}

export function shouldFinishCookLoad(mode: CookMode, cooking: boolean, cookableRawCount: number): boolean {
    return mode !== 'off' && cooking && cookableRawCount > 0;
}

export function shouldStartBankRawCookBatch(mode: CookMode, bankRawTotal: number, target: number): boolean {
    return mode === 'bank-raw-then-cook' && target > 0 && bankRawTotal >= target;
}

export function shouldKeepDrainingCookBatch(inCookBatch: boolean, bankRawRemaining: number): boolean {
    return inCookBatch && bankRawRemaining > 0;
}

type CookBatchLoadOutcome = 'drain-more' | 'stop' | 'fish-again';

export function cookBatchAfterLoad(
    bankRawRemaining: number,
    afterCook: AfterCookCycle
): CookBatchLoadOutcome {
    if (bankRawRemaining > 0) {
        return 'drain-more';
    }
    return afterCook === 'continue' ? 'fish-again' : 'stop';
}

/** 1 tick between single-fish cook actions (this revision has no Make-X). */
export function cookPaceTicks(_rand: () => number = Math.random): number {
    return 1;
}

/** 1–2 ticks between bank UI steps (aligned with api/bank/Banking bankPaceTicks). */
export function bankPaceTicks(rand: () => number = Math.random): number {
    return rand() < 0.35 ? 2 : 1;
}

export function cookedNameFromRaw(rawName: string): string {
    const n = rawName.trim();
    if (/^raw\s+/i.test(n)) {
        return n.replace(/^raw\s+/i, '');
    }
    return n;
}

export function cookFilterLabel(filter: string): string {
    return filter.trim().length === 0 ? 'all raw' : filter.trim();
}
