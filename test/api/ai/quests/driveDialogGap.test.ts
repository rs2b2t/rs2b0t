import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { stubProps } from '../../../lib/stubSingletons.js';
import { driveDialog, openDialogue } from '#/bot/api/ai/quests/exec/primitives.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';

// Why: Lawgof walks to the cannon and inspects it before the next page, and the default 1.5s lull
// tolerance ended the drive mid-scene, the quest then picked another step and talked over him.

const TICK_MS = 600;
const initialExecution = { delayTicks: Execution.delayTicks, delayUntil: Execution.delayUntil };
const initialChat = { isOpen: ChatDialog.isOpen, continue: ChatDialog.continue, canContinue: ChatDialog.canContinue,
    options: ChatDialog.options, chooseOption: ChatDialog.chooseOption };
afterEach(() => {
    Object.assign(Execution, initialExecution);
    Object.assign(ChatDialog, initialChat);
});

/** Poll the predicate once per simulated tick, so a longer wait gets more chances. */
beforeEach(() => {
    (Execution as unknown as { delayUntil: (c: () => boolean, ms: number) => Promise<boolean> }).delayUntil =
        async (check: () => boolean, ms: number) => {
            for (let i = 0; i < Math.max(1, Math.floor(ms / TICK_MS)); i++) {
                if (check()) {
                    return true;
                }
            }
            return check();
        };
    (Execution as unknown as { delayTicks: (n: number) => Promise<void> }).delayTicks = async () => {};
});

/** A conversation that goes quiet for `gapTicks` polls, then offers one last page. */
function scriptGap(gapTicks: number): { pages: () => number } {
    let polls = 0;
    let pages = 0;
    (ChatDialog as unknown as { isOpen: () => boolean }).isOpen = () => false;
    (ChatDialog as unknown as { canContinue: () => boolean }).canContinue = () => {
        polls++;
        return polls > gapTicks;
    };
    (ChatDialog as unknown as { continue: () => Promise<boolean> }).continue = async () => {
        pages++;
        return true;
    };
    (ChatDialog as unknown as { options: () => string[] }).options = () => [];
    return { pages: () => pages };
}

describe('a talk can wait out a scripted pause', () => {
    test('the default tolerance gives up on a long inspection', async () => {
        const seen = scriptGap(8);
        await driveDialog([], () => {});
        expect(seen.pages()).toBe(0);
    });

    test('a stop that asks for longer clicks the page that follows', async () => {
        const seen = scriptGap(8);
        await driveDialog([], () => {}, 12_000);
        expect(seen.pages()).toBeGreaterThan(0);
    });
});

test('confirmed dialogue pages need no extra ticks between actions', async () => {
    let page = 0;
    const actionTicks: number[] = [];
    let ticks = 0;
    Execution.delayTicks = async n => { ticks += n; };
    ChatDialog.isOpen = () => page < 3;
    ChatDialog.canContinue = () => page === 0 || page === 2;
    ChatDialog.options = () => page === 1 ? ['Yes'] : [];
    const advance = async () => { actionTicks.push(ticks); page++; return true; };
    ChatDialog.continue = advance;
    ChatDialog.chooseOption = advance;
    expect(await driveDialog(['Yes'], () => {})).toBe(true);
    expect(actionTicks).toEqual([0, 0, 0]);
});

test('talks to an NPC on the first tick its scene entry arrives', async () => {
    let ticks = 0;
    const undo = [
        stubProps(reader, { npcs: () => ticks ? [{
            index: 1, id: 1, name: 'Harold', tile: { x: 1, z: 1, level: 0 }, distance: 1, ops: ['Talk-to'],
            anim: -1, level: 1, size: 1, inCombat: false, health: 1, totalHealth: 1, faceEntity: -1
        }] : [] }),
        stubProps(Reach, { entityOp: async () => 'done' }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false })
    ];
    Execution.delayTicks = async n => { ticks += n; };
    try {
        expect(await openDialogue('Harold', () => {})).toBe(true);
        expect(ticks).toBe(1);
    } finally {
        for (const restore of undo.reverse()) restore();
    }
});
