import type { SlotSnapshot } from './types.js';

export function slotIsRunning(slot: Pick<SlotSnapshot, 'ingame' | 'scriptState'>): boolean {
    return slot.ingame && slot.scriptState === 'running';
}

export function renderRailTile(tile: HTMLElement, slot: SlotSnapshot): void {
    const dot = tile.querySelector<HTMLElement>('.mbx-dot')!;
    const running = slotIsRunning(slot);
    dot.classList.toggle('is-running', running);
    dot.title = running
        ? 'logged in — script running'
        : slot.ingame
            ? `logged in — script ${slot.scriptState}`
            : 'logged out';
    tile.querySelector<HTMLElement>('.mbx-name')!.textContent = slot.player ?? slot.username;
}
