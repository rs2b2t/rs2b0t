import type { SlotSnapshot } from './types.js';

export function slotIsRunning(slot: Pick<SlotSnapshot, 'ingame' | 'scriptState'>): boolean {
    return slot.ingame && slot.scriptState === 'running';
}

export function renderRailTile(tile: HTMLElement, slot: SlotSnapshot): void {
    const dot = tile.querySelector<HTMLElement>('.mbx-dot')!;
    const running = slotIsRunning(slot);
    const local = tile.dataset.localEngine === 'true';
    dot.classList.toggle('is-running', running);
    const connected = local ? 'logged in local engine' : slot.world === null ? 'logged in; world unavailable' : `logged in World ${slot.world}`;
    dot.title = slot.ingame ? `${connected}; script ${slot.scriptState}` : 'logged out';
    tile.querySelector<HTMLElement>('.mbx-name')!.textContent = slot.player ?? slot.username;
    const pending = slot.switchingWorld;
    const status = tile.querySelector<HTMLElement>('.mbx-world-status');
    if (status) {
        const current = slot.ingame ? slot.world === null ? 'Logged in; world unavailable' : `In World ${slot.world}` : slot.ready ? 'Logged out' : 'Loading';
        status.textContent = local ? slot.ingame ? 'In local engine' : `${current}; local engine`
            : pending !== null ? `${current}; waiting for World ${pending}` : slot.ingame ? current : `${current}; target World ${slot.targetWorld}`;
    }
    const select = tile.querySelector<HTMLSelectElement>('.mbx-world-select');
    if (select) {
        const state = `${slot.targetWorld}:${pending ?? ''}`;
        if (select.dataset.worldState !== state) select.value = String(pending ?? slot.targetWorld);
        select.dataset.worldState = state;
        select.disabled = pending !== null;
        const change = tile.querySelector<HTMLButtonElement>('.mbx-world-switch');
        if (change) {
            change.textContent = pending === null ? 'Switch' : 'Retry';
            change.disabled = pending === null && select.value === String(slot.targetWorld);
        }
    }
    const cancel = tile.querySelector<HTMLButtonElement>('.mbx-world-cancel');
    if (cancel) cancel.hidden = pending === null;
}
