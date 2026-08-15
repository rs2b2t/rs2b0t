import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const DEATH_PLATEAU_QUEST = 'Death Plateau';

/**
 * Equip-room track mirrors `%death_equiproom` constants from the server.
 * Map track is journal flags — the client never sees the map bitfield.
 */
export const DP_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    SPOKEN_EOHRIC: 20,
    SPOKEN_HAROLD: 30,
    SPOKEN_EOHRIC2: 40,
    GIVEN_ALE: 50,
    GIVEN_IOU: 55,
    FOUND_COMBO: 60,
    UNLOCKED_DOOR: 70,
    COMPLETE: 80
} as const;

export const DP_FLAG = {
    SABA: 'saba',
    TENZING: 'tenzing',
    SMITHY: 'smithy',
    ENTRANCE_CERT: 'entrancecert',
    GIVEN_CERT: 'given_cert',
    SUPPLIES: 'supplies',
    GOT_MAP: 'got_map',
    SCOUTED: 'scouted'
} as const;

export function normalizeJournal(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function readEquipStage(text: string): number | undefined {
    // Newest first: later paragraphs retain earlier history.
    if (text.includes('quest complete!')) {
        return DP_STAGE.COMPLETE;
    }
    if (text.includes('i can start this quest')) {
        return DP_STAGE.NOT_STARTED;
    }
    if (
        text.includes('unlocked the door')
        || text.includes('found the combination to the equipment room and unlocked')
    ) {
        return DP_STAGE.UNLOCKED_DOOR;
    }
    if (text.includes('written on the back of the combination')) {
        return DP_STAGE.FOUND_COMBO;
    }
    if (text.includes('wrote me an iou') || text.includes('he wrote me an iou')) {
        return DP_STAGE.GIVEN_IOU;
    }
    if (text.includes('bought the guard a drink')) {
        return DP_STAGE.GIVEN_ALE;
    }
    if (
        text.includes('buy the guard a drink')
        || text.includes('eohric says to buy')
    ) {
        return DP_STAGE.SPOKEN_EOHRIC2;
    }
    if (text.includes("wouldn't talk to me") || text.includes('wouldnt talk to me')) {
        return DP_STAGE.SPOKEN_HAROLD;
    }
    if (
        text.includes('equipment room guard is staying')
        || text.includes('eohric said that the equipment room guard')
        || (text.includes('toad and chicken') && text.includes('equipment room guard'))
    ) {
        return DP_STAGE.SPOKEN_EOHRIC;
    }
    if (
        text.includes('offered to help denulth')
        || text.includes('finding another way')
        || text.includes('another way up death plateau')
        || text.includes('combination to the equipment room')
    ) {
        return DP_STAGE.STARTED;
    }
    return undefined;
}

function readMapFlags(text: string): Set<string> {
    const flags = new Set<string>();

    // Past-tense only: "I need to check that the secret way is safe" must not match.
    if (
        text.includes('checked the secret way')
        || text.includes('and it is safe for the imperial')
        || text.includes('i checked the secret way')
    ) {
        flags.add(DP_FLAG.SCOUTED);
    }
    if (
        text.includes('map of the secret way')
        || text.includes('has given me a map')
        || text.includes('need to check that the secret way')
    ) {
        flags.add(DP_FLAG.GOT_MAP);
    }
    if (
        text.includes('gave tenzing the ten loaves')
        || text.includes('gave tenzing the ten loaves of bread')
        || text.includes('ten cooked trout and the spiked boots')
    ) {
        flags.add(DP_FLAG.SUPPLIES);
    }
    // "Dunstan made me the Spiked boots" appears both after supplies and when
    // only the boots are done — given_cert is the stronger cert-hand-in signal.
    if (
        text.includes('given dunstan the certificate')
        || text.includes('i have given dunstan the certificate')
        || text.includes('dunstan made me the spiked boots')
    ) {
        flags.add(DP_FLAG.GIVEN_CERT);
    }
    if (text.includes('denulth gave me a certificate')) {
        flags.add(DP_FLAG.ENTRANCE_CERT);
    }
    if (
        text.includes('dunstan will help me if i get his son')
        || text.includes('son signed up for the imperial guard')
    ) {
        flags.add(DP_FLAG.SMITHY);
    }
    if (
        text.includes('tenzing will show me a secret way')
        || text.includes('ten loaves of bread')
        || text.includes('found the sherpa')
        || text.includes('climbing boots')
    ) {
        flags.add(DP_FLAG.TENZING);
    }
    if (
        text.includes('saba says that there is a sherpa')
        || text.includes('saba says that there is a sherpa living')
    ) {
        flags.add(DP_FLAG.SABA);
    }

    // Cascading: later map milestones imply earlier ones.
    if (flags.has(DP_FLAG.SCOUTED)) {
        flags.add(DP_FLAG.GOT_MAP);
        flags.add(DP_FLAG.SUPPLIES);
        flags.add(DP_FLAG.GIVEN_CERT);
        flags.add(DP_FLAG.ENTRANCE_CERT);
        flags.add(DP_FLAG.SMITHY);
        flags.add(DP_FLAG.TENZING);
        flags.add(DP_FLAG.SABA);
    } else if (flags.has(DP_FLAG.GOT_MAP) || flags.has(DP_FLAG.SUPPLIES)) {
        flags.add(DP_FLAG.GIVEN_CERT);
        flags.add(DP_FLAG.ENTRANCE_CERT);
        flags.add(DP_FLAG.SMITHY);
        flags.add(DP_FLAG.TENZING);
        flags.add(DP_FLAG.SABA);
    } else if (flags.has(DP_FLAG.GIVEN_CERT)) {
        flags.add(DP_FLAG.ENTRANCE_CERT);
        flags.add(DP_FLAG.SMITHY);
        flags.add(DP_FLAG.TENZING);
        flags.add(DP_FLAG.SABA);
    } else if (flags.has(DP_FLAG.ENTRANCE_CERT)) {
        flags.add(DP_FLAG.SMITHY);
        flags.add(DP_FLAG.TENZING);
        flags.add(DP_FLAG.SABA);
    } else if (flags.has(DP_FLAG.SMITHY)) {
        flags.add(DP_FLAG.TENZING);
        flags.add(DP_FLAG.SABA);
    } else if (flags.has(DP_FLAG.TENZING)) {
        flags.add(DP_FLAG.SABA);
    }

    return flags;
}

// Why: stage is the equip-room track and the map bits are flags.
// Why: live journals always open with the equip-room lines, but unit tests and a partial journal open may carry only map paragraphs.
// Why: progress is still emitted at stage STARTED when those are present, rather than failing closed.

/** Turn journal lines into quest progress. */
export function parseDeathPlateauJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalizeJournal(lines);
    const flags = readMapFlags(text);
    let stage = readEquipStage(text);
    if (stage === undefined) {
        if (flags.size === 0) {
            return undefined;
        }
        stage = DP_STAGE.STARTED;
    }
    return { stage, flags };
}

export async function readDeathPlateauProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(DEATH_PLATEAU_QUEST);
    if (status === 'complete') {
        return { stage: DP_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: DP_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const progress = parseDeathPlateauJournal(await Quests.journal(DEATH_PLATEAU_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
