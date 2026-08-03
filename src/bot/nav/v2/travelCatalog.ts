/**
 * Curated 2004-era travel edges derived from Server content scripts.
 *
 * Families: spirit trees, gnome glider, Entrana ferry, Shilo↔Brimhaven cart.
 * Loaded alongside transports.json (see NavWorker). Stands may be refined with
 * live probes; destinations come from content constants / p_teleport targets.
 *
 * Content root (operator machine): experiments/Server/content/scripts/
 */

import type { TransportEdgeData } from '../PathFinder.js';
import { parseLcCoord } from './lcCoord.js';
import type { NavPoint, TransportRequires } from './types.js';

/** Content-constant landings (spirit_tree.constant / glider.constant). */
export const SPIRIT_TREE = {
    stronghold: parseLcCoord('0_38_53_29_52'),
    village: parseLcCoord('0_39_49_46_33'),
    varrock: parseLcCoord('0_49_54_43_51'),
    khazard: parseLcCoord('0_39_50_59_59')
} as const;

export const GLIDER_PAD = {
    /** Grand Tree top — hub. */
    taQuirPriw: parseLcCoord('3_38_54_33_45'),
    gandius: parseLcCoord('0_46_46_27_25'),
    sindarpos: parseLcCoord('0_44_54_34_41'),
    lemantoAndra: parseLcCoord('0_51_53_56_38'),
    karHewo: parseLcCoord('0_51_50_20_11')
} as const;

/** set_sail landings (monk_of_entrana.rs2). */
export const ENTRANA_LAND = parseLcCoord('1_44_52_18_3');
export const PORT_SARIM_FROM_ENTRANA = parseLcCoord('1_47_50_40_31');

/** Cart p_teleport targets (vigroy.rs2 / hajedy.rs2). */
export const CART_BRIMHAVEN = parseLcCoord('0_43_50_24_14');
export const CART_SHILO = parseLcCoord('0_44_46_18_7');

/**
 * Pier / NPC stand heuristics (Talk-to range). Refine with live pack probes.
 * Pathfinder only keeps the edge if both ends are walkable in the collision pack.
 */
export const TRAVEL_STANDS = {
    portSarimMonk: { x: 3048, z: 3236, level: 0 } as NavPoint,
    entranaMonk: { x: 2834, z: 3335, level: 0 } as NavPoint,
    shiloCart: { x: 2834, z: 2954, level: 0 } as NavPoint,
    brimhavenCart: { x: 2779, z: 3212, level: 0 } as NavPoint
} as const;

const members: TransportRequires = { members: true };

function edge(
    from: NavPoint,
    to: NavPoint,
    locName: string,
    action: string,
    kind: string,
    debugName: string,
    requires?: TransportRequires
): TransportEdgeData {
    return {
        from: { ...from },
        to: { ...to },
        locName,
        action,
        kind,
        locX: from.x,
        locZ: from.z,
        debugName,
        options: [action],
        requires
    };
}

/**
 * Spirit tree network (spirit_tree.rs2).
 * Stronghold tree needs Grand Tree complete; village/young trees need Tree Gnome Village.
 * Encoded as members + quest complete on each origin family.
 */
export function spiritTreeEdges(): TransportEdgeData[] {
    const strongholdReq: TransportRequires = {
        ...members,
        quests: [{ quest: 'The Grand Tree', minStatus: 'complete' }]
    };
    const villageReq: TransportRequires = {
        ...members,
        quests: [{ quest: 'Tree Gnome Village', minStatus: 'complete' }]
    };
    const out: TransportEdgeData[] = [];
    const link = (
        from: NavPoint,
        to: NavPoint,
        debug: string,
        requires: TransportRequires
    ): void => {
        out.push(edge(from, to, 'Spirit Tree', 'Talk-to', 'portal', debug, requires));
    };
    // Stronghold tree → others
    link(SPIRIT_TREE.stronghold, SPIRIT_TREE.village, 'spirit_stronghold_to_village', strongholdReq);
    link(SPIRIT_TREE.stronghold, SPIRIT_TREE.varrock, 'spirit_stronghold_to_varrock', strongholdReq);
    link(SPIRIT_TREE.stronghold, SPIRIT_TREE.khazard, 'spirit_stronghold_to_khazard', strongholdReq);
    // Village tree → others
    link(SPIRIT_TREE.village, SPIRIT_TREE.khazard, 'spirit_village_to_khazard', villageReq);
    link(SPIRIT_TREE.village, SPIRIT_TREE.varrock, 'spirit_village_to_varrock', villageReq);
    link(SPIRIT_TREE.village, SPIRIT_TREE.stronghold, 'spirit_village_to_stronghold', villageReq);
    // Young / satellite trees only offer home (village) — model as return edges from known dests
    // that talk back toward village (varrock + khazard young trees).
    link(SPIRIT_TREE.varrock, SPIRIT_TREE.village, 'spirit_varrock_to_village', villageReq);
    link(SPIRIT_TREE.khazard, SPIRIT_TREE.village, 'spirit_khazard_to_village', villageReq);
    return out;
}

