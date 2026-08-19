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
    expect(dot.title).toBe('logged in — script running');
    expect(tile.querySelector('.mbx-name')?.textContent).toBe('Player Name');
});
