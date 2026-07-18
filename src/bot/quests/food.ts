/**
 * The configured quest food item's display name, set by AIOQuester from its
 * `food` setting at onStart. Quest DEFS (which have no host/settings access —
 * e.g. Waterfall's post-tomb rune/food withdraw) read this holder so the food
 * they carry follows the parameter instead of a hardcoded item. `null` = no food
 * configured (the setting was left blank), in which case defs carry none rather
 * than trying to withdraw food that doesn't exist.
 */
export const QuestFood = { name: 'Trout' as string | null };
