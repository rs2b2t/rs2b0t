import { DomSlotOps } from './DomSlotOps.js';
import { MultiBoxController } from './MultiBoxController.js';
import type { Account } from './types.js';

function boot(): void {
    const rail = document.getElementById('mbx-rail')!;
    const addTile = document.getElementById('mbx-add')!;

    const ops = new DomSlotOps(rail, addTile);
    const controller = new MultiBoxController(ops);

    // Tiles carry a click-catching overlay (.mbx-hit) because the iframe underneath
    // would otherwise swallow the click and the rail could never switch bots.
    rail.addEventListener('click', ev => {
        const tile = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!tile) return;
        const idx = Array.from(rail.querySelectorAll('.mbx-slot')).indexOf(tile);
        const snap = controller.snapshot()[idx];
        if (snap) { controller.focus(snap.id); renderRail(); }
    });

    // No prompt: a bot starts empty and gets its login typed into its own panel.
    addTile.addEventListener('click', () => { controller.add(); renderRail(); });

    // Bind live status (name + online dot) onto the rail tiles, which DomSlotOps
    // keeps in slot order — so snapshot[i] is tile[i].
    function renderRail(): void {
        const snaps = controller.snapshot();
        const tiles = Array.from(rail.querySelectorAll('.mbx-slot'));
        if (tiles.length !== snaps.length) {
            throw new Error(`rail desync: ${tiles.length} tiles vs ${snaps.length} slots`);
        }
        snaps.forEach((s, i) => {
            const tile = tiles[i];
            tile.querySelector('.mbx-dot')!.classList.toggle('is-online', s.ingame);
            tile.querySelector('.mbx-name')!.textContent = s.player ?? s.username;
        });
    }

    window.setInterval(renderRail, 1000);
    renderRail();

    (globalThis as Record<string, unknown>).multibox = {
        controller,
        add: (a?: Account) => controller.add(a),
        focus: (id: number) => { controller.focus(id); renderRail(); },
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
