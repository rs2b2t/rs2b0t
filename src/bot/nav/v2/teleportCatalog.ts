/**
 * Teleport catalog derived from rs2b2t-era content scripts (revision 274 pack).
 *
 * Not wired into PathFinder yet — Phase D catalog for nav-v2.
 */

import { ensureEdgeId } from './edgeId.js';
import { DEFAULT_EDGE_COST, type NavPoint, type TransportEdge, type TransportRequires } from './types.js';

export type TeleportFamily = 'spell' | 'jewellery' | 'lever';

export interface TeleportDestination {
    /** Stable id for PathPolicy.allowTeleportIds / edge.teleportId */
    teleportId: string;
    family: TeleportFamily;
    label: string;
    /** Approximate landing; server uses map_findsquare radius 2. */
    to: NavPoint;
    /** Fixed cost override; default DEFAULT_EDGE_COST.teleport */
    cost?: number;
    requires?: TransportRequires;
    /**
     * Inventory item name substrings that satisfy the hop (any charge stage).
     * Spells use requires.items (runes) instead.
     */
    itemNameMatch?: string[];
    /**
     * Chat option substrings to pick after Rub (jewellery). Empty/omit for
     * single-dest items that only offer that destination + Nowhere.
     */
    dialogueChoose?: string[];
    /** Debug / regenerate */
    source: string;
    notes?: string;
}

/** Placeholder from-tile for originless teles (ignored when attaching to player). */
const ORIGINLESS: NavPoint = { x: 0, z: 0, level: 0 };

const law = (n: number) => ({ name: 'Law rune', count: n, consumed: true as const });
const air = (n: number) => ({ name: 'Air rune', count: n, consumed: true as const });
const fire = (n: number) => ({ name: 'Fire rune', count: n, consumed: true as const });
const water = (n: number) => ({ name: 'Water rune', count: n, consumed: true as const });
const earth = (n: number) => ({ name: 'Earth rune', count: n, consumed: true as const });

/** Standard spellbook — magic_spells.dbrow + teleport.rs2 */
export const SPELL_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'varrock',
        family: 'spell',
        label: 'Varrock teleport',
        to: { x: 3213, z: 3424, level: 0 },
        requires: { skills: [{ name: 'magic', level: 25 }], items: [fire(1), air(3), law(1)] },
        source: 'magic_spell_teleport_varrock'
    },
    {
        teleportId: 'lumbridge',
        family: 'spell',
        label: 'Lumbridge teleport',
        to: { x: 3221, z: 3218, level: 0 },
        requires: { skills: [{ name: 'magic', level: 31 }], items: [earth(1), air(3), law(1)] },
        source: 'magic_spell_teleport_lumbridge'
    },
    {
        teleportId: 'falador',
        family: 'spell',
        label: 'Falador teleport',
        to: { x: 2965, z: 3378, level: 0 },
        requires: { skills: [{ name: 'magic', level: 37 }], items: [water(1), air(3), law(1)] },
        source: 'magic_spell_teleport_falador'
    },
    {
        teleportId: 'camelot',
        family: 'spell',
        label: 'Camelot teleport',
        to: { x: 2757, z: 3478, level: 0 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 45 }],
            items: [air(5), law(1)]
        },
        source: 'magic_spell_teleport_camelot'
    },
    {
        teleportId: 'ardougne',
        family: 'spell',
        label: 'Ardougne teleport',
        to: { x: 2661, z: 3301, level: 0 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 51 }],
            items: [water(2), law(2)],
            quests: [{ quest: 'Plague City', minStatus: 'complete' }]
        },
        source: 'magic_spell_teleport_ardougne',
        notes: 'Also requires having read the unlock scroll (elenaquest complete_read_scroll).'
    },
    {
        teleportId: 'watchtower',
        family: 'spell',
        label: 'Watchtower teleport',
        to: { x: 2933, z: 4713, level: 2 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 58 }],
            items: [earth(2), law(2)],
            quests: [{ quest: 'Watchtower', minStatus: 'complete' }]
        },
        source: 'magic_spell_teleport_watchtower',
        notes: 'Landing is level 2; requires Watchtower complete + scroll. Cast via Game.teleport.'
    },
    {
        teleportId: 'trollheim',
        family: 'spell',
        label: 'Trollheim teleport',
        to: { x: 2890, z: 3679, level: 0 },
        requires: {
            members: true,
            skills: [{ name: 'magic', level: 61 }],
            items: [fire(2), law(2)],
            quests: [{ quest: "Eadgar's Ruse", minStatus: 'complete' }]
        },
        source: 'magic_spell_teleport_trollheim',
        notes: 'Requires Eadgar\'s Ruse complete. Cast via Game.teleport.'
    }
];

