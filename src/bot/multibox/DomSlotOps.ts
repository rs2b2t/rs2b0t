import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import { paintThumbnail } from './ThumbnailPainter.js';

const LOGICAL_W = 1100;
const LOGICAL_H = 620;

// Must match multibox.html: #mbx-rail width and .mbx-clip size.
const RAIL_W = 264;
const TILE_W = 236;
const TILE_H = 155;

// bot.html geometry: #rs2b0t-root is a flex row [game-wrap | 8px gap | 330px panel];
// #game-stage is the largest 765:503 box centered in game-wrap. We derive where the
// game canvas sits inside the 1100x620 client so a thumbnail can crop to just the game.
const PANEL_W = 330;
const ROOT_GAP = 8;
const STAGE_W = 765;
const STAGE_H = 503;
const WRAP_W = LOGICAL_W - PANEL_W - ROOT_GAP;
const STAGE_K = Math.min(WRAP_W / STAGE_W, LOGICAL_H / STAGE_H);
const GAME_W = STAGE_W * STAGE_K;
const GAME_H = STAGE_H * STAGE_K;
const GAME_X = (WRAP_W - GAME_W) / 2;
const GAME_Y = (LOGICAL_H - GAME_H) / 2;

// cover-fit that game region into a rail tile (scaler transform-origin is top-left)
const CROP_K = Math.max(TILE_W / GAME_W, TILE_H / GAME_H);
const CROP_TX = TILE_W / 2 - (GAME_X + GAME_W / 2) * CROP_K;
const CROP_TY = TILE_H / 2 - (GAME_Y + GAME_H / 2) * CROP_K;
const CROP_TRANSFORM = `translate(${CROP_TX}px, ${CROP_TY}px) scale(${CROP_K})`;

// docs/MULTIBOX.md#slots-and-iframes
// Rail (background) slots paint at ~1fps so many bots stay cheap on a laptop; the
// focused slot ignores this and draws every frame. Set per-iframe at runtime — the
// standalone single-instance client keeps its own RenderGate default.
const RAIL_BACKGROUND_INTERVAL_MS = 1000;

function railWidth(): number {
    return document.getElementById('mbx-rail')?.offsetWidth ?? RAIL_W;
}

interface Lcb {
    client: { constructor: { loopCycle: number } };
    reader: { ingame(): boolean; localPlayerName(): string | null };
    renderGate: { drawn: number; backgroundIntervalMs: number };
    runner: { state: string };
    setRenderMode(mode: RenderMode): void;
    startSelectedScript(): void;
    stopScript(): void;
    setRendererEnabled(enabled: boolean): void;
    setCredentials(u: string, p: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
}
interface LcbWindow extends Window { rs2b0t?: Lcb; }

class DomSlotHandle implements SlotHandle {
    readonly el: HTMLDivElement;

    private scaler: HTMLDivElement;
    private iframe: HTMLIFrameElement;
    private mirror: HTMLCanvasElement;
    private mirrorTimer: number;
    private win: LcbWindow | null = null;
    private pending: Array<(l: Lcb) => void> = [];
    private destroyed = false;
    private mode: RenderMode = 'background';
    private onResize = (): void => this.applyLayout();

    constructor(account: Account) {
        this.el = document.createElement('div');
        this.el.className = 'mbx-slot';
        this.el.draggable = true;

        const cap = document.createElement('div');
        cap.className = 'mbx-cap';
        const dot = document.createElement('span');
        dot.className = 'mbx-dot';
        const name = document.createElement('span');
        name.className = 'mbx-name';
        name.textContent = account.username;
        const close = document.createElement('button');
        close.className = 'mbx-close';
        close.type = 'button';
        close.title = 'remove bot';
        close.textContent = '✕';
        cap.append(dot, name, close);

        const body = document.createElement('div');
        body.className = 'mbx-body';
        const clip = document.createElement('div');
        clip.className = 'mbx-clip';
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
        this.iframe.src = new URL('bot.html' + (qs ? `?${qs}` : ''), document.baseURI).href;
        this.scaler.appendChild(this.iframe);
        clip.appendChild(this.scaler);

        // The focused bot's live iframe is lifted over the main pane, so its rail
        // tile mirrors that canvas instead — every bot stays visible in the rail.
        this.mirror = document.createElement('canvas');
        this.mirror.className = 'mbx-mirror';
        this.mirror.width = TILE_W;
        this.mirror.height = TILE_H;

        // An iframe swallows clicks, so the rail would never see them; this overlay
        // sits above it and lets a tile click switch which bot is active.
        const hit = document.createElement('div');
        hit.className = 'mbx-hit';

        body.append(clip, this.mirror, hit);
        this.el.append(cap, body);
        this.mirrorTimer = window.setInterval(this.paintMirror, 1000);
        this.applyLayout();
        this.poll();
    }

