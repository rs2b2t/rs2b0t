import { hostedWorld, WORLDS, worldSwitchUrl, type BotMode } from '../../client/config/worlds.js';

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
    const current = hostedWorld(options.location.host);
    const label = document.createElement('span');
    label.textContent = current ? `World ${current.number}` : 'Local world';
    root.appendChild(label);
    if (!current) {
        return root;
    }
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Destination world');
    for (const world of WORLDS) {
        const option = document.createElement('option');
        option.value = String(world.number);
        option.textContent = `World ${world.number}`;
        select.appendChild(option);
    }
    select.value = String(current.number);
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
    status.textContent = options.mode === 'wall'
        ? 'One world per wall. Profiles stay on each host; use Export / Import to move them.'
        : 'Log out before switching. Sign in again on the other world.';
    button.addEventListener('click', () => {
        const number = Number(select.value);
        if (number === current.number || !WORLDS.some(world => world.number === number)) {
            return;
        }
        if (!options.prepare()) {
            status.textContent = 'Scripts and reconnects stopped. Log out in-game on every client, wait for pending logins, then click Switch again.';
            cancel.hidden = false;
            return;
        }
        options.navigate(worldSwitchUrl(number, options.mode, options.location).href);
    });
    cancel.addEventListener('click', () => {
        options.cancel();
        select.value = String(current.number);
        cancel.hidden = true;
        status.textContent = 'Switch cancelled. Scripts and auto-login remain stopped; resume them when ready.';
    });
    root.append(select, button, cancel, status);
    return root;
}
