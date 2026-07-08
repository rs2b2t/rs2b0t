import type { QuestRecord } from '../types.js';

// Members quests, group A. Filled in Task 6.
export const MEMBERS_A: QuestRecord[] = [
    {
        // source: arena_journal.rs2:6-8 only advertises "defeat a level 137 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:69 QP.
        id: 'arena', name: 'Fight Arena', members: true, questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: arthur_journal.rs2:8-10 only advertises "defeat a level 39 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:70 QP. Excalibur/black candle/bat bones are acquired mid-quest.
        id: 'arthur', name: "Merlin's Crystal", members: true, questPoints: 6,
        requirements: {},
        items: []
    },
    {
        // source: ball_journal.rs2:5-7 only advertises "defeat a level 53 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:71 QP.
        id: 'ball', name: "Witch's House", members: true, questPoints: 4,
        requirements: {},
        items: [
            { name: 'Cheese', qty: 1, kind: 'acquirable' } // ball_journal/quest_ball.rs2 inv_del(inv, cheese, 1): lure the mouse
        ]
    },
    {
        // source: biohazard_journal.rs2:4-5 advertises no gate; start dialogue elena.rs2:118-134 has no varp gate. NOTE: canonically requires Plague City (elena) but it is enforced only via elena2 NPC availability, not an explicit journal/start check. quest.constant:72 QP.
        id: 'biohazard', name: 'Biohazard', members: true, questPoints: 3,
        requirements: {},
        items: []
    },
    {
        // source: chompybird_journal.rs2:10-30 not_started display stat_base gates fletching 5, cooking 30, ranged 30 (journal-advisory); quest.constant:75 QP. Ogre bow/toads/arrows acquired mid-quest.
        id: 'chompybird', name: 'Big Chompy Bird Hunting', members: true, questPoints: 2,
        requirements: { skills: [
            { skill: 'fletching', level: 5 },
            { skill: 'cooking', level: 30 },
            { skill: 'ranged', level: 30 }
        ] },
        items: []
    },
    {
        // source: cog_journal.rs2:6-7 advertises no gate; quest.constant:76 QP. Coloured cogs are acquired mid-quest.
        id: 'cog', name: 'Clock Tower', members: true, questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: crest_journal.rs2:10-14 not_started static advisory text (NOT stat_base): mining 40, crafting 40, smithing 40, magic 59, + "level 170 Demon" combat advisory (journal-advisory); quest.constant:78 QP.
        id: 'crest', name: 'Family Crest', members: true, questPoints: 1,
        requirements: { skills: [
            { skill: 'mining', level: 40 },
            { skill: 'crafting', level: 40 },
            { skill: 'smithing', level: 40 },
            { skill: 'magic', level: 59 }
        ] },
        items: [
            // crest_journal.rs2:37-41 cooked fish for Caleb; 73-74 'perfect' jewellery made from in-quest perfect gold.
            { name: 'Tuna', qty: 1, kind: 'acquirable' },
            { name: 'Bass', qty: 1, kind: 'acquirable' },
            { name: 'Salmon', qty: 1, kind: 'acquirable' },
            { name: 'Shrimps', qty: 1, kind: 'acquirable' },
            { name: 'Swordfish', qty: 1, kind: 'acquirable' },
            { name: "'perfect' ring", qty: 1, kind: 'acquirable' },
            { name: "'perfect' necklace", qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: death_journal.rs2:19-20 advertises no skill/qp/prereq gate; quest.constant:79 QP. Bring-items death_journal.rs2:78-100 + quest_death.rs2 inv_del bread 10, trout 10, iron_bar 1.
        id: 'death', name: 'Death Plateau', members: true, questPoints: 1,
        requirements: {},
        items: [
            { name: 'Bread', qty: 10, kind: 'mustHave' },
            { name: 'Trout', qty: 10, kind: 'mustHave' },
            { name: 'Iron bar', qty: 1, kind: 'mustHave' }
        ]
    },
    {
        // source: desertrescue_journal.rs2:9,14 stat_base gates fletching 10, smithing 20; quest.constant:81 QP. Dart bring-items desertrescue_journal.rs2:127-139 (hammer, feathers, bronze bar).
        id: 'desertrescue', name: 'The Tourist Trap', members: true, questPoints: 2,
        requirements: { skills: [
            { skill: 'fletching', level: 10 },
            { skill: 'smithing', level: 20 }
        ] },
        items: [
            { name: 'Hammer', qty: 1, kind: 'mustHave' },
            { name: 'Feather', qty: 10, kind: 'acquirable' },
            { name: 'Bronze bar', qty: 1, kind: 'mustHave' }
        ]
    },
    {
        // source: dragon_journal.rs2:7 `%qp < 32` -> minQuestPoints 32; quest.constant:83 QP. Rhyme door items dragon_journal.rs2:135-146; ship repair lady_lumbridge.rs2:63-78 (3 planks, 4 nails each = 12, hammer); coins to buy ship quest_dragon inv_del(coins,10000).
        id: 'dragon', name: 'Dragon Slayer', members: true, questPoints: 2,
        requirements: { minQuestPoints: 32 },
        items: [
            { name: 'Coins', qty: 10000, kind: 'mustHave' },
            { name: "Wizard's mind bomb", qty: 1, kind: 'mustHave' },
            { name: 'Silk', qty: 1, kind: 'mustHave' },
            { name: 'Lobster pot', qty: 1, kind: 'mustHave' },
            { name: 'Unfired bowl', qty: 1, kind: 'mustHave' },
            { name: 'Plank', qty: 3, kind: 'mustHave' },
            { name: 'Nails', qty: 12, kind: 'mustHave' },
            { name: 'Hammer', qty: 1, kind: 'mustHave' },
            { name: 'Dragonfire shield', qty: 1, kind: 'acquirable' } // given by the Duke of Lumbridge; obj name= is 'Dragonfire shield'
        ]
    },
    {
        // source: druid_journal.rs2:6-7 advertises no gate; quest.constant:84 QP. Raw meats druid_journal.rs2:12 placed in cauldron.
        id: 'druid', name: 'Druidic Ritual', members: true, questPoints: 4,
        requirements: {},
        items: [
            { name: 'Raw bear meat', qty: 1, kind: 'acquirable' },
            { name: 'Raw beef', qty: 1, kind: 'acquirable' },
            { name: 'Raw chicken', qty: 1, kind: 'acquirable' },
            { name: 'Raw rat meat', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: druidspirit_journal.rs2:26-41 not_started advertises prereqs The Restless Ghost (priest) + Priest in Peril (priestperil), and stat_base(crafting)>=18 under "also recommended" (journal-advisory); quest.constant:85 QP.
        id: 'druidspirit', name: 'Nature Spirit', members: true, questPoints: 2,
        requirements: {
            skills: [ { skill: 'crafting', level: 18 } ],
            quests: ['priest', 'priestperil']
        },
        items: []
    },
    {
        // source: drunkmonk_journal.rs2:8-9 advertises no gate; quest.constant:86 QP. Jug of water / logs are acquired locally.
        id: 'drunkmonk', name: "Monk's Friend", members: true, questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: eadgar_journal.rs2:8 not_started advertises prereq Druidic Ritual (druid) + rescued Mad Eadgar from Troll Stronghold (troll) + "Level 31 Herblore" (static advisory text, journal-advisory); quest.constant:128 QP. Fake-man bring-items eadgar_journal.rs2:61-83 (5 raw chickens, 10 grain, logs, dirty clothes).
        id: 'eadgar', name: "Eadgar's Ruse", members: true, questPoints: 1,
        requirements: {
            skills: [ { skill: 'herblore', level: 31 } ],
            quests: ['druid', 'troll']
        },
        items: [
            { name: 'Raw chicken', qty: 5, kind: 'acquirable' },
            { name: 'Grain', qty: 10, kind: 'acquirable' }
        ]
    },
    {
        // source: elemental_workshop_journal.rs2:68-84 not_started stat_base gates mining 20, smithing 20, crafting 20; quest.constant:87 QP. Bring-items quest_elemental_workshop inv_del leather 1, thread 1, coal 4.
        id: 'elemental_workshop', name: 'Elemental Workshop', members: true, questPoints: 1,
        requirements: { skills: [
            { skill: 'mining', level: 20 },
            { skill: 'smithing', level: 20 },
            { skill: 'crafting', level: 20 }
        ] },
        items: [
            { name: 'Leather', qty: 1, kind: 'acquirable' },
            { name: 'Thread', qty: 1, kind: 'acquirable' },
            { name: 'Coal', qty: 4, kind: 'acquirable' }
        ]
    }
];
