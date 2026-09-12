import { afterAll, beforeEach, expect, test } from 'bun:test';

import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { driveToEnd } from '#/bot/api/ai/quests/defs/legends/scene.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

let boxes: string[];

const restore = [
    stubProps(Execution, { delayTicks: async (): Promise<void> => {} }),
    stubProps(Modals, {
        isOpen: () => boxes.length > 0,
        close: async (): Promise<boolean> => { boxes.shift(); return true; }
    })
];

afterAll(() => restore.forEach(fn => fn()));
beforeEach(() => { boxes = []; });

// Why: `~mesbox` can suspend a chain without opening chat, so silence does not mean completion.
test('a chain suspended on a message box is driven, not counted as silence', async () => {
    boxes = ['the shaman throws himself down on the floor and starts convulsing.'];
    const chat = stubProps(ChatDialog, {
        isOpen: () => false,
        canContinue: () => false,
        options: () => []
    });
    const got = await driveToEnd([], () => {}, 5000);

    expect(got).toBe(true);
    expect(boxes).toHaveLength(0);
    chat();
});
