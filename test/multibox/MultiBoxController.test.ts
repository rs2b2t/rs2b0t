import { describe, expect, test } from 'bun:test';
import { MultiBoxController } from '#/bot/multibox/MultiBoxController.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from '#/bot/multibox/types.js';
import type { LoginCoordination } from '#/bot/runtime/LoginCoordination.js';

class FakeHandle implements SlotHandle {
    calls: string[] = [];
    mode: RenderMode = 'background';
    destroyed = false;
    loginCoordination: LoginCoordination | null = null;
    setRenderMode(m: RenderMode): void { this.mode = m; this.calls.push(`mode:${m}`); }
    startScript(): void { this.calls.push('start'); }
    stopScript(): void { this.calls.push('stop'); }
    setRendererEnabled(enabled: boolean): void { this.calls.push(`renderer:${enabled}`); }
    setCredentials(u: string): void { this.calls.push(`creds:${u}`); }
    setAutoLogin(on: boolean): void { this.calls.push(`autoLogin:${on}`); }
    setLoginCoordination(coordination: LoginCoordination | null): void {
        this.loginCoordination = coordination;
        this.calls.push('loginCoordination');
    }
    status(): SlotStatus { return { ready: true, ingame: false, player: null, loopCycle: 0, drawn: 0, scriptState: 'idle' }; }
    destroy(): void { this.destroyed = true; this.calls.push('destroy'); }
}
class FakeOps implements SlotOps {
    handles: FakeHandle[] = [];
    spawn(_a: Account): SlotHandle { const h = new FakeHandle(); this.handles.push(h); return h; }
    move(handle: SlotHandle, before: SlotHandle | null): void {
        const fromIndex = this.handles.indexOf(handle as FakeHandle);
        const [moving] = this.handles.splice(fromIndex, 1);
        const toIndex = before === null ? this.handles.length : this.handles.indexOf(before as FakeHandle);
        this.handles.splice(toIndex, 0, moving);
    }
}

describe('MultiBoxController', () => {
    test('add takes no account: the bot starts empty, with no creds and no auto-login', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const snap = c.add();
        expect(snap?.username).toBe('bot1');
        expect(ops.handles[0].calls).toEqual(['loginCoordination', 'mode:focused']);
    });

    test('auto-labelled bots stay distinct', () => {
        const c = new MultiBoxController(new FakeOps());
        expect(c.add()?.username).toBe('bot1');
        expect(c.add()?.username).toBe('bot2');
        expect(c.snapshot().length).toBe(2);
    });

    test('every bot receives the same wall-level login coordinator', () => {
        const ops = new FakeOps();
        const coordination: LoginCoordination = { requestPermit: () => true, holdFor: () => {} };
        const c = new MultiBoxController(ops, coordination);
        c.add();
        c.add();
        expect(ops.handles[0].loginCoordination).toBe(coordination);
        expect(ops.handles[1].loginCoordination).toBe(coordination);
    });

    test('an explicit account (automation) injects creds before arming auto-login', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const snap = c.add({ username: 'alice', password: 'x' });
        expect(snap?.username).toBe('alice');
        expect(ops.handles[0].calls).toEqual(['loginCoordination', 'creds:alice', 'mode:focused', 'autoLogin:true']);
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

    test('focusAdjacent selects exactly one neighbouring bot', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const alice = c.add({ username: 'alice', password: 'a' })!;
        const bob = c.add({ username: 'bob', password: 'b' })!;
        const carol = c.add({ username: 'carol', password: 'c' })!;
        c.focus(bob.id);

        expect(c.focusAdjacent(-1)).toBe(true);
        expect(c.focusedId).toBe(alice.id);
        expect(c.focusAdjacent(-1)).toBe(false);
        expect(c.focusAdjacent(1)).toBe(true);
        expect(c.focusedId).toBe(bob.id);
        expect(c.focusAdjacent(1)).toBe(true);
        expect(c.focusedId).toBe(carol.id);
        expect(ops.handles.filter(handle => handle.mode === 'focused')).toHaveLength(1);
    });

    test('moveFocused reorders one slot and keeps that bot focused', () => {
        const c = new MultiBoxController(new FakeOps());
        c.add({ username: 'alice', password: 'a' })!;
        const bob = c.add({ username: 'bob', password: 'b' })!;
        c.add({ username: 'carol', password: 'c' })!;
        c.focus(bob.id);

        expect(c.moveFocused(-1)).toBe(true);
        expect(c.snapshot().map(slot => slot.username)).toEqual(['bob', 'alice', 'carol']);
        expect(c.focusedId).toBe(bob.id);
        expect(c.moveFocused(-1)).toBe(false);
        expect(c.moveFocused(1)).toBe(true);
        expect(c.snapshot().map(slot => slot.username)).toEqual(['alice', 'bob', 'carol']);
        expect(c.focusedId).toBe(bob.id);
    });

    test('move reorders slots and their handles without changing focus', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        c.add({ username: 'alice', password: 'a' })!;
        const bob = c.add({ username: 'bob', password: 'b' })!;
        const carol = c.add({ username: 'carol', password: 'c' })!;
        c.focus(bob.id);
        const originalHandles = [...ops.handles];

        expect(c.move(carol.id, 0)).toBe(true);
        expect(c.snapshot().map(slot => slot.username)).toEqual(['carol', 'alice', 'bob']);
        expect(ops.handles).toEqual([originalHandles[2], originalHandles[0], originalHandles[1]]);
        expect(c.focusedId).toBe(bob.id);

        expect(c.move(carol.id, 2)).toBe(true);
        expect(c.snapshot().map(slot => slot.username)).toEqual(['alice', 'bob', 'carol']);
    });

    test('move rejects invalid requests and clamps valid destinations', () => {
        const c = new MultiBoxController(new FakeOps());
        const alice = c.add({ username: 'alice', password: 'a' })!;
        c.add({ username: 'bob', password: 'b' })!;

        expect(c.move(999, 0)).toBe(false);
        expect(c.move(alice.id, 0.5)).toBe(false);
        expect(c.move(alice.id, -50)).toBe(false);
        expect(c.move(alice.id, 50)).toBe(true);
        expect(c.snapshot().map(slot => slot.username)).toEqual(['bob', 'alice']);
        expect(c.move(alice.id, 50)).toBe(false);
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

    test('bulk controls act once on every bot without changing focus or render mode', () => {
        const ops = new FakeOps();
        const c = new MultiBoxController(ops);
        const alice = c.add({ username: 'alice', password: 'a' })!;
        c.add({ username: 'bob', password: 'b' })!;
        c.focus(alice.id);
        ops.handles.forEach(handle => handle.calls.splice(0));

        c.startAll();
        c.stopAll();
        c.setAllRenderers(false);
        c.setAllRenderers(true);

        expect(ops.handles.map(handle => handle.calls)).toEqual([
            ['start', 'stop', 'renderer:false', 'renderer:true'],
            ['start', 'stop', 'renderer:false', 'renderer:true']
        ]);
        expect(ops.handles.map(handle => handle.mode)).toEqual(['focused', 'background']);
        expect(c.focusedId).toBe(alice.id);
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
