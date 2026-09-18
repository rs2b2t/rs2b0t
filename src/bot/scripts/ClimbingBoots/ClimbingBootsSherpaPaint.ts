import { Inventory } from '../../api/inventory/Inventory.js';
import { BOOTS, COINS, SCRIPT_VERSION } from './ClimbingBootsLogic.js';
import { PAINT_BOOTS_PHOTO, PAINT_BOOTS_SPRITE } from './ClimbingBootsPaintAssets.js';

const GAME_VIEW = { x: 4, y: 4, w: 512, h: 334 };
const PAINT_CANVAS_W = 765;
const PAINT_CANVAS_H = 503;
const PAINT_LEATHER = '#3a2416';
const PAINT_LEATHER_LIT = '#6d4a2e';
const PAINT_BRONZE = '#d2b07a';
const PAINT_BRONZE_DIM = '#8a6234';
const PAINT_ICE = '#c9d8ea';
const PAINT_INK = '#f4e6c8';
const PAINT_MUTED = '#c4b196';
const PAINT_SLATE = '#2c3c4c';

export interface SherpaPaintBot {
    paintCollapsed: boolean;
    status: string;
    startedAt: number;
    trips: number;
    bought: number;
    useTeleport: boolean;
    planQty(): number;
}

let activePaintBot: SherpaPaintBot | null = null;
let paintClicksInstalled = false;
let paintCanvas: HTMLCanvasElement | null = null;
let paintToggleHit = { x: 0, y: 0, w: 16, h: 16 };

const paintBootsPhoto = typeof Image !== 'undefined' ? new Image() : null;
if (paintBootsPhoto) {
    paintBootsPhoto.src = PAINT_BOOTS_PHOTO;
}
const paintBootsSprite = typeof Image !== 'undefined' ? new Image() : null;
if (paintBootsSprite) {
    paintBootsSprite.src = PAINT_BOOTS_SPRITE;
}

function prefKey(key: string): string {
    return `rs2b0t.pref.ClimbingBoots.${key}`;
}

export function readPrefBool(key: string, fallback: boolean): boolean {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(prefKey(key));
            if (raw === null) {
                return fallback;
            }
            const n = raw.trim().toLowerCase();
            return n === 'true' || n === '1' || n === 'yes';
        }
    } catch {
        /* private mode */
    }
    return fallback;
}

function writePrefRaw(key: string, value: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(prefKey(key), value);
        }
    } catch {
        /* private mode */
    }
}

function paintCanvasPoint(e: MouseEvent | PointerEvent): { x: number; y: number } | null {
    const canvas = e.currentTarget instanceof HTMLElement ? e.currentTarget : paintCanvas;
    if (!canvas) {
        return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }
    const w = canvas instanceof HTMLCanvasElement && canvas.width > 0 ? canvas.width : PAINT_CANVAS_W;
    const h = canvas instanceof HTMLCanvasElement && canvas.height > 0 ? canvas.height : PAINT_CANVAS_H;
    return {
        x: (e.clientX - rect.left) * (w / rect.width),
        y: (e.clientY - rect.top) * (h / rect.height)
    };
}

function pointInRect(p: { x: number; y: number } | null, r: { x: number; y: number; w: number; h: number }): boolean {
    return Boolean(p && r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
}

function onPaintPointerEvent(e: Event): void {
    const bot = activePaintBot;
    if (!bot) {
        return;
    }
    if (!(e instanceof MouseEvent) && !(typeof PointerEvent !== 'undefined' && e instanceof PointerEvent)) {
        return;
    }
    if (!pointInRect(paintCanvasPoint(e), paintToggleHit)) {
        return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    const isDown = e.type === 'pointerdown' || e.type === 'mousedown';
    if (!isDown || (e.button != null && e.button !== 0)) {
        return;
    }
    bot.paintCollapsed = !bot.paintCollapsed;
    writePrefRaw('paintCollapsed', bot.paintCollapsed ? 'true' : 'false');
}

export function installPaintClicks(canvas?: HTMLCanvasElement): void {
    if (paintClicksInstalled) {
        return;
    }
    const el = canvas ?? paintCanvas;
    if (!el) {
        return;
    }
    paintCanvas = el;
    paintClicksInstalled = true;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick'] as const) {
        el.addEventListener(type, onPaintPointerEvent, true);
    }
}

export function uninstallPaintClicks(): void {
    if (paintCanvas) {
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick'] as const) {
            paintCanvas.removeEventListener(type, onPaintPointerEvent, true);
        }
    }
    paintClicksInstalled = false;
    paintCanvas = null;
}

