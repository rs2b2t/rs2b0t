/**
 * Which `attempt_cook_item` branch a surface takes in content `skill_cooking/cooking.rs2`.
 * Why: only `cooking_oven` reads `successchance_range`, so an oven burns less than a fire at the same level and wins the pairing when both are a similar walk.
 */
export type CookSurfaceKind = 'oven' | 'fire';

/** One cook surface placed in the map pack (`category=cooking_oven` / `cooking_fire`). */
export interface CookSurfaceLoc {
    x: number;
    z: number;
    level: number;
    /** Loc query name: Range / Fireplace / Cooking pot / Cooking range. */
    name: string;
    debugname: string;
    kind: CookSurfaceKind;
}
