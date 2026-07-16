import type { QuestRecord } from '../types.js';

// Members quests, group C. Filled in Task 6.
export const MEMBERS_C: QuestRecord[] = [
    {
        // source: murder_journal.rs2:5-51 no skill/qp/prereq gate; quest.constant:107 QP.
        id: 'murder',
        name: 'Murder Mystery',
        members: true,
        questPoints: 3,
        requirements: {},
        items: []
    },
    {
        // source: priestperil_journal.rs2:6-7 no skill/qp gate (only "defeat a level 30 enemy" combat note);
        // :91 quest advertises bringing 50 rune essence to Drezel (obj "Rune essence", ores.obj); quest.constant:109 QP.
        id: 'priestperil',
        name: 'Priest in Peril',
        members: true,
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Rune essence', qty: 50, kind: 'mustHave' }
        ]
    },
    {
        // source: regicide_journal.rs2:11-25 requirement list -> Underground Pass complete (%upass), agility 56, crafting 10; quest.constant:127 QP.
        id: 'regicide',
        name: 'Regicide',
        members: true,
        questPoints: 3,
        requirements: {
            skills: [
                { skill: 'agility', level: 56 },
                { skill: 'crafting', level: 10 }
            ],
            quests: ['upass']
        },
        items: []
    },
    {
        // source: scorpcatcher_journal.rs2:9 requirement list -> prayer 31 (stat_base); quest.constant:113 QP.
        id: 'scorpcatcher',
        name: 'Scorpion Catcher',
        members: true,
        questPoints: 1,
        requirements: {
            skills: [
                { skill: 'prayer', level: 31 }
            ]
        },
        items: []
    },
    {
        // source: seaslug_journal.rs2 no stat_base/qp/prereq gate advertised; quest.constant:114 QP.
        id: 'seaslug',
        name: 'Sea Slug Quest',
        members: true,
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: sheepherder_journal.rs2 no skill/qp/prereq gate; quest.constant:116 QP.
        id: 'sheepherder',
        name: 'Sheep Herder',
        members: true,
        questPoints: 4,
        requirements: {},
        items: []
    },
    {
        // source: tbwt_journal.rs2:10,17 prereq Jungle Potion; :13 advertised cooking 30/agility 15/fishing 5 (journal-advisory text, no stat_base); quest.constant:126 QP.
        id: 'tbwt',
        name: 'Tai Bwo Wannai Trio',
        members: true,
        questPoints: 2,
        requirements: {
            skills: [
                { skill: 'cooking', level: 30 },
                { skill: 'agility', level: 15 },
                { skill: 'fishing', level: 5 }
            ],
            quests: ['junglepotion']
        },
        items: []
    },
    {
        // source: totem_journal.rs2:12 thieving 21 (stat_base); quest.constant:118 QP.
        id: 'totem',
        name: 'Tribal Totem',
        members: true,
        questPoints: 1,
        requirements: {
            skills: [
                { skill: 'thieving', level: 21 }
            ]
        },
        items: []
    },
    {
        // source: tree_journal.rs2 no skill/qp/prereq gate; quest.constant:119 QP.
        id: 'tree',
        name: 'Tree Gnome Village',
        members: true,
        questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: troll_journal.rs2:4 prereq Death Plateau; :5 agility 15 (journal-advisory text, no stat_base). "Level 30 Thieving might be useful" is optional, not recorded. quest.constant:125 QP.
        id: 'troll',
        name: 'Troll Stronghold',
        members: true,
        questPoints: 1,
        requirements: {
            skills: [
                { skill: 'agility', level: 15 }
            ],
            quests: ['death']
        },
        items: []
    },
    {
        // source: upass_journal.rs2 no skill gate; quest_upass.rs2:81 mesbox hard-gates on Biohazard complete;
        // rope consumed at upass_obstacles.rs2:108, plank (obj woodplank -> "Plank") placed at upass_obstacles.rs2:195; bow+arrows also needed at bridge (upass_bridge.rs2:46). quest.constant:120 QP.
        id: 'upass',
        name: 'Underground Pass',
        members: true,
        questPoints: 5,
        requirements: {
            quests: ['biohazard']
        },
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' },
            { name: 'Plank', qty: 1, kind: 'mustHave' }
        ]
    },
    {
        // source: viking_journal.rs2:7 advertised woodcutting 40/crafting 40/fletching 25 (journal-advisory text, no stat_base); quest.constant:130 QP.
        id: 'viking',
        name: 'The Fremennik Trials',
        members: true,
        questPoints: 3,
        requirements: {
            skills: [
                { skill: 'woodcutting', level: 40 },
                { skill: 'crafting', level: 40 },
                { skill: 'fletching', level: 25 }
            ]
        },
        items: []
    },
    {
        // source: waterfall_journal.rs2 no skill/qp/prereq gate (quest_waterfall.rs2:60-95 is the whirlpool "items you lose" list, not a requirement); quest.constant:122 QP.
        id: 'waterfall',
        name: 'Waterfall Quest',
        members: true,
        questPoints: 1,
        requirements: {},
        // Only the player-supplied Rope is a record item (never consumed —
        // quest_waterfall.rs2:218-262). The runes (6 air + 6 earth + 6 water) and
        // food are DEF-managed mid-quest: they cannot pass the tomb gate
        // (quest_waterfall.rs2:44-100), so waterfall.ts withdraws them only AFTER
        // the tomb rather than provisioning them up front.
        items: [
            { name: 'Rope', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: zanaris_journal.rs2:10,15 crafting 31 + woodcutting 36 (stat_base); quest.constant:123 QP.
        id: 'zanaris',
        name: 'Lost City',
        members: true,
        questPoints: 3,
        requirements: {
            skills: [
                { skill: 'crafting', level: 31 },
                { skill: 'woodcutting', level: 36 }
            ]
        },
        items: []
    },
    {
        // source: zombiequeen_journal.rs2 no skill/qp/prereq gate; quest_zombiequeen.rs2:465 attach player-supplied rope to enter Ah Za Rhoon; quest.constant:124 QP.
        id: 'zombiequeen',
        name: 'Shilo Village',
        members: true,
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' }
        ]
    }
];
