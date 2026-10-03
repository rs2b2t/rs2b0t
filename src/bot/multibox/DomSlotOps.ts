import { botFrameUrl, type WorldNumber } from '../../client/config/worlds.js';
import { supportsWorldRouting } from '../../client/config/target.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import { paintThumbnail } from './ThumbnailPainter.js';

const LOGICAL_W = 1100;
const LOGICAL_H = 620;

// Must match multibox.html: #mbx-rail width and .mbx-clip size.
const RAIL_W = 264;
const TILE_W = 236;
const TILE_H = 155;

// bot.html uses [game-wrap | 8px gap | 330px panel] inside the 1100x620 client.
// game-stage is the largest centered 765:503 box in game-wrap.
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

// Cover-fit the game region into a rail tile from the top-left origin.
const CROP_K = Math.max(TILE_W / GAME_W, TILE_H / GAME_H);
const CROP_TX = TILE_W / 2 - (GAME_X + GAME_W / 2) * CROP_K;
const CROP_TY = TILE_H / 2 - (GAME_Y + GAME_H / 2) * CROP_K;
const CROP_TRANSFORM = `translate(${CROP_TX}px, ${CROP_TY}px) scale(${CROP_K})`;

// docs/reference/multibox.md#slots
// Rail (background) slots paint at ~1fps while the focused slot draws every frame.
// Why: many bots stay cheap on a laptop, and setting it per-iframe leaves the standalone client its own RenderGate default.
const RAIL_BACKGROUND_INTERVAL_MS = 1000;

function railWidth(): number {
    return document.getElementById('mbx-rail')?.offsetWidth ?? RAIL_W;
}

interface Lcb {
    readonly world: WorldNumber | null;
    prepareWorldSwitch(): boolean;
    cancelWorldSwitch(): void;
    client: { constructor: { loopCycle: number } };
    reader: { ingame(): boolean; localPlayerName(): string | null };
    renderGate: { drawn: number; backgroundIntervalMs: number };
    runner: { state: string; meta: { name: string } | null };
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
    private pollTimer: number | null = null;
    private win: LcbWindow | null = null;
    private pending: Array<(l: Lcb) => void> = [];
    private destroyed = false;
    private mode: RenderMode = 'background';
    private onResize = (): void => this.applyLayout();

    constructor(private account: Account, private worldRouting: boolean) {
        this.el = document.createElement('div');
        this.el.className = 'mbx-slot';
        this.el.draggable = true;
        if (!worldRouting) this.el.dataset.localEngine = 'true';

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

        const controls = document.createElement('div');
        controls.className = 'mbx-world-controls';
        const select = document.createElement('select');
        select.className = 'mbx-world-select';
        select.setAttribute('aria-label', `World for ${account.username}`);
        for (const world of [1, 2]) {
            const option = document.createElement('option');
            option.value = String(world);
            option.textContent = `World ${world}`;
            select.appendChild(option);
        }
        select.value = String(account.world ?? 1);
        const change = document.createElement('button');
        change.className = 'mbx-world-switch';
        change.type = 'button';
        change.textContent = 'Switch';
        select.addEventListener('change', () => {
            if (select.disabled) return;
            change.disabled = select.value === (select.dataset.worldState?.split(':')[0] ?? String(this.account.world ?? 1));
        });
        const cancel = document.createElement('button');
        cancel.className = 'mbx-world-cancel';
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.hidden = true;
        controls.append(select, change, cancel);
        const scriptStatus = document.createElement('div');
        scriptStatus.className = 'mbx-script-status';
        scriptStatus.setAttribute('aria-live', 'polite');

        const body = document.createElement('div');
        body.className = 'mbx-body';
        const clip = document.createElement('div');
        clip.className = 'mbx-clip';
        this.scaler = document.createElement('div');
        this.scaler.className = 'mbx-scaler';
        this.iframe = this.createFrame(account.world);
        this.scaler.appendChild(this.iframe);
        clip.appendChild(this.scaler);

        // The focused bot's live iframe is lifted over the main pane, so its rail
        // tile mirrors that canvas instead, every bot stays visible in the rail.
        this.mirror = document.createElement('canvas');
        this.mirror.className = 'mbx-mirror';
        this.mirror.width = TILE_W;
        this.mirror.height = TILE_H;

        // An iframe swallows clicks, so the rail would never see them; this overlay
        // sits above it and lets a tile click switch which bot is active.
        const hit = document.createElement('div');
        hit.className = 'mbx-hit';

        body.append(clip, this.mirror, hit);
        this.el.append(cap);
        if (worldRouting) this.el.append(controls);
        this.el.append(scriptStatus, body);
        this.mirrorTimer = window.setInterval(this.paintMirror, 1000);
        this.applyLayout();
        this.poll();
    }

