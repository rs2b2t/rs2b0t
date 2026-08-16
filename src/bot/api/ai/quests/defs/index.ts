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
import { clocktower } from './clocktower.js';
import { monksfriend } from './monksfriend.js';
import { seaslug } from './seaslug/index.js';
import { murder } from './murder/index.js';
import { tribaltotem } from './tribaltotem.js';
import { fishingcontest } from './fishingcontest/index.js';
import { tbwt } from './tbwt/index.js';
import { biohazard } from './biohazard/index.js';

// Why: Dragon Slayer is last, as it is gated at 32 quest points and the queue has to earn them on the way past everything else before it becomes runnable.
// Why: Death Plateau comes before Troll Stronghold, which requires it complete.
// Why: Plague City comes before Family Crest, whose Ardougne legs ride the teleport it unlocks.
// Why: Biohazard follows Plague City, which it requires complete.
// Why: Shield of Arrav sits late among the free quests — it is the one quest that stalls without a partner or a banked certificate, so the queue should bank the others first.
// Why: Tribal Totem sits with the other Ardougne quests — no quest requires it, and its 21 Thieving gate is eligibility's job rather than the order's.
// Why: Hazeel Cult follows Plague City for the same reason Family Crest does — every leg of it is in Ardougne, so the teleport Plague City unlocks pays for all of them.
// Why: Fishing Contest follows Vampire Slayer, which is the other quest that empties Morgan's cupboard, so the two Draynor legs run back to back.
// Why: Tai Bwo Wannai Trio follows Jungle Potion, which it requires complete.
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, knightssword, sheepshearer, restlessghost, cooksassistant, impcatcher, ernest, hetty, romeojuliet, princeali, piratestreasure, shieldofarrav, waterfall, goblindiplomacy, demonslayer, witchshouse, dwarfcannon, clocktower, monksfriend, merlinscrystal, priestperil, druidspirit, blackknight, druidicritual, lostcity, touristtrap, watchtower, vampireslayer, fishingcontest, junglepotion, tbwt, shilo, elementalworkshop, deathplateau, trollstronghold, plaguecity, biohazard, hazeelcult, tribaltotem, familycrest, horror, fightarena, seaslug, murder, dragonslayer];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
