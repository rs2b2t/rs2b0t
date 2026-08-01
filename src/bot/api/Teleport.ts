export interface TeleportDefinition {
    name: string;
    fallbackComId: number;
}

/**
 * Component IDs from the 2004 magic interface. They are deliberately fallbacks:
 * the live component tree is searched by button text before one of these is used.
 */
const TELEPORTS: Record<string, TeleportDefinition> = {
    varrock: { name: 'Varrock', fallbackComId: 1164 },
    lumbridge: { name: 'Lumbridge', fallbackComId: 1167 },
    falador: { name: 'Falador', fallbackComId: 1170 },
    camelot: { name: 'Camelot', fallbackComId: 1174 },
    ardougne: { name: 'Ardougne', fallbackComId: 1540 },
    watchtower: { name: 'Watchtower', fallbackComId: 1541 },
    trollheim: { name: 'Trollheim', fallbackComId: 7455 }
};

function teleportKey(value: string): string {
    return value
        .trim()
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/^cast\s+/i, '')
        .replace(/\s+teleport$/i, '')
        .trim()
        .toLowerCase();
}

export function resolveTeleport(name: string): TeleportDefinition | null {
    return TELEPORTS[teleportKey(name)] ?? null;
}

export function teleportButtonText(teleport: TeleportDefinition): string {
    return `Cast @gre@${teleport.name} teleport`;
}

/** Prefer the live interface component and fall back to the 2004 static ID. */
export function resolveTeleportComponent(
    teleport: TeleportDefinition,
    findButton: (label: string) => number
): number {
    const liveComId = findButton(teleportButtonText(teleport));
    return liveComId === -1 ? teleport.fallbackComId : liveComId;
}
