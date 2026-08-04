// docs/NAV.md#special-crossings
export interface SpecialCrossing {
    x: number;
    z: number;
    level: number;
    locName: string;
    action: string;
    useItem?: { id: number; name: string };
    requires?: { item: string; count: number };
    requiresSkill?: { name: string; level: number };
    dialogue?: { choose: string[] };
    npc?: string;
    toTile?: { x: number; z: number; level: number };
    /**
     * After dialogue opens a main-modal map (e.g. glidermap), click the button
     * nearest the label matching this text (case-insensitive substring).
     */
    mapChoice?: string;
    /**
     * Chebyshev radius for toTile arrival (default 2). Larger for random landings
     * (e.g. essence mine pads).
     */
    arrivalRadius?: number;
    reopenAfterDialogue?: boolean;
    /**
     * When `quest` is notStarted, walk to `npc` at `stand`, run `dialogue`, then
     * re-attempt the crossing. Used when a permanent unlock is granted by starting
     * a quest (Mort Myre / Nature Spirit via Drezel).
     */
    unlockQuest?: {
        quest: string;
        /** Must already be complete (e.g. Priest in Peril before Nature Spirit). */
        requireComplete?: string;
        npc: string;
        stand: { x: number; z: number; level: number };
        dialogue: { choose: string[] };
        /**
         * Free inventory slots required before talking (NPC may grant items).
         * Drezel hands 3 meat pie + 3 apple pie (unstackable) = 6.
         * Short packs try to bank disposable junk first; if still tight, give up.
         */
        freeSlots?: number;
    };
    label: string;
}

