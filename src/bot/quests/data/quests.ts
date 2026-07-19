import type { QuestRecord } from '../types.js';

// Every quest's record — this 2004scape server is one world with all content,
// so there is no tier distinction. Requirements/items are transcribed from
// rs2b2t-content with a `source:` citation; requirements are HARD gates only.
export const QUESTS: QuestRecord[] = [
    {
        // source: quest_cook/scripts/quest_cook.rs2 — no stat/quest/qp gate; items at :45.
        // Display names: cakes.obj (Egg/Pot of flour/Bucket of milk). QP: quest.constant:77.
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
        // source: quest_squire — start (quest_squire.rs2:55) has NO hard gate;
        // "Mining 10" is journal-advertised only (squire_journal.rs2:7), so it is
        // recorded as a skill req for eligibility guidance. Items: redberry_pie
        // (:126) + iron_bar x2 (:190). blurite_ore is mined mid-quest -> acquirable.
        // Display names: pies.obj (Redberry pie), smelting.obj (Iron bar). QP: quest.constant:117.
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
        // source: demon_journal.rs2 — no stat/qp/quest gate in start; bucket_water
        // consumed at demon_slayer.rs2:29 (Silverlight keys are quest-internal).
        // quest.constant:80 QP; name questlist.if:63.
        id: 'demon',
        name: 'Demon Slayer',
        questPoints: 3,
        requirements: {},
        items: [
            { name: 'Bucket of water', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: runemysteries_journal.rs2 — no stat/qp/quest gate; talisman &
        // research package are quest-internal. quest.constant:112 QP; name questlist.if:78.
        id: 'runemysteries',
        name: 'Rune Mysteries Quest',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: doric_journal.rs2 — no gate; items inv_del at quest_doric.rs2:74-76
        // (mineable near Doric, so acquirable). quest.constant:82 QP; name questlist.if:93.
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
        // source: priest_journal.rs2 — no stat/qp/quest gate ("Level 13 Skeleton" is
        // flavour); Ghostspeak amulet & skull are quest-internal. quest.constant:108 QP.
        id: 'priest',
        name: 'The Restless Ghost',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: gobdip_journal.rs2 — no gate; items inv_del quest_gobdip.rs2:31,40,51
        // + goblin_mail.rs2:3-10 (mail from goblins, dyes from Aggie). quest.constant:91 QP.
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
        // source: haunted_journal.rs2:5-27 — no gate; machine parts found inside
        // Draynor Manor (acquirable). quest.constant:94 QP; name questlist.if:138.
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
        // source: imp_journal.rs2:10-36 — no gate; 4 beads are Imp drops (acquirable).
        // quest.constant:100 QP; name questlist.if:153.
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
        // source: hunt_journal.rs2:9-10 ("aren't any requirements"); Karamjan rum bought
        // on Karamja, inv_del redbeard_frank.rs2:43 (acquirable). quest.constant:98 QP.
        id: 'hunt',
        name: "Pirate's Treasure",
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Karamjan rum', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: prince_journal.rs2:22-46 — no gate. Only the CHEAP, one-shop-trip
        // buyables are declared here so provisioning fetches them BANK-FIRST at the
        // start (redberries/flour/tinderbox at Wydin+Lumbridge, bronze bar at
        // Shantay, pink skirt at Thessalia, rope at Aemad's/Ardougne). The
        // tightly-consumed / slow raws (Clay, Onion, Logs, Ball of wool, Jug of
        // water) are NOT declared — the def gathers them JUST-IN-TIME in their
        // sub-chains, so provisioning doesn't criss-cross the map before the quest
        // (a ~15min upfront sweep, live 2026-07-18). CREATED / stage-gated crafts
        // (Soft clay, Yellow dye, Ashes, Wig, BLOND wig [name collides with plain
        // wig], Paste, Key print, Bronze key) stay quest-internal; Beer is
        // jailbreak-managed. quest.constant:110 QP.
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
        // source: romeojuliet_journal.rs2:45-48 — no gate; cadava berries are a
        // free GROUND PICK (obj 753 map-spawns at SE Varrock, m51_52.jm2; imps
        // also drop them but that grind is far slower) — potion made by Apothecary
        // (acquirable). quest.constant:111 QP.
        id: 'romeojuliet',
        name: 'Romeo & Juliet',
        questPoints: 5,
        requirements: {},
        items: [
            { name: 'Cadava berries', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: sheep_journal.rs2:13-16 — no gate; 20 balls of wool sheared/spun
        // (inv_del quest_sheep.rs2:3), acquirable. quest.constant:115 QP.
        id: 'sheep',
        name: 'Sheep Shearer',
        questPoints: 1,
        requirements: {},
        items: [
            { name: 'Ball of wool', qty: 20, kind: 'acquirable' }
        ]
    },
    {
        // source: blackarmgang_journal.rs2 — no stat/qp/quest gate; all items
        // (reports, shield halves, certificates) are quest-internal and it needs a
        // second player. quest.constant:73 QP; name questlist.if:228.
        id: 'blackarmgang',
        name: 'Shield of Arrav',
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: vampire_journal.rs2:9 ("kill a level 34 Vampire" is combat flavour,
        // not a modeled skill). Items count_draynor.rs2:7,58,64 — garlic (Morgan's
        // house), stake (from Harlow), hammer (journal: "any general store") -> all
        // acquirable. quest.constant:121 QP.
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
        // source: hetty_journal.rs2:19-41 — no gate; 4 ingredients gathered locally
        // (onion field, kill rat, burn meat, buy eye of newt). quest.constant:97 QP.
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
        // source: blackknight_journal.rs2:10 advertises "at least 12 Quest Points"
        // (journal-advisory; start block does not %qp-gate) -> minQuestPoints 12.
        // Disguise hard-enforced quest_blackknight.rs2:16 & fortress_guard.rs2:2
        // (Iron chainbody + Bronze med helm worn) -> mustHave. Cabbage from Draynor
        // Manor garden, inv_del quest_blackknight.rs2:101 -> acquirable.
        // quest.constant:74 QP; name questlist.if:33.
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
        // source: itwatchtower_journal.rs2:8-28 skill gates (real gates per brief);
        // crystals/relics obtained during quest. quest.constant:103 QP; name questlist.if:288.
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
        // source: arena_journal.rs2:6-8 only advertises "defeat a level 137 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:69 QP.
        id: 'arena', name: 'Fight Arena', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: arthur_journal.rs2:8-10 only advertises "defeat a level 39 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:70 QP. Excalibur/black candle/bat bones are acquired mid-quest.
        id: 'arthur', name: "Merlin's Crystal", questPoints: 6,
        requirements: {},
        items: [
            { name: 'Bread', qty: 1, kind: 'acquirable' },            // fed to the Beggar for Excalibur
            { name: 'Insect repellent', qty: 1, kind: 'acquirable' }, // free the bees for wax
            { name: 'Bucket', qty: 1, kind: 'acquirable' },           // collect the wax
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' }         // light the black candle
        ]
    },
    {
        // source: ball_journal.rs2:5-7 only advertises "defeat a level 53 enemy" (combat advisory, no skill/qp/prereq gate); quest.constant:71 QP.
        id: 'ball', name: "Witch's House", questPoints: 4,
        requirements: {},
        items: [
            { name: 'Cheese', qty: 1, kind: 'acquirable' }, // ball_journal/quest_ball.rs2 inv_del(inv, cheese, 1): lure the mouse
            { name: 'Leather gloves', qty: 1, kind: 'acquirable' } // WORN: cross the shocking iron gate (quest_ball.rs2:33-38)
        ]
    },
    {
        // source: biohazard_journal.rs2:4-5 advertises no gate; start dialogue elena.rs2:118-134 has no varp gate. NOTE: canonically requires Plague City (elena) but it is enforced only via elena2 NPC availability, not an explicit journal/start check. quest.constant:72 QP.
        id: 'biohazard', name: 'Biohazard', questPoints: 3,
        requirements: {},
        items: []
    },
    {
        // source: chompybird_journal.rs2:10-30 not_started display stat_base gates fletching 5, cooking 30, ranged 30 (journal-advisory); quest.constant:75 QP. Ogre bow/toads/arrows acquired mid-quest.
        id: 'chompybird', name: 'Big Chompy Bird Hunting', questPoints: 2,
        requirements: { skills: [
            { skill: 'fletching', level: 5 },
            { skill: 'cooking', level: 30 },
            { skill: 'ranged', level: 30 }
        ] },
        items: []
    },
    {
        // source: cog_journal.rs2:6-7 advertises no gate; quest.constant:76 QP. Coloured cogs are acquired mid-quest.
        id: 'cog', name: 'Clock Tower', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: crest_journal.rs2:10-14 not_started static advisory text (NOT stat_base): mining 40, crafting 40, smithing 40, magic 59, + "level 170 Demon" combat advisory (journal-advisory); quest.constant:78 QP.
        id: 'crest', name: 'Family Crest', questPoints: 1,
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
        id: 'death', name: 'Death Plateau', questPoints: 1,
        requirements: {},
        items: [
            { name: 'Bread', qty: 10, kind: 'mustHave' },
            { name: 'Trout', qty: 10, kind: 'mustHave' },
            { name: 'Iron bar', qty: 1, kind: 'mustHave' }
        ]
    },
    {
        // source: desertrescue_journal.rs2:9,14 stat_base gates fletching 10, smithing 20; quest.constant:81 QP. Dart bring-items desertrescue_journal.rs2:127-139 (hammer, feathers, bronze bar).
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
        // source: dragon_journal.rs2:7 `%qp < 32` -> minQuestPoints 32; quest.constant:83 QP. Rhyme door items dragon_journal.rs2:135-146; ship repair lady_lumbridge.rs2:63-78 (3 planks, 4 nails each = 12, hammer); coins to buy ship quest_dragon inv_del(coins,10000).
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
            { name: 'Dragonfire shield', qty: 1, kind: 'acquirable' } // given by the Duke of Lumbridge; obj name= is 'Dragonfire shield'
        ]
    },
    {
        // source: druid_journal.rs2:6-7 advertises no gate; quest.constant:84 QP. Raw meats druid_journal.rs2:12 placed in cauldron.
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
        // source: druidspirit_journal.rs2:26-41 not_started advertises prereqs The Restless Ghost (priest) + Priest in Peril (priestperil), and stat_base(crafting)>=18 under "also recommended" (journal-advisory); quest.constant:85 QP.
        id: 'druidspirit', name: 'Nature Spirit', questPoints: 2,
        requirements: {
            skills: [ { skill: 'crafting', level: 18 } ],
            quests: ['priest', 'priestperil']
        },
        items: []
    },
    {
        // source: drunkmonk_journal.rs2:8-9 advertises no gate; quest.constant:86 QP. Jug of water / logs are acquired locally.
        id: 'drunkmonk', name: "Monk's Friend", questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: eadgar_journal.rs2:8 not_started advertises prereq Druidic Ritual (druid) + rescued Mad Eadgar from Troll Stronghold (troll) + "Level 31 Herblore" (static advisory text, journal-advisory); quest.constant:128 QP. Fake-man bring-items eadgar_journal.rs2:61-83 (5 raw chickens, 10 grain, logs, dirty clothes).
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
        // source: elemental_workshop_journal.rs2:68-84 not_started stat_base gates mining 20, smithing 20, crafting 20; quest.constant:87 QP. Bring-items quest_elemental_workshop inv_del leather 1, thread 1, coal 4.
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
        // source: elena_journal.rs2:6-8 "There aren't any requirements for this Quest."; items alrena.rs2:11,24 dwellberries (found in McGrubor's wood per journal), sewerpipe.rs2:25 rope; quest.constant:88 QP.
        id: 'elena', name: 'Plague City', questPoints: 1,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' },
            { name: 'Dwellberries', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: fishingcompo_journal.rs2:11 stat_base(fishing) < 10; items quest_fishingcompo.rs2 garlic, hemenster_fishing.rs2:78 fishing_rod, :21 red_vine_worm; quest.constant:89 QP.
        id: 'fishingcompo', name: 'Fishing Contest', questPoints: 1,
        requirements: { skills: [{ skill: 'fishing', level: 10 }] },
        items: [
            { name: 'Garlic', qty: 1, kind: 'mustHave' },
            { name: 'Fishing rod', qty: 1, kind: 'mustHave' },
            { name: 'Red vine worm', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: fluffs_journal.rs2 no skill/qp gates; items quest_fluffs.rs2:106 inv_del(coins,100) + raw_sardine/bucket_milk checks; quest.constant:90 QP.
        id: 'fluffs', name: "Gertrude's Cat", questPoints: 1,
        requirements: {},
        items: [
            { name: 'Raw sardine', qty: 1, kind: 'mustHave' },
            { name: 'Bucket of milk', qty: 1, kind: 'mustHave' },
            { name: 'Coins', qty: 100, kind: 'mustHave' }
        ]
    },
    {
        // source: grail_journal.rs2:85 completion check only; no skill/qp/prereq gate present in quest_grail scripts (this content does NOT gate on Merlin's Crystal); quest.constant:92 QP.
        id: 'grail', name: 'Holy Grail', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: grandtree_journal.rs2:8-14 "I must have: Level 25 Agility" (stat_base(agility) < 25); quest.constant:93 QP.
        id: 'grandtree', name: 'The Grand Tree', questPoints: 5,
        requirements: { skills: [{ skill: 'agility', level: 25 }] },
        items: []
    },
    {
        // source: hazeelcult_journal.rs2 no skill/qp/prereq gates; quest.constant:95 QP.
        id: 'hazeelcult', name: 'Hazeel Cult', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: quest_hero.rs2:2-4 (%qp < ^hero_required_questpoints; %zanaris/%dragonquest/%arthur/%blackarmgang < *_complete); quest_hero.constant:20 required QP = 55; quest.constant:96 QP.
        id: 'hero', name: "Hero's Quest", questPoints: 1,
        requirements: { minQuestPoints: 55, quests: ['zanaris', 'dragon', 'arthur', 'blackarmgang'] },
        items: []
    },
    {
        // source: horror_journal.rs2:5-6 "To complete this quest I need: Level 35 agility" (journal-advisory: hardcoded text, no stat_base check; magic 13 = "will be an advantage" + level-100 combat advisory, NOT recorded); items quest_horror.rs2:133-134,162-163 (2 bridge sections, 1 plank + 4 nails each) + hammer; quest.constant:131 QP.
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
        // source: ikov_journal.rs2:12-15 "I must have: Level 42 thieving / Level 40 ranged" (journal-advisory: hardcoded text, comment ":13 Not sure if these are checked"); quest.constant:99 QP.
        id: 'ikov', name: 'Temple of Ikov', questPoints: 1,
        requirements: { skills: [{ skill: 'thieving', level: 42 }, { skill: 'ranged', level: 40 }] },
        items: []
    },
    {
        // source: itexam_journal.rs2:10,16,22 "To complete this quest I need" agility 10 / herblore 10 / thieving 25; name questlist.if:375 (NOTE: brief table swapped itexam/itgronigen; questlist.if is source-of-truth -> itexam = "Digsite Quest"); quest.constant:101 QP.
        id: 'itexam', name: 'Digsite Quest', questPoints: 2,
        requirements: { skills: [
            { skill: 'agility', level: 10 },
            { skill: 'herblore', level: 10 },
            { skill: 'thieving', level: 25 }
        ] },
        items: []
    },
    {
        // source: itgronigen_journal.rs2 no skill/qp/prereq gates; name questlist.if:615 (NOTE: brief table swapped itexam/itgronigen; itgronigen = "Observatory Quest"); quest.constant:102 QP.
        id: 'itgronigen', name: 'Observatory Quest', questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: junglepotion_journal.rs2:104 completion check only; no skill/qp/prereq gate present (this content does NOT gate on Druidic Ritual); quest.constant:104 QP.
        id: 'junglepotion', name: 'Jungle Potion', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: legends_journal.rs2:20-53 prereq quests (%heroquest,%crestquest,%zombiequeen,%upass,%waterfall_quest >= *_complete), :55 %qp >= ^legends_required_questpoints (quest_legends.constant:76 = 107), :65-128 skill gates; items radimus_notes.rs2:83-97 papyrus/charcoal, quest_legends.rs2:1493 gold_bar 2; name questlist.if:540; quest.constant:105 QP.
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
        // source: mcannon_journal.rs2 no skill/qp/prereq gates; quest.constant:106 QP.
        id: 'mcannon', name: 'Dwarf Cannon', questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: mortton_journal.rs2:9 completion check only; no skill/qp/prereq gate present (this content does NOT gate on Priest in Peril); name questlist.if:930 "Shades of Mortton" (no apostrophe); quest.constant:129 QP.
        id: 'mortton', name: 'Shades of Mortton', questPoints: 3,
        requirements: {},
        items: []
    },
    {
        // source: murder_journal.rs2:5-51 no skill/qp/prereq gate; quest.constant:107 QP.
        id: 'murder',
        name: 'Murder Mystery',
        questPoints: 3,
        requirements: {},
        items: []
    },
    {
        // source: priestperil_journal.rs2:6-7 no skill/qp gate (only "defeat a level 30 enemy" combat note);
        // :91 quest advertises bringing 50 rune essence to Drezel (obj "Rune essence", ores.obj); quest.constant:109 QP.
        id: 'priestperil',
        name: 'Priest in Peril',
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
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: sheepherder_journal.rs2 no skill/qp/prereq gate; quest.constant:116 QP.
        id: 'sheepherder',
        name: 'Sheep Herder',
        questPoints: 4,
        requirements: {},
        items: []
    },
    {
        // source: tbwt_journal.rs2:10,17 prereq Jungle Potion; :13 advertised cooking 30/agility 15/fishing 5 (journal-advisory text, no stat_base); quest.constant:126 QP.
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
        // source: totem_journal.rs2:12 thieving 21 (stat_base); quest.constant:118 QP.
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
        // source: tree_journal.rs2 no skill/qp/prereq gate; quest.constant:119 QP.
        id: 'tree',
        name: 'Tree Gnome Village',
        questPoints: 2,
        requirements: {},
        items: []
    },
    {
        // source: troll_journal.rs2:4 prereq Death Plateau; :5 agility 15 (journal-advisory text, no stat_base). "Level 30 Thieving might be useful" is optional, not recorded. quest.constant:125 QP.
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
        // source: upass_journal.rs2 no skill gate; quest_upass.rs2:81 mesbox hard-gates on Biohazard complete;
        // rope consumed at upass_obstacles.rs2:108, plank (obj woodplank -> "Plank") placed at upass_obstacles.rs2:195; bow+arrows also needed at bridge (upass_bridge.rs2:46). quest.constant:120 QP.
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
        // source: viking_journal.rs2:7 advertised woodcutting 40/crafting 40/fletching 25 (journal-advisory text, no stat_base); quest.constant:130 QP.
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
        // source: waterfall_journal.rs2 no skill/qp/prereq gate (quest_waterfall.rs2:60-95 is the whirlpool "items you lose" list, not a requirement); quest.constant:122 QP.
        id: 'waterfall',
        name: 'Waterfall Quest',
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
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Rope', qty: 1, kind: 'mustHave' }
        ]
    }
];
