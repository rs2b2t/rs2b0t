import { BUILD_INFO, formatBuildInfo } from '../runtime/buildInfo.js';
import { installWorkerClockHub } from '../runtime/WorkerClock.js';
import { installDiagnostics } from './installDiagnostics.js';
import { TrafficCollector } from '../adapter/TrafficAdapter.js';
import { DomSlotOps, orderedSlotElements } from './DomSlotOps.js';
import { MultiBoxController } from './MultiBoxController.js';
import { ProfileChooser } from './ProfileChooser.js';
import { vault, type Profile } from './ProfileVault.js';
import { renderRailTile, slotIsRunning } from './RailTile.js';
import { ResourcePanel } from './ResourcePanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { TabBar } from './TabBar.js';
import { VaultPrompt } from './VaultPrompt.js';
import { applyBoxStorage, collectBoxStorage, type ProfileSnapshot } from './ProfileTransfer.js';
import type { Account } from './types.js';

if (typeof window !== 'undefined') {
    installWorkerClockHub(window);
}

function boot(): void {
    console.log(`[rs2b0t] multibox build ${formatBuildInfo()}`);
    const buildEl = document.getElementById('mbx-build');
    if (buildEl) {
        buildEl.textContent = BUILD_INFO.label;
        buildEl.title = `commit ${BUILD_INFO.commit}${BUILD_INFO.dirty ? ' (dirty tree)' : ''}\nbuilt ${BUILD_INFO.builtAt || '—'}`;
    }

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

    function persistTabState(): void {
        if (vault.status() !== 'unlocked') {
            return;
        }
        const customTabs = controller.tabs().slice(1);
        const tabByUser = new Map(controller.snapshot().map(slot => [slot.username, slot.tab]));
        const activeTab = controller.activeTab();
        orderWrite = orderWrite.then(() => vault.saveTabState(customTabs, tabByUser, activeTab)).catch(err => console.error('[rs2b0t] failed to save tab state', err));
    }

    function mutateTabs(action: () => boolean): boolean {
        const changed = action();
        if (changed) {
            renderRail();
            persistTabState();
        }
        return changed;
    }

    const tabBar = new TabBar(document.getElementById('mbx-tabs')!, {
        onSelect: name => void mutateTabs(() => controller.setActiveTab(name)),
        onAdd: name => mutateTabs(() => controller.addTab(name)),
        onRename: (oldName, newName) => mutateTabs(() => controller.renameTab(oldName, newName)),
        onRemove: name => void mutateTabs(() => controller.removeTab(name)),
        onMove: (name, toIndex) => void mutateTabs(() => controller.moveTab(name, toIndex)),
        onDropBot: (id, tab) => void mutateTabs(() => controller.setSlotTab(id, tab))
    });

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

    // Why: the iframe would otherwise swallow the click, so tiles carry a click-catching overlay (.mbx-hit) and the rail can still switch bots.
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
        if (target.closest('#mbx-tabs')) {
            // chip drags belong to the TabBar
            return;
        }
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
        // a fresh profile joins the active tab; record that membership
        persistTabState();
    });
    document.body.appendChild(chooser.el);

    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);

    let tabsHydrated = false;
    function hydrateTabState(): void {
        if (tabsHydrated) {
            return;
        }
        tabsHydrated = true;
        const { tabs, activeTab } = vault.tabState();
        controller.setTabState(tabs, activeTab);
        renderRail();
    }

    async function ensureUnlocked(): Promise<boolean> {
        const ok = await prompt.ensureUnlocked();
        if (ok) {
            hydrateTabState();
        }
        return ok;
    }

    function applyImportedTabs(data: ProfileSnapshot): void {
        const live = controller.snapshot();
        if (live.length === 0) {
            controller.setTabState(data.tabs, data.activeTab);
            tabsHydrated = true;
            return;
        }
        const extra = data.tabs.filter(tab => !controller.tabs().includes(tab));
        if (extra.length > 0) {
            controller.setTabState([...controller.tabs().slice(1), ...extra], controller.activeTab());
        }
    }

    function loadImportedProfiles(): void {
        const live = new Set(controller.snapshot().map(slot => slot.username));
        for (const p of vault.list()) {
            if (!live.has(p.username)) {
                controller.add({ username: p.username, password: p.password, tab: p.tab });
            }
        }
        persistTabState();
        renderRail();
    }

    const settings = new SettingsPanel({
        ensureUnlocked: () => ensureUnlocked(),
        snapshot: () => ({
            ...vault.snapshot(),
            storage: collectBoxStorage(vault.list().map(p => p.username))
        }),
        replaceAll: async data => {
            const previous = vault.list().map(p => p.username);
            await vault.replaceAll(data);
            applyBoxStorage(data.storage, [...previous, ...data.profiles.map(p => p.username)]);
        },
        onImported: data => {
            applyImportedTabs(data);
            loadImportedProfiles();
        }
    });
    document.body.appendChild(settings.el);
    document.getElementById('mbx-settings')!.addEventListener('click', () => settings.open());

    addTile.addEventListener('click', () => {
        void ensureUnlocked().then(ok => {
            if (ok) {
                chooser.open();
            }
        });
    });

    window.addEventListener('message', ev => {
        if (ev.origin !== location.origin) return;
        const d = ev.data as { type?: string; username?: string; password?: string };
        if (d?.type !== 'rs2b0t:profile-save' || typeof d.username !== 'string' || d.username.length === 0 || typeof d.password !== 'string') return;
        void ensureUnlocked().then(ok => {
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

    // Bind live status (name + running dot) onto the rail tiles, which DomSlotOps keeps in slot order, so snapshot[i] is tile[i].
    // Why: tabs filter by visibility only — hidden tiles stay in the DOM, keeping that mapping intact.
    function renderRail(): void {
        tabBar.render(controller.tabs(), controller.activeTab());
        const snaps = controller.snapshot();
        resources.setBotCount(snaps.length, snaps.filter(slotIsRunning).length);
        const empty = snaps.length === 0;
        startAll.disabled = empty;
        stopAll.disabled = empty;
        renderersOff.disabled = empty;
        renderersOn.disabled = empty;
        const tiles = railTiles();
        if (tiles.length !== snaps.length) {
            throw new Error(`rail desync: ${tiles.length} tiles vs ${snaps.length} slots`);
        }
        const activeTab = controller.activeTab();
        snaps.forEach((s, i) => {
            renderRailTile(tiles[i], s);
            tiles[i].classList.toggle('mbx-tab-hidden', s.tab !== activeTab);
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

    const diagnostics = installDiagnostics(window, () => Array.from(document.querySelectorAll('iframe')));

    (globalThis as Record<string, unknown>).multibox = {
        build: BUILD_INFO,
        controller,
        diagnostics: () => diagnostics.dump(),
        diagCompare: (agoMs: number) => diagnostics.compare(agoMs),
        diagDownload: () => diagnostics.download(),
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
        tabs: () => controller.tabs(),
        activeTab: () => controller.activeTab(),
        addTab: (name: string) => mutateTabs(() => controller.addTab(name)),
        renameTab: (oldName: string, newName: string) => mutateTabs(() => controller.renameTab(oldName, newName)),
        removeTab: (name: string) => mutateTabs(() => controller.removeTab(name)),
        moveTab: (name: string, toIndex: number) => mutateTabs(() => controller.moveTab(name, toIndex)),
        setActiveTab: (name: string) => mutateTabs(() => controller.setActiveTab(name)),
        setSlotTab: (id: number, tab: string) => mutateTabs(() => controller.setSlotTab(id, tab)),
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
