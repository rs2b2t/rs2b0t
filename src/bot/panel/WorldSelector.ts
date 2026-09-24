import { resolveWorldNumber, WORLDS, worldSwitchUrl, type BotMode } from '../../client/config/worlds.js';

import { waitForWorldSwitch } from '../runtime/WorldSwitch.js';

interface WorldSelectorOptions {
    mode: BotMode;
    location: URL;
    prepare(): boolean;
    cancel(): void;
    navigate(url: string): void;
}

export function worldSelector(options: WorldSelectorOptions): HTMLElement {
    const root = document.createElement('div');
    root.className = 'rs2b0t-world-selector';
    const current = resolveWorldNumber(options.location.host, options.location.searchParams);
    const label = document.createElement('span');
    label.textContent = `World ${current}`;
    root.appendChild(label);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Destination world');
    for (const world of WORLDS) {
        const option = document.createElement('option');
        option.value = String(world.number);
        option.textContent = `World ${world.number}`;
        select.appendChild(option);
    }
    select.value = String(current);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Switch';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.hidden = true;
    const status = document.createElement('span');
    status.className = 'rs2b0t-world-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Your profile and script settings carry across worlds.';
    let pending: AbortController | null = null;
    button.addEventListener('click', async () => {
        const number = Number(select.value);
        if (pending || number === current || !WORLDS.some(world => world.number === number)) return;
        const attempt = new AbortController();
        pending = attempt;
        button.disabled = true;
        select.disabled = true;
        cancel.hidden = false;
        status.textContent = `Switching to World ${number}...`;
        try {
            const ready = await waitForWorldSwitch(options.prepare, attempt.signal);
            if (attempt.signal.aborted) return;
            if (ready) options.navigate(worldSwitchUrl(number, options.mode, options.location).href);
            else {
                options.cancel();
                status.textContent = 'Could not log out. Check the game message before switching again.';
            }
        } catch {
            options.cancel();
            status.textContent = 'World switch failed. Check the connection before switching again.';
        } finally {
            if (pending === attempt) {
                pending = null;
                button.disabled = false;
                select.disabled = false;
                cancel.hidden = true;
            }
        }
    });
    cancel.addEventListener('click', () => {
        pending?.abort();
        pending = null;
        options.cancel();
        select.value = String(current);
        select.disabled = false;
        button.disabled = false;
        cancel.hidden = true;
        status.textContent = 'Switch cancelled. Scripts and auto-login remain stopped; resume them when ready.';
    });
    root.append(select, button, cancel, status);
    return root;
}
