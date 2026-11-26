import type { MeleeCombatStyle } from './CombatStyle.js';

export function dragonMeleeStyle(requested: MeleeCombatStyle, weapon: string | null | undefined, targets: readonly string[], activeTarget?: string | null): MeleeCombatStyle {
    const names = activeTarget ? [activeTarget] : targets;
    return weapon?.trim().toLowerCase() === 'dragon longsword' && names.length > 0 && names.every(name => /\bdragon$/i.test(name.trim()))
        ? 'controlled'
        : requested;
}
