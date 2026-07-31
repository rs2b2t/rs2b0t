import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { gotoNpc, talkStrict, type NpcStop } from '../exec/primitives.js';

/** Exact server-side rjquest values, recovered from the client-visible quest journal. */
export const ROMEO_JULIET_STAGE = {
    NOT_STARTED: 0,
    SPOKEN_TO_ROMEO: 10,
    SPOKEN_TO_JULIET: 20,
    PASSED_MESSAGE: 30,
    SPOKEN_TO_FATHER: 40,
    SPOKEN_TO_APOTHECARY: 50,
    JULIET_IN_CRYPT: 60,
    COMPLETE: 100
} as const;

export const ROMEO_JULIET_ITEM = {
    BERRIES: { name: 'Cadava berries', id: 753 },
    MESSAGE: { name: 'Message', id: 755 },
    POTION: { name: 'Cadava potion', id: 756 }
} as const;

const ROMEO: NpcStop = {
    npc: 'Romeo',
    anchor: new Tile(3211, 3425, 0),
    leash: 8,
    prefer: ['Can I help find her for you?']
};
const JULIET: NpcStop = {
    npc: 'Juliet',
    anchor: new Tile(3158, 3425, 1),
    leash: 6,
    prefer: []
};
const LAWRENCE: NpcStop = {
    npc: 'Father Lawrence',
    anchor: new Tile(3254, 3475, 0),
    leash: 6,
    prefer: []
};
const APOTHECARY: NpcStop = {
    npc: 'Apothecary',
    anchor: new Tile(3195, 3404, 0),
    leash: 6,
    prefer: []
};

const VARROCK_WEST_BANK = new Tile(3185, 3440, 0);
const BERRY_ANCHOR = new Tile(3272, 3369, 0);
const BERRY_RESPAWN_MS = 70_000;

interface ExactItem {
    readonly name: string;
    readonly id: number;
}

