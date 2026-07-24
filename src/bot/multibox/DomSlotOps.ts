import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';

const LOGICAL_W = 1100;
const LOGICAL_H = 620;
const THUMB_W = 300;

interface Lcb {
    client: { constructor: { loopCycle: number } };
    reader: { ingame(): boolean };
    renderGate: { drawn: number };
    runner: { state: string };
    setRenderMode(mode: RenderMode): void;
    setCredentials(u: string, p: string): void;
    setAutoLogin(on: boolean): void;
}
interface LcbWindow extends Window { rs2b0t?: Lcb; }

class DomSlotHandle implements SlotHandle {
    readonly el: HTMLDivElement;

    private scaler: HTMLDivElement;
    private iframe: HTMLIFrameElement;
    private win: LcbWindow | null = null;
    private pending: Array<(l: Lcb) => void> = [];
    private destroyed = false;
    private mode: RenderMode = 'background';
    private onResize = (): void => this.applyLayout();

    constructor(account: Account) {
        this.el = document.createElement('div');
        this.el.className = 'mbx-slot';
        this.scaler = document.createElement('div');
        this.scaler.className = 'mbx-scaler';
        this.iframe = document.createElement('iframe');
        this.iframe.className = 'mbx-frame';
        this.iframe.title = account.username;
        const q = new URLSearchParams(location.search);
        const forwarded = new URLSearchParams();
        for (const k of ['nodeid', 'members'] as const) {
            if (q.has(k)) {
                forwarded.set(k, q.get(k)!);
            }
        }
        // per-account storage namespace — isolates each iframe's creds/settings
        // even though same-origin iframes share one sessionStorage (see box.ts)
        forwarded.set('box', account.username);
        const qs = forwarded.toString();
        this.iframe.src = qs ? `/bot.html?${qs}` : '/bot.html';
        this.scaler.appendChild(this.iframe);
        this.el.appendChild(this.scaler);
        this.applyLayout();
        this.poll();
    }

    setRenderMode(mode: RenderMode): void {
        this.mode = mode;
        this.whenReady(l => l.setRenderMode(mode));
        this.applyLayout();
    }

    setCredentials(u: string, p: string): void {
        this.whenReady(l => l.setCredentials(u, p));
    }

    setAutoLogin(on: boolean): void {
        this.whenReady(l => l.setAutoLogin(on));
    }

    status(): SlotStatus {
        const l = this.win?.rs2b0t;
        if (!l) {
            return { ready: false, ingame: false, loopCycle: 0, drawn: 0, scriptState: 'idle' };
        }
        return { ready: true, ingame: l.reader.ingame(), loopCycle: l.client.constructor.loopCycle, drawn: l.renderGate.drawn, scriptState: l.runner.state };
    }

    destroy(): void {
        this.destroyed = true;
        window.removeEventListener('resize', this.onResize);
        this.el.remove();
    }

    private poll = (): void => {
        if (this.destroyed) {
            return;
        }
        const w = this.iframe.contentWindow as LcbWindow | null;
        if (w?.rs2b0t) {
            this.win = w;
            const flush = this.pending;
            this.pending = [];
            for (const fn of flush) fn(w.rs2b0t);
            return;
        }
        window.setTimeout(this.poll, 50);
    };

    private whenReady(fn: (l: Lcb) => void): void {
        if (this.win?.rs2b0t) {
            fn(this.win.rs2b0t);
        } else {
            this.pending.push(fn);
        }
    }

    private applyLayout(): void {
        const focused = this.mode === 'focused';
        this.el.classList.toggle('is-focused', focused);
        this.el.classList.toggle('is-hidden', this.mode === 'hidden');
        if (focused) {
            const k = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
            const dx = (window.innerWidth - LOGICAL_W * k) / 2;
            const dy = (window.innerHeight - LOGICAL_H * k) / 2;
            this.scaler.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
            window.addEventListener('resize', this.onResize);
        } else {
            this.scaler.style.transform = `scale(${THUMB_W / LOGICAL_W})`;
            window.removeEventListener('resize', this.onResize);
        }
    }
}

export class DomSlotOps implements SlotOps {
    constructor(private wallEl: HTMLElement, private beforeEl: HTMLElement) {}

    spawn(account: Account): SlotHandle {
        const handle = new DomSlotHandle(account);
        this.wallEl.insertBefore(handle.el, this.beforeEl);
        return handle;
    }
}
