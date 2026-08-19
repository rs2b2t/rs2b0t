import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';
import { doric } from './doric.js';
import { knightssword } from './knightssword/index.js';
import { sheepshearer } from './sheepshearer.js';
import { restlessghost } from './restlessghost.js';
import { cooksassistant } from './cooksassistant.js';
import { impcatcher } from './impcatcher.js';
import { ernest } from './ernest/index.js';
import { hetty } from './hetty.js';
import { romeojuliet } from './romeojuliet.js';
import { princeali } from './princeali/index.js';
import { piratestreasure } from './piratestreasure/index.js';
import { shieldofarrav } from './shieldofarrav/index.js';
import { waterfall } from './waterfall.js';
import { goblindiplomacy } from './goblindiplomacy.js';
import { demonslayer } from './demonslayer.js';
import { witchshouse } from './witchshouse.js';
import { dwarfcannon } from './dwarfcannon/index.js';
import { merlinscrystal } from './merlinscrystal.js';
import { priestperil } from './priestperil.js';
import { druidspirit } from './druidspirit/index.js';
import { blackknight } from './blackknight.js';
import { druidicritual } from './druidicritual.js';
import { lostcity } from './lostcity.js';
import { touristtrap } from './touristtrap.js';
import { vampireslayer } from './vampireslayer.js';
import { watchtower } from './watchtower/index.js';
import { junglepotion } from './junglepotion.js';
import { shilo } from './shilo/index.js';
import { elementalworkshop } from './elementalworkshop/index.js';
import { deathplateau } from './deathplateau/index.js';
import { trollstronghold } from './trollstronghold/index.js';
import { dragonslayer } from './dragonslayer/index.js';
import { plaguecity } from './plaguecity/index.js';
import { hazeelcult } from './hazeelcult.js';
import { familycrest } from './familycrest/index.js';
import { horror } from './horror/index.js';
import { fightarena } from './fightarena/index.js';
import { chompybird } from './chompybird/index.js';
import { clocktower } from './clocktower.js';
import { monksfriend } from './monksfriend.js';
import { seaslug } from './seaslug/index.js';
import { murder } from './murder/index.js';
import { tribaltotem } from './tribaltotem.js';
import { fishingcontest } from './fishingcontest/index.js';
import { heroquest } from './heroquest/index.js';
import { tbwt } from './tbwt/index.js';
import { biohazard } from './biohazard/index.js';
import { holygrail } from './holygrail/index.js';
import { treegnome } from './treegnome/index.js';
import { mortton } from './mortton/index.js';
import { gertrudescat } from './gertrudescat.js';
import { grandtree } from './grandtree/index.js';
import { scorpcatcher } from './scorpcatcher/index.js';
import { eadgar } from './eadgar/index.js';
import { sheepherder } from './sheepherder/index.js';
import { ikov } from './ikov/index.js';
import { observatory } from './observatory/index.js';
import { digsite } from './digsite/index.js';
import { upass } from './upass/index.js';
import { fremenniktrials } from './fremenniktrials/index.js';
import { regicide } from './regicide/index.js';

// Why: Hero's Quest is after Dragon Slayer: it is gated at 55 quest points and on Lost City, Merlin's Crystal, Dragon Slayer and Shield of Arrav all being green.
// Why: Dragon Slayer is last, as it is gated at 32 quest points and the queue has to earn them on the way past everything else before it becomes runnable.
// Why: Death Plateau comes before Troll Stronghold, which requires it complete.
// Why: Plague City comes before Family Crest, whose Ardougne legs ride the teleport it unlocks.
// Why: Biohazard follows Plague City, which it requires complete.
// Why: Shield of Arrav sits late among the free quests — it is the one quest that stalls without a partner or a banked certificate, so the queue should bank the others first.
// Why: Tribal Totem sits with the other Ardougne quests — no quest requires it, and its 21 Thieving gate is eligibility's job rather than the order's.
// Why: Hazeel Cult follows Plague City for the same reason Family Crest does — every leg of it is in Ardougne, so the teleport Plague City unlocks pays for all of them.
// Why: Big Chompy Bird Hunting follows Fight Arena, which is where the melee kit its wolves need is already proven.
// Why: Fishing Contest follows Vampire Slayer, which is the other quest that empties Morgan's cupboard, so the two Draynor legs run back to back.
// Why: Tai Bwo Wannai Trio follows Jungle Potion, which it requires complete.
// Why: Holy Grail follows Merlin's Crystal, which is its prerequisite and the only source of the Excalibur its one fight needs.
// Why: Shades of Mort'ton follows Nature Spirit, whose gate-guard unlock is what opens Mort Myre and so the only road south to Mort'ton.
// Why: The Grand Tree sits beside Tree Gnome Village so the two gnome-area quests run back to back — no quest requires it, and its 25 Agility gate is eligibility's job rather than the order's.
// Why: Scorpion Catcher comes after Horror from the Deep, which is the other quest built on the barcrawl — running it second finds the outpost gate already open.
// Why: Eadgar's Ruse follows Troll Stronghold, which is what frees Mad Eadgar and opens the mountain.
// Why: Sheep Herder sits with the other Ardougne quests for the same reason Hazeel Cult does — every leg of it is in East Ardougne, so the teleport Plague City unlocks pays for all of them.
// Why: Temple of Ikov sits near the end because it fletches its own yew shortbow, so it wants woodcutting 60 and fletching 65 on top of its thieving and ranged gates.
// Why: the Observatory follows Clock Tower, as both are Ardougne-side and it pays two quest points towards Dragon Slayer's gate for one outing.
// Why: Underground Pass follows Biohazard, which it requires complete, and sits second to last as the longest single run in the queue.
// Why: Regicide comes straight after Underground Pass, which it requires complete — and which is also the only way back into Tirannwn until its own catapult has fired.
// Why: The Fremennik Trials wants Woodcutting and Crafting 40, so it runs after the skilling quests rather than among the early ones.
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, knightssword, sheepshearer, restlessghost, cooksassistant, impcatcher, ernest, hetty, romeojuliet, princeali, piratestreasure, shieldofarrav, gertrudescat, waterfall, goblindiplomacy, demonslayer, witchshouse, dwarfcannon, clocktower, observatory, monksfriend, merlinscrystal, holygrail, priestperil, druidspirit, mortton, blackknight, druidicritual, lostcity, touristtrap, watchtower, vampireslayer, fishingcontest, junglepotion, tbwt, shilo, elementalworkshop, deathplateau, trollstronghold, eadgar, plaguecity, biohazard, hazeelcult, tribaltotem, sheepherder, familycrest, horror, scorpcatcher, fightarena, chompybird, seaslug, murder, treegnome, grandtree, ikov, digsite, upass, regicide, fremenniktrials, dragonslayer, heroquest];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
