// Print all quest record names (one per line) from the authoritative loader.
// Used to cross-check the dataset against the live quest journal.
import { loadQuestRecords } from '#/bot/quests/data/index.js';

for (const r of loadQuestRecords()) {
    console.log(r.name);
}
