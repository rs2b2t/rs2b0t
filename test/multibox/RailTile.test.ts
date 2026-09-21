import { expect, test } from 'bun:test';
import { renderRailTile, slotIsRunning } from '#/bot/multibox/RailTile.js';
import type { SlotSnapshot } from '#/bot/multibox/types.js';

function slot(ingame: boolean, scriptState: string): SlotSnapshot {
    return {
        id: 1,
        username: 'profile name',
        focused: true,
        mode: 'focused',
        tab: 'Main',
        ready: true,
        ingame,
        world: ingame ? 1 : null,
        targetWorld: 1,
        switchingWorld: null,
        player: 'Player Name',
        loopCycle: 0,
        drawn: 0,
        scriptState
    };
}

test('green dot requires both login and a running script', () => {
    const tile = document.createElement('div');
    tile.innerHTML = '<span class="mbx-dot"></span><span class="mbx-name"></span>';
    const dot = tile.querySelector<HTMLElement>('.mbx-dot')!;

    for (const [ingame, state] of [[false, 'running'], [true, 'idle'], [true, 'paused'], [true, 'stopped'], [true, 'crashed']] as const) {
        renderRailTile(tile, slot(ingame, state));
        expect(dot.classList.contains('is-running')).toBe(false);
    }

    renderRailTile(tile, slot(true, 'running'));
    expect(dot.classList.contains('is-running')).toBe(true);
    expect(slotIsRunning(slot(true, 'running'))).toBe(true);
    expect(slotIsRunning(slot(true, 'idle'))).toBe(false);
    expect(dot.title).toBe('logged in World 1; script running');
    expect(tile.querySelector('.mbx-name')?.textContent).toBe('Player Name');
});

test('rail status distinguishes a live world from a pending or logged-out target', () => {
    const tile = document.createElement('div');
    tile.innerHTML = '<span class="mbx-dot"></span><span class="mbx-name"></span><span class="mbx-world-status"></span><select class="mbx-world-select"><option value="1">World 1</option><option value="2">World 2</option></select><button class="mbx-world-switch"></button><button class="mbx-world-cancel"></button>';
    const select = tile.querySelector<HTMLSelectElement>('.mbx-world-select')!;
    const status = tile.querySelector('.mbx-world-status')!;
    renderRailTile(tile, { ...slot(true, 'idle'), switchingWorld: 2 });
    expect(status.textContent).toBe('In World 1; waiting for World 2');
    expect(select.value).toBe('2');
    expect(select.disabled).toBe(true);
    expect(tile.querySelector<HTMLButtonElement>('.mbx-world-cancel')!.hidden).toBe(false);
    renderRailTile(tile, { ...slot(false, 'idle'), targetWorld: 2 });
    expect(status.textContent).toBe('Logged out; target World 2');
    expect(select.disabled).toBe(false);
    expect(tile.querySelector<HTMLButtonElement>('.mbx-world-cancel')!.hidden).toBe(true);
    select.value = '1';
    renderRailTile(tile, { ...slot(false, 'idle'), targetWorld: 2 });
    expect(select.value).toBe('1');
    expect(tile.querySelector<HTMLButtonElement>('.mbx-world-switch')!.disabled).toBe(false);
});


test('local rail status never presents a saved preference as a connected public world', () => {
    const tile = document.createElement('div');
    tile.dataset.localEngine = 'true';
    tile.innerHTML = '<span class="mbx-dot"></span><span class="mbx-name"></span><span class="mbx-world-status"></span>';
    for (const ingame of [false, true]) {
        renderRailTile(tile, { ...slot(ingame, 'idle'), world: null, targetWorld: 2 });
        expect(tile.querySelector('.mbx-world-status')!.textContent).toBe(ingame ? 'In local engine' : 'Logged out; local engine');
        expect(tile.querySelector<HTMLElement>('.mbx-dot')!.title).not.toContain('World');
    }
});
