export const RUNE_LEGS = [{ id: 1079, name: 'Rune platelegs' }, { id: 1093, name: 'Rune plateskirt' }] as const;

export function selectRuneLegs(preferred: string, availability: (piece: typeof RUNE_LEGS[number]) => number) {
    const name = preferred.toLowerCase();
    const requested = RUNE_LEGS.find(piece => piece.name.toLowerCase() === name);
    if (!requested) return undefined;
    const other = requested === RUNE_LEGS[0] ? RUNE_LEGS[1] : RUNE_LEGS[0];
    return availability(other) > availability(requested) ? other : requested;
}
