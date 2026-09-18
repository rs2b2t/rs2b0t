export const FOOD_OPTIONS: string[] = [
    'Shark', 'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout', 'Pike', 'Bass', 'Herring', 'Sardine', 'Anchovies', 'Shrimps',
    'Cooked meat', 'Cooked chicken', 'Bread', 'Stew',
    'Cake', 'Chocolate cake', 'Plain pizza', 'Meat pizza', 'Anchovy pizza', 'Pineapple pizza', 'Redberry pie', 'Meat pie', 'Apple pie'
];

const FOOD_FORMS: Record<string, string[]> = {
    'cake': ['cake', '2/3 cake', 'slice of cake'],
    'chocolate cake': ['chocolate cake', '2/3 chocolate cake', 'chocolate slice'],
    'plain pizza': ['plain pizza', '1/2 plain pizza'],
    'meat pizza': ['meat pizza', '1/2 meat pizza'],
    'anchovy pizza': ['anchovy pizza', '1/2 anchovy pizza'],
    'pineapple pizza': ['pineapple pizza', '1/2 pineapple pizza'],
    'redberry pie': ['redberry pie', 'half a redberry pie'],
    'meat pie': ['meat pie', 'half a meat pie'],
    'apple pie': ['apple pie', 'half an apple pie']
};

/**
 * HP restored by one Eat/Drink of the named food (or a partial form of it).
 * Multi-bite foods list the per-bite heal (a cake slice is 4).
 */
const FOOD_HEAL: Record<string, number> = {
    shrimps: 3,
    shrimp: 3,
    anchovies: 1,
    sardine: 4,
    herring: 5,
    trout: 7,
    pike: 8,
    salmon: 9,
    tuna: 10,
    lobster: 12,
    bass: 13,
    swordfish: 14,
    shark: 20,
    'cooked meat': 3,
    'cooked chicken': 3,
    bread: 5,
    stew: 11,
    cake: 4,
    '2/3 cake': 4,
    'slice of cake': 4,
    'chocolate cake': 5,
    '2/3 chocolate cake': 5,
    'chocolate slice': 5,
    'plain pizza': 7,
    '1/2 plain pizza': 7,
    'meat pizza': 8,
    '1/2 meat pizza': 8,
    'anchovy pizza': 9,
    '1/2 anchovy pizza': 9,
    'pineapple pizza': 11,
    '1/2 pineapple pizza': 11,
    'redberry pie': 5,
    'half a redberry pie': 5,
    'meat pie': 6,
    'half a meat pie': 6,
    'apple pie': 7,
    'half an apple pie': 7
};

/** Always eat at or below this HP when food remains, issue #465 floor. */
export const MIN_EAT_HP = 5;

/** Used only when the food name is unknown. */
const DEFAULT_FOOD_HEAL = 8;

export function foodForms(foodName: string): string[] {
    const key = foodName.toLowerCase();
    return FOOD_FORMS[key] ?? [key];
}

export function isFoodItem(name: string | null | undefined, foodName: string): boolean {
    return foodForms(foodName).includes((name ?? '').toLowerCase());
}

export function foodCount(items: readonly { name: string | null | undefined }[], foodName: string): number {
    return items.filter(i => isFoodItem(i.name, foodName)).length;
}

/**
 * Heal amount for one consume of `foodName`, resolving partial cake/pizza/pie forms and common aliases.
 * Why: unknown names fall back to {@link DEFAULT_FOOD_HEAL} so smart-eat still has a room size above the 5 HP floor.
 */
export function foodHealAmount(foodName: string): number {
    const key = foodName.trim().toLowerCase();
    if (key.length === 0) {
        return DEFAULT_FOOD_HEAL;
    }
    const exact = FOOD_HEAL[key];
    if (exact !== undefined) {
        return exact;
    }
    for (const [parent, forms] of Object.entries(FOOD_FORMS)) {
        if (parent === key || forms.includes(key)) {
            return FOOD_HEAL[parent] ?? FOOD_HEAL[forms[0]!] ?? DEFAULT_FOOD_HEAL;
        }
    }
    for (const [name, heal] of Object.entries(FOOD_HEAL)) {
        if (key.includes(name) || name.includes(key)) {
            return heal;
        }
    }
    return DEFAULT_FOOD_HEAL;
}

/**
 * Absolute HP at or below which we eat for a full (or near-full) use of `heal`,
 * never above maxHp - heal, never below {@link MIN_EAT_HP}.
 */
export function eatAtHpThreshold(maxHp: number, heal: number, minHp: number = MIN_EAT_HP): number {
    if (maxHp <= 0) {
        return minHp;
    }
    const fullUse = maxHp - Math.max(0, heal);
    return Math.max(minHp, Math.min(maxHp - 1, fullUse));
}

/**
 * Eat when a full heal fits (no overheal waste), or HP is at/below the safety
 * floor so we don't die with food still in the pack (#465).
 */
export function shouldEatToUseFood(opts: {
    hp: number;
    maxHp: number;
    heal: number;
    foodCount: number;
    minHp?: number;
}): boolean {
    if (opts.foodCount <= 0 || opts.hp <= 0 || opts.maxHp <= 0) {
        return false;
    }
    const minHp = opts.minHp ?? MIN_EAT_HP;
    if (opts.hp <= minHp) {
        return true;
    }
    const heal = Math.max(0, opts.heal);
    if (heal <= 0) {
        return false;
    }
    return opts.maxHp - opts.hp >= heal;
}

/** Convenience: resolve heal from the food name. */
export function shouldEatFood(
    foodName: string,
    opts: { hp: number; maxHp: number; foodCount: number; minHp?: number }
): boolean {
    return shouldEatToUseFood({
        hp: opts.hp,
        maxHp: opts.maxHp,
        heal: foodHealAmount(foodName),
        foodCount: opts.foodCount,
        minHp: opts.minHp
    });
}
