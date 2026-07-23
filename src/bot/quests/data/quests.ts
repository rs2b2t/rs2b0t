import type { QuestRecord } from '../types.js';

export const QUESTS: QuestRecord[] = [
    {
        id: 'cook',
        name: "Cook's Assistant",
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Egg', qty: 1, kind: 'acquirable' },
            { name: 'Pot of flour', qty: 1, kind: 'acquirable' },
            { name: 'Bucket of milk', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'squire',
        name: "The Knight's Sword",
        questPoints: 1,
        requirements: { skills: [{ skill: 'mining', level: 10 }] },
        items: [
            { name: 'Redberry pie', qty: 1, kind: 'mustHave' },
            { name: 'Iron bar', qty: 2, kind: 'mustHave' }
        ]
    },
    {
        id: 'demon',
        name: 'Demon Slayer',
        questPoints: 3,
        requirements: {},
        items: []
    },
    {
        id: 'runemysteries',
        name: 'Rune Mysteries Quest',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'doric',
        name: "Doric's Quest",
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Clay', qty: 6, kind: 'acquirable' },
            { name: 'Copper ore', qty: 4, kind: 'acquirable' },
            { name: 'Iron ore', qty: 2, kind: 'acquirable' }
        ]
    },
    {
        id: 'priest',
        name: 'The Restless Ghost',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'gobdip',
        name: 'Goblin Diplomacy',
        questPoints: 5,
        requirements: {},
        items: [
            { name: 'Goblin mail', qty: 3, kind: 'acquirable' },
            { name: 'Orange dye', qty: 1, kind: 'acquirable' },
            { name: 'Blue dye', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'haunted',
        name: 'Ernest the Chicken',
        questPoints: 4,
        requirements: {},
        items: [
            { name: 'Oil can', qty: 1, kind: 'acquirable' },
            { name: 'Pressure gauge', qty: 1, kind: 'acquirable' },
            { name: 'Rubber tube', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'imp',
        name: 'Imp Catcher',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Black bead', qty: 1, kind: 'acquirable' },
            { name: 'Red bead', qty: 1, kind: 'acquirable' },
            { name: 'White bead', qty: 1, kind: 'acquirable' },
            { name: 'Yellow bead', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'hunt',
        name: "Pirate's Treasure",
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Karamjan rum', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'prince',
        name: 'Prince Ali Rescue',
        questPoints: 3,
        requirements: {},
        items: [
            { name: 'Redberries', qty: 1, kind: 'acquirable' },
            { name: 'Pot of flour', qty: 1, kind: 'acquirable' },
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' },
            { name: 'Bronze bar', qty: 1, kind: 'acquirable' },
            { name: 'Pink skirt', qty: 1, kind: 'acquirable' },
            { name: 'Rope', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'romeojuliet',
        name: 'Romeo & Juliet',
        questPoints: 5,
        requirements: {},
        items: [
            { name: 'Cadava berries', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'sheep',
        name: 'Sheep Shearer',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Ball of wool', qty: 20, kind: 'acquirable' }
        ]
    },
    {
        id: 'blackarmgang',
        name: 'Shield of Arrav',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'vampire',
        name: 'Vampire Slayer',
        questPoints: 3,
        requirements: {},
        items: [
            { name: 'Hammer', qty: 1, kind: 'acquirable' },
            { name: 'Garlic', qty: 1, kind: 'acquirable' },
            { name: 'Stake', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'hetty',
        name: "Witch's Potion",
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Onion', qty: 1, kind: 'acquirable' },
            { name: 'Rats tail', qty: 1, kind: 'acquirable' },
            { name: 'Burnt meat', qty: 1, kind: 'acquirable' },
            { name: 'Eye of newt', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'blackknight',
        name: "Black Knight's Fortress",
        questPoints: 3,
        requirements: { minQuestPoints: 12 },
        items: [
            { name: 'Iron chainbody', qty: 1, kind: 'mustHave' },
            { name: 'Bronze med helm', qty: 1, kind: 'mustHave' },
            { name: 'Cabbage', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'itwatchtower',
        name: 'Watch Tower',
        questPoints: 4,
        requirements: { skills: [
            { skill: 'magic', level: 14 },
            { skill: 'mining', level: 40 },
            { skill: 'herblore', level: 14 },
            { skill: 'thieving', level: 15 },
            { skill: 'agility', level: 25 }
        ] },
        items: []
    },
    {
        id: 'arena', name: 'Fight Arena', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        id: 'arthur', name: "Merlin's Crystal", questPoints: 6,
        requirements: {},
        items: [
            { name: 'Bread', qty: 1, kind: 'acquirable' },
            { name: 'Insect repellent', qty: 1, kind: 'acquirable' },
            { name: 'Bucket', qty: 1, kind: 'acquirable' },
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'ball', name: "Witch's House", questPoints: 4,
        requirements: {},
        items: [
            { name: 'Cheese', qty: 1, kind: 'acquirable' },
            { name: 'Leather gloves', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'biohazard', name: 'Biohazard', questPoints: 3,
        requirements: {},
        items: []
    },
    {
        id: 'chompybird', name: 'Big Chompy Bird Hunting', questPoints: 2,
        requirements: { skills: [
            { skill: 'fletching', level: 5 },
            { skill: 'cooking', level: 30 },
            { skill: 'ranged', level: 30 }
        ] },
        items: []
    },
    {
        id: 'cog', name: 'Clock Tower', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'crest', name: 'Family Crest', questPoints: 1,
        requirements: { skills: [
            { skill: 'mining', level: 40 },
            { skill: 'crafting', level: 40 },
            { skill: 'smithing', level: 40 },
            { skill: 'magic', level: 59 }
        ] },
        items: [
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
        id: 'death', name: 'Death Plateau', questPoints: 1,
        requirements: {},
        items: [
            { name: 'Bread', qty: 10, kind: 'mustHave' },
            { name: 'Trout', qty: 10, kind: 'mustHave' },
            { name: 'Iron bar', qty: 1, kind: 'mustHave' }
        ]
    },
    {
        id: 'desertrescue', name: 'The Tourist Trap', questPoints: 2,
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
        id: 'dragon', name: 'Dragon Slayer', questPoints: 2,
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
            { name: 'Dragonfire shield', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'druid', name: 'Druidic Ritual', questPoints: 4,
        requirements: {},
        items: [
            { name: 'Raw bear meat', qty: 1, kind: 'acquirable' },
            { name: 'Raw beef', qty: 1, kind: 'acquirable' },
            { name: 'Raw chicken', qty: 1, kind: 'acquirable' },
            { name: 'Raw rat meat', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'druidspirit', name: 'Nature Spirit', questPoints: 2,
        requirements: {
            skills: [ { skill: 'crafting', level: 18 } ],
            quests: ['priest', 'priestperil']
        },
        items: []
    },
    {
        id: 'drunkmonk', name: "Monk's Friend", questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'eadgar', name: "Eadgar's Ruse", questPoints: 1,
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
        id: 'elemental_workshop', name: 'Elemental Workshop', questPoints: 1,
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
    },
    {
        id: 'elena', name: 'Plague City', questPoints: 1,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' },
            { name: 'Dwellberries', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'fishingcompo', name: 'Fishing Contest', questPoints: 1,
        requirements: { skills: [{ skill: 'fishing', level: 10 }] },
        items: [
            { name: 'Garlic', qty: 1, kind: 'mustHave' },
            { name: 'Fishing rod', qty: 1, kind: 'mustHave' },
            { name: 'Red vine worm', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'fluffs', name: "Gertrude's Cat", questPoints: 1,
        requirements: {},
        items: [
            { name: 'Raw sardine', qty: 1, kind: 'mustHave' },
            { name: 'Bucket of milk', qty: 1, kind: 'mustHave' },
            { name: 'Coins', qty: 100, kind: 'mustHave' }
        ]
    },
    {
        id: 'grail', name: 'Holy Grail', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        id: 'grandtree', name: 'The Grand Tree', questPoints: 5,
        requirements: { skills: [{ skill: 'agility', level: 25 }] },
        items: []
    },
    {
        id: 'hazeelcult', name: 'Hazeel Cult', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'hero', name: "Hero's Quest", questPoints: 1,
        requirements: { minQuestPoints: 55, quests: ['zanaris', 'dragon', 'arthur', 'blackarmgang'] },
        items: []
    },
    {
        id: 'horror', name: 'Horror from the Deep', questPoints: 2,
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
        id: 'ikov', name: 'Temple of Ikov', questPoints: 1,
        requirements: { skills: [{ skill: 'thieving', level: 42 }, { skill: 'ranged', level: 40 }] },
        items: []
    },
    {
        id: 'itexam', name: 'Digsite Quest', questPoints: 2,
        requirements: { skills: [
            { skill: 'agility', level: 10 },
            { skill: 'herblore', level: 10 },
            { skill: 'thieving', level: 25 }
        ] },
        items: []
    },
    {
        id: 'itgronigen', name: 'Observatory Quest', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        id: 'junglepotion', name: 'Jungle Potion', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'legends', name: 'Legends Quest', questPoints: 4,
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
        id: 'mcannon', name: 'Dwarf Cannon', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'mortton', name: 'Shades of Mortton', questPoints: 3,
        requirements: {},
        items: []
    },
    {
        id: 'murder',
        name: 'Murder Mystery',
        questPoints: 3,
        requirements: {},
        items: []
    },
    {
        id: 'priestperil',
        name: 'Priest in Peril',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Bucket', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'regicide',
        name: 'Regicide',
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
        id: 'scorpcatcher',
        name: 'Scorpion Catcher',
        questPoints: 1,
        requirements: {
            skills: [
                { skill: 'prayer', level: 31 }
            ]
        },
        items: []
    },
    {
        id: 'seaslug',
        name: 'Sea Slug Quest',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'sheepherder',
        name: 'Sheep Herder',
        questPoints: 4,
        requirements: {},
        items: []
    },
    {
        id: 'tbwt',
        name: 'Tai Bwo Wannai Trio',
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
        id: 'totem',
        name: 'Tribal Totem',
        questPoints: 1,
        requirements: {
            skills: [
                { skill: 'thieving', level: 21 }
            ]
        },
        items: []
    },
    {
        id: 'tree',
        name: 'Tree Gnome Village',
        questPoints: 2,
        requirements: {},
        items: []
    },
    {
        id: 'troll',
        name: 'Troll Stronghold',
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
        id: 'upass',
        name: 'Underground Pass',
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
        id: 'viking',
        name: 'The Fremennik Trials',
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
        id: 'waterfall',
        name: 'Waterfall Quest',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'zanaris',
        name: 'Lost City',
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
        id: 'zombiequeen',
        name: 'Shilo Village',
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' }
        ]
    }
];
