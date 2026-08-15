import { cycleOption, paintState, resolveDock, type Dock, type Rect, type Region } from '#/bot/paint/paintLogic.js';

/**
 * Layout and behaviour of an overlay HUD.
 * @see docs/reference/api-bots.md
 */
interface PaintOptions {
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
            this.regions.push({ id: 'paint:panel', ...this.panel, kind: 'panel' });
            this.ctx.fillStyle = BG;
            this.ctx.fillRect(this.panel.x, this.cursorY, this.panel.w, this.panel.y + this.panel.h - this.cursorY);
            this.ctx.strokeStyle = BORDER;
            this.ctx.strokeRect(this.panel.x + 0.5, this.cursorY + 0.5, this.panel.w - 1, this.panel.y + this.panel.h - this.cursorY - 1);
        } else {
            this.regions.push({ id: 'paint:panel', x: this.panel.x, y: this.panel.y, w: this.panel.w, h: TITLE_H, kind: 'panel' });
        }
    }

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

    text(line: string, color?: string): void {
        if (this.collapsed) {
            return;
        }
        this.ctx.fillStyle = color ?? FG;
        this.ctx.fillText(line, this.panel.x + PAD, this.cursorY + LINE / 2 + 1);
        this.cursorY += LINE;
    }

    row(...cols: string[]): void {
        if (this.collapsed || cols.length === 0) {
            return;
        }
        const colW = (this.panel.w - PAD * 2) / cols.length;
        this.ctx.fillStyle = FG;
        cols.forEach((col, i) => this.ctx.fillText(col, this.panel.x + PAD + i * colW, this.cursorY + LINE / 2 + 1));
        this.cursorY += LINE;
    }

    // Why: immediate mode has no retained scroll position, so the offset lives in paintState under the list id and the wheel notches are applied here.
    // Why: the window registers a 'scroll' region so the canvas swallows the wheel rather than letting the game zoom behind the panel.
    // Why: the offset shown is returned, already clamped.

    /** A scrollable list of lines. */
    list(id: string, lines: string[], rows: number, color?: string): number {
        if (this.collapsed) {
            return 0;
        }
        const key = `list:${id}`;
        const maxOffset = Math.max(0, lines.length - rows);
        const stored = Number(paintState.get(key, '0'));
        const offset = Math.min(maxOffset, Math.max(0, (Number.isFinite(stored) ? stored : 0) + paintState.consumeWheel(key)));
        paintState.set(key, String(offset));

        const top = this.cursorY;
        const h = rows * LINE;
        this.regions.push({ id: key, x: this.panel.x, y: top, w: this.panel.w, h, kind: 'scroll' });

        if (lines.length === 0) {
            this.text('nothing yet', FG_DIM);
            return 0;
        }

        for (const line of lines.slice(offset, offset + rows)) {
            this.ctx.fillStyle = color ?? FG;
            this.ctx.fillText(line, this.panel.x + PAD, this.cursorY + LINE / 2 + 1);
            this.cursorY += LINE;
        }

        if (maxOffset > 0) {
            // Thumb on the right edge, so it is obvious there is more.
            const trackH = h;
            const thumbH = Math.max(6, (rows / lines.length) * trackH);
            const thumbY = top + (offset / maxOffset) * (trackH - thumbH);
            this.ctx.fillStyle = BG_WIDGET;
            this.ctx.fillRect(this.panel.x + this.panel.w - 5, top, 3, trackH);
            this.ctx.fillStyle = this.accent;
            this.ctx.fillRect(this.panel.x + this.panel.w - 5, thumbY, 3, thumbH);
            this.ctx.fillStyle = FG_DIM;
            this.ctx.fillText(`${offset + 1}–${Math.min(lines.length, offset + rows)} of ${lines.length}`, this.panel.x + PAD, this.cursorY + LINE / 2 + 1);
            this.cursorY += LINE;
        }
        return offset;
    }

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
            return cycleOption(options, current, 1);
        }
        return null;
    }

    /**
     * Prev / label / Next stepper — one click moves one option (no spam overshoot).
     * Layout: `[◀] label: current [▶]`. Returns the newly selected option or null.
     */
    stepper(id: string, label: string, options: string[], current: string): string | null {
        if (this.collapsed || options.length === 0) {
            return null;
        }
        const y = this.cursorY + 2;
        let x = this.panel.x + PAD;
        let picked: string | null = null;

        const prevW = this.ctx.measureText('◀').width + 14;
        const prevR = { x, y, w: prevW, h: BUTTON_H };
        this.drawButton(prevR, '◀');
        this.regions.push({ id: `step:${id}:prev`, ...prevR, kind: 'widget' });
        if (paintState.consumeClick(`step:${id}:prev`)) {
            picked = cycleOption(options, current, -1);
        }
        x += prevW + 4;

        const mid = `${label}: ${current}`;
        const midW = Math.min(
            this.ctx.measureText(mid).width + 14,
            this.panel.w - PAD * 2 - prevW - 40
        );
        const midR = { x, y, w: Math.max(midW, 40), h: BUTTON_H };
        this.drawButton(midR, mid);
        // Mid is display-only (no cycle on click) so spam does not skip destinations.
        this.regions.push({ id: `step:${id}:mid`, ...midR, kind: 'widget' });
        x += midR.w + 4;

        const nextW = this.ctx.measureText('▶').width + 14;
        const nextR = { x, y, w: nextW, h: BUTTON_H };
        this.drawButton(nextR, '▶');
        this.regions.push({ id: `step:${id}:next`, ...nextR, kind: 'widget' });
        if (paintState.consumeClick(`step:${id}:next`)) {
            picked = cycleOption(options, current, 1);
        }

        this.cursorY += BUTTON_H + 4;
        return picked;
    }

    gap(px = 6): void {
        if (!this.collapsed) {
            this.cursorY += px;
        }
    }

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

/**
 * Immediate-mode overlay HUD — tabs, buttons, bars — redrawn every frame from
 * `onPaint`.
 * @see docs/reference/api-bots.md
 */
export const Paint = {
    begin(ctx: CanvasRenderingContext2D, opts: PaintOptions = {}): PaintFrame {
        return new PaintFrame(ctx, opts);
    }
};
