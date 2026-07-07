import { describe, expect, test } from 'bun:test';
import { MultiBoxController } from './MultiBoxController.js';
import { AccountRoster } from './AccountRoster.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';

class FakeHandle implements SlotHandle {
    calls: string[] = [];
    mode: RenderMode = 'background';
    destroyed = false;
    setRenderMode(m: RenderMode): void { this.mode = m; this.calls.push(`mode:${m}`); }
    setCredentials(u: string): void { this.calls.push(`creds:${u}`); }
    setAutoLogin(on: boolean): void { this.calls.push(`autoLogin:${on}`); }
    status(): SlotStatus { return { ready: true, ingame: false, loopCycle: 0, drawn: 0, scriptState: 'idle' }; }
    destroy(): void { this.destroyed = true; this.calls.push('destroy'); }
}
class FakeOps implements SlotOps {
    handles: FakeHandle[] = [];
    spawn(_a: Account): SlotHandle { const h = new FakeHandle(); this.handles.push(h); return h; }
}
function roster(...users: string[]): AccountRoster {
    const r = new AccountRoster(null);
    for (const u of users) r.add({ username: u, password: 'x' });
    return r;
}

describe('MultiBoxController', () => {
    test('add claims an account and injects creds before arming auto-login', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice'));
        const snap = c.add();
        expect(snap?.username).toBe('alice');
        // order matters: creds must precede autoLogin (credential isolation).
        // a lone bot auto-focuses (single bot = focused 1-cell wall).
        expect(ops.handles[0].calls).toEqual(['creds:alice', 'mode:focused', 'autoLogin:true']);
    });

    test('a lone bot auto-focuses (fullscreen single-bot view)', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice', 'bob'));
        const a = c.add()!;
        expect(c.focusedId).toBe(a.id);
        expect(ops.handles[0].mode).toBe('focused');
        // a second bot joins without stealing focus (stays hidden behind it)
        c.add();
        expect(ops.handles[1].mode).toBe('hidden');
    });

    test('removing down to one bot refocuses the survivor', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice', 'bob'));
        const a = c.add()!;
        const b = c.add()!;
        c.showWall();
        expect(c.focusedId).toBeNull();
        c.remove(a.id); // one bot left → it becomes the focused solo view
        expect(c.focusedId).toBe(b.id);
        expect(ops.handles[1].mode).toBe('focused');
    });

    test('add returns null when the roster is exhausted', () => {
        const c = new MultiBoxController(new FakeOps(), roster('alice'));
        expect(c.add()?.username).toBe('alice');
        expect(c.add()).toBeNull();
    });

    test('adding while a bot is focused hides the new bot', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice', 'bob'));
        const a = c.add()!;
        c.focus(a.id);
        c.add(); // bob, added while focused
        expect(ops.handles[1].mode).toBe('hidden');
    });

    test('add rejects an empty username', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster());
        expect(c.add({ username: '', password: 'x' })).toBeNull();
        expect(ops.handles.length).toBe(0);
    });

    test('add rejects a duplicate live username', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster());
        expect(c.add({ username: 'dup', password: 'x' })?.username).toBe('dup');
        expect(c.add({ username: 'dup', password: 'x' })).toBeNull();
        expect(ops.handles.length).toBe(1);
    });

    test('focus sets the target focused and the rest hidden', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice', 'bob'));
        c.add();
        const b = c.add()!;
        c.focus(b.id);
        expect(ops.handles[0].mode).toBe('hidden');
        expect(ops.handles[1].mode).toBe('focused');
        expect(c.focusedId).toBe(b.id);
    });

    test('showWall returns every bot to background', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops, roster('alice', 'bob'));
        const a = c.add()!;
        c.add();
        c.focus(a.id);
        c.showWall();
        expect(ops.handles.every(h => h.mode === 'background')).toBe(true);
        expect(c.focusedId).toBeNull();
    });

    test('remove destroys the handle, frees the account, and unfocuses', () => {
        const ops = new FakeOps();
        const rr = roster('alice');
        const c = new MultiBoxController(ops, rr);
        const a = c.add()!;
        c.focus(a.id);
        c.remove(a.id);
        expect(ops.handles[0].destroyed).toBe(true);
        expect(c.focusedId).toBeNull();
        expect(c.snapshot()).toEqual([]);
        // account released → claimable again
        expect(c.add()?.username).toBe('alice');
    });
});