    setRenderMode(mode: RenderMode): void {
        this.mode = mode;
        this.whenReady(l => {
            l.renderGate.backgroundIntervalMs = RAIL_BACKGROUND_INTERVAL_MS;
            l.setRenderMode(mode);
        });
        this.applyLayout();
    }

    startScript(): void {
        this.whenReady(l => l.startSelectedScript());
    }

    stopScript(): void {
        this.whenReady(l => l.stopScript());
    }

    setRendererEnabled(enabled: boolean): void {
        this.whenReady(l => l.setRendererEnabled(enabled));
    }

    setCredentials(u: string, p: string): void {
        this.whenReady(l => l.setCredentials(u, p));
    }

    setAutoLogin(on: boolean): void {
        this.whenReady(l => l.setAutoLogin(on));
    }

    setLoginCoordination(coordination: LoginCoordination | null): void {
        this.whenReady(l => l.setLoginCoordination(coordination));
    }

    status(): SlotStatus {
        const l = this.win?.rs2b0t;
        if (!l) {
            return { ready: false, ingame: false, player: null, loopCycle: 0, drawn: 0, scriptState: 'idle' };
        }
        return { ready: true, ingame: l.reader.ingame(), player: l.reader.localPlayerName(), loopCycle: l.client.constructor.loopCycle, drawn: l.renderGate.drawn, scriptState: l.runner.state };
    }

    destroy(): void {
        this.destroyed = true;
        window.clearInterval(this.mirrorTimer);
        window.removeEventListener('resize', this.onResize);
        this.el.remove();
    }

    private paintMirror = (): void => {
        if (this.mode !== 'focused' || railWidth() === 0) {
            return;
        }
        const doc = this.iframe.contentDocument;
        const game = doc?.getElementById('canvas') as HTMLCanvasElement | null;
        const overlay = doc?.getElementById('overlay') as HTMLCanvasElement | null;
        paintThumbnail(this.mirror.getContext('2d')!, game, overlay, TILE_W, TILE_H);
    };

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
        if (focused) {
            // fill the main pane (viewport minus the rail), centered, whole client visible
            const mainW = window.innerWidth - railWidth();
            const mainH = window.innerHeight;
            const k = Math.min(mainW / LOGICAL_W, mainH / LOGICAL_H);
            const dx = (mainW - LOGICAL_W * k) / 2;
            const dy = (mainH - LOGICAL_H * k) / 2;
            this.scaler.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
            window.addEventListener('resize', this.onResize);
        } else {
            // rail thumbnail: crop the client to just the game viewport
            this.scaler.style.transform = CROP_TRANSFORM;
            window.removeEventListener('resize', this.onResize);
        }
    }
}

function flexOrder(el: HTMLElement): number {
    const order = Number.parseInt(el.style.order, 10);
    return Number.isFinite(order) ? order : 0;
}

/**
 * Return rail slots in their visual flex order. Their DOM order deliberately
 * stays fixed because moving an iframe ancestor reloads its browsing context in
 * Firefox.
 */
export function orderedSlotElements(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => flexOrder(a) - flexOrder(b));
}

export class DomSlotOps implements SlotOps {
    constructor(private railEl: HTMLElement, private beforeEl: HTMLElement) {}

    spawn(account: Account): SlotHandle {
        const handle = new DomSlotHandle(account);
        this.railEl.insertBefore(handle.el, this.beforeEl);
        this.applyVisualOrder(orderedSlotElements(this.railEl));
        return handle;
    }

    move(handle: SlotHandle, before: SlotHandle | null): void {
        const moving = handle as DomSlotHandle;
        const target = before as DomSlotHandle | null;
        const slots = orderedSlotElements(this.railEl);
        const fromIndex = slots.indexOf(moving.el);
        if (fromIndex < 0 || target === moving) {
            return;
        }

        slots.splice(fromIndex, 1);
        const toIndex = target === null ? slots.length : slots.indexOf(target.el);
        if (toIndex < 0) {
            return;
        }
        slots.splice(toIndex, 0, moving.el);
        this.applyVisualOrder(slots);
    }

    private applyVisualOrder(slots: HTMLElement[]): void {
        // Negative values keep every slot before the add/resources controls,
        // whose default flex order is zero.
        const first = -slots.length;
        slots.forEach((slot, index) => {
            slot.style.order = String(first + index);
        });
    }
}
