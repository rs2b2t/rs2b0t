// Why: curated 2004-era travel edges derived from Server content scripts — spirit trees, gnome glider, Entrana ferry, Shilo↔Brimhaven cart.
// Why: loaded alongside transports.json (see NavWorker); stands may be refined with live probes while destinations come from content constants and p_teleport targets.
// Why: the content root on the operator machine is experiments/Server/content/scripts/.

import type { TransportEdgeData } from './PathFinder.js';
import { essenceExitEdges } from './essenceExit.js';
import { parseLcCoord } from './geometry/lcCoord.js';
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
const PORT_SARIM_FROM_ENTRANA = parseLcCoord('1_47_50_40_31');

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

// Why: in spirit_tree.rs2 the stronghold tree needs Grand Tree complete while the village and young trees need Tree Gnome Village.
// Why: encoded as members plus quest complete on each origin family.

/** Spirit tree network edges. */
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

// Why: gnome_glider.rs2 forces non-hub hops via Ta Quir Priw, so only hub↔pad edges are encoded.
// Why: execution is a Talk-to on the Gnome pilot plus a glidermap click — there is no loc named glider.

/** Gnome glider pad edges. */
export function gliderEdges(): TransportEdgeData[] {
    const hub = GLIDER_PAD.taQuirPriw;
    /** Pads with a return hop in `~calc_glidervar` (gnome_glider.rs2). */
    const roundTripPads: { id: string; to: NavPoint }[] = [
        { id: 'gandius', to: GLIDER_PAD.gandius },
        { id: 'sindarpos', to: GLIDER_PAD.sindarpos },
        { id: 'kar_hewo', to: GLIDER_PAD.karHewo }
    ];
    // Glider pads open once Grand Tree is finished (content checks complete for free flight).
    const req: TransportRequires = { ...REQ.grandTreeComplete };
    const out: TransportEdgeData[] = [];
    for (const p of roundTripPads) {
        out.push(edge(hub, p.to, 'Gnome pilot', 'Talk-to', 'ship', `glider_hub_to_${p.id}`, req));
        out.push(edge(p.to, hub, 'Gnome pilot', 'Talk-to', 'ship', `glider_${p.id}_to_hub`, req));
    }
    // Lemanto Andra (Digsite): hub → pad only. `~calc_glidervar` has no reverse pair;
    // `~calc_gliderstart` never treats the digsite zone as an origin. One-way sink.
    out.push(
        edge(hub, GLIDER_PAD.lemantoAndra, 'Gnome pilot', 'Talk-to', 'ship', 'glider_hub_to_lemanto_andra', req)
    );
    return out;
}

/** Port Sarim ↔ Entrana (monk Talk-to + weapon search; members). */
export function entranaFerryEdges(): TransportEdgeData[] {
    // Port Sarim → Entrana: monks refuse weapons/armour (plan + execute).
    const toEntrana: TransportRequires = {
        members: true,
        forbidEntranaRestricted: true
    };
    // Return ferry has no gear gate.
    const fromEntrana: TransportRequires = { members: true };
    return [
        edge(
            TRAVEL_STANDS.portSarimMonk,
            ENTRANA_LAND,
            'Monk of Entrana',
            'Talk-to',
            'ship',
            'ferry_port_sarim_to_entrana',
            toEntrana
        ),
        edge(
            TRAVEL_STANDS.entranaMonk,
            PORT_SARIM_FROM_ENTRANA,
            'Monk of Entrana',
            'Talk-to',
            'ship',
            'ferry_entrana_to_port_sarim',
            fromEntrana
        )
    ];
}

// Why: the fare is 5 % of coins clamped 10–200, so the plan uses a minimum of 10 coins.
// Why: Brimhaven → Shilo requires Shilo Village complete.

/** Shilo ↔ Brimhaven jungle cart edges (vigroy / hajedy). */
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