function journalText(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Convert the server-rendered journal into the authoritative rjquest stage.
 * Entries are cumulative, so the newest milestone must always be matched first.
 */
export function parseRomeoJulietJournal(lines: readonly string[] | string): number | undefined {
    const text = journalText(lines);

    if (text.includes('quest complete!')) return ROMEO_JULIET_STAGE.COMPLETE;
    if (text.includes('i have to find romeo') && text.includes("tell him what's happened")) {
        return ROMEO_JULIET_STAGE.JULIET_IN_CRYPT;
    }
    // Content branch 274 corrected the journal's legacy "cadaver" spelling to
    // the actual item spelling, "cadava". Match the stable authored clause so
    // both deployed revisions resolve to the same server stage.
    if (text.includes('i went to the apothecary regarding making this') && text.includes('potion, and he told me to bring him some')) {
        return ROMEO_JULIET_STAGE.SPOKEN_TO_APOTHECARY;
    }
    if (text.includes('i need to find the apothecary')) return ROMEO_JULIET_STAGE.SPOKEN_TO_FATHER;
    if (text.includes('i should find father lawrence')) return ROMEO_JULIET_STAGE.PASSED_MESSAGE;
    if (text.includes('i should take the message') && text.includes('to romeo')) {
        return ROMEO_JULIET_STAGE.SPOKEN_TO_JULIET;
    }
    if (text.includes('i should go and speak to juliet')) return ROMEO_JULIET_STAGE.SPOKEN_TO_ROMEO;
    if (text.includes('i can start this quest by talking to romeo')) return ROMEO_JULIET_STAGE.NOT_STARTED;
    return undefined;
}

export async function readRomeoJulietStage(): Promise<number | undefined> {
    const status = Quests.status('Romeo & Juliet');
    if (status === 'complete') return ROMEO_JULIET_STAGE.COMPLETE;
    if (status === 'notStarted') return ROMEO_JULIET_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    // rjquest is server-only and is not transmitted as a client varp. The journal
    // is rendered by the server from that same value, making it the browser's exact oracle.
    const lines = await Quests.journal('Romeo & Juliet');
    const stage = parseRomeoJulietJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

function held(snap: QuestSnapshot, item: ExactItem): boolean {
    if (snap.invIds !== undefined) {
        return (snap.invIds.get(item.id) ?? 0) > 0;
    }
    return (snap.inv.get(item.name.toLowerCase()) ?? 0) > 0;
}

function banked(snap: QuestSnapshot, item: ExactItem): number {
    if (snap.bankIds !== undefined) {
        return snap.bankIds.get(item.id) ?? 0;
    }
    return snap.bank?.get(item.name.toLowerCase()) ?? 0;
}

function clearFullPack(): QuestStep {
    return {
        kind: 'deposit',
        keep: [],
        keepIds: [],
        bank: VARROCK_WEST_BANK,
        exactKeep: true
    };
}

function talkAtStage(stage: number, action: string, stop: NpcStop): QuestStep {
    return {
        kind: 'custom',
        name: `stage ${stage}: ${action}`,
        run: async log => {
            log(`journal stage ${stage}: ${action}`);
            if (!(await gotoNpc(stop, [], log))) {
                log(`stage ${stage}: could not reach ${stop.npc}`);
                return false;
            }
            if (!(await talkStrict(stop.npc, stop.prefer, log))) {
                log(`stage ${stage}: ${stop.npc} dialogue did not complete`);
                return false;
            }
            log(`stage ${stage}: finished talking to ${stop.npc}; re-reading the journal`);
            return true;
        }
    };
}

function nearbyBerries() {
    return GroundItems.query()
        .where(item => item.id === ROMEO_JULIET_ITEM.BERRIES.id)
        .within(12)
        .nearest();
}

async function pickBerries(log: (message: string) => void): Promise<boolean> {
    if (Inventory.isFull()) {
        log('stage 50: inventory is full; refusing to risk losing the berry pickup');
        return false;
    }

    const before = Inventory.countById(ROMEO_JULIET_ITEM.BERRIES.id);
    let berry = nearbyBerries();
    if (!berry) {
        log('stage 50: walking to the three Cadava berry ground spawns');
        if (!(await Traversal.walkResilient(BERRY_ANCHOR, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
            log('stage 50: could not reach the Cadava berry spawn area');
            return false;
        }
        berry = nearbyBerries();
    }

    if (!berry) {
        log('stage 50: all three Cadava berry spawns are empty; waiting up to 70 seconds for a respawn');
        const appeared = await Execution.delayUntil(() => nearbyBerries() !== null, BERRY_RESPAWN_MS);
        if (!appeared) {
            log('stage 50: no Cadava berry respawn appeared within 70 seconds');
            return false;
        }
        berry = nearbyBerries();
    }

    if (!berry) {
        log('stage 50: a Cadava berry appeared but another player took it first; retrying');
        return false;
    }
    log('stage 50: taking a Cadava berry from the ground spawn');
    if (!(await berry.interact('Take'))) {
        log('stage 50: the Cadava berry pickup action failed or lost a player race');
        return false;
    }
    const obtained = await Execution.delayUntil(() => Inventory.countById(ROMEO_JULIET_ITEM.BERRIES.id) > before, 8000);
    if (!obtained) {
        log('stage 50: the pickup completed without a Cadava berry entering the inventory');
    } else {
        log('stage 50: acquired a Cadava berry');
    }
    return obtained;
}

function stageTwenty(snap: QuestSnapshot): QuestStep {
    if (held(snap, ROMEO_JULIET_ITEM.MESSAGE)) {
        return talkAtStage(20, "deliver Juliet's message to Romeo", ROMEO);
    }
    if (snap.freeSlots === 0) {
        return clearFullPack();
    }
    // Juliet checks both inventory and bank before issuing a replacement, so a
    // restart must establish whether the exact quest message is already banked.
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: VARROCK_WEST_BANK };
    }
    if (banked(snap, ROMEO_JULIET_ITEM.MESSAGE) > 0) {
        return {
            kind: 'withdraw',
            items: [{ ...ROMEO_JULIET_ITEM.MESSAGE, qty: 1 }],
            bank: VARROCK_WEST_BANK
        };
    }
    return talkAtStage(20, 'ask Juliet to replace the lost message', JULIET);
}

function stageFifty(snap: QuestSnapshot): QuestStep {
    if (held(snap, ROMEO_JULIET_ITEM.POTION)) {
        return talkAtStage(50, 'deliver the Cadava potion to Juliet', JULIET);
    }
    if (held(snap, ROMEO_JULIET_ITEM.BERRIES)) {
        return talkAtStage(50, 'exchange Cadava berries with the Apothecary', APOTHECARY);
    }
    if (snap.freeSlots === 0) {
        return clearFullPack();
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: VARROCK_WEST_BANK };
    }
    if (banked(snap, ROMEO_JULIET_ITEM.POTION) > 0) {
        return {
            kind: 'withdraw',
            items: [{ ...ROMEO_JULIET_ITEM.POTION, qty: 1 }],
            bank: VARROCK_WEST_BANK
        };
    }
    if (banked(snap, ROMEO_JULIET_ITEM.BERRIES) > 0) {
        return {
            kind: 'withdraw',
            items: [{ ...ROMEO_JULIET_ITEM.BERRIES, qty: 1 }],
            bank: VARROCK_WEST_BANK
        };
    }
    return {
        kind: 'custom',
        name: 'stage 50: collect Cadava berries from their ground spawns',
        run: pickBerries
    };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= ROMEO_JULIET_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Romeo & Juliet stage unavailable' };
    }

    switch (snap.stage) {
        case ROMEO_JULIET_STAGE.NOT_STARTED:
            return talkAtStage(0, 'ask Romeo how to help find Juliet', ROMEO);
        case ROMEO_JULIET_STAGE.SPOKEN_TO_ROMEO:
            return snap.freeSlots === 0 ? clearFullPack() : talkAtStage(10, "ask Juliet for Romeo's message", JULIET);
        case ROMEO_JULIET_STAGE.SPOKEN_TO_JULIET:
            return stageTwenty(snap);
        case ROMEO_JULIET_STAGE.PASSED_MESSAGE:
            return talkAtStage(30, 'ask Father Lawrence for help', LAWRENCE);
        case ROMEO_JULIET_STAGE.SPOKEN_TO_FATHER:
            return talkAtStage(40, 'ask the Apothecary for a Cadava potion', APOTHECARY);
        case ROMEO_JULIET_STAGE.SPOKEN_TO_APOTHECARY:
            return stageFifty(snap);
        case ROMEO_JULIET_STAGE.JULIET_IN_CRYPT:
            return talkAtStage(60, 'tell Romeo that Juliet took the potion', ROMEO);
        default:
            return { kind: 'wait', reason: `unrecognized Romeo & Juliet stage ${snap.stage}` };
    }
}

export const romeojuliet: QuestModule = {
    record: QUESTS.find(record => record.id === 'romeojuliet')!,
    bank: VARROCK_WEST_BANK,
    ownsInventory: true,
    readStage: readRomeoJulietStage,
    decide
};
