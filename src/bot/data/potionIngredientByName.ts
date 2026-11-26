export function potionIngredientByName<T extends { name: string }>(
    ingredients: readonly T[],
    name: string,
    fallback?: (wanted: string) => T | undefined
): T | null {
    const wanted = name.trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    return (
        ingredients.find(ingredient => ingredient.name.toLowerCase() === wanted) ??
        ingredients.find(ingredient => ingredient.name.toLowerCase().includes(wanted)) ??
        fallback?.(wanted) ??
        null
    );
}