// Why: in `essence_mine.rs2` the landing is `random(enum essence_mine_teleports)` over 22 tiles across mapsquare 45_75, then `map_findsquare(..., 0, 1, lineofsight)`.
// Why: that is not a static destination, so these rows are blacklisted from the path graph (#388) and scripts needing the mine own the wizard hop via a specialCrossings Talk-to.
// Why: `essenceEntrySetsReturn` is kept on the audit rows so docs and tests know which wizard sets which session return; it is not plan-usable while blacklisted.
// Why: exit edges stay routable and require the matching `essenceExitReturn` (#377).

/** Rune Mysteries complete → essence mine, via the wizard Teleport. */
export function essenceEntryEdges(): TransportEdgeData[] {
    const f2p: TransportRequires = { ...REQ.runeMysteriesComplete };
    const membersReq: TransportRequires = {
        members: true,
        ...REQ.runeMysteriesComplete
    };
    const mine = ESSENCE_MINE_PAD;
    const bl = {
        blacklist: true as const,
        blacklistReason:
            'Essence mine entry: landing is random(enum essence_mine_teleports) over 22 pads + map_findsquare r=1 (content essence_mine.rs2) — not a static destination. Scripts own entry.'
    };
    const mk = (
        from: NavPoint,
        npc: string,
        debug: string,
        requires: TransportRequires,
        returnId: string
    ): TransportEdgeData => ({
        ...edge(from, mine, npc, 'Teleport', 'portal', debug, {
            ...requires,
            essenceEntrySetsReturn: returnId
        }),
        ...bl
    });

    return [
        mk(ESSENCE_RETURN.aubury, 'Aubury', 'ess_entry_aubury', f2p, 'aubury'),
        mk(ESSENCE_RETURN.sedridor, 'Sedridor', 'ess_entry_sedridor', f2p, 'sedridor'),
        mk(ESSENCE_RETURN.distentor, 'Wizard Distentor', 'ess_entry_distentor', membersReq, 'distentor'),
        mk(ESSENCE_RETURN.cromperty, 'Wizard Cromperty', 'ess_entry_cromperty', membersReq, 'cromperty'),
        mk(ESSENCE_RETURN.brimstail, 'Brimstail', 'ess_entry_brimstail', membersReq, 'brimstail')
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

// Why: `mage_arena.rs2` gives one placement pair for `magearena_scan` (loc 2880, map m48_61), with direction taken from the player versus the loc.
// Why: inbound (north → south) needs `%magearena >= complete` plus no armour or weapons (`~can_enter_mage_arena`).
// Why: the miniquest is not on the quest list, so the plan uses members + `forbidEntranaRestricted`, the same gear heuristic as Entrana; an incomplete miniquest still fails at the loc.
// Why: outbound (south → north) is a free tele to north of the loc.
// Why: dual directed edges are emitted so pathfind cannot pin one approach and drop a side (#403).

/** Mage Arena outdoor barrier edges. */
export function mageArenaBarrierEdges(): TransportEdgeData[] {
    // Placements: 0_48_61_33_49 + 0_48_61_34_49 → (3105|3106, 3953).
    const locX = 3105;
    const locZ = 3953;
    const north = { x: 3105, z: 3954, level: 0 };
    const south = { x: 3105, z: 3952, level: 0 };
    const inbound: TransportRequires = {
        members: true,
        forbidEntranaRestricted: true
    };
    const outbound: TransportRequires = { members: true };
    const mk = (
        from: NavPoint,
        to: NavPoint,
        debug: string,
        requires: TransportRequires
    ): TransportEdgeData => ({
        from: { ...from },
        to: { ...to },
        locName: 'Mystic portal',
        action: 'Walk-through',
        kind: 'gate',
        locId: 2880,
        locX,
        locZ,
        debugName: debug,
        options: ['Walk-through'],
        requires
    });
    return [
        mk(north, south, 'magearena_scan_in', inbound),
        mk(south, north, 'magearena_scan_out', outbound)
    ];
}

// Why: `[oploc1,tribaltotemdoor]` opens only for `coordz(coord) > coordz(loc_coord)`, so the mansion's one ground-floor door lets a player out and never in.
// Why: derive-doors.ts drops the instance rather than baking it both ways, and this restores the half that works — without it every route out of the mansion reads unreachable.

/** Handelmort Mansion's inner door (loc 0_41_51_11_57), northward side only. */
export function handelmortDoorEdges(): TransportEdgeData[] {
    const loc = parseLcCoord('0_41_51_11_57');
    return [{
        from: { x: loc.x, z: loc.z + 1, level: 0 },
        to: { x: loc.x, z: loc.z, level: 0 },
        locName: 'Door',
        action: 'Open',
        kind: 'door',
        locId: 2706,
        locX: loc.x,
        locZ: loc.z,
        debugName: 'handelmort_inner_door_out',
        options: ['Open']
    }];
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
    // Outpost / castle crumbling wall: one-way west→east (loc 0_39_55_46_33).
    const castleLoc = parseLcCoord('0_39_55_46_33');
    const castleFrom = { x: castleLoc.x - 1, z: castleLoc.z, level: 0 };
    const castleTo = { x: castleLoc.x + 1, z: castleLoc.z, level: 0 };
    // Shilo river log already in transports.json (zq_logbalance @ 2906↔2910,3049).
    // Edgeville dungeon monkeybars (loc params).
    const mbA = parseLcCoord('0_48_155_48_44');
    const mbB = parseLcCoord('0_48_155_49_49');
    // Why: area_yanille/agility_dungeon.rs2 gives content start tiles 0_40_148_20_48 / _20_40 and dual placements (2580,9519)/(2580,9513) at Agility 40.
    // Why: without this edge the bank → chaos-druid-warrior field is disconnected.
    const yanilleLedgeN = parseLcCoord('0_40_148_20_48'); // 2580,9520
    const yanilleLedgeS = parseLcCoord('0_40_148_20_40'); // 2580,9512
    const yanilleLedge = (from: NavPoint, to: NavPoint, locZ: number, debug: string): TransportEdgeData => ({
        from: { ...from },
        to: { ...to },
        locName: 'Balancing ledge',
        action: 'Walk-across',
        kind: 'shortcut',
        locId: 2303,
        locX: 2580,
        locZ,
        debugName: debug,
        options: ['Walk-across'],
        requires: membersAgi(40)
    });
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
        edge(mbB, mbA, 'Monkeybars', 'Swing across', 'shortcut', 'agi_edgeville_monkeybars_s', agi(15)),
        yanilleLedge(yanilleLedgeN, yanilleLedgeS, 9519, 'agi_yanille_balancing_ledge_ns'),
        yanilleLedge(yanilleLedgeS, yanilleLedgeN, 9513, 'agi_yanille_balancing_ledge_sn')
    ];
}

// Why: in areas/area_gnome/scripts/elkoy.rs2 the outside `elkoy` goes to ^elkoy_maze_coord and the village `elkoy_village` goes to ^elkoy_entrance_coord.
// Why: Tree Gnome Village must be started for the escort dialogue — not_started offers the intro only.

/** Elkoy maze escort edges. */
export function elkoyMazeEdges(): TransportEdgeData[] {
    const entrance = parseLcCoord('0_39_49_8_56'); // 2504,3192
    const maze = parseLcCoord('0_39_49_19_23'); // 2515,3159
    const req: TransportRequires = { ...REQ.treeGnomeStarted };
    const mk = (from: NavPoint, to: NavPoint, debug: string): TransportEdgeData => ({
        from: { ...from },
        to: { ...to },
        locName: 'Elkoy',
        action: 'Talk-to',
        kind: 'portal',
        locX: from.x,
        locZ: from.z,
        debugName: debug,
        options: ['Talk-to'],
        requires: req
    });
    return [
        mk(entrance, maze, 'elkoy_outside_to_village'),
        mk(maze, entrance, 'elkoy_village_to_outside')
    ];
}

/**
 * Tourist Trap mining-camp barriers and cart whose handlers teleport or
 * direction-gate the player. Adjacent door rows are excluded at graph load.
 */
export function desertMiningCampEdges(): TransportEdgeData[] {
    const complete: TransportRequires = {
        quests: [{ quest: 'The Tourist Trap', minStatus: 'complete' }]
    };
    const disguised: TransportRequires = {
        worn: [
            { name: "Slaves' shirt", count: 1 },
            { name: 'Slave robe', count: 1 },
            { name: 'Slave boots', count: 1 }
        ]
    };
    const completeAndDisguised: TransportRequires = {
        ...disguised,
        ...complete
    };
    const wroughtKey: TransportRequires = {
        items: [{ name: 'Wrought iron key', count: 1, consumed: false }]
    };
    const scripted = (
        from: NavPoint,
        to: NavPoint,
        locName: string,
        action: string,
        kind: string,
        locId: number,
        locX: number,
        locZ: number,
        debugName: string,
        requires?: TransportRequires
    ): TransportEdgeData => ({
        from: { ...from },
        to: { ...to },
        locName,
        action,
        kind,
        locId,
        locX,
        locZ,
        debugName,
        options: [action],
        ...(requires ? { requires } : {})
    });

    const surfaceDoor = { x: 3301, z: 3036, level: 0 };
    const mineDoor = { x: 3278, z: 9427, level: 0 };
    const caveWest = { x: 3278, z: 9415, level: 0 };
    const caveEast = { x: 3286, z: 9415, level: 0 };
    const lowerCart = { x: 3303, z: 9416, level: 0 };
    const deepCart = { x: 3319, z: 9430, level: 0 };
    const wroughtSouth = { x: 3322, z: 9448, level: 0 };
    const wroughtNorth = { x: 3322, z: 9449, level: 0 };

    return [
        scripted(
            surfaceDoor,
            mineDoor,
            'Mine door entrance',
            'Open',
            'dungeon',
            2675,
            3301,
            3036,
            'desert_mining_camp_door_in',
            disguised
        ),
        scripted(
            mineDoor,
            surfaceDoor,
            'Mine door entrance',
            'Open',
            'dungeon',
            2690,
            3278,
            9426,
            'desert_mining_camp_door_out',
            disguised
        ),
        scripted(
            caveWest,
            caveEast,
            'Mine cave',
            'Walk through',
            'dungeon',
            2699,
            3281,
            9415,
            'desert_mining_camp_cave_in',
            completeAndDisguised
        ),
        scripted(
            caveEast,
            caveWest,
            'Mine cave',
            'Walk through',
            'dungeon',
            2698,
            3283,
            9415,
            'desert_mining_camp_cave_out',
            complete
        ),
        scripted(
            caveEast,
            caveWest,
            'Mine cave',
            'Walk through',
            'dungeon',
            2698,
            3283,
            9415,
            'desert_mining_camp_cave_out_disguised',
            disguised
        ),
        scripted(
            lowerCart,
            { x: 3319, z: 9431, level: 0 },
            'Mine Cart',
            'Search',
            'dungeon',
            2684,
            3303,
            9417,
            'desert_mining_camp_cart_in'
        ),
        scripted(
            deepCart,
            { x: 3302, z: 9417, level: 0 },
            'Mine Cart',
            'Search',
            'dungeon',
            2684,
            3318,
            9430,
            'desert_mining_camp_cart_out'
        ),
        scripted(
            wroughtSouth,
            wroughtNorth,
            'Gate',
            'Open',
            'gate',
            2687,
            3322,
            9448,
            'desert_mining_camp_wrought_in',
            wroughtKey
        ),
        scripted(
            wroughtNorth,
            wroughtSouth,
            'Gate',
            'Open',
            'gate',
            2687,
            3322,
            9448,
            'desert_mining_camp_wrought_out'
        )
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
        // Session multiloc: portal × return, gated by WorldState.essenceExitReturn.
        // Replaces the four hard-coded Sedridor-only rows formerly in transports.json.
        ...essenceExitEdges(),
        ...wildyLeverEdges(),
        ...mageArenaBarrierEdges(),
        ...handelmortDoorEdges(),
        ...agilityShortcutEdges(),
        ...elkoyMazeEdges(),
        ...desertMiningCampEdges()
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
    'essence_exit',
    'mage_arena_barrier',
    'handelmort_door',
    'agility_shortcut',
    'elkoy_maze',
    'desert_mining_camp'
] as const;

