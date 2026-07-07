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
    }
];