export const SPECIAL_CROSSINGS: SpecialCrossing[] = [
    { x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },
    { x: 3268, z: 3228, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },

    // Plague City (#366) — East Ardougne garden mud → sewer → pipe → West Ardougne manhole.
    // Complete quest: dig soft mud (spade), climb mud pile out; pipe needs Gas mask worn.
    {
        x: 2566,
        z: 3331,
        level: 0,
        locName: 'Mud patch',
        action: 'Dig',
        useItem: { id: 952, name: 'Spade' },
        requires: { item: 'Spade', count: 1 },
        toTile: { x: 2562, z: 9737, level: 0 },
        arrivalRadius: 2,
        label: 'Plague City mud dig → sewer (#366)'
    },
    {
        x: 2562,
        z: 9737,
        level: 0,
        locName: 'Mud pile',
        action: 'Climb',
        toTile: { x: 2566, z: 3331, level: 0 },
        arrivalRadius: 2,
        label: 'Plague City mud pile → garden (#366)'
    },
    {
        x: 2530,
        z: 9701,
        level: 0,
        locName: 'Sewer pipe',
        action: 'Search',
        toTile: { x: 2529, z: 3304, level: 0 },
        arrivalRadius: 2,
        label: 'Plague City sewer pipe → West Ardougne (#366)'
    },
    {
        x: 2529,
        z: 3303,
        level: 0,
        locName: 'Manhole',
        action: 'Climb-down',
        toTile: { x: 2530, z: 9703, level: 0 },
        arrivalRadius: 2,
        label: 'West Ardougne manhole → sewer (#366)'
    },

    // Gu'Tanoth chasm (#364 dig 3546) — Jump-From rock, 25 Agility, 20gp to guard.
    {
        x: 2530,
        z: 3026,
        level: 0,
        locName: 'Rock',
        action: 'Jump-From',
        requires: { item: 'Coins', count: 20 },
        requiresSkill: { name: 'agility', level: 25 },
        dialogue: { choose: ["Okay, I'll pay it."] },
        toTile: { x: 2530, z: 3029, level: 0 },
        arrivalRadius: 2,
        label: "Gu'Tanoth chasm jump in (#364)"
    },
    {
        x: 2531,
        z: 3029,
        level: 0,
        locName: 'Rock',
        action: 'Jump-From',
        toTile: { x: 2531, z: 3026, level: 0 },
        arrivalRadius: 2,
        label: "Gu'Tanoth chasm jump out (#364)"
    },
    // Toban camp (#364 dig 3548) — cave enter / ladder leave.
    {
        x: 2499,
        z: 2988,
        level: 0,
        locName: 'Cave entrance',
        action: 'Enter',
        toTile: { x: 2576, z: 3029, level: 0 },
        arrivalRadius: 3,
        label: "Toban cave enter (#364)"
    },
    {
        x: 2575,
        z: 3029,
        level: 0,
        locName: 'Ladder',
        action: 'Climb-down',
        toTile: { x: 2500, z: 2988, level: 0 },
        arrivalRadius: 2,
        label: "Toban ladder leave (#364)"
    },

    { x: 2568, z: 9893, level: 0, locName: 'Door', action: 'Open', useItem: { id: 298, name: 'A key' }, label: 'Baxtorian keyed door' },

    // edgeville_dungeon.rs2 brasskeydoor — Open only answers "The door is locked";
    // the key has to be USED on it (oplocu), in both directions, and the unlock walks
    // you through. Without a key the graph must route around the hut (#421, #423).
    { x: 3115, z: 3450, level: 0, locName: 'Door', action: 'Open', useItem: { id: 983, name: 'Brass key' }, requires: { item: 'Brass key', count: 1 }, label: 'Hill giant hut brass key door' },

    // Baxtorian Falls approach (#369 / #320) — same stands as FireGiantLogic:
    //   Board Log raft @ ~2510,3493 → crash mound 2512,3481
    //   Walk south to throw stand 2512,3477 (in THROW_ZONE z 3476–3481)
    //   Rope on Rock @ 2512,3468 → PastRock (~2513,3468, r≤3)
    //   Walk south to 2512,3466, Rope on Dead tree → ledge 2511,3463
    // One Rope, not consumed. Barrel exit already in transports.json.
    {
        x: 2509,
        z: 3493,
        level: 0,
        locName: 'Log raft',
        action: 'Board',
        toTile: { x: 2512, z: 3481, level: 0 },
        arrivalRadius: 2,
        label: 'Baxtorian log raft (#369)'
    },
    {
        x: 2512,
        z: 3468,
        level: 0,
        locName: 'Rock',
        action: 'Swim to',
        useItem: { id: 954, name: 'Rope' },
        requires: { item: 'Rope', count: 1 },
        toTile: { x: 2513, z: 3468, level: 0 },
        arrivalRadius: 3, // FireGiant PastRock = cheb(POST_ROCK) ≤ 3
        label: 'Baxtorian rope → rock (#369)'
    },
    {
        x: 2512,
        z: 3465,
        level: 0,
        locName: 'Dead tree',
        action: 'Climb',
        useItem: { id: 954, name: 'Rope' },
        requires: { item: 'Rope', count: 1 },
        toTile: { x: 2511, z: 3463, level: 0 },
        arrivalRadius: 1,
        label: 'Baxtorian rope → ledge (#369)'
    },

    { x: 3027, z: 3218, level: 1, npc: 'Seaman Thresnor', locName: 'Seaman Thresnor', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2956, z: 3143, level: 1 }, label: 'Port Sarim->Musa ship' },
    // Customs officer is ONE npc type; content branches on coordx(npc_coord) < 2815
    // (customs_officer.rs2). Key each reverse ship by pier stand + toTile — never type alone (#404).
    {
        x: 2955,
        z: 3146,
        level: 1,
        npc: 'Customs officer',
        locName: 'Customs officer',
        action: 'Pay-fare',
        requires: { item: 'Coins', count: 30 },
        dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] },
        toTile: { x: 3032, z: 3217, level: 1 },
        label: 'Musa->Port Sarim ship' // npc x ~2953–2955 ≥ 2815 → Port Sarim
    },

    { x: 2683, z: 3272, level: 1, npc: 'Captain Barnaby', locName: 'Captain Barnaby', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2775, z: 3234, level: 1 }, label: 'Ardougne->Brimhaven ship' },
    {
        x: 2772,
        z: 3234,
        level: 1,
        npc: 'Customs officer',
        locName: 'Customs officer',
        action: 'Pay-fare',
        requires: { item: 'Coins', count: 30 },
        dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] },
        toTile: { x: 2683, z: 3268, level: 1 },
        label: 'Brimhaven->Ardougne ship' // npc x ~2772–2773 < 2815 → Ardougne
    },

    { x: 2461, z: 3382, level: 0, locName: 'Gate', action: 'Open', dialogue: { choose: ['OK then'] }, reopenAfterDialogue: true, label: 'Gnome Stronghold gate (Femi boxes)' },

    // Heading south into the desert costs a Shantay pass and, the first time,
    // a disclaimer prompt. Coming back north is free, which is why only this
    // direction needs an entry. (shantay_pass.rs2)
    {
        x: 3304,
        z: 3118,
        level: 0,
        locName: 'Shantay pass',
        action: 'Go-through',
        requires: { item: 'Shantay pass', count: 1 },
        dialogue: { choose: ["Yeah, that poster doesn't scare me!"] },
        toTile: { x: 3304, z: 3114, level: 0 },
        label: 'Shantay Pass -> Kharidian desert'
    },

    // Mort Myre gate (#115). Server: Open is a hard mesbox while Nature Spirit is not
    // started; once started/complete the gate opens with no dialog. Unlock = walk back
    // to Drezel (post–Priest in Peril mausoleum), start Nature Spirit, return.
    // Both leaves share the gate (PathFinder keys edge origin).
    {
        x: 3443,
        z: 3458,
        level: 0,
        locName: 'Gate',
        action: 'Open',
        unlockQuest: {
            quest: 'Nature Spirit',
            requireComplete: 'Priest in Peril',
            npc: 'Drezel',
            stand: { x: 3439, z: 9895, level: 0 },
            // 3× meat pie + 3× apple pie (unstackable)
            freeSlots: 6,
            dialogue: {
                choose: [
                    'anything else interesting',
                    'what is it, I may be able to help',
                    "I'll go and look for him",
                    "Yes, I'm sure"
                ]
            }
        },
        label: 'Mort Myre gate (Ulizius)'
    },
    {
        x: 3444,
        z: 3458,
        level: 0,
        locName: 'Gate',
        action: 'Open',
        unlockQuest: {
            quest: 'Nature Spirit',
            requireComplete: 'Priest in Peril',
            npc: 'Drezel',
            stand: { x: 3439, z: 9895, level: 0 },
            freeSlots: 6,
            dialogue: {
                choose: [
                    'anything else interesting',
                    'what is it, I may be able to help',
                    "I'll go and look for him",
                    "Yes, I'm sure"
                ]
            }
        },
        label: 'Mort Myre gate (Ulizius)'
    },

    { x: 2598, z: 3477, level: 0, locName: 'Log balance', action: 'Walk-across', requiresSkill: { name: 'agility', level: 20 }, label: 'Coal trucks log balance' },
    { x: 2603, z: 3477, level: 0, locName: 'Log balance', action: 'Walk-across', requiresSkill: { name: 'agility', level: 20 }, label: 'Coal trucks log balance' },

    // Island ropeswings (shortcuts.rs2) — outer swings need agility 10; execute re-check.
    // Do not gate tree_ropeswing2 (2705,3205) — softlock prevention in content.
    {
        x: 2709,
        z: 3209,
        level: 0,
        locName: 'Ropeswing',
        action: 'Swing-on',
        requiresSkill: { name: 'agility', level: 10 },
        label: 'Brimhaven north ropeswing'
    },
    {
        x: 2511,
        z: 3091,
        level: 0,
        locName: 'Ropeswing',
        action: 'Swing-on',
        requiresSkill: { name: 'agility', level: 10 },
        label: 'Ogre island ropeswing'
    },

    // Entrana ferry — content: areas/area_port_sarim|entrana/monk_of_entrana.rs2 (Talk-to, members, weapon strip).
    {
        x: 3048,
        z: 3236,
        level: 0,
        npc: 'Monk of Entrana',
        locName: 'Monk of Entrana',
        action: 'Talk-to',
        dialogue: { choose: ["Yes, okay, I'm ready to go."] },
        toTile: { x: 2834, z: 3331, level: 1 },
        label: 'Port Sarim → Entrana'
    },
    {
        x: 2834,
        z: 3335,
        level: 0,
        npc: 'Monk of Entrana',
        locName: 'Monk of Entrana',
        action: 'Talk-to',
        dialogue: { choose: ["Yes, I'm ready to go."] },
        toTile: { x: 3048, z: 3231, level: 1 },
        label: 'Entrana → Port Sarim'
    },

    // Shilo ↔ Brimhaven cart — vigroy.rs2 / hajedy.rs2 (fare 10–200 coins).
    {
        x: 2834,
        z: 2954,
        level: 0,
        npc: 'Vigroy',
        locName: 'Vigroy',
        action: 'Talk-to',
        requires: { item: 'Coins', count: 10 },
        dialogue: { choose: ["Yes please, I'd like to go to Brimhaven."] },
        toTile: { x: 2776, z: 3214, level: 0 },
        label: 'Shilo → Brimhaven cart'
    },
    {
        x: 2779,
        z: 3212,
        level: 0,
        npc: 'Hajedy',
        locName: 'Hajedy',
        action: 'Talk-to',
        requires: { item: 'Coins', count: 10 },
        dialogue: { choose: ["Yes please, I'd like to go to Shilo Village."] },
        toTile: { x: 2834, z: 2951, level: 0 },
        label: 'Brimhaven → Shilo cart'
    },

    // Essence mine entry — right-click Teleport after Rune Mysteries (content runecraft.constant stands).
    {
        x: 3253,
        z: 3401,
        level: 0,
        npc: 'Aubury',
        locName: 'Aubury',
        action: 'Teleport',
        toTile: { x: 2912, z: 4833, level: 0 },
        arrivalRadius: 64,
        dialogue: { choose: ['Can you teleport me to the Rune Essence?'] },
        label: 'Aubury → essence mine'
    },
    {
        x: 3106,
        z: 9572,
        level: 0,
        npc: 'Sedridor',
        locName: 'Sedridor',
        action: 'Teleport',
        toTile: { x: 2912, z: 4833, level: 0 },
        arrivalRadius: 64,
        dialogue: { choose: ['Can you teleport me to the Rune Essence?'] },
        label: 'Sedridor → essence mine'
    },
    {
        x: 2591,
        z: 3086,
        level: 0,
        npc: 'Wizard Distentor',
        locName: 'Wizard Distentor',
        action: 'Teleport',
        toTile: { x: 2912, z: 4833, level: 0 },
        arrivalRadius: 64,
        dialogue: { choose: ['Can you teleport me to the Rune Essence?'] },
        label: 'Distentor → essence mine'
    },
    {
        x: 2684,
        z: 3322,
        level: 0,
        npc: 'Wizard Cromperty',
        locName: 'Wizard Cromperty',
        action: 'Teleport',
        toTile: { x: 2912, z: 4833, level: 0 },
        arrivalRadius: 64,
        dialogue: { choose: ['Can you teleport me to the Rune Essence?'] },
        label: 'Cromperty → essence mine'
    },
    {
        x: 2390,
        z: 9810,
        level: 0,
        npc: 'Brimstail',
        locName: 'Brimstail',
        action: 'Teleport',
        toTile: { x: 2912, z: 4833, level: 0 },
        arrivalRadius: 64,
        dialogue: { choose: ['Can you teleport me to the Rune Essence?'] },
        label: 'Brimstail → essence mine'
    },

    // Spirit trees — one crossing per destination (dialog option); multi-dest match uses toTile.
    // Stronghold tree (Grand Tree complete): village / varrock forest / khazard battlefield.
    {
        x: 2461,
        z: 3444,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Tree Gnome Village'] },
        toTile: { x: 2542, z: 3169, level: 0 },
        label: 'Spirit tree → Gnome Village'
    },
    {
        x: 2461,
        z: 3444,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Forest north of Varrock'] },
        toTile: { x: 3179, z: 3507, level: 0 },
        label: 'Spirit tree → Varrock forest'
    },
    {
        x: 2461,
        z: 3444,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Battlefield of Khazard'] },
        toTile: { x: 2555, z: 3259, level: 0 },
        label: 'Spirit tree → Khazard battlefield'
    },
    // Village tree → others
    {
        x: 2542,
        z: 3169,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Battlefield of Khazard'] },
        toTile: { x: 2555, z: 3259, level: 0 },
        label: 'Village spirit → Khazard'
    },
    {
        x: 2542,
        z: 3169,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Forest north of Varrock'] },
        toTile: { x: 3179, z: 3507, level: 0 },
        label: 'Village spirit → Varrock forest'
    },
    {
        x: 2542,
        z: 3169,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Where can I go?', 'Gnome stronghold'] },
        toTile: { x: 2461, z: 3444, level: 0 },
        label: 'Village spirit → Stronghold'
    },
    // Young trees → village only
    {
        x: 3179,
        z: 3507,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Yes please'] },
        toTile: { x: 2542, z: 3169, level: 0 },
        label: 'Varrock young spirit → Village'
    },
    {
        x: 2555,
        z: 3259,
        level: 0,
        locName: 'Spirit Tree',
        action: 'Talk-to',
        dialogue: { choose: ['Yes please'] },
        toTile: { x: 2542, z: 3169, level: 0 },
        label: 'Khazard young spirit → Village'
    },

    // Gnome glider (gnome_glider.rs2): Talk-to Gnome pilot → glidermap destination click.
    // Content only allows hub↔pad (not pad↔pad). Labels match glidermap.if text.
    {
        x: 2465,
        z: 3501,
        level: 3,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Gandius',
        toTile: { x: 2971, z: 2969, level: 0 },
        arrivalRadius: 4,
        label: 'Glider hub → Gandius'
    },
    {
        x: 2465,
        z: 3501,
        level: 3,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Sindarpos',
        toTile: { x: 2850, z: 3497, level: 0 },
        arrivalRadius: 4,
        label: 'Glider hub → Sindarpos'
    },
    {
        x: 2465,
        z: 3501,
        level: 3,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Lemanto Andra',
        toTile: { x: 3320, z: 3430, level: 0 },
        arrivalRadius: 4,
        label: 'Glider hub → Lemanto Andra'
    },
    {
        x: 2465,
        z: 3501,
        level: 3,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Kar-Hewo',
        toTile: { x: 3284, z: 3211, level: 0 },
        arrivalRadius: 4,
        label: 'Glider hub → Kar-Hewo'
    },
    {
        x: 2971,
        z: 2969,
        level: 0,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Ta Quir Priw',
        toTile: { x: 2465, z: 3501, level: 3 },
        arrivalRadius: 4,
        label: 'Glider Gandius → hub'
    },
    {
        x: 2850,
        z: 3497,
        level: 0,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Ta Quir Priw',
        toTile: { x: 2465, z: 3501, level: 3 },
        arrivalRadius: 4,
        label: 'Glider Sindarpos → hub'
    },
    {
        x: 3320,
        z: 3430,
        level: 0,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Ta Quir Priw',
        toTile: { x: 2465, z: 3501, level: 3 },
        arrivalRadius: 4,
        label: 'Glider Lemanto Andra → hub'
    },
    {
        x: 3284,
        z: 3211,
        level: 0,
        npc: 'Gnome pilot',
        locName: 'Gnome pilot',
        action: 'Talk-to',
        dialogue: { choose: ['Can you take me on the glider?'] },
        mapChoice: 'Ta Quir Priw',
        toTile: { x: 2465, z: 3501, level: 3 },
        arrivalRadius: 4,
        label: 'Glider Kar-Hewo → hub'
    },

    // Wilderness levers (wilderness_lever.rs2). Ardougne→deep wild shows a confirm
    // the first time (%warning_wilderness_teleport_lever); reverse has no dialog.
    {
        x: 2561,
        z: 3311,
        level: 0,
        locName: 'Lever',
        action: 'Pull',
        dialogue: {
            choose: ["Yes I'm brave.", "Yes please, don't show this message again."]
        },
        toTile: { x: 3154, z: 3924, level: 0 },
        arrivalRadius: 3,
        label: 'Ardougne → deep wilderness lever'
    },
    {
        x: 3153,
        z: 3923,
        level: 0,
        locName: 'Lever',
        action: 'Pull',
        toTile: { x: 2562, z: 3311, level: 0 },
        arrivalRadius: 3,
        label: 'Deep wilderness → Ardougne lever'
    }
];

