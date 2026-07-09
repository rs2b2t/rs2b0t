import type { AccountRoster } from './AccountRoster.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotSnapshot } from './types.js';

interface Slot {
    id: number;
    account: Account;
    handle: SlotHandle;
    mode: RenderMode;
}

/**
 * Pure orchestration for the wall (no DOM — DOM lives behind SlotOps). Owns
 * the slot list + focus state and drives per-slot render modes: wall view →
 * everyone `background`; one focused → focused bot `focused`, the rest
 * `hidden`. On add, creds are injected before auto-login is armed.
 *
 * A lone bot auto-focuses (fullscreen): a single bot is just a focused 1-cell
 * wall, so the wall doubles as the standalone single-bot client — dropping to
 * one bot refocuses it, and going to zero returns to the (empty) wall.
 */
export class MultiBoxController {
    focusedId: number | null = null;

    private slots: Slot[] = [];
    private nextId = 1;

    constructor(private ops: SlotOps, private roster: AccountRoster) {}

    add(account?: Account): SlotSnapshot | null {
        const acct = account ?? this.roster.claimNext();
        // reject no-account, empty username (would fall back to the shared
        // rs2b0t:creds key), and a username already live in another slot (would
        // double-spawn the same account) — both defeat credential isolation.
        if (!acct || acct.username.length === 0) {
            return null;
        }
        if (this.slots.some(s => s.account.username === acct.username)) {
            return null;
        }
        const handle = this.ops.spawn(acct);
        const slot: Slot = { id: this.nextId++, account: acct, handle, mode: 'background' };
        this.slots.push(slot);
        // credential isolation: inject BEFORE arming auto-login so the shared
        // rs2b0t:creds fallback is never consulted (constraint #4).
        handle.setCredentials(acct.username, acct.password);
        // the first bot is a focused 1-cell wall (the single-bot client);
        // later bots join the wall, or stay hidden behind whatever is focused.
        if (this.slots.length === 1) {
            this.focusedId = slot.id;
        }
        this.applyModes();
        handle.setAutoLogin(true);
        return this.snap(slot);
    }

    remove(id: number): void {
        const slot = this.slots.find(s => s.id === id);
        if (!slot) {
            return;
        }
        slot.handle.destroy();
        this.roster.release(slot.account.username);
        this.slots = this.slots.filter(s => s.id !== id);
        if (this.focusedId === id) {
            this.focusedId = null;
        }
        // back down to a lone bot → refocus it (solo = fullscreen); to zero →
        // the empty wall.
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

    showWall(): void {
        this.focusedId = null;
        this.applyModes();
    }

    snapshot(): SlotSnapshot[] {
        return this.slots.map(s => this.snap(s));
    }

    /** Reconcile every slot's render mode from the current focus state. */
    private applyModes(): void {
        for (const s of this.slots) {
            this.setMode(s, this.focusedId === null ? 'background' : s.id === this.focusedId ? 'focused' : 'hidden');
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
