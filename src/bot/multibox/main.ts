import { installWorkerClockHub } from '../../util/WorkerClock.js';
import { TrafficCollector } from '../adapter/TrafficAdapter.js';
import { DomSlotOps, orderedSlotElements } from './DomSlotOps.js';
import { MultiBoxController } from './MultiBoxController.js';
import { ProfileChooser } from './ProfileChooser.js';
import { vault, type Profile } from './ProfileVault.js';
import { renderRailTile } from './RailTile.js';
import { ResourcePanel } from './ResourcePanel.js';
import { VaultPrompt } from './VaultPrompt.js';
import type { Account } from './types.js';

if (typeof window !== 'undefined') {
    installWorkerClockHub(window);
}

function boot(): void {
    const rail = document.getElementById('mbx-rail')!;
    const addTile = document.getElementById('mbx-add')!;

    const ops = new DomSlotOps(rail, addTile);
    const controller = new MultiBoxController(ops);
    const startAll = document.getElementById('mbx-start-all') as HTMLButtonElement;
    const stopAll = document.getElementById('mbx-stop-all') as HTMLButtonElement;
    const renderersOff = document.getElementById('mbx-renderers-off') as HTMLButtonElement;
    const renderersOn = document.getElementById('mbx-renderers-on') as HTMLButtonElement;
    startAll.addEventListener('click', () => controller.startAll());
    stopAll.addEventListener('click', () => controller.stopAll());
    renderersOff.addEventListener('click', () => controller.setAllRenderers(false));
    renderersOn.addEventListener('click', () => controller.setAllRenderers(true));
    const traffic = new TrafficCollector();
    const resources = new ResourcePanel(
        {
            botCount: document.getElementById('mbx-resource-bots')!,
            cpu: document.getElementById('mbx-resource-cpu')!,
            memory: document.getElementById('mbx-resource-memory')!,
            traffic: document.getElementById('mbx-resource-traffic')!,
            cpuRow: document.getElementById('mbx-resource-cpu-row')!,
            memoryRow: document.getElementById('mbx-resource-memory-row')!
        },
        { getTrafficSnapshot: () => traffic.snapshot() }
    );

    let draggingId: number | null = null;
    let suppressClick = false;
    let orderWrite = Promise.resolve();

    function railTiles(): HTMLElement[] {
        return orderedSlotElements(rail);
    }

    function clearDropMarker(): void {
        for (const tile of Array.from(rail.querySelectorAll('.mbx-drop-before, .mbx-drop-after'))) {
            tile.classList.remove('mbx-drop-before', 'mbx-drop-after');
        }
    }

    function persistSlotOrder(): void {
        if (vault.status() !== 'unlocked') {
            return;
        }
        const usernames = controller.snapshot().map(slot => slot.username);
        orderWrite = orderWrite.then(() => vault.reorder(usernames)).catch(err => console.error('[rs2b0t] failed to save bot order', err));
    }

    function moveSlot(id: number, toIndex: number): boolean {
        if (!controller.move(id, toIndex)) {
            return false;
        }
        renderRail();
        persistSlotOrder();
        return true;
    }

    function revealFocusedTile(): void {
        const index = controller.snapshot().findIndex(slot => slot.focused);
        railTiles()[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Tiles carry a click-catching overlay (.mbx-hit) because the iframe underneath
    // would otherwise swallow the click and the rail could never switch bots.
    rail.addEventListener('click', ev => {
        if (suppressClick) {
            return;
        }
        const tile = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!tile) return;
        const idx = railTiles().indexOf(tile as HTMLElement);
        const snap = controller.snapshot()[idx];
        if (!snap) return;
        if ((ev.target as HTMLElement).closest('.mbx-close')) {
            controller.remove(snap.id);
        } else {
            controller.focus(snap.id);
        }
        rail.focus({ preventScroll: true });
        renderRail();
    });

    rail.addEventListener('keydown', ev => {
        if (ev.target !== rail || ev.altKey || ev.ctrlKey || ev.metaKey) {
            return;
        }
        const direction = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : null;
        if (direction === null) {
            return;
        }
        ev.preventDefault();
        const changed = ev.shiftKey
            ? controller.moveFocused(direction)
            : controller.focusAdjacent(direction);
        if (!changed) {
            return;
        }
        renderRail();
        if (ev.shiftKey) {
            persistSlotOrder();
        }
        revealFocusedTile();
    });

    rail.addEventListener('dragstart', ev => {
        const target = ev.target as HTMLElement;
        const tile = target.closest('.mbx-slot');
        if (!tile || target.closest('.mbx-close')) {
            ev.preventDefault();
            return;
        }
        const index = railTiles().indexOf(tile as HTMLElement);
        const slot = controller.snapshot()[index];
        if (!slot) {
            ev.preventDefault();
            return;
        }
        draggingId = slot.id;
        tile.classList.add('is-dragging');
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', String(slot.id));
        }
    });

    rail.addEventListener('dragover', ev => {
        if (draggingId === null) {
            return;
        }
        const tile = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!tile) {
            return;
        }
        const index = railTiles().indexOf(tile as HTMLElement);
        const slot = controller.snapshot()[index];
        if (!slot || slot.id === draggingId) {
            clearDropMarker();
            return;
        }
        ev.preventDefault();
        if (ev.dataTransfer) {
            ev.dataTransfer.dropEffect = 'move';
        }
        clearDropMarker();
        const rect = tile.getBoundingClientRect();
        tile.classList.add(ev.clientY < rect.top + rect.height / 2 ? 'mbx-drop-before' : 'mbx-drop-after');
    });

    rail.addEventListener('drop', ev => {
        if (draggingId === null) {
            return;
        }
        const tile = (ev.target as HTMLElement).closest('.mbx-slot');
        if (!tile) {
            return;
        }
        ev.preventDefault();
        const slots = controller.snapshot();
        const fromIndex = slots.findIndex(slot => slot.id === draggingId);
        const targetIndex = railTiles().indexOf(tile as HTMLElement);
        if (fromIndex < 0 || targetIndex < 0) {
            return;
        }
        const rect = tile.getBoundingClientRect();
        let destination = targetIndex + (ev.clientY >= rect.top + rect.height / 2 ? 1 : 0);
        if (fromIndex < destination) {
            destination--;
        }
        if (moveSlot(draggingId, destination)) {
            suppressClick = true;
            window.setTimeout(() => {
                suppressClick = false;
            }, 0);
        }
        clearDropMarker();
    });

    rail.addEventListener('dragend', () => {
        draggingId = null;
        clearDropMarker();
        for (const tile of Array.from(rail.querySelectorAll('.is-dragging'))) {
            tile.classList.remove('is-dragging');
        }
    });

    const chooser = new ProfileChooser(p => {
        controller.add(p);
        renderRail();
    });
    document.body.appendChild(chooser.el);

    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);
    addTile.addEventListener('click', () => {
        void prompt.ensureUnlocked().then(ok => {
            if (ok) {
                chooser.open();
            }
        });
    });

    window.addEventListener('message', ev => {
        if (ev.origin !== location.origin) return;
        const d = ev.data as { type?: string; username?: string; password?: string };
        if (d?.type !== 'rs2b0t:profile-save' || typeof d.username !== 'string' || d.username.length === 0 || typeof d.password !== 'string') return;
        void prompt.ensureUnlocked().then(ok => {
            if (ok) {
                void vault.upsert({ username: d.username!, password: d.password! });
            }
        });
    });

    const app = document.getElementById('mbx-app')!;
    const drawer = document.getElementById('mbx-drawer')!;
    const RAIL_HIDDEN_KEY = 'rs2b0t:multibox:railHidden';
    function setRailHidden(hidden: boolean): void {
        app.classList.toggle('mbx-rail-hidden', hidden);
        drawer.textContent = hidden ? '◀' : '▶';
        localStorage.setItem(RAIL_HIDDEN_KEY, hidden ? '1' : '0');
        // the focused slot re-fits the widened/narrowed main pane via its resize listener
        window.dispatchEvent(new Event('resize'));
    }
    drawer.addEventListener('click', () => setRailHidden(!app.classList.contains('mbx-rail-hidden')));
    if (localStorage.getItem(RAIL_HIDDEN_KEY) === '1') {
        setRailHidden(true);
    }

    // Bind live status (name + running dot) onto the rail tiles, which DomSlotOps
    // keeps in slot order — so snapshot[i] is tile[i].
    function renderRail(): void {
        const snaps = controller.snapshot();
        resources.setBotCount(snaps.length);
        const empty = snaps.length === 0;
        startAll.disabled = empty;
        stopAll.disabled = empty;
        renderersOff.disabled = empty;
        renderersOn.disabled = empty;
        const tiles = railTiles();
        if (tiles.length !== snaps.length) {
            throw new Error(`rail desync: ${tiles.length} tiles vs ${snaps.length} slots`);
        }
        snaps.forEach((s, i) => {
            renderRailTile(tiles[i], s);
        });
    }

    window.setInterval(renderRail, 1000);
    resources.start();
    window.addEventListener(
        'pagehide',
        () => {
            resources.stop();
            traffic.close();
        },
        { once: true }
    );
    renderRail();

    (globalThis as Record<string, unknown>).multibox = {
        controller,
        add: (a?: Account) => {
            const slot = controller.add(a);
            renderRail();
            return slot;
        },
        focus: (id: number) => {
            controller.focus(id);
            renderRail();
        },
        move: (id: number, toIndex: number) => moveSlot(id, toIndex),
        slots: () => controller.snapshot(),
        importProfiles: async (json: string | Profile[]): Promise<number> => {
            if (!(await prompt.ensureUnlocked())) {
                return 0;
            }
            const arr = typeof json === 'string' ? (JSON.parse(json) as Profile[]) : json;
            let n = 0;
            for (const p of Array.isArray(arr) ? arr : []) {
                if (p && typeof p.username === 'string' && p.username.length > 0 && typeof p.password === 'string') {
                    await vault.upsert({ username: p.username, password: p.password });
                    n++;
                }
            }
            return n;
        },
        profiles: (): string[] => vault.list().map(p => p.username)
    };
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}
