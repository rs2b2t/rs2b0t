import type { SlotSnapshot } from './types.js';

export function slotIsRunning(slot: Pick<SlotSnapshot, 'ingame' | 'scriptState'>): boolean {
    return slot.ingame && slot.scriptState === 'running';
}

function setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
}

export function renderRailTile(tile: HTMLElement, slot: SlotSnapshot): void {
    const dot = tile.querySelector<HTMLElement>('.mbx-dot')!;
    const running = slotIsRunning(slot);
    const local = tile.dataset.localEngine === 'true';
    if (dot.classList.contains('is-running') !== running) dot.classList.toggle('is-running', running);
    const connected = local ? 'logged in local engine' : slot.world === null ? 'logged in; world unavailable' : `logged in World ${slot.world}`;
    const title = slot.ingame ? `${connected}; script ${slot.scriptState}` : 'logged out';
    if (dot.title !== title) dot.title = title;
    setText(tile.querySelector<HTMLElement>('.mbx-name')!, slot.player ?? slot.username);
    const pending = slot.switchingWorld;
    const status = tile.querySelector<HTMLElement>('.mbx-script-status');
    if (status) {
        const switching = pending !== null ? `Switching to World ${pending}...` : null;
        const startup = tile.dataset.startup ?? (slot.ready ? null : 'Loading');
        const script = !slot.scriptName ? 'No script running' : slot.scriptState === 'running' ? slot.scriptName : `${slot.scriptName} (${slot.scriptState})`;
        setText(status, slot.worldSwitchError ?? switching ?? startup ?? script);
    }
    const select = tile.querySelector<HTMLSelectElement>('.mbx-world-select');
    if (select) {
        const state = `${slot.targetWorld}:${pending ?? ''}`;
        if (select.dataset.worldState !== state) {
            select.value = String(pending ?? slot.targetWorld);
            select.dataset.worldState = state;
        }
        const switching = pending !== null;
        if (select.disabled !== switching) select.disabled = switching;
        const change = tile.querySelector<HTMLButtonElement>('.mbx-world-switch');
        if (change) {
            setText(change, switching ? 'Switching...' : 'Switch');
            const disabled = switching || select.value === String(slot.targetWorld);
            if (change.disabled !== disabled) change.disabled = disabled;
        }
    }
    const cancel = tile.querySelector<HTMLButtonElement>('.mbx-world-cancel');
    const hideCancel = pending === null;
    if (cancel && cancel.hidden !== hideCancel) cancel.hidden = hideCancel;
}
