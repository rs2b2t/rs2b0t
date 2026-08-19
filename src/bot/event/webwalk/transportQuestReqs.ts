// Why: quest gates for curated 2004 travel pair journal display names with engine varps.
// Why: display names must match the quest-list row text (questlist.if) so live `Quests.status` and worldStateLive snapshots open the same edges as pack probes.
// Why: the complete values come from content `general/configs/quest.constant`.
// Why: after a setvar, live harnesses must relog so `~update_questlist` recolours the tab.

import type { QuestProgress, TransportRequires } from './types.js';

/** Engine permanent varp + complete stage (setvar seed). */
interface QuestVarSeed {
    /** Journal / quest-list display name. */
    journal: string;
    /** Content varp name for `setvar <varp> <stage>`. */
    varp: string;
    /** Value at which the quest is complete (quest.constant). */
    complete: number;
    /** Optional bit-varp seeds (e.g. Shilo map mechanisms). */
    extra?: { varp: string; value: number }[];
    /** Why this quest is needed for travel. */
    usedBy: string[];
}

/**
 * All quests that gate curated travel or common teleports used with them.
 * Aliases map short catalog names → journal name for WorldState lookup.
 */
export const TRANSPORT_QUEST_SEEDS: readonly QuestVarSeed[] = [
    {
        journal: 'Rune Mysteries Quest',
        varp: 'runemysteries',
        complete: 6,
        usedBy: [
            'essence_entry (Aubury/Sedridor/Distentor/Cromperty/Brimstail)',
            'essence_exit (session portal×return)'
        ]
    },
    {
        journal: 'The Grand Tree',
        varp: 'grandtree',
        complete: 160,
        usedBy: ['spirit_tree (stronghold)', 'gnome_glider']
    },
    {
        journal: 'Tree Gnome Village',
        varp: 'treequest',
        complete: 9,
        usedBy: ['spirit_tree (village / young trees)']
    },
    {
        journal: 'Shilo Village',
        varp: 'zombiequeen',
        complete: 15,
        // Cart Brimhaven→Shilo checks %zombiequeen >= complete; prereq jungle potion
        // is content-side for quest start only — complete shilo is enough for cart.
        usedBy: ['shilo_cart (Brimhaven→Shilo Hajedy)']
    },
    {
        journal: 'Priest in Peril',
        varp: 'priestperil',
        // Why: ^priestperil_complete = 60, but the Salve barrier wants 61 (^priestperil_access_holy_barrier), one Drezel talk past complete.
        // Why: the quest bot takes that talk and the walker unlocks it on refusal.
        complete: 60,
        usedBy: [
            'paterdomus tunnel gates (pip_underground_door1/2)',
            'salve holy barrier → Morytania'
        ]
    },
    {
        journal: 'Plague City',
        varp: 'elenaquest',
        // ^elena_complete = 29; spell also requires ^elena_complete_read_scroll = 30
        // ("You haven't learnt how to cast this spell yet." if only 29).
        complete: 30,
        usedBy: ['spell: Ardougne teleport (combo routes)']
    },
    {
        // questlist.if text=Watch Tower (space)
        journal: 'Watch Tower',
        varp: 'itwatchtower',
        // ^itwatchtower_complete = 13; spell needs ^itwatchtower_complete_read_scroll = 14
        complete: 14,
        usedBy: ['spell: Watchtower teleport']
    },
    {
        journal: "Eadgar's Ruse",
        // content: %eadgar_quest (not %eadgar) — quests.rs2 / teleport.rs2
        varp: 'eadgar_quest',
        complete: 110,
        usedBy: ['spell: Trollheim teleport']
    },
    {
        // questlist.if text=Waterfall Quest; raft needs ≥ started (not 0).
        // complete = 10; log raft boards for any stage ≥ 1 (FireGiant parks if notStarted).
        journal: 'Waterfall Quest',
        varp: 'waterfall_quest',
        complete: 10,
        usedBy: [
            'baxtorian_log_raft (Board — refuses if not started)',
            'baxtorian rope rock/tree approach after raft crash (#369)'
        ]
    },
    {
        // Post-quest Crandor: secret wall + rock/rope (ship is one-shot during the quest).
        journal: 'Dragon Slayer',
        varp: 'dragonquest',
        // ^dragon_complete = 10
        complete: 10,
        usedBy: ['dragonsecretdoor', 'crandor_rock_opening', 'crandor_climbing_rope']
    },
    {
        // questlist.if omits "The"; generic travel exposes the guarded cave post-quest.
        journal: 'Tourist Trap',
        varp: 'desertrescue',
        complete: 30,
        usedBy: ['Desert Mining Camp guarded cave']
    }
] as const;

