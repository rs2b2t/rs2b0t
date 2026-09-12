import { expect, test } from 'bun:test';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import { shilo } from '#/bot/api/ai/quests/defs/shilo/index.js';
import { SV_STAGE } from '#/bot/api/ai/quests/defs/shilo/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Game } from '#/bot/api/game/Game.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const host: QuestHost = {
    log: () => {}, verbose: () => false, foodItem: () => null,
    pickedIds: () => new Set(['zombiequeen']), skipPending: () => false,
    consumeSkip: () => false, consumeDeath: () => false,
    noteState: () => {}, finish: () => {}
};

test('a new quest run retries gear rejected in the previous run', async () => {
    const snap: QuestSnapshot = {
        journal: 'inProgress', stage: SV_STAGE.STARTED, noProgress: 0,
        inv: new Map([['steel scimitar', 1]]), worn: new Set(),
        bankKnown: true, bankCoins: 0, bank: new Map(), tile: { x: 2809, z: 3086, level: 0 }
    };
    const restores = [
        stubProps(Equipment, { equip: async () => false, contains: () => false }),
        stubProps(Game, { tile: () => new Tile(2809, 3086) }),
        stubProps(Bank, { isOpen: () => false }),
        stubProps(reader, { modals: () => ({ main: -1, chat: -1, side: -1 }) }),
        stubProps(Skills, { level: () => 99 }),
        stubProps(Quests, { status: name => name === 'Shilo Village' ? 'inProgress' : 'complete' }),
        stubProps(shilo, { readProgress: async () => undefined }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Execution, { delayTicks: async () => {} })
    ];
    const reject = async (): Promise<void> => {
        const step = shilo.decide(snap);
        expect(step.kind === 'custom' && step.name).toBe('wear Steel scimitar');
        if (step.kind === 'custom') await step.run(() => {});
        const next = shilo.decide(snap);
        expect(next.kind === 'custom' && next.name).not.toBe('wear Steel scimitar');
    };
    try {
        const first = new QuestEngine(host);
        await first.execute();
        await reject();
        await first.execute();
        const stillRejected = shilo.decide(snap);
        expect(stillRejected.kind === 'custom' && stillRejected.name).not.toBe('wear Steel scimitar');
        await new QuestEngine(host).execute();
        const retried = shilo.decide(snap);
        expect(retried.kind === 'custom' && retried.name).toBe('wear Steel scimitar');
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