export function setActivePaintBot(bot: SherpaPaintBot | null): void {
    activePaintBot = bot;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

function fitPaintText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    const s = String(text ?? '');
    if (maxW <= 0 || ctx.measureText(s).width <= maxW) {
        return s;
    }
    const ell = '...';
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ctx.measureText(s.slice(0, mid) + ell).width <= maxW) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo <= 0 ? ell : s.slice(0, lo) + ell;
}

function imageReady(img: HTMLImageElement | null): img is HTMLImageElement {
    return Boolean(img && img.complete && img.naturalWidth > 0);
}

function fmtElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

function drawMountainRidge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + h * 0.62);
    ctx.lineTo(x + w * 0.1, y + h * 0.34);
    ctx.lineTo(x + w * 0.18, y + h * 0.48);
    ctx.lineTo(x + w * 0.32, y + 1);
    ctx.lineTo(x + w * 0.44, y + h * 0.36);
    ctx.lineTo(x + w * 0.58, y + h * 0.1);
    ctx.lineTo(x + w * 0.7, y + h * 0.4);
    ctx.lineTo(x + w * 0.84, y + h * 0.16);
    ctx.lineTo(x + w * 0.93, y + h * 0.42);
    ctx.lineTo(x + w, y + h * 0.28);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, PAINT_ICE);
    g.addColorStop(0.22, '#7a8ea4');
    g.addColorStop(1, PAINT_SLATE);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.32, y + 1);
    ctx.lineTo(x + w * 0.28, y + h * 0.16);
    ctx.lineTo(x + w * 0.36, y + h * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.58, y + h * 0.1);
    ctx.lineTo(x + w * 0.55, y + h * 0.22);
    ctx.lineTo(x + w * 0.62, y + h * 0.22);
    ctx.closePath();
    ctx.fill();
}

function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = PAINT_BRONZE;
    ctx.fill();
    ctx.strokeStyle = PAINT_BRONZE_DIM;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - 0.6, y - 0.6, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 236, 196, 0.7)';
    ctx.fill();
}