/**
 * Gnome glider pads (gnome_glider.rs2).
 * Content forces non-hub hops via Ta Quir Priw — encode only hub↔pad edges.
 */
export function gliderEdges(): TransportEdgeData[] {
    const hub = GLIDER_PAD.taQuirPriw;
    const pads: { id: string; to: NavPoint }[] = [
        { id: 'gandius', to: GLIDER_PAD.gandius },
        { id: 'sindarpos', to: GLIDER_PAD.sindarpos },
        { id: 'lemanto_andra', to: GLIDER_PAD.lemantoAndra },
        { id: 'kar_hewo', to: GLIDER_PAD.karHewo }
    ];
    const req: TransportRequires = {
        ...members,
        quests: [{ quest: 'The Grand Tree', minStatus: 'started' }]
    };
    const out: TransportEdgeData[] = [];
    for (const p of pads) {
        out.push(edge(hub, p.to, 'Gnome glider', 'Glider', 'portal', `glider_hub_to_${p.id}`, req));
        out.push(edge(p.to, hub, 'Gnome glider', 'Glider', 'portal', `glider_${p.id}_to_hub`, req));
    }
    return out;
}

/** Port Sarim ↔ Entrana (monk Talk-to + weapon search; members). */
export function entranaFerryEdges(): TransportEdgeData[] {
    const req: TransportRequires = { members: true };
    return [
        edge(
            TRAVEL_STANDS.portSarimMonk,
            ENTRANA_LAND,
            'Monk of Entrana',
            'Talk-to',
            'ship',
            'ferry_port_sarim_to_entrana',
            req
        ),
        edge(
            TRAVEL_STANDS.entranaMonk,
            PORT_SARIM_FROM_ENTRANA,
            'Monk of Entrana',
            'Talk-to',
            'ship',
            'ferry_entrana_to_port_sarim',
            req
        )
    ];
}

/**
 * Shilo ↔ Brimhaven jungle cart (vigroy / hajedy).
 * Fare is 5% of coins clamped 10–200 — plan with min 10 coins.
 * Brimhaven→Shilo requires Shilo Village complete.
 */
export function shiloCartEdges(): TransportEdgeData[] {
    const coins10: TransportRequires = {
        members: true,
        currency: { name: 'Coins', amount: 10 },
        items: [{ name: 'Coins', count: 10, consumed: true }]
    };
    const shiloDone: TransportRequires = {
        ...coins10,
        quests: [{ quest: 'Shilo Village', minStatus: 'complete' }]
    };
    return [
        edge(
            TRAVEL_STANDS.shiloCart,
            CART_BRIMHAVEN,
            'Vigroy',
            'Talk-to',
            'ship',
            'cart_shilo_to_brimhaven',
            coins10
        ),
        edge(
            TRAVEL_STANDS.brimhavenCart,
            CART_SHILO,
            'Hajedy',
            'Talk-to',
            'ship',
            'cart_brimhaven_to_shilo',
            shiloDone
        )
    ];
}

/** All curated travel rows to merge with transports.json at graph load. */
export function curatedTravelEdges(): TransportEdgeData[] {
    return [...spiritTreeEdges(), ...gliderEdges(), ...entranaFerryEdges(), ...shiloCartEdges()];
}

/** Stable family ids for audits / docs. */
export const TRAVEL_FAMILIES = [
    'spirit_tree',
    'gnome_glider',
    'entrana_ferry',
    'shilo_cart',
    'karamja_ferry',
    'brimhaven_ferry',
    'spell_teleport',
    'jewellery_teleport',
    'wildy_lever'
] as const;

export type TravelFamilyId = (typeof TRAVEL_FAMILIES)[number];
