import type { Account, RenderMode, SlotHandle, SlotOps, SlotSnapshot } from './types.js';
import type {
    LoginCoordination,
    LoginCoordinationRegistry
} from '../runtime/LoginCoordination.js';
import { LoginCoordinator } from './LoginCoordinator.js';

export const MAIN_TAB = 'Main';

interface Slot {
    id: number;
    account: Account;
    handle: SlotHandle;
    loginCoordination: LoginCoordination;
    mode: RenderMode;
    tab: string;
}

type RailDirection = -1 | 1;

export class MultiBoxController {
    focusedId: number | null = null;

    private slots: Slot[] = [];
    private nextId = 1;
    private customTabs: string[] = [];
    private active: string = MAIN_TAB;
    // tab -> the bot you were last looking at there, so returning to a tab
    // resumes that bot instead of snapping back to its top slot
    private lastFocusByTab = new Map<string, number>();

    constructor(
        private ops: SlotOps,
        private loginCoordinator: LoginCoordinationRegistry = new LoginCoordinator()
    ) {}

    tabs(): string[] {
        return [MAIN_TAB, ...this.customTabs];
    }

    activeTab(): string {
        return this.active;
    }

    // A bot is added empty, its login typed into the bot's own panel; `account` is for automation and vault restores, which inject credentials only.
    // Why: title-screen auto-login stays off unless the bot's Global checkbox (or ?autologin=1) arms it, though a running script still reconnects on its own (#215).
    add(account?: Account): SlotSnapshot | null {
        const acct: Account = account ?? { username: `bot${this.nextId}`, password: '' };
        if (acct.username.length === 0) {
            return null;
        }
        if (this.slots.some(s => s.account.username === acct.username)) {
            return null;
        }
        const tab = account?.tab ?? this.active;
        if (!this.tabs().includes(tab)) {
            throw new Error(`unknown tab '${tab}' for bot '${acct.username}'`);
        }
        const handle = this.ops.spawn(acct);
        const loginCoordination = this.loginCoordinator.register();
        handle.setLoginCoordination(loginCoordination);
        const slot: Slot = {
            id: this.nextId++,
            account: acct,
            handle,
            loginCoordination,
            mode: 'background',
            tab
        };
        this.slots.push(slot);
        if (account) {
            handle.setCredentials(acct.username, acct.password);
        }
        // a new bot is what you want to look at — but only when it lands in the
        // visible tab; a restored bot spawns into its saved (possibly hidden) tab
        if (tab === this.active) {
            this.focusedId = slot.id;
        }
        this.applyModes();
        return this.snap(slot);
    }

    remove(id: number): void {
        const slot = this.slots.find(s => s.id === id);
        if (!slot) {
            return;
        }
        // Release the parent-owned FIFO entry even if the iframe stopped responding.
        slot.loginCoordination.leaveQueue();
        slot.handle.setLoginCoordination(null);
        slot.handle.destroy();
        this.slots = this.slots.filter(s => s.id !== id);
        if (this.focusedId === id) {
            this.focusedId = null;
        }
        this.applyModes();
    }

    focus(id: number): void {
        const slot = this.slots.find(s => s.id === id);
        if (!slot) {
            return;
        }
        // focusing a bot means looking at it, so its tab becomes the active one
        this.active = slot.tab;
        this.focusedId = id;
        this.applyModes();
    }

    focusAdjacent(direction: RailDirection): boolean {
        const visible = this.visibleSlots();
        const current = visible.findIndex(s => s.id === this.focusedId);
        const target = visible[current + direction];
        if (current < 0 || !target) {
            return false;
        }
        this.focus(target.id);
        return true;
    }

    moveFocused(direction: RailDirection): boolean {
        const visible = this.visibleSlots();
        const current = visible.findIndex(s => s.id === this.focusedId);
        const neighbour = visible[current + direction];
        if (current < 0 || !neighbour) {
            return false;
        }
        return this.move(visible[current].id, this.slots.findIndex(s => s.id === neighbour.id));
    }

    move(id: number, toIndex: number): boolean {
        const fromIndex = this.slots.findIndex(s => s.id === id);
        if (fromIndex < 0 || !Number.isSafeInteger(toIndex)) {
            return false;
        }

        const destination = Math.max(0, Math.min(this.slots.length - 1, toIndex));
        if (destination === fromIndex) {
            return false;
        }

        const [slot] = this.slots.splice(fromIndex, 1);
        this.slots.splice(destination, 0, slot);
        this.ops.move(slot.handle, this.slots[destination + 1]?.handle ?? null);
        return true;
    }

    addTab(name: string): boolean {
        const trimmed = name.trim();
        if (trimmed.length === 0 || this.tabs().includes(trimmed)) {
            return false;
        }
        this.customTabs.push(trimmed);
        return true;
    }

