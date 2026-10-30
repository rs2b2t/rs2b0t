import { expect, test } from 'bun:test';
import { decide, merlinscrystal } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

function snapshot(stage?: number): QuestSnapshot {
    return { journal: 'inProgress', stage, inv: new Map([['bat bones', 1], ['lit black candle', 1]]), worn: new Set(), noProgress: 0, bankCoins: 0, bankKnown: true, bank: new Map() };
}

for (const [stage, text] of [
    [0, '@dbl@I can start this quest by speaking to @dre@King Arthur'],
    [1, '@dbl@I should ask the @dre@other Knights@dbl@ if they have any @dre@advice'],
    [2, '@dre@Gawain@dbl@ think this was the work of @dre@Morgan Le Faye|@dbl@who lives in an @dre@impenetrable fortress'],
    [3, '@dbl@There might be a way to enter with a @dre@delivery by sea@dbl@...'],
    [4, '@str@In return for sparing her son, Morgan Le Faye told me|@str@how I could break the spell that had imprisoned Merlin.|@dbl@I need to summon the spirit @dre@Thrantax'],
    [5, '@str@I need to summon the spirit Thrantax|@str@I summoned the Spirit Thrantax and forced him to aid me'],
    [6, '@str@I summoned the Spirit Thrantax|@str@I freed Merlin by shattering the Crystal that trapped him'],
    [7, '@str@I freed Merlin by shattering the Crystal|@red@QUEST COMPLETE!'],
    [undefined, '']
] as const) {
    test(`Merlin reads journal stage ${stage}`, async () => {
        const restores = [
            stubProps(Quests, { status: () => 'inProgress', journal: async () => [text] }),
            stubProps(reader, { modals: () => ({ main: -1, chat: -1, side: -1 }) })
        ];
        try {
            expect(merlinscrystal.readStage).toBeDefined();
            expect(await merlinscrystal.readStage?.()).toBe(stage);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}

for (const stage of [1, 2, 3]) {
    test(`Merlin stage ${stage} cannot skip Morgan with unrelated ingredients`, () => {
        const step = decide(snapshot(stage));
        expect(step.kind).toBe('custom');
        if (step.kind === 'custom') expect(step.name).toMatch(/opening|fortress/);
    });
}

test('Merlin waits when its journal stage is unavailable', () => {
    expect(decide(snapshot()).kind).toBe('wait');
});

test('Merlin checks an unknown bank before asking for another Excalibur', () => {
    expect(decide({ ...snapshot(4), bankKnown: false }).kind).toBe('scanBank');
});

test('Merlin retrieves banked Excalibur instead of repeating the Lady test', () => {
    const step = decide({ ...snapshot(4), bank: new Map([['excalibur', 1]]) });
    expect(step).toMatchObject({ kind: 'withdraw', items: [{ name: 'Excalibur', qty: 1 }] });
});

test('Merlin returns to Arthur after freeing Merlin without re-gathering bones', () => {
    const step = decide({ ...snapshot(6), inv: new Map() });
    expect(step).toMatchObject({ kind: 'talk', stop: { npc: 'King Arthur' } });
});

test('Merlin breaks the bound crystal without replacing consumed bones', () => {
    const step = decide({ ...snapshot(5), inv: new Map([['excalibur', 1]]) });
    expect(step).toMatchObject({ kind: 'custom', name: 'summon Thrantax + break the crystal' });
});
