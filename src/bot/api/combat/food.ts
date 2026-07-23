export const FOOD_OPTIONS: string[] = [
    'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout', 'Pike', 'Bass', 'Herring', 'Sardine', 'Anchovies', 'Shrimps',
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
