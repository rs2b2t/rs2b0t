import type { QuestRecord } from '../types.js';

// Members quests, group B. Filled in Task 6.
export const MEMBERS_B: QuestRecord[] = [
    {
        // source: elena_journal.rs2:6-8 "There aren't any requirements for this Quest."; items alrena.rs2:11,24 dwellberries (found in McGrubor's wood per journal), sewerpipe.rs2:25 rope; quest.constant:88 QP.
        id: 'elena', name: 'Plague City', members: true, questPoints: 1,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' },
            { name: 'Dwellberries', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: fishingcompo_journal.rs2:11 stat_base(fishing) < 10; items quest_fishingcompo.rs2 garlic, hemenster_fishing.rs2:78 fishing_rod, :21 red_vine_worm; quest.constant:89 QP.
        id: 'fishingcompo', name: 'Fishing Contest', members: true, questPoints: 1,
        requirements: { skills: [{ skill: 'fishing', level: 10 }] },
        items: [
            { name: 'Garlic', qty: 1, kind: 'mustHave' },
            { name: 'Fishing rod', qty: 1, kind: 'mustHave' },
            { name: 'Red vine worm', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: fluffs_journal.rs2 no skill/qp gates; items quest_fluffs.rs2:106 inv_del(coins,100) + raw_sardine/bucket_milk checks; quest.constant:90 QP.
        id: 'fluffs', name: "Gertrude's Cat", members: true, questPoints: 1,
        requirements: {},
        items: [
            { name: 'Raw sardine', qty: 1, kind: 'mustHave' },
            { name: 'Bucket of milk', qty: 1, kind: 'mustHave' },
            { name: 'Coins', qty: 100, kind: 'mustHave' }
        ]
    },
    {
        // source: grail_journal.rs2:85 completion check only; no skill/qp/prereq gate present in quest_grail scripts (this content does NOT gate on Merlin's Crystal); quest.constant:92 QP.
        id: 'grail', name: 'Holy Grail', members: true, questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: grandtree_journal.rs2:8-14 "I must have: Level 25 Agility" (stat_base(agility) < 25); quest.constant:93 QP.
        id: 'grandtree', name: 'The Grand Tree', members: true, questPoints: 5,
        requirements: { skills: [{ skill: 'agility', level: 25 }] },
        items: []
    },
    {
        // source: hazeelcult_journal.rs2 no skill/qp/prereq gates; quest.constant:95 QP.
        id: 'hazeelcult', name: 'Hazeel Cult', members: true, questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: quest_hero.rs2:2-4 (%qp < ^hero_required_questpoints; %zanaris/%dragonquest/%arthur/%blackarmgang < *_complete); quest_hero.constant:20 required QP = 55; quest.constant:96 QP.
        id: 'hero', name: "Hero's Quest", members: true, questPoints: 1,
        requirements: { minQuestPoints: 55, quests: ['zanaris', 'dragon', 'arthur', 'blackarmgang'] },
        items: []
    },
    {
        // source: horror_journal.rs2:5-6 "To complete this quest I need: Level 35 agility" (journal-advisory: hardcoded text, no stat_base check; magic 13 = "will be an advantage" + level-100 combat advisory, NOT recorded); items quest_horror.rs2:133-134,162-163 (2 bridge sections, 1 plank + 4 nails each) + hammer; quest.constant:131 QP.
        id: 'horror', name: 'Horror from the Deep', members: true, questPoints: 2,
        requirements: { skills: [{ skill: 'agility', level: 35 }] },
        items: [
            { name: 'Plank', qty: 2, kind: 'mustHave' },
            { name: 'Nails', qty: 8, kind: 'mustHave' },
            { name: 'Hammer', qty: 1, kind: 'mustHave' },
            { name: 'Swamp tar', qty: 1, kind: 'acquirable' },
            { name: 'Molten glass', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: ikov_journal.rs2:12-15 "I must have: Level 42 thieving / Level 40 ranged" (journal-advisory: hardcoded text, comment ":13 Not sure if these are checked"); quest.constant:99 QP.
        id: 'ikov', name: 'Temple of Ikov', members: true, questPoints: 1,
        requirements: { skills: [{ skill: 'thieving', level: 42 }, { skill: 'ranged', level: 40 }] },
        items: []
    },
    {
        // source: itexam_journal.rs2:10,16,22 "To complete this quest I need" agility 10 / herblore 10 / thieving 25; name questlist.if:375 (NOTE: brief table swapped itexam/itgronigen; questlist.if is source-of-truth -> itexam = "Digsite Quest"); quest.constant:101 QP.
        id: 'itexam', name: 'Digsite Quest', members: true, questPoints: 2,
        requirements: { skills: [
            { skill: 'agility', level: 10 },
            { skill: 'herblore', level: 10 },
            { skill: 'thieving', level: 25 }
        ] },
        items: []
    },
    {
        // source: itgronigen_journal.rs2 no skill/qp/prereq gates; name questlist.if:615 (NOTE: brief table swapped itexam/itgronigen; itgronigen = "Observatory Quest"); quest.constant:102 QP.
        id: 'itgronigen', name: 'Observatory Quest', members: true, questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: junglepotion_journal.rs2:104 completion check only; no skill/qp/prereq gate present (this content does NOT gate on Druidic Ritual); quest.constant:104 QP.
        id: 'junglepotion', name: 'Jungle Potion', members: true, questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: legends_journal.rs2:20-53 prereq quests (%heroquest,%crestquest,%zombiequeen,%upass,%waterfall_quest >= *_complete), :55 %qp >= ^legends_required_questpoints (quest_legends.constant:76 = 107), :65-128 skill gates; items radimus_notes.rs2:83-97 papyrus/charcoal, quest_legends.rs2:1493 gold_bar 2; name questlist.if:540; quest.constant:105 QP.
        id: 'legends', name: 'Legends Quest', members: true, questPoints: 4,
        requirements: {
            minQuestPoints: 107,
            skills: [
                { skill: 'magic', level: 56 },
                { skill: 'mining', level: 52 },
                { skill: 'agility', level: 50 },
                { skill: 'crafting', level: 50 },
                { skill: 'smithing', level: 50 },
                { skill: 'strength', level: 50 },
                { skill: 'thieving', level: 50 },
                { skill: 'woodcutting', level: 50 },
                { skill: 'herblore', level: 45 },
                { skill: 'prayer', level: 42 }
            ],
            quests: ['hero', 'crest', 'zombiequeen', 'upass', 'waterfall']
        },
        items: [
            { name: 'Gold bar', qty: 2, kind: 'mustHave' },
            { name: 'Papyrus', qty: 3, kind: 'mustHave' },
            { name: 'Charcoal', qty: 3, kind: 'mustHave' }
        ]
    },
    {
        // source: mcannon_journal.rs2 no skill/qp/prereq gates; quest.constant:106 QP.
        id: 'mcannon', name: 'Dwarf Cannon', members: true, questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: mortton_journal.rs2:9 completion check only; no skill/qp/prereq gate present (this content does NOT gate on Priest in Peril); name questlist.if:930 "Shades of Mortton" (no apostrophe); quest.constant:129 QP.
        id: 'mortton', name: 'Shades of Mortton', members: true, questPoints: 3,
        requirements: {},
        items: []
    }
];
