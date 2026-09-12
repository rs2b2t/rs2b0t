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
        requirements: { skills: [
            { skill: 'mining', level: 10 },
            { skill: 'cooking', level: 10 }
        ] },
        items: [
            { name: 'Redberry pie', qty: 1, kind: 'acquirable' },
            { name: 'Iron bar', qty: 2, kind: 'acquirable' }
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
            { name: 'Karamjan rum', qty: 1, kind: 'acquirable' },
            { name: 'White apron', qty: 1, kind: 'acquirable' },
            { name: 'Spade', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'prince',
        name: 'Prince Ali Rescue',
        questPoints: 3,
        requirements: {},
        items: [
            { name: 'Coins', qty: 400, kind: 'acquirable' },
            { name: 'Bronze bar', qty: 1, kind: 'acquirable' },
            { name: 'Pink skirt', qty: 1, kind: 'acquirable' },
            { name: 'Redberries', qty: 1, kind: 'acquirable' },
            { name: 'Pot of flour', qty: 1, kind: 'acquirable' },
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' },
            { name: 'Shears', qty: 1, kind: 'acquirable' },
            { name: 'Rope', qty: 2, kind: 'acquirable' },
            { name: 'Beer', qty: 3, kind: 'acquirable' }
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
            { name: "Rat's tail", qty: 1, kind: 'acquirable' },
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
        items: [
            { name: 'Dragon bones', qty: 1, kind: 'mustHave' },
            { name: 'Guam leaf', qty: 1, kind: 'mustHave' },
            { name: 'Bat bones', qty: 1, kind: 'mustHave' },
            { name: 'Gold bar', qty: 1, kind: 'mustHave' }
        ]
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
        requirements: { quests: ['elena'] },
        // The module owns its inventory and sources the vials, sample, gown, key and priest suit per stage.
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
        // Why: the bucket of water for the black cog is consumed mid-quest, so the module fetches it on the leg that needs it and the provisioner leaves it alone.
        items: []
    },
    {
        id: 'crest', name: 'Family Crest', questPoints: 1,
        // Why: journal gates; Magic 59 is Fire Blast, the last of the 4 spells Chronozon has to be hit with.
        // Why: crafting 40 is the perfect ruby necklace.
        requirements: { skills: [
            { skill: 'mining', level: 40 },
            { skill: 'crafting', level: 40 },
            { skill: 'smithing', level: 40 },
            { skill: 'magic', level: 59 }
        ] },
        // Why: Eligibility runs before the bank scan, so the module sources these per leg and reports any remaining shortfall.
        items: [
            { name: 'Tuna', qty: 1, kind: 'acquirable' },
            { name: 'Bass', qty: 1, kind: 'acquirable' },
            { name: 'Salmon', qty: 1, kind: 'acquirable' },
            { name: 'Shrimps', qty: 1, kind: 'acquirable' },
            { name: 'Swordfish', qty: 1, kind: 'acquirable' },
            { name: 'Ruby', qty: 2, kind: 'acquirable' },
            { name: 'Ring mould', qty: 1, kind: 'acquirable' },
            { name: 'Necklace mould', qty: 1, kind: 'acquirable' },
            { name: 'Death rune', qty: 4, kind: 'acquirable' }
        ]
    },
    {
        id: 'death', name: 'Death Plateau', questPoints: 1,
        requirements: {},
        // Why: Bread x10, Trout x10 and Iron bar x1 are mid-quest Tenzing/Dunstan supplies the deathplateau module withdraws when the map track needs them.
        // Why: Listing these as `mustHave` would block the queue before Denulth starts the quest.
        items: []
    },
    {
        id: 'desertrescue', name: 'The Tourist Trap', questPoints: 2,
        requirements: { skills: [
            { skill: 'fletching', level: 10 },
            { skill: 'smithing', level: 20 }
        ] },
        // Why: the quest module owns its restart-safe loadout and sources every item.
        // Why: smithing supplies as mustHave here would make eligibility reject a fresh account before the module can buy them.
        items: []
    },
    {
        id: 'dragon', name: 'Dragon Slayer', questPoints: 2,
        requirements: { minQuestPoints: 32 },
        items: [
            // Why: 1, against a 12k bill, since provisioning re-checks every mustHave each loop while anything is outstanding.
            // Why: A larger coin requirement triggers a bank trip after every purchase.
            // Why: the float covers the shopping, and the module withdraws Wormbrain's 10k and the ship's 2k when it needs them.
            { name: 'Coins', qty: 1, kind: 'mustHave' },
            // Why: provisioning walks this list in order, so it sweeps Port Sarim, Falador, Varrock then the wilderness instead of crossing Asgarnia between items.
            // Why: nails are left out, since 6 steel bars is 18 slots of ore that won't fit behind the rest of the shopping.
            // Why: the nails leg runs from decide() after provisioning, so the shopping can be banked first without the engine withdrawing it straight back.
            // Why: melee kit is left out too; the quest takes the account as it finds it.
            { name: 'Lobster pot', qty: 1, kind: 'acquirable' },   // Gerrant, Port Sarim
            { name: 'Hammer', qty: 1, kind: 'acquirable' },        // Falador general store
            { name: "Wizard's mind bomb", qty: 1, kind: 'acquirable' }, // Rising Sun, Falador
            { name: 'Unfired bowl', qty: 1, kind: 'acquirable' },  // jug + fountain + Varrock clay
            { name: 'Silk', qty: 1, kind: 'acquirable' },          // Thessalia, Varrock
            { name: 'Plank', qty: 3, kind: 'acquirable' }          // Graveyard of Shadows
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
        // Official skill gates only. Combat is not a server req but elementals hit hard,
        // see EW_TESTED_COMBAT / warnReadiness in defs/elementalworkshop and docs/TESTING.md.
        requirements: { skills: [
            { skill: 'mining', level: 20 },
            { skill: 'smithing', level: 20 },
            { skill: 'crafting', level: 20 }
        ] },
        items: [
            // Needle/leather also spawn in workshop crates; thread and coal must be brought.
            // Knife or any slash weapon opens the book; melee weapon + food for elementals.
            { name: 'Leather', qty: 1, kind: 'acquirable' },
            { name: 'Needle', qty: 1, kind: 'acquirable' },
            { name: 'Thread', qty: 1, kind: 'acquirable' },
            { name: 'Coal', qty: 4, kind: 'acquirable' },
            { name: 'Knife', qty: 1, kind: 'acquirable' },
            { name: 'Hammer', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        id: 'elena', name: 'Plague City', questPoints: 1,
        requirements: {},
        // The module owns its inventory and sources the rope, spade, buckets, berries and cure ingredients per stage.
        items: []
    },
    {
        id: 'fishingcompo', name: 'Fishing Contest', questPoints: 1,
        requirements: { skills: [{ skill: 'fishing', level: 10 }] },
        // The module sources the garlic, rod, spade and worms per stage; it walks Draynor, Falador, Catherby, McGrubor's Wood in that order anyway.
        items: []
    },
    {
        id: 'fluffs', name: "Gertrude's Cat", questPoints: 1,
        requirements: {},
        // Why: the milk, doogle leaves and sardine are all fed to Fluffs mid-quest, so the module sources each on the leg that needs it and the provisioner would refetch all 3 on every resume.
        items: []
    },
    {
        id: 'grail', name: 'Holy Grail', questPoints: 2,
        requirements: { quests: ['arthur'] },
        items: [
            { name: 'Excalibur', qty: 1, kind: 'acquirable' }
        ]
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
            // Why: all 5 have a source the module walks to: the plank spawn by the outpost, nails off the Dwarven Mine anvil, a 1gp hammer, the Lumbridge swamp tar patch and Catherby seaweed for the glass.
            { name: 'Plank', qty: 2, kind: 'acquirable' },
            { name: 'Nails', qty: 8, kind: 'acquirable' },
            { name: 'Hammer', qty: 1, kind: 'acquirable' },
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
        // Why: the server gates nothing (`craft_telescope_disc` has no level check), but the quest is listed at Crafting 10 and the eligibility view should say so.
        requirements: { skills: [{ skill: 'crafting', level: 10 }] },
        // Why: the professor takes the planks, bar, glass and mould one stage at a time and deletes each, so a provisioning list would re-fetch items already spent.
        // Why: the module sources every one of them itself, bank first.
        items: []
    },
    {
        id: 'junglepotion', name: 'Jungle Potion', questPoints: 1,
        requirements: {
            skills: [{ skill: 'herblore', level: 3 }],
            quests: ['druid']
        },
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
        // Why: every entry is `acquirable` because eligibility runs before any bank is opened, so a `mustHave` would block the quest at startup on an empty snapshot.
        // Why: The module can source the listed supplies; any remaining shortfall must wait for the user.
        // Why: no shop sells a rune axe (smithing 86), a lockpick (a rogue's pocket), an unpowered orb (a glassblower's pipe) or a cosmic rune outside the Mage Arena.
        // Why: the 7 gems are listed because no counter stocks opal, jade or red topaz and only the Shilo rocks past Hajedy's cart drop them; the module mines and cuts them when the bank is empty.
        items: [
            { name: 'Rune axe', qty: 1, kind: 'acquirable' },
            { name: 'Lockpick', qty: 1, kind: 'acquirable' },
            { name: 'Unpowered orb', qty: 1, kind: 'acquirable' },
            { name: 'Cosmic rune', qty: 3, kind: 'acquirable' },
            { name: 'Opal', qty: 1, kind: 'acquirable' },
            { name: 'Jade', qty: 1, kind: 'acquirable' },
            { name: 'Red topaz', qty: 1, kind: 'acquirable' },
            { name: 'Sapphire', qty: 1, kind: 'acquirable' },
            { name: 'Emerald', qty: 1, kind: 'acquirable' },
            { name: 'Ruby', qty: 1, kind: 'acquirable' },
            { name: 'Diamond', qty: 1, kind: 'acquirable' },
            { name: 'Gold bar', qty: 2, kind: 'acquirable' },
            { name: 'Papyrus', qty: 6, kind: 'acquirable' },
            { name: 'Charcoal', qty: 6, kind: 'acquirable' }
        ]
    },
    {
        id: 'mcannon', name: 'Dwarf Cannon', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        id: 'mortton', name: 'Shades of Mortton', questPoints: 3,
        requirements: {
            skills: [
                { skill: 'crafting', level: 20 },
                { skill: 'herblore', level: 15 },
                { skill: 'firemaking', level: 5 }
            ],
            quests: ['priestperil']
        },
        // Why: the diary, the herbs, the vials and every building material are sourced in Mort'ton.
        // Why: the module owns its own loadout and draws coins, food, a tinderbox and the logs itself.
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
        requirements: { skills: [{ skill: 'firemaking', level: 30 }] },
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
        // Why: the plank only crosses the double spring trap and the module walks that with the journal held open, so requiring one would block a quest that doesn't need it.
        items: [
            { name: 'Rope', qty: 1, kind: 'acquirable' }
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
        items: [
            // Why: the axe and knife have permanent spawns in Rellekka, the tinderbox comes off Arhein in Catherby, and the shark is bought from Rufus in Canifis, the only shop that restocks one.
            { name: 'Bronze axe', qty: 1, kind: 'acquirable' },
            { name: 'Knife', qty: 1, kind: 'acquirable' },
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' },
            { name: 'Raw shark', qty: 1, kind: 'acquirable' }
        ]
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
        requirements: {
            skills: [
                { skill: 'crafting', level: 20 },
                { skill: 'agility', level: 32 },
                { skill: 'smithing', level: 4 },
                { skill: 'mining', level: 4 }
            ],
            quests: ['junglepotion']
        },
        // Karamja has no bank until this quest opens Shilo's, so the module sources its loadout from Jiminua's.
        items: []
    }
];
