export const LOG_OPTIONS = ['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs', 'Magic logs'];

export function logNameMatches(itemName: string | null | undefined, material: string): boolean {
    if (itemName === null || itemName === undefined) {
        return false;
    }
    return itemName.trim().toLowerCase() === material.trim().toLowerCase();
}

export function productNeedsDifferentLog(product: string, material: string): boolean {
    return product.trim().toLowerCase() === 'arrow shafts' && material.trim().toLowerCase() !== 'logs';
}

const PRODUCT_KEYWORDS: Record<string, string[]> = {
    'arrow shafts': ['shaft', 'arrow'],
    'short bow': ['short'],
    'long bow': ['long']
};

export function productKeywords(product: string): string[] {
    const key = product.trim().toLowerCase();
    return PRODUCT_KEYWORDS[key] ?? (key.length > 0 ? [key] : []);
}

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

export interface AttachPlan {
    inputs: [string, string];
    product: string;
    level: number;
}

export const ATTACH_PRODUCTS: Record<string, AttachPlan> = {
    'headless arrows': { inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 },
    'bronze arrows': { inputs: ['Bronze arrowtips', 'Headless arrow'], product: 'Bronze arrow', level: 1 },
    'iron arrows': { inputs: ['Iron arrowtips', 'Headless arrow'], product: 'Iron arrow', level: 15 },
    'steel arrows': { inputs: ['Steel arrowtips', 'Headless arrow'], product: 'Steel arrow', level: 30 },
    'mithril arrows': { inputs: ['Mithril arrowtips', 'Headless arrow'], product: 'Mithril arrow', level: 45 },
    'adamant arrows': { inputs: ['Adamant arrowtips', 'Headless arrow'], product: 'Adamant arrow', level: 60 },
    'rune arrows': { inputs: ['Rune arrowtips', 'Headless arrow'], product: 'Rune arrow', level: 75 }
};

export function attachPlanFor(product: string): AttachPlan | null {
    return ATTACH_PRODUCTS[product.trim().toLowerCase()] ?? null;
}
