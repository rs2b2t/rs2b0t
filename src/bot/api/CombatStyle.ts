/**
 * Combat-style tab mode (`com_mode`): 0 = Attack/accurate, 1 = Strength/aggressive,
 * 2 = Defence/defensive. `Game.setCombatStyle` / `Game.combatMode` target these;
 * the actual button ids are pack-assigned per weapon and resolved from the live
 * combat tab. com_mode isn't persisted, so a bot re-asserts it each session.
 */
const COMBAT_STYLE_MODE: Record<string, number> = {
    attack: 0,
    accurate: 0,
    strength: 1,
    aggressive: 1,
    defence: 2,
    defense: 2,
    defensive: 2
};

/** The styles offered in a settings dropdown (one per melee stat). */
export const COMBAT_STYLE_OPTIONS = ['attack', 'strength', 'defence'];

/** Combat-style name → com_mode (unknown → 1, aggressive/Strength). */
export function parseCombatStyle(name: string): number {
    return COMBAT_STYLE_MODE[name.trim().toLowerCase()] ?? 1;
}