function drawBootPhoto(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12, 8, 4, 0.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
    const ring = ctx.createRadialGradient(cx - 4, cy - 4, 6, cx, cy, r + 3.5);
    ring.addColorStop(0, '#e8c888');
    ring.addColorStop(0.55, PAINT_BRONZE);
    ring.addColorStop(1, '#5a3a16');
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0c0c0c';
    ctx.fill();
    ctx.clip();
    const img = imageReady(paintBootsPhoto) ? paintBootsPhoto : imageReady(paintBootsSprite) ? paintBootsSprite : null;
    if (img) {
        const size = r * 2.15;
        ctx.drawImage(img, cx - size / 2, cy - size / 2 + 2, size, size);
    } else {
        ctx.fillStyle = '#6a6a6a';
        ctx.fillRect(cx - r * 0.55, cy - r * 0.2, r * 0.95, r * 0.85);
        ctx.fillRect(cx - r * 0.15, cy - r * 0.55, r * 0.7, r * 1.15);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0d8a0';
    ctx.lineWidth = 1.2;
    ctx.stroke();
}

export function drawSherpaPass(ctx: CanvasRenderingContext2D, bot: SherpaPaintBot): void {
    installPaintClicks(ctx.canvas);
    const view = GAME_VIEW;
    const collapsed = bot.paintCollapsed === true;
    const pad = 5;
    const sealR = collapsed ? 20 : 36;
    const boxW = collapsed ? 118 : 168;
    const boxH = collapsed ? 30 : 122;
    const hang = sealR * 2 - 8;
    const totalW = boxW + hang;
    const totalH = Math.max(boxH, sealR * 2 + 4);
    const x = view.x + view.w - pad - totalW;
    const y = view.y + view.h - pad - totalH;
    const boxY = y + Math.max(0, totalH - boxH);
    const sealX = x + boxW + sealR - 10;
    const sealY = boxY + boxH - sealR - 2;
    paintToggleHit = {
        x: sealX - sealR - 4,
        y: sealY - sealR - 4,
        w: (sealR + 4) * 2,
        h: (sealR + 4) * 2
    };

    ctx.save();
    ctx.shadowColor = 'rgba(8, 4, 0, 0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const leather = ctx.createLinearGradient(x, boxY, x, boxY + boxH);
    leather.addColorStop(0, PAINT_LEATHER_LIT);
    leather.addColorStop(0.45, '#4a2e1c');
    leather.addColorStop(1, PAINT_LEATHER);
    roundRectPath(ctx, x, boxY, boxW, boxH, 8);
    ctx.fillStyle = leather;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = PAINT_BRONZE;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240, 216, 160, 0.35)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, x + 1.5, boxY + 1.5, boxW - 3, boxH - 3, 7);
    ctx.stroke();

    ctx.save();
    roundRectPath(ctx, x, boxY, boxW, boxH, 8);
    ctx.clip();
    drawMountainRidge(ctx, x, boxY, boxW, collapsed ? 14 : 22);
    ctx.fillStyle = 'rgba(20, 12, 6, 0.28)';
    ctx.fillRect(x, boxY + (collapsed ? 12 : 20), boxW, 6);
    ctx.restore();

    drawRivet(ctx, x + 8, boxY + 8);
    drawRivet(ctx, x + boxW - 8, boxY + 8);
    if (!collapsed) {
        drawRivet(ctx, x + 8, boxY + boxH - 8);
        drawRivet(ctx, x + boxW - 22, boxY + boxH - 8);
    }

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = PAINT_INK;
    ctx.font = 'bold 11px sans-serif';
    if (collapsed) {
        ctx.fillText('SHERPA PASS', x + 16, boxY + 10);
        drawBootPhoto(ctx, sealX, sealY, sealR);
        ctx.restore();
        return;
    }

    if (imageReady(paintBootsSprite)) {
        ctx.drawImage(paintBootsSprite, x + 12, boxY + 24, 18, 18);
    }
    ctx.fillText("TENZING'S PASS", x + 34, boxY + 26);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = PAINT_MUTED;
    ctx.fillText(`v${SCRIPT_VERSION}  12gp a pair`, x + 34, boxY + 40);

    let qty = 0;
    let boots = 0;
    let coins = 0;
    try {
        qty = bot.planQty();
        boots = Inventory.count(BOOTS);
        coins = Inventory.count(COINS);
    } catch {
        /* paint can run before the client is ready */
    }
    const frac = qty > 0 ? Math.min(1, boots / qty) : 0;
    const barX = x + 12;
    const barY = boxY + 54;
    const barW = boxW - 24;
    const barH = 7;
    roundRectPath(ctx, barX, barY, barW, barH, 3);
    ctx.fillStyle = 'rgba(12, 8, 4, 0.55)';
    ctx.fill();
    if (frac > 0) {
        roundRectPath(ctx, barX + 1, barY + 1, Math.max(2, (barW - 2) * frac), barH - 2, 2);
        ctx.fillStyle = PAINT_BRONZE;
        ctx.fill();
    }

    const textW = boxW - 24;
    const status = fitPaintText(ctx, String(bot.status ?? ''), textW);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = PAINT_ICE;
    ctx.fillText(status, x + 12, boxY + 66);

    const rows = [
        `Time  ${fmtElapsed(Date.now() - bot.startedAt)}`,
        `Trips  ${bot.trips}   Bought  ${bot.bought}`,
        `Pack  ${boots}/${qty}   Coins  ${coins}`,
        `Tele  ${bot.useTeleport ? 'on' : 'off'}`
    ];
    ctx.fillStyle = PAINT_INK;
    let rowY = boxY + 80;
    for (const row of rows) {
        ctx.fillText(fitPaintText(ctx, row, textW), x + 12, rowY);
        rowY += 10;
    }

    drawBootPhoto(ctx, sealX, sealY, sealR);
    ctx.restore();
}
