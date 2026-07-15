/**
 * Immediate-mode interactive paint API (the iDungeon-style panel over the
 * chatbox). Call `Paint.begin(ctx, {dock})` in onPaint, then widget methods —
 * each call DRAWS and reports interaction for this frame — and finish with
 * `p.end()`, which publishes the frame's hit regions to the input capture
 * layer (clicks inside the panel go to widgets and never reach the client).
 *
 *   const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ad0ff' });
 *   p.title('RockCrab');
 *   const tab = p.tabs('main', ['Overview', 'Loot']);
 *   if (tab === 'Overview') { p.row('Kills: 4', 'XP/hr: 31k'); p.bar('HP', 0.82); }
 *   if (p.button('pause', 'Pause')) this.pause();
 *   p.end();
 *
 * Widget ids are stable strings — the cross-frame state (active tab, queued
 * clicks, collapse) is keyed by them (see paintLogic.ts). State clears when
 * the script stops.
 */
import { paintState, resolveDock, type Dock, type Rect, type Region } from '#/bot/api/hud/paintLogic.js';

export interface PaintOptions {
    dock?: Dock;
    accent?: string;
}

const FONT = '12px monospace';
const FONT_BOLD = 'bold 12px monospace';
const PAD = 8;
const LINE = 16;
const TITLE_H = 20;
const TAB_H = 18;
const BUTTON_H = 16;

const BG = 'rgba(12, 12, 14, 0.88)';
const BG_TITLE = 'rgba(28, 28, 34, 0.95)';
const BG_WIDGET = 'rgba(50, 50, 58, 0.9)';
const BG_WIDGET_HOT = 'rgba(72, 72, 84, 0.95)';
const FG = '#cdd3da';
const FG_DIM = '#8a919a';
const BORDER = 'rgba(90, 90, 100, 0.8)';

export class PaintFrame {
    private readonly regions: Region[] = [];
    private cursorY: number;
    private readonly accent: string;
    private readonly panel: Rect;
    private collapsed = false;

    constructor(
        private readonly ctx: CanvasRenderingContext2D,
        opts: PaintOptions
    ) {
        this.panel = resolveDock(opts.dock ?? 'chatbox');
        this.accent = opts.accent ?? '#7ad0ff';
        this.cursorY = this.panel.y;
        this.ctx.font = FONT;
        this.ctx.textBaseline = 'middle';
    }

    /** Title bar with a collapse toggle. Everything after a collapsed title
     *  is skipped (widgets no-op), leaving just the bar on screen. */
    title(text: string): void {
        const { x, w } = this.panel;
        const r = { x, y: this.cursorY, w, h: TITLE_H };
        this.collapsed = paintState.get('paint:collapsed', '0') === '1';

        this.ctx.fillStyle = BG_TITLE;
        this.ctx.fillRect(r.x, r.y, r.w, r.h);
        this.ctx.strokeStyle = BORDER;
        this.ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        this.ctx.font = FONT_BOLD;
        this.ctx.fillStyle = this.accent;
        this.ctx.fillText(text, r.x + PAD, r.y + r.h / 2 + 1);
        this.ctx.font = FONT;

        // collapse toggle on the right edge
        const toggle = { x: r.x + r.w - TITLE_H, y: r.y, w: TITLE_H, h: TITLE_H };
        this.ctx.fillStyle = paintState.isHovered(toggle) ? FG : FG_DIM;
        this.ctx.fillText(this.collapsed ? '+' : '–', toggle.x + 7, toggle.y + r.h / 2 + 1);
        this.regions.push({ id: 'paint:toggle', ...toggle, kind: 'widget' });
        if (paintState.consumeClick('paint:toggle')) {
            this.collapsed = !this.collapsed;
            paintState.set('paint:collapsed', this.collapsed ? '1' : '0');
        }

        this.cursorY = r.y + r.h;
        if (!this.collapsed) {
            // panel body backdrop is drawn lazily as widgets extend it; register
            // the full dock as the swallow area up-front
            this.regions.push({ id: 'paint:panel', ...this.panel, kind: 'panel' });
            this.ctx.fillStyle = BG;
            this.ctx.fillRect(this.panel.x, this.cursorY, this.panel.w, this.panel.y + this.panel.h - this.cursorY);
            this.ctx.strokeStyle = BORDER;
            this.ctx.strokeRect(this.panel.x + 0.5, this.cursorY + 0.5, this.panel.w - 1, this.panel.y + this.panel.h - this.cursorY - 1);
        } else {
            // collapsed: only the title bar swallows input
            this.regions.push({ id: 'paint:panel', x: this.panel.x, y: this.panel.y, w: this.panel.w, h: TITLE_H, kind: 'panel' });
        }
    }

    /** Tab strip; returns the active tab name. `id` keys the selection. */
    tabs(id: string, names: string[]): string {
        if (this.collapsed || names.length === 0) {
            return paintState.get(`tabs:${id}`, names[0] ?? '');
        }
        let active = paintState.get(`tabs:${id}`, names[0]);
        if (!names.includes(active)) {
            active = names[0];
        }
        let tx = this.panel.x + 4;
        const ty = this.cursorY + 3;
        for (const name of names) {
            const tw = this.ctx.measureText(name).width + 14;
            const r = { x: tx, y: ty, w: tw, h: TAB_H };
            const isActive = name === active;
            this.ctx.fillStyle = isActive ? BG_WIDGET_HOT : paintState.isHovered(r) ? BG_WIDGET : 'transparent';
            this.ctx.fillRect(r.x, r.y, r.w, r.h);
            if (isActive) {
                this.ctx.fillStyle = this.accent;
                this.ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
            }
            this.ctx.fillStyle = isActive ? '#fff' : FG_DIM;
            this.ctx.fillText(name, r.x + 7, r.y + r.h / 2 + 1);

            const regionId = `tab:${id}:${name}`;
            this.regions.push({ id: regionId, ...r, kind: 'widget' });
            if (paintState.consumeClick(regionId)) {
                active = name;
                paintState.set(`tabs:${id}`, name);
            }
            tx += tw + 2;
        }
        this.cursorY = ty + TAB_H + 2;
        return active;
    }

