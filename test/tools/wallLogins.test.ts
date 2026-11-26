import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { WallLogins } = createRequire(import.meta.url)('../../desktop/wall-logins.cjs');

test('walls share login pacing and release queued slots on renderer exit', () => {
    let now = 0;
    const logins = new WallLogins({ now: () => now });
    const attach = () => {
        const mainFrame = { url: 'http://localhost/wall' };
        const contents = Object.assign(new EventEmitter(), { mainFrame, ipc: new EventEmitter() });
        logins.attach(contents, 'http://localhost');
        const send = (action: string, delay?: number | string) => {
            const event: { senderFrame: typeof mainFrame; returnValue: unknown } = { senderFrame: mainFrame, returnValue: null };
            contents.ipc.emit('rs2b0t-login', event, 1, action, delay);
            return event.returnValue;
        };
        return { send, contents };
    };
    const a = attach();
    const b = attach();
    expect(a.send('claimProfile', 'alice')).toBe(true);
    b.send('releaseProfile', 'alice');
    expect(b.send('claimProfile', 'alice')).toBe(false);
    a.send('releaseProfile', 'alice');
    expect(b.send('claimProfile', 'alice')).toBe(true);
    expect(a.send('claimProfile', 'bob')).toBe(true);
    expect(a.send('requestPermit')).toBe(true);
    expect(a.send('requestPermit')).toBe(false);
    expect(b.send('requestPermit')).toBe(false);
    expect(b.send('queueStatus')).toEqual({ position: 2, total: 2 });
    a.contents.emit('render-process-gone');
    expect(b.send('queueStatus')).toEqual({ position: 1, total: 1 });
    expect(b.send('claimProfile', 'bob')).toBe(true);
    now = 1000;
    expect(b.send('requestPermit')).toBe(true);
    b.send('holdFor', 20000);
    const c = attach();
    now = 20000;
    expect(c.send('requestPermit')).toBe(false);
    now = 21000;
    expect(c.send('requestPermit')).toBe(true);
});
