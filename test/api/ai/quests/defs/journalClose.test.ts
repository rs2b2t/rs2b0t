import { expect, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { readBiohazardProgress } from '#/bot/api/ai/quests/defs/biohazard/journal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

for (const closeAfter of [0, 2]) {
    test(`returns quest progress when the journal closes on tick ${closeAfter}`, async () => {
        let main = 123;
        let ticks = 0;
        const advance = () => {
            ticks++;
            if (ticks >= closeAfter) main = -1;
        };
        const restores = [
            stubProps(Quests, { status: () => 'inProgress', journal: async () => ['Quest complete!'] }),
            stubProps(reader, { modals: () => ({ main, side: -1, chat: -1 }) }),
            stubProps(actions, { closeModal: () => { if (closeAfter === 0) main = -1; return true; } }),
            stubProps(Execution, {
                delayTicks: async n => { for (let i = 0; i < n; i++) advance(); },
                delayUntil: async ready => { while (!ready() && ticks < 4) advance(); return ready(); }
            })
        ];
        try {
            expect(await readBiohazardProgress()).toBeDefined();
            expect(main).toBe(-1);
            expect(ticks).toBe(closeAfter);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}
