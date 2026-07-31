import type { Account, RenderMode, SlotHandle, SlotOps, SlotSnapshot } from './types.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import { LoginCoordinator } from './LoginCoordinator.js';

interface Slot {
    id: number;
    account: Account;
    handle: SlotHandle;
    mode: RenderMode;
}

export type RailDirection = -1 | 1;

export class MultiBoxController {
    focusedId: number | null = null;

    private slots: Slot[] = [];
    private nextId = 1;

    constructor(
        private ops: SlotOps,
        private loginCoordination: LoginCoordination = new LoginCoordinator()
    ) {}

    // A bot is added empty — its login is typed into the bot's own panel, so there
    // is nothing to prompt for here. `account` is for automation, which injects
    // credentials and arms auto-login (creds must land before auto-login is armed).
    add(account?: Account): SlotSnapshot | null {
        const acct: Account = account ?? { username: `bot${this.nextId}`, password: '' };
        if (acct.username.length === 0) {
            return null;
        }
        if (this.slots.some(s => s.account.username === acct.username)) {
            return null;
        }
        const handle = this.ops.spawn(acct);
        handle.setLoginCoordination(this.loginCoordination);
        const slot: Slot = { id: this.nextId++, account: acct, handle, mode: 'background' };
        this.slots.push(slot);
        if (account) {
            handle.setCredentials(acct.username, acct.password);
        }
        // a new bot is what you want to look at — it still needs its login
        this.focusedId = slot.id;
        this.applyModes();
        if (account) {
            handle.setAutoLogin(true);
        }
        return this.snap(slot);
    }

    remove(id: number): void {
        const slot = this.slots.find(s => s.id === id);
        if (!slot) {
            return;
        }
        slot.handle.destroy();
        this.slots = this.slots.filter(s => s.id !== id);
        if (this.focusedId === id) {
            this.focusedId = null;
        }
        if (this.slots.length === 1) {
            this.focusedId = this.slots[0].id;
        }
        this.applyModes();
    }

    focus(id: number): void {
        if (!this.slots.some(s => s.id === id)) {
            return;
        }
        this.focusedId = id;
        this.applyModes();
    }

    focusAdjacent(direction: RailDirection): boolean {
        const current = this.slots.findIndex(s => s.id === this.focusedId);
        const target = this.slots[current + direction];
        if (current < 0 || !target) {
            return false;
        }
        this.focus(target.id);
        return true;
    }

    moveFocused(direction: RailDirection): boolean {
        const current = this.slots.findIndex(s => s.id === this.focusedId);
        if (current < 0) {
            return false;
        }
        return this.move(this.slots[current].id, current + direction);
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

    private applyModes(): void {
        // exactly one slot is focused whenever any exist; the rest render live
        // (background) so their rail thumbnails keep painting.
        if (this.slots.length > 0 && !this.slots.some(s => s.id === this.focusedId)) {
            this.focusedId = this.slots[0].id;
        }
        for (const s of this.slots) {
            this.setMode(s, s.id === this.focusedId ? 'focused' : 'background');
        }
    }

    private setMode(slot: Slot, mode: RenderMode): void {
        slot.mode = mode;
        slot.handle.setRenderMode(mode);
    }

    private snap(slot: Slot): SlotSnapshot {
        return { id: slot.id, username: slot.account.username, focused: slot.id === this.focusedId, mode: slot.mode, ...slot.handle.status() };
    }
}
