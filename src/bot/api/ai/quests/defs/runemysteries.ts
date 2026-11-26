import { talkTo, waitForJournal } from '../engine/questSteps.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { normalizeJournal } from '../journalText.js';
import Tile from '../../../../geometry/Tile.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const DUKE: NpcStop = { npc: 'Duke Horacio', anchor: new Tile(3212, 3220, 1), leash: 6, prefer: ['Have you any quests for me?', 'Sure, no problem.'] };
const SEDRIDOR: NpcStop = { npc: 'Sedridor', anchor: new Tile(3103, 9572, 0), leash: 8, prefer: ["I'm looking for the head wizard.", 'Ok, here you are.', 'Yes, certainly.'], approach: [new Tile(3108, 9572, 0)] };
const AUBURY: NpcStop = { npc: 'Aubury', anchor: new Tile(3253, 3402, 0), leash: 8, prefer: ['I have been sent here with a package for you.'] };

export const WIZARD_HOPS: LadderHop[] = [
    { stand: new Tile(3105, 3162, 0), walk: new Tile(3108, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];

const RECOVER_PROBES: NpcStop[] = [AUBURY, SEDRIDOR, DUKE];

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return waitForJournal();
    }
    if (snap.journal === 'notStarted') {
        return talkTo(DUKE);
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === 2) return talkTo(SEDRIDOR);
    if (stage === 4) return talkTo(AUBURY);
    for (const [name, stop] of [['Notes', SEDRIDOR], ['Research package', AUBURY], ['Air talisman', SEDRIDOR]] as const) {
        const key = name.toLowerCase();
        if ((snap.inv.get(key) ?? 0) > 0) {
            return talkTo(stop);
        }
        if ((snap.bank?.get(key) ?? 0) > 0) {
            return { kind: 'withdraw', items: [{ name, qty: 1 }] };
        }
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    return talkTo(RECOVER_PROBES[snap.noProgress % RECOVER_PROBES.length]);
}

export const runemysteries: QuestModule = {
    record: QUESTS.find(r => r.id === 'runemysteries')!,
    bank: new Tile(3093, 3243, 0),
    tools: ['air talisman', 'research package', 'notes'],
    hops: WIZARD_HOPS,
    readStage,
    decide
};

export function parseRuneMysteriesJournal(lines: readonly string[] | string): number | undefined {
    const text = normalizeJournal(lines);
    const stage = [
        'i can start this quest by speaking to',
        'i need to find the head wizard',
        'i should talk to the head wizard again',
        'i should take this research package',
        'i should speak to aubury again',
        'i should take the notes to sedridor',
        'quest complete!'
    ].findIndex(needle => text.includes(needle));
    return stage < 0 ? undefined : stage;
}

async function readStage(): Promise<number | undefined> {
    const quest = runemysteries.record.name;
    const status = Quests.status(quest);
    if (status === 'complete') return 6;
    if (status === 'notStarted') return 0;
    if (status !== 'inProgress') return undefined;
    const stage = parseRuneMysteriesJournal(await Quests.journal(quest));
    await Modals.closeIfOpen();
    return stage;
}
