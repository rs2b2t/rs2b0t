import type { RosterClient } from './RosterTypes.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotSnapshot } from './types.js';
import type {
    LoginCoordination,
    LoginCoordinationRegistry
} from '../runtime/LoginCoordination.js';
import { LoginCoordinator } from './LoginCoordinator.js';
import JString from '../../client/datastruct/JString.js';
import { waitForWorldSwitch } from '../runtime/WorldSwitch.js';
import type { WorldNumber } from '../../client/config/worlds.js';

export const MAIN_TAB = 'Main';

export function normalizeUsername(username: string): string {
    const hash = JString.toUserhash(username);
    return hash === 0n ? '' : JString.toRawUsername(hash);
}

export function indexByUsername<T>(entries: Iterable<readonly [string, T]>) {
    const exact = new Map<string, T>();
    const firstByIdentity = new Map<string, T>();
    for (const [username, value] of entries) {
        if (!exact.has(username)) exact.set(username, value);
        const identity = normalizeUsername(username);
        if (identity && !firstByIdentity.has(identity)) firstByIdentity.set(identity, value);
    }
    return {
        get: (username: string) => exact.get(username) ?? firstByIdentity.get(normalizeUsername(username)),
        firstByIdentity
    };
}

interface Slot {
    id: number;
    account: Account;
    claimedProfile?: string;
    handle: SlotHandle;
    loginCoordination: LoginCoordination;
    mode: RenderMode;
    tab: string;
    switchingWorld: WorldNumber | null;
    worldSwitchError?: string;
}

type RailDirection = -1 | 1;

export class MultiBoxController {
    focusedId: number | null = null;

    private slots: Slot[] = [];
    private switchingWorld = false;
    private worldSwitches = new Map<number, AbortController>();
    private nextId = 1;
    private customTabs: string[] = [];
    private active: string = MAIN_TAB;
    // Restore the last selected bot when returning to a tab.
    private lastFocusByTab = new Map<string, number>();

    constructor(
        private ops: SlotOps,
        private loginCoordinator: LoginCoordinationRegistry = new LoginCoordinator(),
        private defaultWorld: WorldNumber = 1
    ) {}

    tabs(): string[] {
        return [MAIN_TAB, ...this.customTabs];
    }

    activeTab(): string {
        return this.active;
    }

    // New bots start empty; `account` is only for automation and vault restores.
    // Why: title-screen auto-login stays off unless the bot's Global checkbox (or ?autologin=1) arms it, though a running script still reconnects on its own (#215).
    add(account?: Account): SlotSnapshot | null {
        const slot = this.addSlot(account);
        if (!slot) return null;
        this.applyModes();
        return this.snap(slot);
    }

    restoreProfiles(profiles: Account[], tabs: string[], activeTab: string): void {
        const savedProfiles = indexByUsername(profiles.map(p => [p.username, p] as const));
        const knownTabs = new Set([MAIN_TAB, ...tabs]);
        const retained = new Set<string>();
        let modesChanged = this.active !== activeTab;
        for (const slot of this.slots) {
            const saved = savedProfiles.get(slot.account.username);
            if (!saved) {
                retained.add(slot.tab);
                continue;
            }
            const tab = saved.tab ?? MAIN_TAB;
            const next = knownTabs.has(tab) ? tab : MAIN_TAB;
            if (slot.tab !== next) {
                slot.tab = next;
                modesChanged = true;
            }
            savedProfiles.firstByIdentity.delete(normalizeUsername(slot.account.username));
        }
        for (const tab of this.customTabs) {
            if (retained.has(tab)) knownTabs.add(tab);
            else if (!knownTabs.has(tab)) this.lastFocusByTab.delete(tab);
        }
        this.customTabs = [...knownTabs].slice(1);
        this.active = activeTab;
        this.addGroup([...savedProfiles.firstByIdentity.values()], modesChanged);
    }

    addGroup(accounts: Account[], modesChanged = false): void {
        const before = this.slots.length;
        try {
            for (const account of accounts) this.addSlot(account);
        } finally {
            if (modesChanged || this.slots.length !== before) this.applyModes();
        }
    }