    renameTab(oldName: string, newName: string): boolean {
        const idx = this.customTabs.indexOf(oldName);
        const trimmed = newName.trim();
        if (idx < 0 || trimmed.length === 0 || this.tabs().includes(trimmed)) {
            return false;
        }
        this.customTabs[idx] = trimmed;
        for (const s of this.slots) {
            if (s.tab === oldName) {
                s.tab = trimmed;
            }
        }
        // a rename keeps the tab's identity, so its remembered bot rides along
        const remembered = this.lastFocusByTab.get(oldName);
        if (remembered !== undefined) {
            this.lastFocusByTab.delete(oldName);
            this.lastFocusByTab.set(trimmed, remembered);
        }
        if (this.active === oldName) {
            this.active = trimmed;
        }
        return true;
    }

    removeTab(name: string): boolean {
        const idx = this.customTabs.indexOf(name);
        if (idx < 0) {
            return false;
        }
        // Main sits pinned at 0, so every custom tab has a left neighbour
        const prior = this.tabs()[idx];
        this.customTabs.splice(idx, 1);
        this.lastFocusByTab.delete(name);
        for (const s of this.slots) {
            if (s.tab === name) {
                s.tab = prior;
            }
        }
        if (this.active === name) {
            this.active = prior;
        }
        this.applyModes();
        return true;
    }

    moveTab(name: string, toIndex: number): boolean {
        const from = this.customTabs.indexOf(name);
        if (from < 0 || !Number.isSafeInteger(toIndex)) {
            return false;
        }
        // toIndex is in tabs() space, where Main is pinned at 0
        const dest = Math.max(1, Math.min(this.customTabs.length, toIndex)) - 1;
        if (dest === from) {
            return false;
        }
        const [tab] = this.customTabs.splice(from, 1);
        this.customTabs.splice(dest, 0, tab);
        return true;
    }

    setActiveTab(name: string): boolean {
        if (this.active === name || !this.tabs().includes(name)) {
            return false;
        }
        this.active = name;
        this.applyModes();
        return true;
    }

    setSlotTab(id: number, tab: string): boolean {
        const slot = this.slots.find(s => s.id === id);
        if (!slot || slot.tab === tab || !this.tabs().includes(tab)) {
            return false;
        }
        slot.tab = tab;
        this.applyModes();
        return true;
    }

    // Vault hydration replaces the tab config wholesale, so it validates loudly
    // instead of returning false like the incremental mutators.
    setTabState(customTabs: string[], activeTab: string): void {
        const tabs = [MAIN_TAB, ...customTabs];
        if (new Set(tabs).size !== tabs.length) {
            throw new Error(`duplicate tab names in ${JSON.stringify(customTabs)}`);
        }
        if (!tabs.includes(activeTab)) {
            throw new Error(`active tab '${activeTab}' is not in ${JSON.stringify(tabs)}`);
        }
        for (const s of this.slots) {
            if (!tabs.includes(s.tab)) {
                throw new Error(`bot '${s.account.username}' sits in tab '${s.tab}', which is not in ${JSON.stringify(tabs)}`);
            }
        }
        this.customTabs = [...customTabs];
        this.active = activeTab;
        this.applyModes();
    }

    snapshot(): SlotSnapshot[] {
        return this.slots.map(s => this.snap(s));
    }

    startAll(): void {
        for (const slot of this.slots) {
            slot.handle.startScript();
        }
    }

    stopAll(): void {
        for (const slot of this.slots) {
            slot.handle.stopScript();
        }
    }

    setAllRenderers(enabled: boolean): void {
        for (const slot of this.slots) {
            slot.handle.setRendererEnabled(enabled);
        }
    }

    private visibleSlots(): Slot[] {
        return this.slots.filter(s => s.tab === this.active);
    }

    private applyModes(): void {
        // focus lives in the active tab: one focused slot whenever the
        // active tab has any; an empty active tab leaves the main pane blank.
        const visible = this.visibleSlots();
        if (!visible.some(s => s.id === this.focusedId)) {
            const remembered = this.lastFocusByTab.get(this.active);
            this.focusedId = visible.find(s => s.id === remembered)?.id ?? visible[0]?.id ?? null;
        }
        if (this.focusedId !== null) {
            this.lastFocusByTab.set(this.active, this.focusedId);
        }
        for (const s of this.slots) {
            // A background tab shows nothing, so its bots stop painting entirely.
            // Why: 'hidden' gates the same draw call the renderer switch does but is the wall's own state, so a tab return resumes what the user's per-bot switch had running.
            const mode: RenderMode = s.tab !== this.active ? 'hidden' : s.id === this.focusedId ? 'focused' : 'background';
            this.setMode(s, mode);
        }
    }

    private setMode(slot: Slot, mode: RenderMode): void {
        slot.mode = mode;
        slot.handle.setRenderMode(mode);
    }

    private snap(slot: Slot): SlotSnapshot {
        return { id: slot.id, username: slot.account.username, focused: slot.id === this.focusedId, mode: slot.mode, tab: slot.tab, ...slot.handle.status() };
    }
}
