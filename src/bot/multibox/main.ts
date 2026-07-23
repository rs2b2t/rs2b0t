import { AccountRoster } from './AccountRoster.js';
import { DomSlotOps } from './DomSlotOps.js';
import { MultiBoxController } from './MultiBoxController.js';
import type { Account } from './types.js';

function boot(): void {
    const wall = document.getElementById('mbx-wall')!;
    const addTile = document.getElementById('mbx-add')!;
    const tabs = document.getElementById('mbx-tabs')!;
    const gridBtn = document.getElementById('mbx-grid-btn')!;
    const form = document.getElementById('mbx-addform') as HTMLElement;
    const userIn = document.getElementById('mbx-user') as HTMLInputElement;
    const passIn = document.getElementById('mbx-pass') as HTMLInputElement;

    const roster = new AccountRoster();
    const ops = new DomSlotOps(wall, addTile);
    const controller = new MultiBoxController(ops, roster);

    wall.addEventListener('click', ev => {
        if (controller.focusedId !== null) return;
        const slotEl = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!slotEl || slotEl.id === 'mbx-add') return;
        const idx = Array.from(wall.querySelectorAll('.mbx-slot:not(.mbx-addtile)')).indexOf(slotEl);
        const snap = controller.snapshot()[idx];
        if (snap) { controller.focus(snap.id); renderTabs(); }
    });

    const openWall = (): void => { controller.showWall(); renderTabs(); };
    gridBtn.addEventListener('click', openWall);

    addTile.addEventListener('click', () => {
        if (controller.add()) {
            renderTabs();
        } else {
            form.hidden = false;
            userIn.focus();
        }
    });

    (document.getElementById('mbx-add-go') as HTMLButtonElement).addEventListener('click', () => {
        const username = userIn.value.trim();
        const password = passIn.value;
        if (!username) return;
        roster.add({ username, password });
        controller.add();
        userIn.value = '';
        passIn.value = '';
        form.hidden = true;
        renderTabs();
    });
    (document.getElementById('mbx-add-cancel') as HTMLButtonElement).addEventListener('click', () => { form.hidden = true; });

    function renderTabs(): void {
        const snaps = controller.snapshot();
        gridBtn.classList.toggle('active', controller.focusedId === null);
        tabs.textContent = '';
        for (const s of snaps) {
            const chip = document.createElement('button');
            chip.className = 'mbx-chip' + (s.focused ? ' active' : '');
            const dot = s.ingame ? '🟢' : s.ready ? '🟡' : '⚪';
            chip.textContent = `${dot} ${s.username}`;
            chip.addEventListener('click', () => { controller.focus(s.id); renderTabs(); });
            tabs.appendChild(chip);
        }
    }

    window.setInterval(renderTabs, 1000);
    renderTabs();

    (globalThis as Record<string, unknown>).multibox = {
        controller,
        roster,
        add: (a?: Account) => controller.add(a),
        focus: (id: number) => { controller.focus(id); renderTabs(); },
        wall: () => openWall(),
        slots: () => controller.snapshot()
    };
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}
