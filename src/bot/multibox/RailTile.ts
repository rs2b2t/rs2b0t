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
    const status = tile.querySelector<HTMLElement>('.mbx-script-status');
    if (status) {
        status.textContent = slot.worldSwitchError ?? (pending !== null ? `Switching to World ${pending}...` : !slot.ready ? 'Loading' : !slot.scriptName ? 'No script running'
            : slot.scriptState === 'running' ? slot.scriptName : `${slot.scriptName} (${slot.scriptState})`);
    }
    const select = tile.querySelector<HTMLSelectElement>('.mbx-world-select');
    if (select) {
        const state = `${slot.targetWorld}:${pending ?? ''}`;
        if (select.dataset.worldState !== state) select.value = String(pending ?? slot.targetWorld);
        select.dataset.worldState = state;
        select.disabled = pending !== null;
        const change = tile.querySelector<HTMLButtonElement>('.mbx-world-switch');
        if (change) {
            change.textContent = pending === null ? 'Switch' : 'Switching...';
            change.disabled = pending !== null || select.value === String(slot.targetWorld);
        }
    }
    const cancel = tile.querySelector<HTMLButtonElement>('.mbx-world-cancel');
    if (cancel) cancel.hidden = pending === null;
}
