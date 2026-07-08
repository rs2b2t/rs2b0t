import type { QuestRecord } from '../types.js';

// Free-to-play quests. Each record's requirements/items are transcribed from
// rs2b2t-content with a `source:` citation. Requirements are HARD gates only.
export const F2P: QuestRecord[] = [
    {
        // source: quest_cook/scripts/quest_cook.rs2 — no stat/quest/qp gate; items at :45.
        // Display names: cakes.obj (Egg/Pot of flour/Bucket of milk). QP: quest.constant:77.
        id: 'cook',
        name: "Cook's Assistant",
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: doric_journal.rs2 — no gate; items inv_del at quest_doric.rs2:74-76
        // (mineable near Doric, so acquirable). quest.constant:82 QP; name questlist.if:93.
        id: 'doric',
        name: "Doric's Quest",
        members: false,
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
        members: false,
        questPoints: 1,
        requirements: {},
        items: []
    },
    {
        // source: gobdip_journal.rs2 — no gate; items inv_del quest_gobdip.rs2:31,40,51
        // + goblin_mail.rs2:3-10 (mail from goblins, dyes from Aggie). quest.constant:91 QP.
        id: 'gobdip',
        name: 'Goblin Diplomacy',
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
        questPoints: 2,
        requirements: {},
        items: [
            { name: 'Karamjan rum', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: prince_journal.rs2:22-46 — no gate; disguise pieces are assembled
        // during the quest (see quest_prince.rs2:8-9,28-29), so all acquirable.
        // quest.constant:110 QP; name questlist.if:183.
        id: 'prince',
        name: 'Prince Ali Rescue',
        members: false,
        questPoints: 3,
        requirements: {},
        items: [
            { name: 'Wig', qty: 1, kind: 'acquirable' },
            { name: 'Paste', qty: 1, kind: 'acquirable' },
            { name: 'Pink skirt', qty: 1, kind: 'acquirable' },
            { name: 'Rope', qty: 1, kind: 'acquirable' },
            { name: 'Bronze key', qty: 1, kind: 'acquirable' }
        ]
    },
    {
        // source: romeojuliet_journal.rs2:45-48 — no gate; cadava berries picked from
        // bushes, potion made by Apothecary (acquirable). quest.constant:111 QP.
        id: 'romeojuliet',
        name: 'Romeo & Juliet',
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
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
        members: false,
        questPoints: 4,
        requirements: { skills: [
            { skill: 'magic', level: 14 },
            { skill: 'mining', level: 40 },
            { skill: 'herblore', level: 14 },
            { skill: 'thieving', level: 15 },
            { skill: 'agility', level: 25 }
        ] },
        items: []
    }
];