    reloadWorld(world: WorldNumber): void {
        if (this.destroyed || !this.worldRouting) return;
        const frame = this.createFrame(world, true);
        if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
        this.win = null;
        this.pending = [];
        this.iframe.replaceWith(frame);
        this.iframe = frame;
        this.account = { ...this.account, world };
        this.poll();
    }

    private createFrame(world?: WorldNumber, switching = false): HTMLIFrameElement {
        const frame = document.createElement('iframe');
        frame.className = 'mbx-frame';
        frame.title = this.account.username;
        const wall = new URL(location.href);
        if (!this.worldRouting) wall.searchParams.delete('world');
        const url = botFrameUrl(wall, this.account.username, this.worldRouting ? world : undefined);
        if (switching) url.searchParams.set('autologin', '0');
        frame.src = url.href;
        return frame;
    }

    cancelWorldSwitch(): void {
        if (!this.worldRouting) return;
        this.whenReady(l => l.cancelWorldSwitch());
    }

    prepareWorldSwitch(): boolean {
        if (!this.worldRouting) return false;
        if (!this.win?.rs2b0t) {
            return false;
        }
        return this.win.rs2b0t.prepareWorldSwitch();
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
            return { ready: false, ingame: false, world: null, player: null, loopCycle: 0, drawn: 0, scriptState: 'idle', scriptName: null };
        }
        const ingame = l.reader.ingame();
        const world = ingame && (l.world === 1 || l.world === 2) ? l.world : null;
        return { ready: true, ingame, world, player: l.reader.localPlayerName(), loopCycle: l.client.constructor.loopCycle, drawn: l.renderGate.drawn, scriptState: l.runner.state, scriptName: l.runner.meta?.name ?? null };
    }

    destroy(): void {
        this.destroyed = true;
        window.clearInterval(this.mirrorTimer);
        if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
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
        this.pollTimer = window.setTimeout(this.poll, 50);
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
            // Fill the main pane (viewport minus the rail): contain-fit keeps the 1100×620 client visible, letterboxing empty space.
            // Why: map-picker chrome must fit inside the 620px client, see WorldMapPicker.
            const mainW = window.innerWidth - railWidth();
            const mainH = window.innerHeight;
            const k = Math.min(mainW / LOGICAL_W, mainH / LOGICAL_H);
            const dx = (mainW - LOGICAL_W * k) / 2;
            const dy = (mainH - LOGICAL_H * k) / 2;
            this.scaler.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
            window.addEventListener('resize', this.onResize);
        } else {
            // rail thumbnail: crop the client to the game viewport alone
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
 * Return rail slots in their visual flex order.
 * Why: their DOM order stays fixed because moving an iframe ancestor reloads its browsing context in Firefox.
 */
export function orderedSlotElements(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => flexOrder(a) - flexOrder(b));
}

export class DomSlotOps implements SlotOps {
    constructor(private railEl: HTMLElement, private beforeEl: HTMLElement, private worldRouting = supportsWorldRouting()) {}

    spawn(account: Account): SlotHandle {
        const handle = new DomSlotHandle(account, this.worldRouting);
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
