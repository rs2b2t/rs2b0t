import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';
import { doric } from './doric.js';
import { sheepshearer } from './sheepshearer.js';
import { restlessghost } from './restlessghost.js';
import { cooksassistant } from './cooksassistant.js';
import { romeojuliet } from './romeojuliet.js';
import { princeali } from './princeali.js';
import { waterfall } from './waterfall.js';
import { goblindiplomacy } from './goblindiplomacy.js';
import { demonslayer } from './demonslayer.js';
import { witchshouse } from './witchshouse.js';
import { merlinscrystal } from './merlinscrystal.js';
import { priestperil } from './priestperil.js';
import { blackknight } from './blackknight.js';

/** Implemented quests, in RUN ORDER (cheapest/most-certain first). */
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, sheepshearer, restlessghost, cooksassistant, romeojuliet, princeali, waterfall, goblindiplomacy, demonslayer, witchshouse, merlinscrystal, priestperil, blackknight];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
