export type MeleeCombatStyle = 'attack' | 'strength' | 'controlled' | 'defence';

const COMBAT_STYLE: Record<string, MeleeCombatStyle> = {
    attack: 'attack',
    accurate: 'attack',
    strength: 'strength',
    aggressive: 'strength',
    controlled: 'controlled',
    shared: 'controlled',
    defence: 'defence',
    defense: 'defence',
    defensive: 'defence'
};

/**
 * Melee styles a script may train.
 * Why: re-applied on every login, because the combat-mode varp isn't persisted.
 * @see docs/reference/api-game.md
 */
export const COMBAT_STYLE_OPTIONS: MeleeCombatStyle[] = ['attack', 'strength', 'controlled', 'defence'];

export interface CombatStyleResolution {
    requested: MeleeCombatStyle;
    effective: MeleeCombatStyle;
    mode: number;
}

export interface CombatModeLabel {
    mode: number;
    label: string;
}

interface CombatStyleBackend {
    offeredModes(): readonly CombatModeLabel[] | null;
    currentMode(): number;
    selectMode(mode: number): boolean;
}

export function parseCombatStyle(name: string): MeleeCombatStyle {
    return COMBAT_STYLE[name.trim().toLowerCase()] ?? 'strength';
}

/**
 * Parse a melee training style without defaulting.
 * Why: detects legacy `combatStyle=defence` and the like, after scripts split that field into combatStyle=melee|mage|range plus meleeStyle.
 */
export function tryParseCombatStyle(name: string): MeleeCombatStyle | null {
    return COMBAT_STYLE[name.trim().toLowerCase()] ?? null;
}

type CombatKind = 'melee' | 'mage' | 'range';

/**
 * Resolve combatStyle + meleeStyle after the melee|mage|range split.
 * Why: Preserve legacy melee values in `combatStyle` instead of applying the new strength default (#461).
 */
export function resolveSplitCombatSettings(
    rawCombatStyle: string,
    rawMeleeStyle: string | undefined
): { kind: CombatKind; meleeStyle: MeleeCombatStyle; legacyMigrated: MeleeCombatStyle | null } {
    const legacy = tryParseCombatStyle(rawCombatStyle);
    if (legacy !== null) {
        return {
            kind: 'melee',
            meleeStyle: rawMeleeStyle !== undefined ? parseCombatStyle(rawMeleeStyle) : legacy,
            legacyMigrated: rawMeleeStyle === undefined ? legacy : null
        };
    }
    const kindRaw = rawCombatStyle.trim().toLowerCase();
    const kind: CombatKind = kindRaw === 'mage' || kindRaw === 'range' ? kindRaw : 'melee';
    return {
        kind,
        meleeStyle: parseCombatStyle(rawMeleeStyle ?? 'strength'),
        legacyMigrated: null
    };
}

// Why: follows the interface's Accurate/Aggressive/Controlled/Defensive labels, because button count and position don't imply a style and duplicate styles are valid.
// Why: an unavailable requested style falls to the last defensive option, which covers the controlled-on-3-mode case and stays deterministic for spears and polearms.
// Why: an incomplete interface with neither an exact match nor a defensive option fails closed.

/** Resolve a requested training style against the labelled buttons in the current weapon's combat interface. */
export function resolveCombatStyle(style: MeleeCombatStyle, offeredModes: readonly CombatModeLabel[]): CombatStyleResolution | null {
    const seenModes = new Set<number>();
    const modes = offeredModes.flatMap(option => {
        const effective = parseInterfaceCombatStyle(option.label);
        if (!Number.isInteger(option.mode) || effective === null || seenModes.has(option.mode)) {
            return [];
        }
        seenModes.add(option.mode);
        return [{ mode: option.mode, style: effective }];
    });
    if (modes.length === 0) {
        return null;
    }

    const selected = modes.find(option => option.style === style) ?? modes.findLast(option => option.style === 'defence');
    if (!selected) {
        return null;
    }

    return {
        requested: style,
        effective: selected.style,
        mode: selected.mode
    };
}

export function parseInterfaceCombatStyle(label: string): MeleeCombatStyle | null {
    switch (label.trim().replace(/^\(|\)$/g, '').trim().toLowerCase()) {
        case 'accurate':
            return 'attack';
        case 'aggressive':
            return 'strength';
        case 'controlled':
            return 'controlled';
        case 'defensive':
            return 'defence';
        default:
            return null;
    }
}

/** Keeps resolve, set, and assertion on the same weapon-aware mapping. */
export class CombatStyleController {
    constructor(private readonly backend: CombatStyleBackend) {}

    resolution(style: MeleeCombatStyle): CombatStyleResolution | null {
        const modes = this.backend.offeredModes();
        return modes === null ? null : resolveCombatStyle(style, modes);
    }

    mode(style: MeleeCombatStyle): number | null {
        return this.resolution(style)?.mode ?? null;
    }

    has(style: MeleeCombatStyle): boolean {
        const mode = this.mode(style);
        return mode !== null && this.backend.currentMode() === mode;
    }

    set(style: MeleeCombatStyle): boolean {
        const mode = this.mode(style);
        return mode !== null && this.backend.selectMode(mode);
    }
}

export function describeCombatStyle(resolution: CombatStyleResolution): string {
    let description: string;
    switch (resolution.effective) {
        case 'attack':
            description = 'attack (training Attack)';
            break;
        case 'strength':
            description = 'strength (training Strength)';
            break;
        case 'controlled':
            description = 'controlled (training Attack, Strength & Defence)';
            break;
        case 'defence':
            description = 'defence (training Defence)';
            break;
    }

    if (resolution.requested !== resolution.effective) {
        return `${description.slice(0, -1)}; ${resolution.requested} unavailable)`;
    }
    return description;
}

const RANGE_STYLE_MODE: Record<string, number> = {
    accurate: 0,
    rapid: 1,
    longrange: 2,
    'long range': 2,
    'long-range': 2
};

export const RANGE_STYLE_OPTIONS = ['accurate', 'rapid', 'longrange'];

export function parseRangeStyle(name: string): number {
    return RANGE_STYLE_MODE[name.trim().toLowerCase()] ?? 1;
}
