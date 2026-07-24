import { describe, expect, test } from 'bun:test';
import { MultiBoxController } from '#/bot/multibox/MultiBoxController.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from '#/bot/multibox/types.js';

class FakeHandle implements SlotHandle {
    calls: string[] = [];
    mode: RenderMode = 'background';
    destroyed = false;
    setRenderMode(m: RenderMode): void { this.mode = m; this.calls.push(`mode:${m}`); }
    setCredentials(u: string): void { this.calls.push(`creds:${u}`); }
    setAutoLogin(on: boolean): void { this.calls.push(`autoLogin:${on}`); }
    status(): SlotStatus { return { ready: true, ingame: false, player: null, loopCycle: 0, drawn: 0, scriptState: 'idle' }; }
    destroy(): void { this.destroyed = true; this.calls.push('destroy'); }
}
class FakeOps implements SlotOps {
    handles: FakeHandle[] = [];
    spawn(_a: Account): SlotHandle { const h = new FakeHandle(); this.handles.push(h); return h; }
}

describe('MultiBoxController', () => {
    test('add takes no account: the bot starts empty, with no creds and no auto-login', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const snap = c.add();
        expect(snap?.username).toBe('bot1');
        expect(ops.handles[0].calls).toEqual(['mode:focused']);
    });

    test('auto-labelled bots stay distinct', () => {
        const c = new MultiBoxController(new FakeOps());
        expect(c.add()?.username).toBe('bot1');
        expect(c.add()?.username).toBe('bot2');
        expect(c.snapshot().length).toBe(2);
    });

    test('an explicit account (automation) injects creds before arming auto-login', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const snap = c.add({ username: 'alice', password: 'x' });
        expect(snap?.username).toBe('alice');
        expect(ops.handles[0].calls).toEqual(['creds:alice', 'mode:focused', 'autoLogin:true']);
    });

    test('a newly added bot becomes the focused one', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        c.add();
        const b = c.add()!;
        expect(c.focusedId).toBe(b.id);
        expect(ops.handles[0].mode).toBe('background');
        expect(ops.handles[1].mode).toBe('focused');
    });

    test('removing the focused bot refocuses a survivor', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const a = c.add()!;
        const b = c.add()!;
        c.focus(a.id);
        c.remove(a.id);
        expect(c.focusedId).toBe(b.id);
        expect(ops.handles[1].mode).toBe('focused');
    });

    test('add rejects an empty username', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        expect(c.add({ username: '', password: 'x' })).toBeNull();
        expect(ops.handles.length).toBe(0);
    });

    test('add rejects a duplicate live username', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        expect(c.add({ username: 'dup', password: 'x' })?.username).toBe('dup');
        expect(c.add({ username: 'dup', password: 'x' })).toBeNull();
        expect(ops.handles.length).toBe(1);
    });

    test('focus sets the target focused and the rest background', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const a = c.add()!;
        c.add();
        c.focus(a.id);
        expect(ops.handles[0].mode).toBe('focused');
        expect(ops.handles[1].mode).toBe('background');
        expect(c.focusedId).toBe(a.id);
    });

    test('exactly one bot is focused and the rest background while any exist', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        c.add();
        c.add();
        c.add();
        const modes = ops.handles.map(h => h.mode);
        expect(modes.filter(m => m === 'focused').length).toBe(1);
        expect(modes.filter(m => m === 'background').length).toBe(2);
        expect(c.focusedId).not.toBeNull();
    });

    test('remove destroys the handle and unfocuses when the last bot goes', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const a = c.add()!;
        c.remove(a.id);
        expect(ops.handles[0].destroyed).toBe(true);
        expect(c.focusedId).toBeNull();
        expect(c.snapshot()).toEqual([]);
    });
});