export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}

function toTileMatches(
    sc: SpecialCrossing,
    step: { x: number; z: number; level: number }
): boolean {
    if (!sc.toTile) {
        return true;
    }
    return (
        sc.toTile.x === step.x
        && sc.toTile.z === step.z
        && (sc.toTile.level === undefined || sc.toTile.level === step.level)
    );
}

/**
 * Resolve a special crossing for a path transport hop.
 *
 * Try both approach and destination levels: ships (and similar) are stored as
 * from L0 → to L1 while SPECIAL_CROSSINGS are keyed at the stand/boarding level
 * (often 1). Pre-refactor matching used step.level; approach-only missed ships.
 *
 * When a candidate has `toTile`, it must match the hop destination — otherwise
 * a reverse ship (Customs on the Brimhaven deck) can steal a gangplank hop that
 * lands on the same pier tile at a different level (#live transport-heavy).
 */
export function specialCrossingForTransport(
    transport: { locX: number; locZ: number; locName?: string },
    approach: { x: number; z: number; level: number },
    step?: { x: number; z: number; level: number }
): SpecialCrossing | null {
    const levels = new Set<number>([approach.level]);
    if (step !== undefined) {
        levels.add(step.level);
    }

    const matchesOrigin = (sc: SpecialCrossing, level: number): boolean => {
        if (sc.level !== level) {
            return false;
        }
        return (
            (sc.x === transport.locX && sc.z === transport.locZ)
            || (sc.x === approach.x && sc.z === approach.z)
            || (step !== undefined && sc.x === step.x && sc.z === step.z)
        );
    };

    let candidates: SpecialCrossing[] = [];
    for (const level of levels) {
        for (const sc of SPECIAL_CROSSINGS) {
            if (matchesOrigin(sc, level)) {
                candidates.push(sc);
            }
        }
    }
    if (candidates.length === 0) {
        return null;
    }

    // Prefer loc/npc name match when the transport carries a name.
    const tname = (transport.locName ?? '').toLowerCase();
    if (tname) {
        const byName = candidates.filter(
            sc =>
                sc.locName.toLowerCase() === tname
                || (sc.npc !== undefined && sc.npc.toLowerCase() === tname)
        );
        if (byName.length > 0) {
            candidates = byName;
        }
    }

    // Drop ship/tele SC whose landing does not match this hop's destination.
    // Keeps loc-only gates (no toTile) for doors/tolls.
    if (step !== undefined) {
        const destOk = candidates.filter(sc => toTileMatches(sc, step));
        if (destOk.length > 0) {
            candidates = destOk;
        } else if (candidates.some(sc => sc.toTile !== undefined)) {
            // Only mismatched landings — do not steal a gangplank/loc hop.
            return null;
        }
    }

    // Multi-dest hubs: exact toTile match wins.
    if (step !== undefined && candidates.length > 1) {
        const byDest = candidates.find(sc => sc.toTile !== undefined && toTileMatches(sc, step));
        if (byDest) {
            return byDest;
        }
    }
    return candidates[0] ?? null;
}

export function pickChoice(options: string[], choose: string[]): string | null {
    const wants = choose.map(c => c.toLowerCase());
    return options.find(o => wants.some(w => o.toLowerCase().includes(w))) ?? null;
}

export function meetsRequirement(have: number, requires?: { item: string; count: number }): boolean {
    return !requires || have >= requires.count;
}

export function meetsSkill(level: number, requiresSkill?: SpecialCrossing['requiresSkill']): boolean {
    return !requiresSkill || level >= requiresSkill.level;
}

export function matchesUseItem(item: { id: number }, useItem: NonNullable<SpecialCrossing['useItem']>): boolean {
    return item.id === useItem.id;
}