/**
 * Jewellery — Server-implemented destinations only.
 * Duel ring / games neck are single-dest on this content pack.
 */
export const JEWELLERY_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'dueling_arena',
        family: 'jewellery',
        label: 'Ring of dueling → Al Kharid Duel Arena',
        to: { x: 3315, z: 3235, level: 0 },
        itemNameMatch: ['Ring of dueling'],
        dialogueChoose: ['Al Kharid', 'Duel Arena'],
        source: 'ring_of_dueling.rs2',
        notes: 'Charges 8→1. Inventory Rub only. Wildy >20 blocked. No Castle Wars on this Server.'
    },
    {
        teleportId: 'games_burthorpe',
        family: 'jewellery',
        label: 'Games necklace → Burthorpe Games Room',
        to: { x: 2207, z: 4940, level: 0 },
        requires: { members: true },
        itemNameMatch: ['Games necklace'],
        dialogueChoose: ['Burthorpe', 'Games Room'],
        source: 'necklace_of_minigames.rs2',
        notes: 'Charges 8→1. Inventory Rub only. Wildy >20. Burthorpe only on this Server.'
    },
    {
        teleportId: 'glory_edgeville',
        family: 'jewellery',
        label: 'Amulet of glory → Edgeville',
        to: { x: 3087, z: 3496, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Edgeville'],
        source: 'amulet_of_glory.rs2 case 1',
        notes: 'Requires charged glory (1–4). Wildy >30 blocked. Inventory Rub only.'
    },
    {
        teleportId: 'glory_karamja',
        family: 'jewellery',
        label: 'Amulet of glory → Karamja',
        to: { x: 2918, z: 3176, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Karamja'],
        source: 'amulet_of_glory.rs2 case 2'
    },
    {
        teleportId: 'glory_draynor',
        family: 'jewellery',
        label: 'Amulet of glory → Draynor Village',
        to: { x: 3105, z: 3251, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Draynor'],
        source: 'amulet_of_glory.rs2 case 3'
    },
    {
        teleportId: 'glory_alkharid',
        family: 'jewellery',
        label: 'Amulet of glory → Al Kharid',
        to: { x: 3293, z: 3163, level: 0 },
        itemNameMatch: ['Amulet of glory('],
        dialogueChoose: ['Al Kharid'],
        source: 'amulet_of_glory.rs2 case 4'
    }
];

/** Loc-backed levers (not originless). Documented for completeness; compile as loc edges later. */
export const LEVER_TELEPORTS: readonly TeleportDestination[] = [
    {
        teleportId: 'lever_ardougne_to_wild',
        family: 'lever',
        label: 'Ardougne wilderness lever (in)',
        to: { x: 3154, z: 3924, level: 0 },
        source: 'wilderness_lever.rs2 wildinlever',
        notes: 'Walk to lever loc; warning dialog. Deep wild landing.'
    },
    {
        teleportId: 'lever_wild_to_ardougne',
        family: 'lever',
        label: 'Wilderness lever (out to Ardougne)',
        to: { x: 2562, z: 3311, level: 0 },
        source: 'wilderness_lever.rs2 wildoutlever'
    }
];

export const ALL_TELEPORT_DESTINATIONS: readonly TeleportDestination[] = [
    ...SPELL_TELEPORTS,
    ...JEWELLERY_TELEPORTS,
    ...LEVER_TELEPORTS
];

/** Lookup by teleportId (spell or jewellery). */
export function teleportById(id: string): TeleportDestination | undefined {
    return ALL_TELEPORT_DESTINATIONS.find(d => d.teleportId === id);
}

/** Originless spell + jewellery rows as TransportEdges for future graph load. */
export function teleportDestinationsToEdges(
    dests: readonly TeleportDestination[] = [...SPELL_TELEPORTS, ...JEWELLERY_TELEPORTS]
): TransportEdge[] {
    return dests
        .filter(d => d.family === 'spell' || d.family === 'jewellery')
        .map(d => {
            const partial = {
                from: ORIGINLESS,
                to: d.to,
                kind: 'teleport' as const,
                cost: d.cost ?? DEFAULT_EDGE_COST.teleport,
                landing: { toTile: d.to, acceptAnyLanding: true },
                requires: d.requires,
                teleportId: d.teleportId,
                debug: { name: d.label, source: d.source }
            };
            return { ...partial, id: ensureEdgeId(partial) };
        });
}

/** True if inv name can pay for a jewellery tele (charge stages share prefix). */
export function inventoryNameMatchesJewellery(itemName: string, dest: TeleportDestination): boolean {
    if (!dest.itemNameMatch?.length) {
        return false;
    }
    return dest.itemNameMatch.some(prefix => itemName.includes(prefix));
}
