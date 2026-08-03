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
import { REQ } from './transportQuestReqs.js';
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
 * Essence-mine surface return stands (runecraft.constant) — used as NPC stands
 * for entry edges. Mine landing is random; planner uses a representative pad.
 */
export const ESSENCE_RETURN = {
    aubury: parseLcCoord('0_50_53_53_9'),
    sedridor: parseLcCoord('0_48_149_34_36'),
    distentor: parseLcCoord('0_40_48_31_14'),
    brimstail: parseLcCoord('0_37_153_22_18'),
    cromperty: parseLcCoord('0_41_51_60_58')
} as const;

/** Representative essence-mine pad (essence_mine_teleports.enum val=0). */
export const ESSENCE_MINE_PAD = parseLcCoord('0_45_75_32_33');

/** Wildy lever landings (wilderness_lever.constant). */
export const WILDY_LEVER = {
    deepWild: parseLcCoord('0_49_61_18_20'),
    ardougne: parseLcCoord('0_40_51_2_47')
} as const;

/**
 * Pier / NPC stand heuristics (Talk-to range). Refine with live pack probes.
 * Pathfinder only keeps the edge if both ends are walkable in the collision pack.
 */
export const TRAVEL_STANDS = {
    portSarimMonk: { x: 3048, z: 3236, level: 0 } as NavPoint,
    entranaMonk: { x: 2834, z: 3335, level: 0 } as NavPoint,
    shiloCart: { x: 2834, z: 2954, level: 0 } as NavPoint,
    brimhavenCart: { x: 2779, z: 3212, level: 0 } as NavPoint,
    /** Lever locs — stand next to the object. */
    ardyLever: { x: 2561, z: 3311, level: 0 } as NavPoint,
    wildLever: { x: 3153, z: 3923, level: 0 } as NavPoint
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
    const strongholdReq: TransportRequires = { ...REQ.grandTreeComplete };
    const villageReq: TransportRequires = { ...REQ.treeGnomeComplete };
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
    // Glider pads open once Grand Tree is finished (content checks complete for free flight).
    const req: TransportRequires = { ...REQ.grandTreeComplete };
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
        quests: REQ.shiloComplete.quests
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

/**
 * Rune Mysteries complete → essence mine via wizard Teleport.
 * Landing is random in-content; we plan to a representative pad + acceptAnyLanding.
 */
export function essenceEntryEdges(): TransportEdgeData[] {
    const f2p: TransportRequires = { ...REQ.runeMysteriesComplete };
    const membersReq: TransportRequires = {
        members: true,
        ...REQ.runeMysteriesComplete
    };
    const mine = ESSENCE_MINE_PAD;
    const mk = (
        from: NavPoint,
        npc: string,
        debug: string,
        requires: TransportRequires
    ): TransportEdgeData =>
        edge(from, mine, npc, 'Teleport', 'portal', debug, requires);

    return [
        mk(ESSENCE_RETURN.aubury, 'Aubury', 'ess_entry_aubury', f2p),
        mk(ESSENCE_RETURN.sedridor, 'Sedridor', 'ess_entry_sedridor', f2p),
        mk(ESSENCE_RETURN.distentor, 'Wizard Distentor', 'ess_entry_distentor', membersReq),
        mk(ESSENCE_RETURN.cromperty, 'Wizard Cromperty', 'ess_entry_cromperty', membersReq),
        mk(ESSENCE_RETURN.brimstail, 'Brimstail', 'ess_entry_brimstail', membersReq)
    ];
}

/** Ardougne ↔ deep wilderness levers (wilderness_lever.rs2). */
export function wildyLeverEdges(): TransportEdgeData[] {
    const members: TransportRequires = { members: true };
    return [
        edge(
            TRAVEL_STANDS.ardyLever,
            WILDY_LEVER.deepWild,
            'Lever',
            'Pull',
            'portal',
            'lever_ardougne_to_wild',
            members
        ),
        edge(
            TRAVEL_STANDS.wildLever,
            WILDY_LEVER.ardougne,
            'Lever',
            'Pull',
            'portal',
            'lever_wild_to_ardougne',
            members
        )
    ];
}

/**
 * OD-relevant agility shortcuts from skill_agility/shortcuts.rs2 (not full courses).
 * Coal logs + island ropes already live in transports.json — these fill remaining OD gaps.
 */
export function agilityShortcutEdges(): TransportEdgeData[] {
    const agi = (level: number): TransportRequires => ({
        skills: [{ name: 'agility', level }]
    });
    const membersAgi = (level: number): TransportRequires => ({
        members: true,
        skills: [{ name: 'agility', level }]
    });
    // Barb village crumbling wall: one-way west→east (loc 0_39_55_46_33).
    const castleLoc = parseLcCoord('0_39_55_46_33');
    const castleFrom = { x: castleLoc.x - 1, z: castleLoc.z, level: 0 };
    const castleTo = { x: castleLoc.x + 1, z: castleLoc.z, level: 0 };
    // Shilo river log already in transports.json (zq_logbalance @ 2906↔2910,3049).
    // Edgeville dungeon monkeybars (loc params).
    const mbA = parseLcCoord('0_48_155_48_44');
    const mbB = parseLcCoord('0_48_155_49_49');
    return [
        edge(
            castleFrom,
            castleTo,
            'Crumbling wall',
            'Climb-over',
            'shortcut',
            'agi_castle_crumbling_wall',
            membersAgi(5)
        ),
        edge(mbA, mbB, 'Monkeybars', 'Swing across', 'shortcut', 'agi_edgeville_monkeybars_n', agi(15)),
        edge(mbB, mbA, 'Monkeybars', 'Swing across', 'shortcut', 'agi_edgeville_monkeybars_s', agi(15))
    ];
}

/** All curated travel rows to merge with transports.json at graph load. */
export function curatedTravelEdges(): TransportEdgeData[] {
    return [
        ...spiritTreeEdges(),
        ...gliderEdges(),
        ...entranaFerryEdges(),
        ...shiloCartEdges(),
        ...essenceEntryEdges(),
        ...wildyLeverEdges(),
        ...agilityShortcutEdges()
    ];
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
    'wildy_lever',
    'essence_entry',
    'agility_shortcut'
] as const;

export type TravelFamilyId = (typeof TRAVEL_FAMILIES)[number];