    private addSlot(account?: Account): Slot | null {
        if (this.switchingWorld) return null;
        const acct: Account = { ...(account ?? { username: `bot${this.nextId}`, password: '' }), world: account?.world ?? this.defaultWorld };
        const username = normalizeUsername(acct.username);
        if (!username || (acct.world !== 1 && acct.world !== 2 && acct.world !== 3)) {
            return null;
        }
        if (this.slots.some(s => normalizeUsername(s.account.username) === username)) {
            return null;
        }
        const tab = account?.tab ?? this.active;
        if (!this.tabs().includes(tab)) {
            throw new Error(`unknown tab '${tab}' for bot '${acct.username}'`);
        }
        const claimedProfile = account ? username : undefined;
        if (claimedProfile && this.loginCoordinator.claimProfile?.(claimedProfile) === false) return null;
        let handle: SlotHandle | undefined;
        let slot: Slot;
        try {
            handle = this.ops.spawn(acct);
            const loginCoordination = this.loginCoordinator.register();
            handle.setLoginCoordination(loginCoordination);
            if (account) handle.setCredentials(acct.username, acct.password);
            slot = { id: this.nextId++, account: acct, claimedProfile, handle, loginCoordination,
                mode: 'background', tab, switchingWorld: null };
        } catch (error) {
            if (claimedProfile) this.loginCoordinator.releaseProfile?.(claimedProfile);
            handle?.destroy();
            throw error;
        }
        this.slots.push(slot);
        // a new bot is what you want to look at, but only when it lands in the
        // visible tab; a restored bot spawns into its saved (possibly hidden) tab
        if (tab === this.active) {
            this.focusedId = slot.id;
        }
        return slot;
    }

    remove(id: number): void {
        if (this.switchingWorld) return;
        const slot = this.slots.find(s => s.id === id);
        if (!slot || slot.switchingWorld !== null) {
            return;
        }
        // Release the parent-owned FIFO entry even if the iframe stopped responding.
        slot.loginCoordination.leaveQueue();
        slot.handle.setLoginCoordination(null);
        slot.handle.destroy();
        if (slot.claimedProfile) this.loginCoordinator.releaseProfile?.(slot.claimedProfile);
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

    rosterClient(id: number): RosterClient | null {
        const slot = this.slots.find(slot => slot.id === id);
        if (this.switchingWorld || !slot || slot.switchingWorld !== null || !slot.handle.status().ready) return null;
        return slot.handle.roster?.() ?? null;
    }

    snapshot(): SlotSnapshot[] {
        return this.slots.map(s => this.snap(s));
    }

    async switchWorld(id: number, world: WorldNumber): Promise<boolean> {
        const slot = this.slots.find(s => s.id === id);
        if (this.switchingWorld || !slot || this.worldSwitches.has(id) || (world !== 1 && world !== 2 && world !== 3) || world === slot.account.world) return false;
        const pending = new AbortController();
        this.worldSwitches.set(id, pending);
        let reconnect = slot.handle.status().ingame;
        slot.switchingWorld = world;
        slot.worldSwitchError = undefined;
        slot.loginCoordination.leaveQueue();
        try {
            if (!await waitForWorldSwitch(() => {
                reconnect ||= slot.handle.status().ingame;
                return slot.handle.prepareWorldSwitch();
            }, pending.signal) || pending.signal.aborted) {
                if (!pending.signal.aborted) slot.worldSwitchError = 'Could not log out. Check the game message.';
                return false;
            }
            slot.handle.setLoginCoordination(null);
            slot.handle.reloadWorld(world);
            slot.loginCoordination = this.loginCoordinator.register();
            slot.handle.setLoginCoordination(slot.loginCoordination);
            slot.handle.setAutoLogin(reconnect);
            slot.handle.setRenderMode(slot.mode);
            slot.account = { ...slot.account, world };
            return true;
        } catch {
            if (!pending.signal.aborted) slot.worldSwitchError = 'Could not switch worlds. Check the connection.';
            return false;
        } finally {
            if (this.worldSwitches.get(id) === pending) {
                this.worldSwitches.delete(id);
                slot.switchingWorld = null;
                if (slot.account.world !== world) slot.handle.cancelWorldSwitch();
            }
        }
    }

    cancelSlotWorldSwitch(id: number): void {
        const slot = this.slots.find(s => s.id === id);
        if (this.switchingWorld || !slot || slot.switchingWorld === null) return;
        this.worldSwitches.get(id)?.abort();
        this.worldSwitches.delete(id);
        slot.handle.cancelWorldSwitch();
        slot.switchingWorld = null;
    }

    cancelWorldSwitch(): void {
        this.switchingWorld = false;
        for (const slot of this.slots) {
            if (slot.switchingWorld === null) slot.handle.cancelWorldSwitch();
        }
    }

    prepareWorldSwitch(): boolean {
        this.switchingWorld = true;
        let ready = true;
        for (const slot of this.slots) {
            slot.loginCoordination.leaveQueue();
            if (!slot.handle.prepareWorldSwitch()) ready = false;
        }
        return ready;
    }

    startAll(): void {
        if (this.switchingWorld) return;
        for (const slot of this.slots) {
            if (slot.switchingWorld === null) slot.handle.startScript();
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
        return { id: slot.id, username: slot.account.username, focused: slot.id === this.focusedId, mode: slot.mode, tab: slot.tab, targetWorld: slot.account.world ?? this.defaultWorld, switchingWorld: slot.switchingWorld, worldSwitchError: slot.worldSwitchError, ...slot.handle.status() };
    }
}
