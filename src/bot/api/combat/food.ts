// Shared food handling for the combat bots — the withdraw/eat dropdown options
// and the multi-bite forms so a part-eaten cake/pizza/pie still counts as food.
// Lifted from RockCrab so MossGiant (and future combat bots) share one copy.

/** Every edible the era banks stock — the `food` setting dropdown options. */
export const FOOD_OPTIONS: string[] = [
    'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout', 'Pike', 'Bass', 'Herring', 'Sardine', 'Anchovies', 'Shrimps',
    'Cooked meat', 'Cooked chicken', 'Bread', 'Stew',
    'Cake', 'Chocolate cake', 'Plain pizza', 'Meat pizza', 'Anchovy pizza', 'Pineapple pizza', 'Redberry pie', 'Meat pie', 'Apple pie'
];

// Multi-bite foods eat DOWN through intermediate items (a cake is 3 items: Cake
// -> 2/3 cake -> Slice of cake), so an exact name match would stop seeing it as
// food after the first bite. List every edible form, keyed by the full item you'd
// bank/withdraw. Anything not listed is treated as a single-item food.
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

/** Every edible form of the configured food (all 3 slices of a cake, etc.). */
export function foodForms(foodName: string): string[] {
    const key = foodName.toLowerCase();
    return FOOD_FORMS[key] ?? [key];
}

/** True if an item is one of the edible forms of the configured food. */
export function isFoodItem(name: string | null | undefined, foodName: string): boolean {
    return foodForms(foodName).includes((name ?? '').toLowerCase());
}

/** Edible food items in a pack, counting part-eaten cakes/pizzas/pies too. */
export function foodCount(items: readonly { name: string | null | undefined }[], foodName: string): number {
    return items.filter(i => isFoodItem(i.name, foodName)).length;
}
