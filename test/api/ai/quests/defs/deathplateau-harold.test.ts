import { expect, test } from 'bun:test';
import { decide, DP_STAGE } from '#/bot/api/ai/quests/defs/deathplateau/index.js';
import { gambleWithHarold, giveAleToHarold } from '#/bot/api/ai/quests/defs/deathplateau/harold.js';
import { DEATH_DICE_MAIN } from '#/bot/api/ai/quests/defs/deathplateau/areas.js';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('withdraws a known banked ale before visiting Tostig', () => {
    const step = decide({
        journal: 'inProgress', progress: { stage: DP_STAGE.SPOKEN_EOHRIC2, flags: new Set() },
        inv: new Map([['coins', 101]]), worn: new Set(), bankCoins: 0, noProgress: 0,
        bankIds: new Map([[1905, 1]]), bankKnown: true, freeSlots: 1
    });
    expect(step).toMatchObject({ kind: 'withdraw', items: [{ id: 1905, qty: 1 }] });
});

test('a partial stake can still pay out when the bank has no more coins', () => {
    const step = decide({
        journal: 'inProgress', progress: { stage: DP_STAGE.GIVEN_ALE, flags: new Set() },
        inv: new Map([['coins', 40]]), worn: new Set(), bankCoins: 0, noProgress: 0,
        bankKnown: true, freeSlots: 1
    });
    expect(step.kind === 'custom' && step.name.includes('gamble')).toBe(true);
});

test("resuming in Harold's room gambles without leaving to fetch a banked drink", () => {
    const step = decide({
        journal: 'inProgress', progress: { stage: DP_STAGE.GIVEN_ALE, flags: new Set() },
        inv: new Map([['coins', 101]]), worn: new Set(), bankCoins: 0, noProgress: 0,
        bankIds: new Map([[2028, 1]]), bankKnown: true, freeSlots: 1, tile: { x: 2905, z: 3539, level: 1 }
    });
    expect(step.kind === 'custom' && step.name.includes('gamble')).toBe(true);
});

test('giving one of two ales ends the handoff without offering a second drink', async () => {
    const ale = new InvItem({ id: 1905, count: 1, name: 'Asgarnian ale', slot: 0, comId: 3214, ops: [] });
    let phase = 'offer';
    let ales = 2;
    const restores = [
        stubProps(Game, { tile: () => ({ x: 2905, z: 3539, level: 1 }) }),
        stubProps(Inventory, { items: () => Array.from({ length: ales }, () => ale) }),
        stubProps(ChatDialog, {
            isOpen: () => phase !== 'closed',
            canContinue: () => phase === 'offer',
            options: () => phase === 'menu' ? ['Where were you when you last had the combination?', 'Would you like to gamble?', 'Can I buy you a drink?']
                : phase === 'second drink' ? ['End test'] : [],
            continue: async () => { ales--; phase = 'menu'; return true; },
            chooseOption: async choice => { phase = choice?.includes('drink') ? 'second drink' : 'closed'; return true; }
        }),
        stubProps(Modals, { isOpen: () => false }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
    ];
    try {
        expect(await giveAleToHarold(() => {})).toBe(true);
        expect(ales).toBe(1);
        expect(phase).toBe('closed');
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});

test('a resumed dice game settles from the purse when the panel says the player lost', async () => {
    let coins = 40;
    let phase = 'menu';
    let iou = false;
    const bets: number[] = [];
    const paper = new InvItem({ id: 3103, count: 1, name: 'Iou', slot: 1, comId: 3214, ops: [] });
    const restores = [
        stubProps(Game, { tile: () => ({ x: 2905, z: 3539, level: 1 }) }),
        stubProps(Inventory, { items: () => iou ? [paper] : [], count: () => coins }),
        stubProps(ChatDialog, {
            isOpen: () => phase === 'menu', canContinue: () => false,
            options: () => phase === 'menu' ? ['Would you like to gamble?'] : [],
            chooseOption: async () => { phase = 'count'; return true; }
        }),
        stubProps(reader, {
            countDialogOpen: () => phase === 'count',
            modals: () => ({ main: ['roll', 'verdict'].includes(phase) ? DEATH_DICE_MAIN : -1, chat: -1, side: -1 }),
            mainModalTexts: () => ['You lose!'],
            modalButtons: () => [
                { comId: 28, label: 'Roll Dice', menu: '', pause: false, hidden: phase !== 'roll' },
                { comId: 30, label: 'Continue', menu: '', pause: true, hidden: phase !== 'verdict' }
            ]
        }),
        stubProps(actions, {
            answerCountDialog: stake => { bets.push(stake); phase = 'roll'; return true; },
            ifButton: () => {
                phase = 'verdict';
                if (bets.length === 1) coins += bets[0]!;
                else iou = true;
                return true;
            },
            pauseButton: () => { phase = 'menu'; return true; }
        }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
    ];
    try {
        expect(await gambleWithHarold(() => {})).toBe(true);
        expect(bets).toEqual([40, 61]);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