/** Short names used in older catalog strings → quest-list display name. */
const TRANSPORT_QUEST_ALIASES: Readonly<Record<string, string>> = {
    'rune mysteries': 'Rune Mysteries Quest',
    'rune mysteries quest': 'Rune Mysteries Quest',
    'the grand tree': 'The Grand Tree',
    'grand tree': 'The Grand Tree',
    'tree gnome village': 'Tree Gnome Village',
    'shilo village': 'Shilo Village',
    'plague city': 'Plague City',
    watchtower: 'Watch Tower',
    'watch tower': 'Watch Tower',
    "eadgar's ruse": "Eadgar's Ruse",
    waterfall: 'Waterfall Quest',
    'waterfall quest': 'Waterfall Quest',
    'dragon slayer': 'Dragon Slayer',
    // The 2004 journal omits "The" while some catalog/content names include it.
    'the tourist trap': 'Tourist Trap',
    'tourist trap': 'Tourist Trap'
};

export function canonicalQuestName(name: string): string {
    const hit = TRANSPORT_QUEST_ALIASES[name.toLowerCase()];
    return hit ?? name;
}

/** Requires helpers matching travelCatalog gates (journal names). */
export const REQ = {
    runeMysteriesComplete: {
        quests: [{ quest: 'Rune Mysteries Quest', minStatus: 'complete' as const }]
    },
    grandTreeComplete: {
        members: true,
        quests: [{ quest: 'The Grand Tree', minStatus: 'complete' as const }]
    },
    grandTreeStarted: {
        members: true,
        quests: [{ quest: 'The Grand Tree', minStatus: 'started' as const }]
    },
    treeGnomeComplete: {
        members: true,
        quests: [{ quest: 'Tree Gnome Village', minStatus: 'complete' as const }]
    },
    /** Elkoy maze escort (elkoy.rs2) once Tree Gnome Village is started. */
    treeGnomeStarted: {
        members: true,
        quests: [{ quest: 'Tree Gnome Village', minStatus: 'started' as const }]
    },
    shiloComplete: {
        members: true,
        quests: [{ quest: 'Shilo Village', minStatus: 'complete' as const }]
    },
    /** Log raft boards once Waterfall is started (content: not_started refuses Board). */
    waterfallStarted: {
        members: true,
        quests: [{ quest: 'Waterfall Quest', minStatus: 'started' as const }]
    },
    dragonSlayerComplete: {
        quests: [{ quest: 'Dragon Slayer', minStatus: 'complete' as const }]
    }
} as const satisfies Record<string, TransportRequires>;

/** WorldStateData.quests map with every transport seed marked complete. */
export function richTransportQuestMap(): Record<string, QuestProgress> {
    const q: Record<string, QuestProgress> = {};
    for (const s of TRANSPORT_QUEST_SEEDS) {
        q[s.journal] = 'complete';
        q[s.journal.toLowerCase()] = 'complete';
        for (const [alias, journal] of Object.entries(TRANSPORT_QUEST_ALIASES)) {
            if (journal === s.journal) {
                q[alias] = 'complete';
            }
        }
    }
    return q;
}

/** setvar lines for live harness (after mainlandAccount, before relog). */
export function transportQuestSetvarCommands(): string[] {
    const cmds: string[] = [];
    for (const s of TRANSPORT_QUEST_SEEDS) {
        cmds.push(`setvar ${s.varp} ${s.complete}`);
        if (s.extra) {
            for (const e of s.extra) {
                cmds.push(`setvar ${e.varp} ${e.value}`);
            }
        }
    }
    return cmds;
}

/** Journal names to assert complete after relog. */
export function transportQuestJournalNames(): string[] {
    return TRANSPORT_QUEST_SEEDS.map(s => s.journal);
}
