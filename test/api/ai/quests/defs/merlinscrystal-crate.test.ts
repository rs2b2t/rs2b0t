import { expect, test } from 'bun:test';
import { merlinscrystal, liveFortressStep, liveResetMordredBrief } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loc, Locs } from '#/bot/api/locs/Locs.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

for (const mode of ['closed dialogue', 'in transit', 'exit refused'] as const) {
    test(`Merlin crate recovery: ${mode}`, async () => {
        let tile = new Tile(2778, 9839, 0);
        let page = mode === 'in transit' ? 'voyage' : '';
        let pending = '';
        const query = Locs.query();
        const wall = new Loc({ typecode: 0, id: 65, name: 'Crate wall', tile, ops: ['Climb-out'], distance: 1 });
        const restores = [
            stubProps(Game, { tile: () => tile }),
            stubProps(Locs, { query: () => query }),
            stubProps(query, { name: () => query, action: () => query, within: () => query, nearest: () => wall }),
            stubProps(wall, { interact: async op => {
                expect(op).toBe('Climb-out');
                if (mode === 'exit refused') return false;
                expect(page).toBe('');
                page = 'confirm';
                return true;
            } }),
            stubProps(ChatDialog, {
                isOpen: () => !!page,
                canContinue: () => page === 'voyage' || page === 'exit',
                options: () => page === 'confirm' ? ['Yes.', 'No.'] : [],
                continue: async () => {
                    if (page === 'voyage') pending = 'confirm';
                    if (page === 'exit') tile = new Tile(2778, 3401, 0);
                    page = '';
                    return true;
                },
                chooseOption: async choice => {
                    expect(choice).toBe('Yes.');
                    pending = 'exit';
                    page = '';
                    return true;
                }
            }),
            stubProps(Execution, {
                delayTicks: async () => {},
                delayUntil: async check => {
                    if (check()) return true;
                    page = pending;
                    pending = '';
                    return check();
                }
            })
        ];
        try {
            const step = merlinscrystal.recover?.(tile);
            expect(step?.kind).toBe('custom');
            if (step?.kind !== 'custom') throw new Error('expected crate recovery');
            expect(await step.run(() => {})).toBe(mode !== 'exit refused');
            expect(tile.z).toBe(mode === 'exit refused' ? 9839 : 3401);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}

test('Merlin crate recovery ignores other underground rooms', () => {
    expect(merlinscrystal.recover).toBeDefined();
    expect(merlinscrystal.recover?.(new Tile(2778, 9800, 0))).toBeNull();
    expect(merlinscrystal.recover?.(new Tile(2778, 3401, 0))).toBeNull();
});

test('fortress retries a crate exit before trying to board in Catherby', async () => {
    liveResetMordredBrief();
    const restores = [
        stubProps(Game, { tile: () => new Tile(2778, 9839, 0) }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(Traversal, { walkResilient: async () => { throw new Error('cannot walk out of the crate'); } }),
        stubProps(Execution, { delayUntil: async check => check() })
    ];
    try {
        expect(await liveFortressStep(() => {})).toBe(false);
    } finally {
        for (const restore of restores.reverse()) restore();
        liveResetMordredBrief();
    }
});

test('Merlin crate climbs a cardinal wall instead of an equally near diagonal corner', async () => {
    let tile = new Tile(2778, 9839, 0);
    let page = '';
    const restores = [
        stubProps(Game, { tile: () => tile }),
        stubProps(reader, {
            locs: () => [
                { typecode: 1, id: 65, name: 'Crate wall', tile: new Tile(2777, 9838, 0), ops: ['Climb-out'], distance: 1 },
                { typecode: 2, id: 65, name: 'Crate wall', tile: new Tile(2777, 9839, 0), ops: ['Climb-out'], distance: 1 }
            ],
            toLocal: (x, z) => ({ lx: x - 2752, lz: z - 9792 })
        }),
        stubProps(Input, { interactLoc: (_x, _z, typecode) => {
            if (typecode === 2) page = 'confirm';
            return true;
        } }),
        stubProps(ChatDialog, {
            isOpen: () => !!page,
            canContinue: () => page === 'exit',
            options: () => page === 'confirm' ? ['Yes.', 'No.'] : [],
            chooseOption: async choice => { if (choice === 'Yes.') page = 'exit'; return true; },
            continue: async () => { tile = new Tile(2802, 3441, 0); page = ''; return true; }
        }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
    ];
    try {
        const step = merlinscrystal.recover?.(tile);
        if (step?.kind !== 'custom') throw new Error('expected crate recovery');
        expect(await step.run(() => {})).toBe(true);
        expect(tile.z).toBe(3441);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
