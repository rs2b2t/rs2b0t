import { expect, test } from 'bun:test';
import { blackknight, decide } from '#/bot/api/ai/quests/defs/blackknight.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { stubProps } from '../../../../lib/stubSingletons.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Game } from '#/bot/api/game/Game.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Loc, Locs } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

test('sabotage waits for the delayed confirmation after the cabbage disappears', async () => {
    let consumed = false;
    let confirmed = false;
    let open = false;
    let continued = false;
    const query = Locs.query();
    const hole = new Loc({ typecode: 0, id: 2336, name: 'Hole', tile: new Tile(3031, 3507, 1), ops: [], distance: 1 });
    const item = new InvItem({ slot: 0, id: 1965, name: 'Cabbage', count: 1, ops: ['Eat'], comId: 3214 });
    const restore = [
        stubProps(Inventory, { items: () => consumed ? [] : [item] }),
        stubProps(item, { useOn: async () => { consumed = true; return true; } }),
        stubProps(Game, { setAutoRetaliate: () => true }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(Locs, { query: () => query }),
        stubProps(query, { name: () => query, within: () => query, nearest: () => hole }),
        stubProps(ChatDialog, {
            isOpen: () => open, canContinue: () => open, options: () => [],
            texts: () => open ? ["Right I think that's successfully sabotaged the secret weapon."] : [],
            continue: async () => { continued = true; open = false; return true; }
        }),
        stubProps(Execution, {
            delayTicks: async () => {},
            delayUntil: async check => {
                if (check()) return true;
                if (consumed && !confirmed) { confirmed = true; open = true; }
                return check();
            }
        })
    ];
    try {
        const step = decide({ journal: 'inProgress', stage: 2, inv: new Map([['cabbage', 1]]), worn: new Set(['iron chainbody', 'bronze med helm']), noProgress: 0, bankCoins: 0 });
        if (step.kind !== 'custom') throw new Error('expected sabotage step');
        await step.run(() => {});
        expect(confirmed).toBe(true);
        expect(continued).toBe(true);
    } finally { restore.reverse().forEach(fn => fn()); }
});

test('listening finishes all nine dialogue pages across page-turn gaps', async () => {
    let open = false;
    let pages = 0;
    const item = new InvItem({ slot: 0, id: 1965, name: 'Cabbage', count: 1, ops: ['Eat'], comId: 3214 });
    const restore = [
        stubProps(Inventory, { items: () => [item] }),
        stubProps(Game, { setAutoRetaliate: () => true }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Reach, { locOp: async opts => {
            expect(opts.expect()).toBe(false);
            open = true;
            expect(opts.expect()).toBe(true);
            return 'done';
        } }),
        stubProps(ChatDialog, {
            isOpen: () => open, canContinue: () => open, options: () => [],
            continue: async () => { pages++; open = false; return true; }
        }),
        stubProps(Execution, {
            delayTicks: async () => {},
            delayUntil: async check => {
                if (check()) return true;
                open = pages < 9;
                return check();
            }
        })
    ];
    try {
        const step = decide({ journal: 'inProgress', stage: 1, inv: new Map([['cabbage', 1]]), worn: new Set(['iron chainbody', 'bronze med helm']), noProgress: 0, bankCoins: 0 });
        if (step.kind !== 'custom') throw new Error('expected grill step');
        await step.run(() => {});
        expect(pages).toBe(9);
    } finally { restore.reverse().forEach(fn => fn()); }
});

for (const [stage, text] of [
    [1, "@dre@Sir Amik Varze @dbl@asked me to investigate the @dre@Black|@dre@Knight's Fortress @dbl@which is located on @dre@Ice Mountain."],
    [2, '@str@Sir Amik Varze asked me to investigate the Black Knights Fortress.|@dbl@I eavesdropped on a Witch and the Black Knight Captain|@dbl@and discovered that their invincibility potion can be|@dbl@destroyed with a normal @dre@cabbage.'],
    [3, "@str@I eavesdropped on a Witch and the Black Knight Captain|@dbl@Now that I have sabotaged the witch's potion, I can claim my|@dre@reward @dbl@from @dre@Sir Amik Varze"],
    [4, '@red@QUEST COMPLETE!'],
    [undefined, '']
] as const) test(`fortress reads journal stage ${stage}`, async () => {
    const restore = [
        stubProps(Quests, { status: () => 'inProgress', journal: async () => [text] }),
        stubProps(reader, { modals: () => ({ main: -1, chat: -1, side: -1 }) })
    ];
    try {
        expect(blackknight.readStage).toBeFunction();
        expect(await blackknight.readStage?.()).toBe(stage);
    } finally { restore.reverse().forEach(fn => fn()); }
});

test('unread fortress progress cannot assume it has listened or sabotaged the potion', () => {
    expect(decide({ journal: 'inProgress', inv: new Map([['cabbage', 1]]), worn: new Set(['iron chainbody', 'bronze med helm']), noProgress: 0, bankCoins: 0 }).kind).toBe('wait');
});
