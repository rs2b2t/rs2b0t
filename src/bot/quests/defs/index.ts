import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';
import { doric } from './doric.js';
import { sheepshearer } from './sheepshearer.js';
import { restlessghost } from './restlessghost.js';
import { cooksassistant } from './cooksassistant.js';
import { hetty } from './hetty.js';
import { romeojuliet } from './romeojuliet.js';
import { princeali } from './princeali/index.js';
import { waterfall } from './waterfall.js';
import { goblindiplomacy } from './goblindiplomacy.js';
import { demonslayer } from './demonslayer.js';
import { witchshouse } from './witchshouse.js';
import { merlinscrystal } from './merlinscrystal.js';
import { priestperil } from './priestperil.js';
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

// Dragon Slayer last: it is gated at 32 quest points, so the queue has to earn
// them on the way past everything else before it becomes runnable at all.
// Death Plateau before Troll Stronghold (troll requires death complete).
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, sheepshearer, restlessghost, cooksassistant, hetty, romeojuliet, princeali, waterfall, goblindiplomacy, demonslayer, witchshouse, merlinscrystal, priestperil, blackknight, druidicritual, lostcity, touristtrap, watchtower, vampireslayer, junglepotion, shilo, elementalworkshop, deathplateau, trollstronghold, dragonslayer];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
