import { afterAll, beforeEach, expect, test } from 'bun:test';

import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { clearBoxes, driveBoxes } from '#/bot/api/ai/quests/exec/prompts.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

/** Boxes shown by `search_outer_ancient_gate`, ending with its result. */
let chain: string[];
let ticks: number;
let closes: number;

const restore = [
    stubProps(Execution, {
        delayTicks: async (): Promise<void> => { ticks++; },
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn()
    }),
    stubProps(Modals, {
        isOpen: () => chain.length > 0,
        close: async (): Promise<boolean> => { closes++; chain.shift(); return true; }
    }),
    stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false, texts: () => (chain[0] ? [chain[0]] : []) }),
    stubProps(Sustain, { run: async (): Promise<void> => {} })
];

afterAll(() => restore.forEach(fn => fn()));
beforeEach(() => { ticks = 0; closes = 0; });

// Why: `~mesbox` uses the main modal, which the chat driver cannot advance.
test('clicks the box chain through to its result', async () => {
    chain = [
        'You attempt to pick the lock...',
        'It looks very sophisticated...',
        'You carefully insert your lockpick into the lock.',
        'You feel for the pins and levers in the mechanism.',
        'But you fail to pick the lock.'
    ];
    const got = await driveBoxes(() => /fail to pick the lock/.test(chain[0] ?? ''), 30_000);

    expect(got).toBe(true);
    // Leave the result visible for the caller.
    expect(closes).toBe(4);
    expect(chain[0]).toBe('But you fail to pick the lock.');
});

// Why: a failed close must yield instead of spinning until the deadline.
test('a box that will not close yields instead of spinning', async () => {
    chain = ['a box with no close button'];
    const stuck = stubProps(Modals, { isOpen: () => true, close: async (): Promise<boolean> => { closes++; return false; } });
    const got = await driveBoxes(() => false, 60);

    expect(got).toBe(false);
    expect(ticks).toBeGreaterThan(0);
    stuck();
});

// Why: recheck the goal before advancing past the result message.
test('stops on the goal box when the chain renders as chat continues', async () => {
    chain = [
        'You ripple your muscles.',
        'You brace yourself against the doors.',
        'You start to force the doors open.',
        'And you just manage to force the doors open slightly.'
    ];
    let continues = 0;
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            isOpen: () => chain.length > 0,
            canContinue: () => chain.length > 0,
            options: () => [],
            continue: async (): Promise<boolean> => { continues++; chain.shift(); return true; }
        })
    ];
    const got = await driveBoxes(() => /manage to force the doors open/.test(chain[0] ?? ''), 30_000);

    expect(got).toBe(true);
    expect(continues).toBe(3);
    expect(chain[0]).toBe('And you just manage to force the doors open slightly.');
    asChat.forEach(fn => fn());
});

// Why: chat continues can suspend the server script that performs the crossing.
test('clearBoxes dismisses a chain that rendered as chat continues', async () => {
    chain = ['You see a lever which you pull on to open the door.'];
    let continues = 0;
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            canContinue: () => chain.length > 0,
            continue: async (): Promise<boolean> => { continues++; chain.shift(); return true; }
        })
    ];
    await clearBoxes();

    expect(continues).toBe(1);
    expect(chain).toHaveLength(0);
    asChat.forEach(fn => fn());
});

// Why: an unmatched choice cannot progress, so fail without spending the full budget.
test('an option list nothing matches gives up at once, and says what it saw', async () => {
    chain = [];
    const said: string[] = [];
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            isOpen: () => true,
            canContinue: () => false,
            options: () => ['Sorry for bothering you.', "Ungadulu mumbled something about 'pure' water?"]
        })
    ];
    const got = await driveBoxes(() => false, 30_000, ['I need some pure water to douse some magic flames.'], m => said.push(m));

    expect(got).toBe(false);
    expect(said[0]).toContain('no preferred option');
    expect(said[0]).toContain('mumbled');
    asChat.forEach(fn => fn());
});

// Why: clearing after success closed the combination lock the caller needed.
test('a prompt whose goal is an open panel leaves it open', async () => {
    let panel = -1;
    const opened = (): boolean => panel === 42;
    const asPanel = [
        stubProps(Modals, {
            isOpen: () => panel !== -1,
            main: () => panel,
            close: async (): Promise<boolean> => { panel = -1; return true; }
        }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false, options: () => [] })
    ];
    panel = 42;
    const got = await driveBoxes(opened, 5000);

    expect(got).toBe(true);
    expect(panel).toBe(42);
    asPanel.forEach(fn => fn());
});
