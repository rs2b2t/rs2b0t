import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';
import { doric } from './doric.js';
import { sheepshearer } from './sheepshearer.js';
import { restlessghost } from './restlessghost.js';
import { cooksassistant } from './cooksassistant.js';
import { hetty } from './hetty.js';
import { romeojuliet } from './romeojuliet.js';
import { princeali } from './princeali.js';
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

export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, sheepshearer, restlessghost, cooksassistant, hetty, romeojuliet, princeali, waterfall, goblindiplomacy, demonslayer, witchshouse, merlinscrystal, priestperil, blackknight, druidicritual, lostcity, touristtrap, watchtower, vampireslayer, junglepotion, shilo];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
