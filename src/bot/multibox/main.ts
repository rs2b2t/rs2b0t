import type { LoginCoordinationRegistry } from '../runtime/LoginCoordination.js';
import '../panel/desktopStorage.js';
import { resolveWorldNumber, type WorldNumber } from '../../client/config/worlds.js';
import { installVisibilityTableCache } from '../../client/dash3d/VisibilityTable.js';
import { supportsWorldRouting } from '../../client/config/target.js';
import { BUILD_INFO, formatBuildInfo } from '../runtime/buildInfo.js';
import { installNavWorkerPool, type NavPoolHost } from '../event/webwalk/NavWorkerClient.js';
import { installWorkerClockHub } from '../runtime/WorkerClock.js';
import { installDiagnostics } from './installDiagnostics.js';
import { TrafficCollector } from '../adapter/TrafficAdapter.js';
import { DomSlotOps, orderedSlotElements } from './DomSlotOps.js';
import { indexByUsername, MultiBoxController, normalizeUsername } from './MultiBoxController.js';
import { ProfileChooser } from './ProfileChooser.js';
import { vault, type Profile } from './ProfileVault.js';
import { renderRailTile, slotIsRunning } from './RailTile.js';
import { ResourcePanel } from './ResourcePanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { RosterActions, type RosterProfile } from './RosterActions.js';
import { RosterPanel } from './RosterPanel.js';
import { TabBar } from './TabBar.js';
import { BotTabMenu } from './BotTabMenu.js';
import { VaultPrompt } from './VaultPrompt.js';
import { applyBoxStorage, collectBoxStorage } from './ProfileTransfer.js';
import type { Account } from './types.js';

type DesktopWall = Window & { rs2b0tLoginCoordinator?: LoginCoordinationRegistry & { parallelism: number } };

function resolveSavedUsernames(profiles: Profile[]): (username: string) => string {
    const saved = indexByUsername(profiles.map(p => [p.username, p.username] as const));
    return username => saved.get(username) ?? username;
}

