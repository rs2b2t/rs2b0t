import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { readBiohazardProgress } from '#/bot/api/ai/quests/defs/biohazard/journal.js';
import { readDigsiteProgress, resetDigsiteJournalCache } from '#/bot/api/ai/quests/defs/digsite/journal.js';
import { readDruidProgress } from '#/bot/api/ai/quests/defs/druidspirit/journal.js';
import { readFishingContestStage } from '#/bot/api/ai/quests/defs/fishingcontest/journal.js';
import { readRegicideProgress, RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';
import { readUpassProgress, UP_FLAG, UP_STAGE } from '#/bot/api/ai/quests/defs/upass/journal.js';
import { readQuestJournal } from '#/bot/api/ai/quests/journalReader.js';
import { Quests, type QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';

let status: QuestStatus;
let lines: string[];
let events: string[];
let restores: (() => void)[];

beforeEach(() => {
    status = 'inProgress';
    lines = [];
    events = [];
    const row = spyOn(Quests, 'status').mockImplementation(() => status);
    const journal = spyOn(Quests, 'journal').mockImplementation(async () => { events.push('open'); return lines; });
    const close = spyOn(Modals, 'closeIfOpen').mockImplementation(async () => { events.push('close'); });
    restores = [() => row.mockRestore(), () => journal.mockRestore(), () => close.mockRestore()];
    resetDigsiteJournalCache();
});

afterEach(() => {
    resetDigsiteJournalCache();
    restores.forEach(restore => restore());
});

test('complete and unstarted rows create fresh progress and never open or close the journal', async () => {
    status = 'complete';
    const first = await readBiohazardProgress();
    const again = await readBiohazardProgress();
    expect(first?.stage).toBe(16);
    expect(again).not.toBe(first);
    expect(again?.flags).not.toBe(first?.flags);
    expect((await readDruidProgress())?.flags.size).toBe(2);
    status = 'notStarted';
    expect(await readDruidProgress()).toEqual({ stage: 0, flags: new Set() });
    expect(events).toEqual([]);
});

test('notStarted rows can have Underground Pass flags or a later Regicide stage', async () => {
    status = 'notStarted';
    lines = ['King Lathas asked me to meet a tracker named Koftik.'];
    expect(await readUpassProgress()).toEqual({ stage: UP_STAGE.NOT_STARTED, flags: new Set([UP_FLAG.STARTED]) });
    lines = ['A courier has given me a message.'];
    expect(await readRegicideProgress()).toEqual({ stage: RG_STAGE.RECEIVED_MESSAGE, flags: new Set() });
    expect(events).toEqual(['open', 'close', 'open', 'close']);
});

for (const read of [readUpassProgress, readRegicideProgress]) {
    test(`${read.name} falls back to fresh progress only for an unreadable notStarted page`, async () => {
        status = 'notStarted';
        const first = await read();
        const again = await read();
        expect(first).toEqual({ stage: 0, flags: new Set() });
        expect(again).toEqual(first);
        expect(again).not.toBe(first);
        expect(again?.flags).not.toBe(first?.flags);
        status = 'inProgress';
        expect(await read()).toBeUndefined();
        expect(events).toEqual(['open', 'close', 'open', 'close', 'open', 'close']);
    });
}

test('an unreadable page stays unknown in uncached stage and progress readers', async () => {
    lines = ['Quest complete!'];
    expect(await readBiohazardProgress()).toBeDefined();
    expect(await readFishingContestStage()).toBe(5);
    lines = [];
    expect(await readBiohazardProgress()).toBeUndefined();
    expect(await readFishingContestStage()).toBeUndefined();
    expect(events).toEqual(['open', 'close', 'open', 'close', 'open', 'close', 'open', 'close']);
});

test('only a parsed page updates the cached progress object', async () => {
    lines = ['study for my first exam'];
    const lastGood = await readDigsiteProgress();
    expect(lastGood?.stage).toBe(2);
    status = 'complete';
    expect((await readDigsiteProgress())?.stage).toBe(9);
    status = 'unknown';
    expect(await readDigsiteProgress()).toBeUndefined();
    status = 'inProgress';
    lines = [];
    expect(await readDigsiteProgress()).toBe(lastGood);
    resetDigsiteJournalCache();
    expect(await readDigsiteProgress()).toBeUndefined();
});

test('a zero stage is cached, and the cache changes only after close succeeds', async () => {
    const cache: { lastGood?: number } = {};
    const stages = { COMPLETE: 5, NOT_STARTED: 0 };
    const read = (stage: number | undefined) => readQuestJournal('quest', stages, () => {
        events.push('parse');
        return stage;
    }, value => value, cache);
    expect(await read(0)).toBe(0);
    expect(events).toEqual(['open', 'parse', 'close']);
    spyOn(Modals, 'closeIfOpen').mockRejectedValueOnce(new Error('close failed'));
    await expect(read(3)).rejects.toThrow('close failed');
    expect(await read(undefined)).toBe(0);
});

test.each(['inProgress', 'notStarted'] as const)('a parser error on an %s page propagates before closing the modal', async row => {
    status = row;
    const read = readQuestJournal('quest', { COMPLETE: 5, NOT_STARTED: 0 }, () => {
        throw new Error('parse failed');
    }, stage => stage, undefined, { readNotStarted: true });
    await expect(read).rejects.toThrow('parse failed');
    expect(events).toEqual(['open']);
});
