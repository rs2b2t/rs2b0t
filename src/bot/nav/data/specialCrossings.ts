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
    { x: 2603, z: 3477, level: 0, locName: 'Log balance', action: 'Walk-across', requiresSkill: { name: 'agility', level: 20 }, label: 'Coal trucks log balance' }
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
    for (const level of levels) {
        const hit =
            specialCrossingAt(transport.locX, transport.locZ, level)
            ?? specialCrossingAt(approach.x, approach.z, level)
            ?? (step !== undefined ? specialCrossingAt(step.x, step.z, level) : null);
        if (hit) {
            return hit;
        }
    }
    return null;
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
