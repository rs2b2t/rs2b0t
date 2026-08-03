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

    { x: 2568, z: 9893, level: 0, locName: 'Door', action: 'Open', useItem: { id: 298, name: 'A key' }, label: 'Baxtorian keyed door' },

    { x: 3027, z: 3218, level: 1, npc: 'Seaman Thresnor', locName: 'Seaman Thresnor', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2956, z: 3143, level: 1 }, label: 'Port Sarim->Musa ship' },
    { x: 2955, z: 3146, level: 1, npc: 'Customs officer', locName: 'Customs officer', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] }, toTile: { x: 3032, z: 3217, level: 1 }, label: 'Musa->Port Sarim ship' },

    { x: 2683, z: 3272, level: 1, npc: 'Captain Barnaby', locName: 'Captain Barnaby', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2775, z: 3234, level: 1 }, label: 'Ardougne->Brimhaven ship' },
    { x: 2772, z: 3234, level: 1, npc: 'Customs officer', locName: 'Customs officer', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] }, toTile: { x: 2683, z: 3268, level: 1 }, label: 'Brimhaven->Ardougne ship' },

    { x: 2461, z: 3382, level: 0, locName: 'Gate', action: 'Open', dialogue: { choose: ['OK then'] }, reopenAfterDialogue: true, label: 'Gnome Stronghold gate (Femi boxes)' },

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
    }
];

export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}


/**
 * Resolve a special crossing for a path transport hop.
 *
 * Try both approach and destination levels: ships (and similar) are stored as
 * from L0 → to L1 while SPECIAL_CROSSINGS are keyed at the stand/boarding level
 * (often 1). Pre-refactor matching used step.level; approach-only missed ships.
 */
export function specialCrossingForTransport(
    transport: { locX: number; locZ: number },
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

    const candidates: SpecialCrossing[] = [];
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
    // Multi-dest hubs (spirit trees): pick the crossing whose toTile matches the hop.
    if (step !== undefined && candidates.length > 1) {
        const byDest = candidates.find(
            sc =>
                sc.toTile !== undefined
                && sc.toTile.x === step.x
                && sc.toTile.z === step.z
                && (sc.toTile.level === undefined || sc.toTile.level === step.level)
        );
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