if (typeof window !== 'undefined') {
    installVisibilityTableCache(window);
    installWorkerClockHub(window);
    installNavWorkerPool(window as Window & NavPoolHost, (window as DesktopWall).rs2b0tLoginCoordinator?.parallelism);
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

    const worldRouting = supportsWorldRouting();
    const sharedLogin = (window as DesktopWall).rs2b0tLoginCoordinator;
    const ops = new DomSlotOps(rail, addTile, worldRouting, sharedLogin?.parallelism);
    const defaultWorld = worldRouting ? resolveWorldNumber(window.location.host, new URLSearchParams(window.location.search)) : 1;
    const controller = new MultiBoxController(ops, sharedLogin, defaultWorld);
    let roster: RosterPanel | null = null;
    const worldWrites = new Set<string>();
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
    let restoringTabs: Promise<void> | null = null;
    let wallOnlyTabs = new Set<string>();

    function afterTabRestore<T>(action: () => T): T | Promise<T> {
        return restoringTabs ? restoringTabs.then(action) : action();
    }

    function updateSavedTabs(update: () => Promise<void>): Promise<void> {
        const start = () => {
            const write = orderWrite.then(update);
            orderWrite = write.catch(() => {});
            return write;
        };
        const write = restoringTabs ? restoringTabs.then(start) : start();
        const ready = write.catch(() => {});
        restoringTabs = ready;
        return write.finally(() => {
            if (restoringTabs === ready) restoringTabs = null;
        });
    }

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

    function persistTabState(renamed?: { from: string; to: string }): void {
        if (vault.status() !== 'unlocked') {
            return;
        }
        const tabs = controller.tabs().slice(1);
        const activeTab = controller.activeTab();
        const profiles = vault.list();
        const savedUsername = resolveSavedUsernames(profiles);
        const live = new Map(controller.snapshot().map(slot => [savedUsername(slot.username), slot.tab]));
        const tabByUser = new Map<string, string>();
        for (const profile of profiles) {
            const tab = live.get(profile.username) ?? (renamed && profile.tab === renamed.from ? renamed.to : undefined);
            if (tab !== undefined) {
                tabByUser.set(profile.username, tab);
                wallOnlyTabs.delete(tab);
            }
        }
        wallOnlyTabs = new Set(tabs.filter(tab => wallOnlyTabs.has(tab)));
        const customTabs = tabs.filter(tab => !wallOnlyTabs.has(tab));
        const savedActiveTab = wallOnlyTabs.has(activeTab) ? undefined : activeTab;
        orderWrite = orderWrite.then(() => vault.saveTabState(customTabs, tabByUser, savedActiveTab)).catch(err => console.error('[rs2b0t] failed to save tab state', err));
    }

    function mutateTabs(action: () => boolean, renamed?: { from: string; to: string }) {
        return afterTabRestore(() => {
            const previousActive = controller.activeTab();
            const changed = action();
            if (changed) {
                if (controller.activeTab() !== previousActive) wallOnlyTabs.delete(controller.activeTab());
                renderRail();
                persistTabState(renamed);
            }
            return changed;
        });
    }

    const tabBar = new TabBar(document.getElementById('mbx-tabs')!, {
        onSelect: name => void mutateTabs(() => controller.setActiveTab(name)),
        onAdd: name => mutateTabs(() => controller.addTab(name)),
        onRename: (oldName, newName) => mutateTabs(() => controller.renameTab(oldName, newName), { from: oldName, to: newName.trim() }),
        onRemove: name => void mutateTabs(() => controller.removeTab(name)),
        onMove: (name, toIndex) => void mutateTabs(() => controller.moveTab(name, toIndex)),
        onDropBot: (id, tab) => void mutateTabs(() => controller.setSlotTab(id, tab))
    });
    const botTabMenu = new BotTabMenu((id, tab) => void mutateTabs(() => controller.setSlotTab(id, tab)));
    rail.addEventListener('contextmenu', ev => {
        const tile = (ev.target as HTMLElement).closest<HTMLElement>('.mbx-slot');
        if (!tile) return;
        const slot = controller.snapshot()[railTiles().indexOf(tile)];
        if (!slot) return;
        ev.preventDefault();
        botTabMenu.open(slot, controller.tabs(), ev.clientX, ev.clientY, rail);
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
        const target = ev.target as HTMLElement;
        if (target.closest('.mbx-world-select')) return;
        if (target.closest('.mbx-world-switch')) {
            const selected = (tile.querySelector('.mbx-world-select') as HTMLSelectElement).value;
            void changeSlotWorld(snap.id, Number(selected) as WorldNumber);
            return;
        }
        if (target.closest('.mbx-world-cancel')) {
            controller.cancelSlotWorldSwitch(snap.id);
            renderRail();
            return;
        }
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
        if (!tile || target.closest('button, select, input')) {
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

    const chooser = new ProfileChooser((p, focus) => {
        const added = controller.add(p);
        if (focus) {
            const slot = added ?? controller.snapshot().find(s => normalizeUsername(s.username) === normalizeUsername(p.username));
            if (slot) controller.focus(slot.id);
        }
        renderRail();
        // a fresh profile joins the active tab; record that membership
        afterTabRestore(() => persistTabState());
    }, {
        defaultWorld, worldRouting, onWorldChange: worldRouting ? changeProfileWorld : undefined,
        onLoadGroup: (profiles, tab) => {
            mergeSavedTabs(vault.tabState().tabs);
            if (tab) controller.setActiveTab(tab);
            controller.addGroup(profiles);
            renderRail();
        }
    });
    document.body.appendChild(chooser.el);

    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);
    window.addEventListener('storage', event => {
        if (event.key === 'rs2b0t:multibox:profiles') {
            const pendingWrites = orderWrite;
            void pendingWrites.then(() => vault.refresh()).then(() => {
                if (pendingWrites !== orderWrite) return;
                if (vault.status() !== 'unlocked') {
                    chooser.close();
                    roster?.close();
                    return;
                }
                if (tabsHydrated) syncSavedGroups();
                else hydrateTabState();
                if (!chooser.el.hidden) chooser.open();
                roster?.refresh();
            }).catch(error => console.error('[rs2b0t] failed to refresh saved accounts', error));
        }
    });

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

    async function changeProfileWorld(profile: Profile, world: WorldNumber): Promise<boolean> {
        if (!worldRouting) return false;
        const identity = normalizeUsername(profile.username);
        if (worldWrites.has(identity)) return false;
        worldWrites.add(identity);
        try {
            const slot = controller.snapshot().find(candidate => normalizeUsername(candidate.username) === identity);
            if (slot && (slot.targetWorld !== world || slot.switchingWorld !== null)) {
                if (!await controller.switchWorld(slot.id, world)) {
                    return false;
                }
            }
            await vault.setWorld(profile.username, world);
            return true;
        } finally {
            worldWrites.delete(identity);
            renderRail();
        }
    }

    async function changeSlotWorld(id: number, world: WorldNumber): Promise<boolean> {
        if (!worldRouting || (world !== 1 && world !== 2 && world !== 3)) return false;
        const slot = controller.snapshot().find(candidate => candidate.id === id);
        if (!slot || !(await ensureUnlocked())) return false;
        const profile = vault.list().find(candidate => normalizeUsername(candidate.username) === normalizeUsername(slot.username));
        try {
            if (profile) return await changeProfileWorld(profile, world);
            const changed = await controller.switchWorld(id, world);
            renderRail();
            return changed;
        } catch {
            return false;
        }
    }

    function mergeSavedTabs(tabs: string[]): void {
        let changed = false;
        for (const tab of tabs) {
            if (controller.addTab(tab)) changed = true;
        }
        if (changed) renderRail();
    }

    function syncSavedGroups(): void {
        const { tabs, assignments } = vault.adoptGroupState();
        mergeSavedTabs(tabs);
        const groups = indexByUsername(assignments);
        const liveTabs = new Set(tabs);
        for (const slot of controller.snapshot()) {
            const tab = groups.get(slot.username);
            if (tab) controller.setSlotTab(slot.id, tab);
            else if (slot.tab !== 'Main') liveTabs.add(slot.tab);
        }
        for (const tab of controller.tabs().slice(1)) {
            if (!liveTabs.has(tab)) controller.removeTab(tab);
        }
        wallOnlyTabs = new Set(controller.tabs().slice(1).filter(tab => !tabs.includes(tab)));
        controller.setTabState([...tabs, ...wallOnlyTabs], controller.activeTab());
        renderRail();
    }

    const settings = new SettingsPanel({
        ensureUnlocked: () => ensureUnlocked(),
        snapshot: () => ({
            ...vault.snapshot(),
            storage: collectBoxStorage(vault.list().map(p => p.username))
        }),
        replaceAll: data => updateSavedTabs(async () => {
            const previous = vault.list().map(p => p.username);
            await vault.replaceAll(data);
            try {
                applyBoxStorage(data.storage, [...previous, ...data.profiles.map(p => p.username)]);
            } finally {
                vault.adoptGroupState();
                controller.restoreProfiles(vault.list(), data.tabs, data.activeTab);
                wallOnlyTabs = new Set(controller.tabs().slice(1).filter(tab => !data.tabs.includes(tab)));
                renderRail();
            }
        })
    });
    document.body.appendChild(settings.el);
    document.getElementById('mbx-settings')!.addEventListener('click', () => settings.open());

    function rosterProfiles(): RosterProfile[] {
        const profiles = new Map<string, RosterProfile>();
        for (const profile of vault.status() === 'unlocked' ? vault.list() : []) {
            profiles.set(normalizeUsername(profile.username), {
                username: profile.username, tab: profile.tab ?? 'Main', world: profile.world ?? defaultWorld
            });
        }
        for (const slot of controller.snapshot()) {
            profiles.set(normalizeUsername(slot.username), {
                username: slot.username, tab: slot.tab, world: slot.targetWorld, slot
            });
        }
        return [...profiles.values()];
    }

    const rosterActions = new RosterActions({
        profiles: rosterProfiles,
        client: profile => profile.slot ? controller.rosterClient(profile.slot.id) : null,
        setWorld: async (profile, world) => {
            const saved = vault.list().find(p => normalizeUsername(p.username) === normalizeUsername(profile.username));
            if (saved) return changeProfileWorld(saved, world);
            return profile.slot ? changeSlotWorld(profile.slot.id, world) : false;
        }
    });
    roster = new RosterPanel(rosterActions, {
        tabs: () => controller.tabs(),
        activeTab: () => controller.activeTab(),
        worldRouting,
        assignGroup: (usernames, name) => updateSavedTabs(async () => {
            const savedUsername = resolveSavedUsernames(vault.list());
            await vault.assignGroup(usernames.map(savedUsername), name);
            syncSavedGroups();
        }),
        edit: async profile => {
            const current = rosterProfiles().find(p => p.username === profile.username);
            const client = current?.slot ? controller.rosterClient(current.slot.id) : null;
            if (!current?.slot || !client) throw new Error('Load this profile and wait for its client before editing.');
            controller.focus(current.slot.id);
            renderRail();
            await rosterActions.edit(current);
        }
    });
    document.body.appendChild(roster.el);
    const manage = document.getElementById('mbx-manage');
    manage?.addEventListener('click', () => {
        void ensureUnlocked().then(ok => { if (ok) roster?.open(manage); });
    });

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
    // Why: tabs filter by visibility only, hidden tiles stay in the DOM, keeping that mapping intact.
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
        roster?.refresh();
    }

    window.setInterval(renderRail, 1000);
    resources.start();
    window.addEventListener(
        'pagehide',
        () => {
            botTabMenu.close();
            roster?.close();
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
        setWorld: (id: number, world: WorldNumber) => changeSlotWorld(id, world),
        cancelWorldSwitch: (id: number) => {
            controller.cancelSlotWorldSwitch(id);
            renderRail();
        },
        tabs: () => controller.tabs(),
        activeTab: () => controller.activeTab(),
        addTab: (name: string) => mutateTabs(() => controller.addTab(name)),
        renameTab: (oldName: string, newName: string) => mutateTabs(() => controller.renameTab(oldName, newName), { from: oldName, to: newName.trim() }),
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
                    await vault.upsert(p);
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