    /** One line of text. */
    text(line: string, color?: string): void {
        if (this.collapsed) {
            return;
        }
        this.ctx.fillStyle = color ?? FG;
        this.ctx.fillText(line, this.panel.x + PAD, this.cursorY + LINE / 2 + 1);
        this.cursorY += LINE;
    }

    /** Up to N columns on one line, split evenly across the panel. */
    row(...cols: string[]): void {
        if (this.collapsed || cols.length === 0) {
            return;
        }
        const colW = (this.panel.w - PAD * 2) / cols.length;
        this.ctx.fillStyle = FG;
        cols.forEach((col, i) => this.ctx.fillText(col, this.panel.x + PAD + i * colW, this.cursorY + LINE / 2 + 1));
        this.cursorY += LINE;
    }

    /** Labelled meter (HP, progress). `fraction` clamped to 0..1. */
    bar(label: string, fraction: number, color?: string): void {
        if (this.collapsed) {
            return;
        }
        const f = Math.max(0, Math.min(1, fraction));
        const labelW = 48;
        const barX = this.panel.x + PAD + labelW;
        const barW = this.panel.w - PAD * 2 - labelW - 42;
        const barY = this.cursorY + 3;
        this.ctx.fillStyle = FG;
        this.ctx.fillText(label, this.panel.x + PAD, this.cursorY + LINE / 2 + 1);
        this.ctx.fillStyle = 'rgba(255,255,255,0.12)';
        this.ctx.fillRect(barX, barY, barW, LINE - 6);
        this.ctx.fillStyle = color ?? (f < 0.35 ? '#e05b5b' : f < 0.65 ? '#e8c35b' : '#69c86b');
        this.ctx.fillRect(barX, barY, barW * f, LINE - 6);
        this.ctx.fillStyle = FG_DIM;
        this.ctx.fillText(`${Math.round(f * 100)}%`, barX + barW + 6, this.cursorY + LINE / 2 + 1);
        this.cursorY += LINE;
    }

    /** Push-button; true exactly on the frame after it was clicked. */
    button(id: string, label: string): boolean {
        if (this.collapsed) {
            return false;
        }
        const w = this.ctx.measureText(label).width + 18;
        const r = { x: this.panel.x + PAD, y: this.cursorY + 2, w, h: BUTTON_H };
        this.drawButton(r, label);
        this.regions.push({ id: `btn:${id}`, ...r, kind: 'widget' });
        this.cursorY += BUTTON_H + 4;
        return paintState.consumeClick(`btn:${id}`);
    }

    /** A row of buttons; returns the id of the one clicked, or null. */
    buttons(items: { id: string; label: string }[]): string | null {
        if (this.collapsed || items.length === 0) {
            return null;
        }
        let bx = this.panel.x + PAD;
        let clicked: string | null = null;
        for (const item of items) {
            const w = this.ctx.measureText(item.label).width + 18;
            const r = { x: bx, y: this.cursorY + 2, w, h: BUTTON_H };
            this.drawButton(r, item.label);
            this.regions.push({ id: `btn:${item.id}`, ...r, kind: 'widget' });
            if (paintState.consumeClick(`btn:${item.id}`)) {
                clicked = item.id;
            }
            bx += w + 6;
        }
        this.cursorY += BUTTON_H + 4;
        return clicked;
    }

    /** Click-to-cycle selector: `label: [value]`. Returns the NEWLY selected
     *  option on the frame it changes, else null. */
    select(id: string, label: string, options: string[], current: string): string | null {
        if (this.collapsed || options.length === 0) {
            return null;
        }
        const text = `${label}: ${current} ▸`;
        const w = this.ctx.measureText(text).width + 14;
        const r = { x: this.panel.x + PAD, y: this.cursorY + 2, w, h: BUTTON_H };
        this.drawButton(r, text);
        this.regions.push({ id: `sel:${id}`, ...r, kind: 'widget' });
        this.cursorY += BUTTON_H + 4;
        if (paintState.consumeClick(`sel:${id}`)) {
            const at = options.findIndex(o => o.toLowerCase() === current.toLowerCase());
            return options[(at + 1) % options.length];
        }
        return null;
    }

    /** Small vertical gap. */
    gap(px = 6): void {
        if (!this.collapsed) {
            this.cursorY += px;
        }
    }

    /** Publish this frame's regions to the input layer. Call last. */
    end(): void {
        paintState.publishRegions(this.regions);
    }

    private drawButton(r: Rect, label: string): void {
        this.ctx.fillStyle = paintState.isHovered(r) ? BG_WIDGET_HOT : BG_WIDGET;
        this.ctx.fillRect(r.x, r.y, r.w, r.h);
        this.ctx.strokeStyle = BORDER;
        this.ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        this.ctx.fillStyle = FG;
        this.ctx.fillText(label, r.x + 7, r.y + r.h / 2 + 1);
    }
}

export const Paint = {
    begin(ctx: CanvasRenderingContext2D, opts: PaintOptions = {}): PaintFrame {
        return new PaintFrame(ctx, opts);
    }
};
