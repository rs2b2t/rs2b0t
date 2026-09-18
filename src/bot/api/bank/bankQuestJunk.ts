import type { QuestStatus } from '../ui/questlog/Quests.js';

export interface QuestJunkEntry {
    id: number;
    name: string;
    quest: string;
}

function junk(quest: string, items: readonly (readonly [id: number, name: string])[]): QuestJunkEntry[] {
    return items.map(([id, name]) => ({ id, name, quest }));
}

// Why: https://oldschool.runescape.wiki/w/Wise_Old_Man/Recycling_Centre, kept to objs and quest-tab names at rev 289.
// Why: drop and questObsolete filing stay gated on Quests.status === complete.
export const QUEST_JUNK: readonly QuestJunkEntry[] = [
    ...junk('Demon Slayer', [
        [2399, 'Key'],
        [2400, 'Key'],
        [2401, 'Key']
    ]),
    ...junk('Dragon Slayer', [
        [1535, 'Map part'],
        [1536, 'Map part'],
        [1537, 'Map part'],
        [1538, 'Crandor map'],
        [1543, 'Key'],
        [1544, 'Key'],
        [1545, 'Key'],
        [1546, 'Key'],
        [1547, 'Key'],
        [1548, 'Key']
    ]),
    ...junk('Ernest the Chicken', [
        [271, 'Pressure gauge'],
        [274, 'Poisoned fish food'],
        [275, 'Key'],
        [276, 'Rubber tube'],
        [277, 'Oil can']
    ]),
    ...junk('Goblin Diplomacy', [
        [286, 'Orange goblin mail'],
        [287, 'Blue goblin mail']
    ]),
    ...junk('Imp Catcher', [
        [1470, 'Red bead'],
        [1472, 'Yellow bead'],
        [1474, 'Black bead'],
        [1476, 'White bead']
    ]),
    ...junk("The Knight's Sword", [[666, 'Portrait']]),
    ...junk("Pirate's Treasure", [
        [432, 'Chest key'],
        [433, 'Pirate message']
    ]),
    ...junk('Romeo & Juliet', [
        [755, 'Message'],
        [756, 'Cadava potion']
    ]),
    ...junk('Rune Mysteries Quest', [
        [290, 'Research package'],
        [291, 'Notes']
    ]),
    ...junk('Shield of Arrav', [
        [761, 'Scroll'],
        [763, 'Broken shield'],
        [765, 'Broken shield'],
        [769, 'Certificate']
    ]),
    ...junk('Vampire Slayer', [[1549, 'Stake']]),
    ...junk("Witch's Potion", [[300, "Rat's tail"]]),
    ...junk('Biohazard', [
        [415, 'Ethanea'],
        [416, 'Liquid honey'],
        [417, 'Sulphuric broline'],
        [418, 'Plague sample'],
        [419, 'Touch paper'],
        [420, 'Distillator'],
        [421, "Lathas' amulet"],
        [422, 'Bird feed'],
        [424, 'Pigeon cage'],
        [425, 'Pigeon cage'],
        [430, "Doctors' gown"]
    ]),
    ...junk('Clock Tower', [
        [20, 'Cog'],
        [21, 'Cog'],
        [22, 'Cog'],
        [23, 'Cog']
    ]),
    ...junk('Digsite Quest', [
        [669, 'Specimen jar'],
        [674, 'Rock sample'],
        [677, 'Panning tray'],
        [678, 'Panning tray'],
        [679, 'Panning tray'],
        [680, 'Nuggets'],
        [681, 'Talisman of zaros'],
        [682, 'Unstamped letter'],
        [683, 'Stamped letter'],
        [684, 'Belt buckle'],
        [686, 'Rusty sword'],
        [687, 'Broken arrow'],
        [688, 'Buttons'],
        [689, 'Broken staff'],
        [690, 'Broken glass'],
        [691, 'Level 1 certificate'],
        [692, 'Level 2 certificate'],
        [693, 'Level 3 certificate'],
        [694, 'Ceramic remains'],
        [695, 'Old tooth'],
        [696, 'Invitation letter'],
        [697, 'Damaged armour'],
        [698, 'Broken armour'],
        [699, 'Stone tablet'],
        [701, 'Ammonium nitrate'],
        [703, 'Nitroglycerin'],
        [705, 'Mixed chemicals'],
        [706, 'Mixed chemicals'],
        [707, 'Chemical compound'],
        [708, 'Arcenia root'],
        [709, 'Chest key'],
        [710, 'Vase'],
        [711, 'Book on chemicals'],
        [712, 'Cup of tea']
    ]),
    ...junk('Druidic Ritual', [
        [522, 'Enchanted beef'],
        [523, 'Enchanted rat'],
        [524, 'Enchanted bear'],
        [525, 'Enchanted chicken']
    ]),
    ...junk('Dwarf Cannon', [
        [0, 'Dwarf remains'],
        [1, 'Tool kit'],
        [3, "Nulodion's notes."],
        [14, 'Railing']
    ]),
    ...junk("Eadgar's Ruse", [
        [3262, 'Troll thistle'],
        [3263, 'Dried thistle'],
        [3264, 'Ground thistle'],
        [3265, 'Troll potion'],
        [3266, 'Drunk parrot'],
        [3267, 'Dirty robe'],
        [3268, 'Fake man'],
        [3269, 'Storeroom key'],
        [3270, 'Alco-chunks']
    ]),
    ...junk('Elemental Workshop', [
        [2886, 'Battered book'],
        [2888, 'A stone bowl'],
        [2889, 'A stone bowl']
    ]),
    ...junk('Family Crest', [
        [773, "'perfect' ring"],
        [774, "'perfect' necklace"],
        [779, 'Crest part'],
        [780, 'Crest part'],
        [781, 'Crest part'],
        [782, 'Family crest']
    ]),
    ...junk('Fight Arena', [
        [74, 'Khazard helmet'],
        [75, 'Khazard armour'],
        [76, 'Khazard cell keys'],
        [77, 'Khali brew']
    ]),
    ...junk('Fishing Contest', [
        [25, 'Red vine worm'],
        [26, 'Fishing trophy'],
        [27, 'Fishing pass']
    ]),
    ...junk('The Grand Tree', [
        [783, 'Bark sample'],
        [785, "Glough's journal"],
        [786, "Hazelmere's scroll"],
        [787, 'Lumber order'],
        [788, "Glough's key"],
        [793, 'Daconia rock'],
        [794, 'Invasion plans']
    ]),
    ...junk('Hazeel Cult', [
        [2403, 'Scroll of hazeel'],
        [2404, 'Key'],
        [2406, 'Mark of hazeel']
    ]),
    ...junk("Hero's Quest", [
        [1579, "Thieves' armband"],
        [1583, 'Fire feather'],
        [1584, 'Id papers'],
        [1586, 'Miscellaneous key'],
        [1588, "Grips' keyring"],
        [1591, 'Jail key']
    ]),
    ...junk('Holy Grail', [
        [15, 'Holy table napkin'],
        [16, 'Magic whistle'],
        [17, 'Grail bell'],
        [18, 'Magic gold feather'],
        [19, 'Holy grail']
    ]),
    ...junk('Horror from the Deep', [
        [3845, 'Journal'],
        [3846, 'Diary'],
        [3847, 'Manual'],
        [3848, 'Lighthouse key'],
        [3849, 'Rusty casket']
    ]),
    ...junk('Temple of Ikov', [
        [78, 'Ice arrows'],
        [83, 'Lever'],
        [84, 'Staff of armadyl'],
        [86, 'Pendant of lucien'],
        [87, 'Armadyl pendant']
    ]),
    ...junk('Legends Quest', [
        [714, 'Radimus notes'],
        [715, 'Radimus notes'],
        [717, 'Scrawled note'],
        [718, 'A scribbled note'],
        [719, 'Scrumpled note'],
        [720, 'Sketch'],
        [727, 'Hollow reed'],
        [729, 'Shamans tome'],
        [733, 'Smashed glass'],
        [735, 'Yommi tree seeds'],
        [736, 'Yommi tree seeds'],
        [739, 'Bravery potion'],
        [740, 'Blue hat'],
        [741, 'Chunk of crystal'],
        [742, 'Hunk of crystal'],
        [743, 'Lump of crystal'],
        [744, 'Heart crystal'],
        [745, 'Heart crystal'],
        [748, 'Holy force'],
        [749, 'Yommi totem'],
        [750, 'Gilded totem']
    ]),
    ...junk('Throne of Miscellania', [
        [3894, 'Awful anthem'],
        [3895, 'Good anthem'],
        [3896, 'Treaty'],
        [3897, 'Giant nib'],
        [3898, 'Giant pen'],
        [3901, "Ghrim's book"]
    ]),
    ...junk('Monkey Madness', [
        [4002, 'Spare controls'],
        [4004, 'Gnome royal seal'],
        [4005, "Narnode's orders"],
        [4007, 'Enchanted bar'],
        [4008, 'Eye of gnome'],
        [4010, 'Monkey magic'],
        [4018, 'Monkey wrench'],
        [4033, 'Monkey']
    ]),
    ...junk('Murder Mystery', [
        [1796, 'Silver necklace'],
        [1797, 'Silver necklace'],
        [1798, 'Silver cup'],
        [1799, 'Silver cup'],
        [1800, 'Silver bottle'],
        [1801, 'Silver bottle'],
        [1802, 'Silver book'],
        [1803, 'Silver book'],
        [1804, 'Silver needle'],
        [1805, 'Silver needle'],
        [1806, 'Silver pot'],
        [1807, 'Silver pot'],
        [1808, "Criminals' thread"],
        [1809, "Criminals' thread"],
        [1810, "Criminals' thread"],
        [1811, 'Flypaper'],
        [1812, 'Pungent pot'],
        [1813, "Criminals' dagger"],
        [1814, "Criminals' dagger"]
    ]),
    ...junk('Nature Spirit', [
        [2964, 'Washing bowl'],
        [2966, 'Mirror'],
        [2967, 'Journal'],
        [2968, 'Druidic spell'],
        [2969, 'A used spell']
    ]),
    ...junk('Observatory Quest', [
        [600, 'Astrology book'],
        [601, 'Keep key'],
        [602, 'Lens mould'],
        [603, 'Lens']
    ]),
    ...junk('Plague City', [
        [1503, 'Warrant'],
        [1507, 'A small key'],
        [1508, 'A scruffy note'],
        [1509, 'Book'],
        [1510, 'Picture']
    ]),
    ...junk('Priest in Peril', [
        [2953, 'Bucket of water'],
        [2954, 'Bucket of water']
    ]),
    ...junk('Regicide', [
        [3206, "King's message"],
        [3207, 'Iorwerths message'],
        [3208, 'Crystal pendant'],
        [3209, 'Sulphur'],
        [3213, 'Quicklime'],
        [3214, 'Pot of quicklime'],
        [3215, 'Ground sulphur'],
        [3219, 'Barrel bomb'],
        [3222, 'Naphtha mix'],
        [3223, 'Naphtha mix'],
        [3230, 'Big book of bangs']
    ]),
    ...junk('Sea Slug Quest', [
        [1466, 'Sea slug'],
        [1467, 'Damp sticks'],
        [1468, 'Dry sticks'],
        [1469, 'Broken glass']
    ]),
    ...junk('Sheep Herder', [
        [278, 'Prod'],
        [279, 'Feed']
    ]),
    ...junk('Tai Bwo Wannai Trio', [
        [3161, 'Crafting manual'],
        [3164, 'Karamjan rum'],
        [3165, 'Karamjan rum'],
        [3166, 'Monkey corpse'],
        [3167, 'Monkey skin'],
        [3168, 'Seaweed sandwich'],
        [3169, 'Stuffed monkey']
    ]),
    ...junk('The Tourist Trap', [
        [1841, 'Barrel'],
        [1844, "Slaves' shirt"],
        [1845, 'Slave robe'],
        [1846, 'Slave boots'],
        [1847, 'Scrumpled paper'],
        [1848, 'Shantay disclaimer'],
        [1849, 'Prototype dart'],
        [1850, 'Technical plans'],
        [1851, 'Tenti pineapple'],
        [1853, 'Prototype dart tip']
    ]),
    ...junk('Tribal Totem', [
        [1856, 'Guide book'],
        [1857, 'Totem'],
        [1858, 'Address label']
    ]),
    ...junk('Troll Stronghold', [
        [3135, 'Prison key'],
        [3136, 'Cell key 1'],
        [3137, 'Cell key 2']
    ]),
    ...junk('Troll Romance', [[4086, 'Trollweiss']]),
    ...junk('Watch Tower', [
        [2372, 'Ogre relic'],
        [2373, 'Relic part 1'],
        [2374, 'Relic part 2'],
        [2375, 'Relic part 3'],
        [2377, 'Ogre tooth'],
        [2378, 'Toban key'],
        [2379, 'Rock cake'],
        [2384, 'Finger nails'],
        [2385, 'Old robe'],
        [2386, 'Unusual armour'],
        [2387, 'Damaged dagger'],
        [2388, 'Tattered eye patch'],
        [2389, 'Vial'],
        [2390, 'Vial'],
        [2391, 'Ground bat bones'],
        [2393, 'Gold'],
        [2394, 'Potion'],
        [2395, 'Magic ogre potion'],
        [2397, 'Shaman robe']
    ]),
    ...junk('Waterfall Quest', [
        [292, 'Book on baxtorian'],
        [296, "Glarial's urn"],
        [297, "Glarial's urn"]
    ]),
    ...junk("Witch's House", [
        [2407, 'Ball'],
        [2408, 'Diary'],
        [2409, 'Door key'],
        [2410, 'Magnet'],
        [2411, 'Key']
    ]),
    ...junk('Shilo Village', [
        [604, 'Bone shard'],
        [605, 'Bone key'],
        [606, 'Stone-plaque'],
        [607, 'Tattered scroll'],
        [608, 'Crumpled scroll'],
        [609, 'Rashiliya corpse'],
        [610, 'Zadimus corpse'],
        [611, 'Locating crystal'],
        [612, 'Locating crystal'],
        [613, 'Locating crystal'],
        [614, 'Locating crystal'],
        [615, 'Locating crystal'],
        [618, 'Bone beads'],
        [619, 'Paramaya ticket'],
        [623, 'Sword pommel'],
        [624, 'Bervirius notes'],
        [625, 'Wampum belt']
    ]),
    ...junk('Underground Pass', [
        [1492, 'Doll of iban'],
        [1494, 'History of iban']
    ]),
    ...junk('Haunted Mine', [
        [4073, 'Damp tinderbox'],
        [4075, 'Glowing fungus'],
        [4078, "Zealot's key"]
    ]),
    ...junk('Death Plateau', [
        [3102, 'Combination'],
        [3103, 'Iou'],
        [3104, 'Secret way map'],
        [3109, 'Stone ball'],
        [3110, 'Stone ball'],
        [3111, 'Stone ball'],
        [3112, 'Stone ball'],
        [3113, 'Stone ball'],
        [3114, 'Certificate']
    ])
];

export interface QuestJunkFinding {
    id: number;
    name: string;
    quest: string;
    status: QuestStatus;
    droppable: boolean;
}

export function findQuestJunk(banked: readonly { id: number }[], statusOf: (quest: string) => QuestStatus): QuestJunkFinding[] {
    const held = new Set(banked.map(item => item.id));
    return QUEST_JUNK.filter(entry => held.has(entry.id)).map(entry => {
        const status = statusOf(entry.quest);
        return { ...entry, status, droppable: status === 'complete' };
    });
}
