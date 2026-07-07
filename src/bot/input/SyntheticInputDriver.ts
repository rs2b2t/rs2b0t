import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import { reader, type MenuEntrySnapshot, type ScreenRect, type WorldTile } from '../adapter/ClientAdapter.js';
import type { InputDriver } from './InputDriver.js';
import { VirtualInput } from './VirtualInput.js';
import { RenderGate } from '../runtime/RenderGate.js';

const NPC_OPS = [MiniMenuAction.OP_NPC1, MiniMenuAction.OP_NPC2, MiniMenuAction.OP_NPC3, MiniMenuAction.OP_NPC4, MiniMenuAction.OP_NPC5];
const LOC_OPS = [MiniMenuAction.OP_LOC1, MiniMenuAction.OP_LOC2, MiniMenuAction.OP_LOC3, MiniMenuAction.OP_LOC4, MiniMenuAction.OP_LOC5];
const OBJ_OPS = [MiniMenuAction.OP_OBJ1, MiniMenuAction.OP_OBJ2, MiniMenuAction.OP_OBJ3, MiniMenuAction.OP_OBJ4, MiniMenuAction.OP_OBJ5];
const HELD_OPS = [MiniMenuAction.OP_HELD1, MiniMenuAction.OP_HELD2, MiniMenuAction.OP_HELD3, MiniMenuAction.OP_HELD4, MiniMenuAction.OP_HELD5];
const INV_BUTTONS = [MiniMenuAction.INV_BUTTON1, MiniMenuAction.INV_BUTTON2, MiniMenuAction.INV_BUTTON3, MiniMenuAction.INV_BUTTON4, MiniMenuAction.INV_BUTTON5];

const MAX_ATTEMPTS = 4;
// correction-pass aim points as box-fraction (x, y): center first, then a
// spread that covers off-center bands where thin models actually render
const COVERAGE: [number, number][] = [
    [0.5, 0.42], [0.35, 0.6], [0.65, 0.3], [0.3, 0.35], [0.7, 0.65],
    [0.5, 0.2], [0.2, 0.5], [0.8, 0.5], [0.5, 0.8]
];
// buildMinimenu rebuilds the hover menu in mainredraw, NOT mainloop — and the
// catch-up loop can run several mainloops per redraw under load, so we poll by
// wall-clock (guarantees ~30+ redraws at 50fps even with dips), not a frame
// count, waiting for the hover menu to pick up our cursor.
const MENU_POLL_MS = 700;
const MENU_RETRY_MS = 320;
const PRIORITY = 2000; // MiniMenuAction._PRIORITY; doAction strips it

interface ResolveSpec {
    /** For failure logs. */
    what: string;
    /** Current clickable screen box, or null when off-screen/out of scene. */
    aim(): ScreenRect | null;
    /** Identify the wanted row in the live minimenu (action+params). */
    match(entry: MenuEntrySnapshot): boolean;
    /** Where the target is in the world — enables camera-rotate recovery. */
    worldTarget?(): WorldTile | null;
    /** Always right-click + row-select, even when the op is the default. */
    forceMenu?: boolean;
    /** Sidebar component to make visible first (TYPE_INV ops). */
    ensureTabFor?: number;
    /**
     * The desired end-state was already reached by other means (so the
     * gesture is moot and should report success, not a resolution failure).
     * E.g. a dialog's continue button vanishing = the dialog advanced.
     */
    satisfiedExternally?(): boolean;
}

/**
 * SYNTHETIC mode (Slice 6): resolve each semantic op exactly the way a human
 * does — WindMouse the virtual cursor onto the target, let the client's own
 * render-picking rebuild the minimenu from hover, then left-click when the
 * wanted entry is the default (last) or right-click and pick the row from
 * the open menu. The click itself drives the client's normal mouseLoop
 * dispatch, so packets/anticheat/telemetry are exactly a human click's.
 *
 * Methods return promises (gestures span many frames) that are serialized on
 * an internal queue. Failures resolve false and log 'synthetic-fail: ...' —
 * never a silent fallback to direct (ADR-0003, dataset purity).
 */
export default class SyntheticInputDriver implements InputDriver {
    readonly mode = 'synthetic';

    /** Wired by ActionRouter to the active script's log. */
    logSink: ((level: 'info' | 'warn', msg: string) => void) | null = null;

    /** Gesture-quality counters (cumulative; read for tests/tuning).
     *  firstTry = hover found the op with no corrections and no extra
     *  attempts — the "clean click" rate is firstTry/gestures. */
    readonly gestureStats = { gestures: 0, firstTry: 0, corrections: 0, extraAttempts: 0, failures: 0 };

    private queue: Promise<unknown> = Promise.resolve();
    private cancelled = false;

    interactNpc(index: number, op: number): Promise<boolean> {
        return this.enqueue(() =>
            this.resolveOp({
                what: `npc ${index} op ${op}`,
                aim: () => reader.npcScreenBox(index),
                match: e => stripPriority(e.action) === NPC_OPS[op - 1] && e.a === index,
                worldTarget: () => reader.npcs().find(n => n.index === index)?.tile ?? null
            })
        );
    }

    interactLoc(lx: number, lz: number, typecode: number, op: number, viaMenu = false): Promise<boolean> {
        return this.enqueue(() =>
            this.resolveOp({
                what: `loc ${typecode} op ${op} at (${lx},${lz})`,
                aim: () => reader.locScreenBox(lx, lz, typecode),
                match: e => stripPriority(e.action) === LOC_OPS[op - 1] && e.a === typecode,
                worldTarget: () => reader.toWorld(lx, lz),
                forceMenu: viaMenu
            })
        );
    }

    takeObj(lx: number, lz: number, objId: number, op: number): Promise<boolean> {
        return this.enqueue(() =>
            this.resolveOp({
                what: `obj ${objId} op ${op} at (${lx},${lz})`,
                aim: () => reader.objScreenBox(lx, lz),
                match: e => stripPriority(e.action) === OBJ_OPS[op - 1] && e.a === objId && e.b === lx && e.c === lz,
                worldTarget: () => reader.toWorld(lx, lz)
            })
        );
    }

    heldOp(objId: number, slot: number, comId: number, op: number): Promise<boolean> {
        return this.enqueue(() =>
            this.resolveOp({
                what: `held ${objId} slot ${slot} op ${op}`,
                aim: () => reader.invSlotRect(comId, slot),
                match: e => stripPriority(e.action) === HELD_OPS[op - 1] && e.a === objId && e.b === slot && e.c === comId,
                ensureTabFor: comId
            })
        );
    }

    invButton(objId: number, slot: number, comId: number, op: number): Promise<boolean> {
        return this.enqueue(() =>
            this.resolveOp({
                what: `invbutton ${objId} slot ${slot} op ${op}`,
                aim: () => reader.invSlotRect(comId, slot),
                match: e => stripPriority(e.action) === INV_BUTTONS[op - 1] && e.a === objId && e.b === slot && e.c === comId,
                ensureTabFor: comId
            })
        );
    }

    // Use-item-on-X is a two-gesture sequence (select the held item, then
    // click the target through the live "Use X -> …" menu) that needs its own
    // resolution + validation. Until that lands, fail honestly rather than
    // silently dispatch a direct packet (ADR-0003). Processing bots run in
    // direct mode, where these are fully supported.
    useItemOnLoc(useObjId: number, _useSlot: number, _useComId: number, lx: number, lz: number, typecode: number): Promise<boolean> {
        return this.enqueue(() => { this.fail(`use ${useObjId} on loc ${typecode} at (${lx},${lz}) — not supported in synthetic mode`); return Promise.resolve(false); });
    }

    useItemOnNpc(useObjId: number, _useSlot: number, _useComId: number, index: number): Promise<boolean> {
        return this.enqueue(() => { this.fail(`use ${useObjId} on npc ${index} — not supported in synthetic mode`); return Promise.resolve(false); });
    }

    useItemOnItem(useObjId: number, _useSlot: number, _useComId: number, targetObjId: number, _targetSlot: number, _targetComId: number): Promise<boolean> {
        return this.enqueue(() => { this.fail(`use ${useObjId} on item ${targetObjId} — not supported in synthetic mode`); return Promise.resolve(false); });
    }

    castOnNpc(spellComId: number, index: number): Promise<boolean> {
        return this.enqueue(() => { this.fail(`cast spell com ${spellComId} on npc ${index} — not supported in synthetic mode`); return Promise.resolve(false); });
    }

    continueDialog(): Promise<boolean> {
        return this.enqueue(() => {
            if (reader.chatContinueComId() === -1) {
                return Promise.resolve(false);
            }

            // Re-read the live continue comId on every aim and match ANY
            // continue button (PAUSE_BUTTON): multi-page level-up dialogs
            // swap the comId between pages, so a comId captured up front
            // would stop matching mid-gesture.
            return this.resolveOp({
                what: 'dialog continue',
                aim: () => {
                    const comId = reader.chatContinueComId();
                    if (comId === -1) {
                        return null;
                    }

                    const rect = reader.componentRect(comId);
                    // the button spans wide; click the readable middle band
                    return rect ? { x: rect.x + rect.w * 0.25, y: rect.y + 1, w: rect.w * 0.5, h: Math.max(6, rect.h - 2) } : null;
                },
                match: e => stripPriority(e.action) === MiniMenuAction.PAUSE_BUTTON,
                // the continue button disappearing means the dialog already
                // advanced (our prior page click, or it auto-closed) — the
                // gesture's goal is met, so don't report a resolution failure
                satisfiedExternally: () => reader.chatContinueComId() === -1
            });
        });
    }

    /**
     * Walking: project the target tile onto the minimap disc (inverse of
     * minimapLoop's rotate+zoom) and left-click it — the client itself runs
     * tryMove + MOVE_MINIMAPCLICK with all its extra payload. Targets beyond
     * the disc walk an intermediate waypoint toward the destination.
     */
    walk(lx: number, lz: number): Promise<boolean> {
        return this.enqueue(async () => {
            const dest = reader.toWorld(lx, lz);
            const me = reader.worldTile();
            if (!dest || !me) {
                return false;
            }

            let point = reader.minimapPoint(dest);
            let target = dest;
            for (let halvings = 0; !point && halvings < 5; halvings++) {
                target = { x: Math.round((me.x + target.x) / 2), z: Math.round((me.z + target.z) / 2), level: target.level };
                if (target.x === me.x && target.z === me.z) {
                    break;
                }
                point = reader.minimapPoint(target);
            }

            if (!point) {
                this.fail(`walk to (${dest.x},${dest.z}) — no minimap point`);
                return false;
            }

            const vi = VirtualInput;
            vi.bindProfile();
            await vi.sleep(vi.rand.logNormal(vi.profile.reactionMu, vi.profile.reactionSigma, 80, 900));
            if (this.cancelled) {
                return false;
            }

            // ±2px jitter keeps the click human while staying on the tile
            const j = this.neverCenter({ x: point.x + vi.rand.gaussian() * 1.2, y: point.y + vi.rand.gaussian() * 1.2 }, point);
            await vi.moveTo(j.x, j.y);
            await vi.sleep(vi.rand.logNormal(vi.profile.dwellMu, vi.profile.dwellSigma, 40, 600));
            if (this.cancelled) {
                return false;
            }

            await vi.click(false, point);
            return true;
        });
    }

    /** Abort pending/queued gestures (script stop). */
    cancel(): void {
        this.cancelled = true;
        VirtualInput.cancelAll();
    }

    /** Re-arm after a cancel (new script run). */
    reset(): void {
        this.cancelled = false;
        this.queue = Promise.resolve();
    }

    // ---- gesture core ----

    /** Serialize gestures; concurrent script calls run in order. */
    private enqueue(job: () => Promise<boolean>): Promise<boolean> {
        const run = this.queue.then(async () => {
            if (this.cancelled) {
                return false;
            }
            // an in-flight gesture must render at full rate even when this bot
            // is backgrounded — buildMinimenu (the menu we click) only runs in
            // mainredraw; waitForMenuEntry polls for it.
            RenderGate.beginBoost();
            try {
                return await job();
            } finally {
                RenderGate.endBoost();
            }
        });
        this.queue = run.catch(() => false);
        return run;
    }

    private async resolveOp(spec: ResolveSpec): Promise<boolean> {
        const vi = VirtualInput;
        vi.bindProfile();
        let diag = 'no attempt reached aim';

        // human reaction before the hand starts moving
        await vi.sleep(vi.rand.logNormal(vi.profile.reactionMu, vi.profile.reactionSigma, 80, 900));

        this.gestureStats.gestures++;
        let correctionsUsed = 0;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                this.gestureStats.extraAttempts++;
            }
            if (this.cancelled) {
                return false;
            }

            // the wanted end-state may already hold (e.g. the dialog advanced
            // on its own / a prior gesture) — that's success, not a failure
            if (spec.satisfiedExternally?.()) {
                return true;
            }

            if (reader.menu().open) {
                await this.closeStrayMenu();
            }

            if (spec.ensureTabFor !== undefined && !(await this.ensureSideTab(spec.ensureTabFor))) {
                diag = `a${attempt}: ensureSideTab failed`;
                continue;
            }

            let box = spec.aim();
            if (!box && spec.worldTarget) {
                // off-screen: rotate the camera toward the target (held
                // arrow keys through the real key handling) and re-aim
                if (await this.rotateToward(spec.worldTarget())) {
                    box = spec.aim();
                }
            }
            if (!box) {
                diag = `a${attempt}: no aim box (off-screen / interface not laid out)`;
                // a freshly-opened dialog/component can have its child layout
                // (childX/childY) unpopulated for a frame or two — wait a few
                // redraws before retrying so it can settle (a no-worldTarget
                // target like a dialog button otherwise burns every attempt in
                // a single frame)
                if (attempt < MAX_ATTEMPTS - 1) {
                    await vi.sleep(vi.rand.range(120, 260));
                }
                continue;
            }

            const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
            const point = this.jitterInBox(box);
            // fractional aim position within the box — retargeting holds the
            // same relative spot as the target's box moves
            const relX = box.w > 0 ? (point.x - box.x) / box.w : 0.5;
            const relY = box.h > 0 ? (point.y - box.y) / box.h : 0.5;
            const liveAim = () => {
                const fresh = spec.aim();
                return fresh ? { x: fresh.x + fresh.w * relX, y: fresh.y + fresh.h * relY } : null;
            };

            // distance-scaled overshoot: long throws sometimes pass the
            // target and correct back
            const dist = Math.hypot(point.x - vi.x, point.y - vi.y);
            const pOver = Math.min(vi.profile.overshootCap, dist * vi.profile.overshootScale);
            if (vi.rand.chance(pOver)) {
                const ratio = vi.profile.overshootRatio * (0.6 + vi.rand.next() * 0.8);
                const ox = point.x + (point.x - vi.x) * ratio + vi.rand.gaussian() * 3;
                const oy = point.y + (point.y - vi.y) * ratio + vi.rand.gaussian() * 3;
                await vi.moveTo(Math.min(763, Math.max(2, ox)), Math.min(501, Math.max(2, oy)));
                await vi.sleep(vi.rand.range(30, 90));
            }

            await vi.moveTo(point.x, point.y, undefined, liveAim);
            await vi.sleep(vi.rand.logNormal(vi.profile.dwellMu, vi.profile.dwellSigma, 40, 600));

            // track a moving target: when hover doesn't yield the op, re-aim
            // at the target's current box walking a spread pattern across it
            // (fresh pointermove -> buildMinimenu each step). Deliberate
            // coverage, not center-jitter: a thin model (tree branch, rope)
            // can occupy a narrow off-center band of its projected bounds.
            let found = await this.waitForMenuEntry(spec.match, MENU_POLL_MS);
            for (let correction = 0; !found && correction < COVERAGE.length; correction++) {
                if (this.cancelled) {
                    return false;
                }

                const fresh = spec.aim();
                if (!fresh) {
                    break;
                }

                correctionsUsed++;
                this.gestureStats.corrections++;
                const [fx, fy] = COVERAGE[correction];
                const px = fresh.x + fresh.w * fx + vi.rand.gaussian() * 2;
                const py = fresh.y + fresh.h * fy + vi.rand.gaussian() * 2;
                await vi.moveTo(Math.min(763, Math.max(2, px)), Math.min(501, Math.max(2, py)));
                await vi.sleep(vi.rand.range(40, 110));
                found = await this.waitForMenuEntry(spec.match, MENU_RETRY_MS);
            }
            if (!found) {
                const m = reader.menu();
                diag = `a${attempt}: no menu match; box=(${box.x | 0},${box.y | 0},${box.w | 0},${box.h | 0}) cursor=(${vi.x | 0},${vi.y | 0}) menuOpen=${m.open} entries=[${m.entries.map(e => `${e.option}:${e.action}`).join(' | ')}]`;
                // picking missed (model occluded / too small at this angle).
                // recover before the next attempt: a small camera turn changes
                // occlusion and the projected pixel; on later attempts, swing
                // to face the target so it renders larger and more central.
                if (spec.worldTarget && attempt < MAX_ATTEMPTS - 1) {
                    if (attempt >= 1) {
                        await this.rotateToward(spec.worldTarget());
                    } else {
                        await this.wiggleCamera();
                    }
                }
                continue;
            }

            if (this.cancelled) {
                return false;
            }

            if (!spec.forceMenu && found.index === found.count - 1) {
                // the wanted op is the left-click default
                if (attempt === 0 && correctionsUsed === 0) {
                    this.gestureStats.firstTry++;
                }
                await vi.click(false, center);
                return true;
            }

            if (await this.rowSelect(spec.match, center)) {
                if (attempt === 0 && correctionsUsed === 0) {
                    this.gestureStats.firstTry++;
                }
                return true;
            }
            diag = `a${attempt}: rowSelect failed (index ${found.index}/${found.count})`;
        }

        // a target that disappeared mid-resolution reached its end-state
        // anyway (dialog advanced, item consumed) — not a resolution failure
        if (spec.satisfiedExternally?.()) {
            return true;
        }

        this.gestureStats.failures++;
        this.fail(`${spec.what} after ${MAX_ATTEMPTS} attempts [${diag}]`);
        return false;
    }

    /**
     * Wait for the hover-rebuilt minimenu (one rebuild per redraw) to show a
     * row matching the wanted op.
     */
    private async waitForMenuEntry(match: (e: MenuEntrySnapshot) => boolean, budgetMs: number): Promise<{ index: number; count: number } | null> {
        const deadline = performance.now() + budgetMs;
        do {
            if (this.cancelled) {
                return null;
            }

            const menu = reader.menu();
            if (!menu.open) {
                const index = menu.entries.findIndex(match);
                if (index !== -1) {
                    return { index, count: menu.entries.length };
                }
            }

            await VirtualInput.nextFrame();
        } while (performance.now() < deadline);

        return null;
    }

    /**
     * Non-default entry: right-click, wait for the real menu to open, move
     * to the wanted row's hit band (path clamped inside the menu's 10px
     * auto-close bounds) and click it. Full row-select — no dispatch
     * shortcut; the row click is what fires doAction.
     */
    private async rowSelect(match: (e: MenuEntrySnapshot) => boolean, targetCenter: { x: number; y: number }): Promise<boolean> {
        const vi = VirtualInput;
        await vi.click(true, targetCenter);

        // openMenu runs in mouseLoop the frame the right-click latches; wait
        // by wall-clock so frame dips don't make us give up early
        const openDeadline = performance.now() + 400;
        let open = reader.menu().open;
        while (!open && performance.now() < openDeadline) {
            await vi.nextFrame();
            open = reader.menu().open;
        }
        if (!open) {
            return false;
        }

        const menu = reader.menu();
        const index = menu.entries.findIndex(match);
        if (index === -1) {
            await this.closeStrayMenu();
            return false;
        }

        const row = reader.menuRowRect(index);
        const bounds = reader.menuCloseBounds();
        if (!row || !bounds) {
            await this.closeStrayMenu();
            return false;
        }

        const rowCenter = { x: row.x + row.w / 2, y: row.y + row.h / 2 };
        const point = this.jitterInBox({ x: row.x + 2, y: row.y + 2, w: row.w - 4, h: row.h - 4 });
        await vi.moveTo(point.x, point.y, { x: bounds.x + 4, y: bounds.y + 4, w: bounds.w - 8, h: bounds.h - 8 });
        await vi.sleep(vi.rand.range(60, 160));

        if (this.cancelled || !reader.menu().open) {
            return false;
        }

        await vi.click(false, rowCenter);

        // a click on a menu row closes the menu (dispatch or not); if it's
        // still open the click missed the band — clear it so it can't block
        // the next gesture, and report failure honestly
        for (let frame = 0; frame < 6; frame++) {
            await vi.nextFrame();
            if (!reader.menu().open) {
                return true;
            }
        }

        await this.closeStrayMenu();
        return false;
    }

    /** Make the sidebar tab owning `comId` active (real click on its icon). */
    private async ensureSideTab(comId: number): Promise<boolean> {
        const tab = reader.sideTabOf(comId);
        if (tab === -1 || reader.activeSideTab() === tab) {
            return true;
        }

        const rect = reader.sideTabRect(tab);
        if (!rect) {
            return false;
        }

        const vi = VirtualInput;
        for (let attempt = 0; attempt < 2; attempt++) {
            const point = this.jitterInBox(rect);
            await vi.moveTo(point.x, point.y);
            await vi.sleep(vi.rand.range(60, 160));
            await vi.click(false, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

            // iconLoop flips activeIcon the frame the click latches; wait by
            // wall-clock so frame dips don't make us give up early
            const deadline = performance.now() + 500;
            while (performance.now() < deadline) {
                if (reader.activeSideTab() === tab) {
                    return true;
                }
                await vi.nextFrame();
            }
        }

        return false;
    }

    /** Camera-rotate recovery: hold the arrow that swings the orbit yaw
     *  toward the target until roughly facing it. */
    private async rotateToward(tile: WorldTile | null): Promise<boolean> {
        if (!tile) {
            return false;
        }

        const desired = reader.yawTo(tile);
        const diff = signedYawDiff(desired, reader.orbitYaw());
        if (Math.abs(diff) < 48) {
            return false; // already facing; aiming failed for another reason
            // (target too far for the pitch, occluded, ...)
        }

        // keyHeld[2] (right arrow) increases orbitCameraYaw, keyHeld[1]
        // decreases it (Client.ts ~3243); ~12 yaw units per client frame, so
        // a half turn needs ~2s at 50fps (longer when frames drop — budget 6s)
        const ch = diff > 0 ? 2 : 1;
        await VirtualInput.holdKeyUntil(ch, () => Math.abs(signedYawDiff(desired, reader.orbitYaw())) < 40, 6000);
        await VirtualInput.sleep(250); // let the yaw velocity decay
        return true;
    }

    /** Brief arrow-key camera tap to shift occlusion + projected pixel when
     *  render-picking keeps missing a (visible but blocked) target. */
    private async wiggleCamera(): Promise<void> {
        const ch = VirtualInput.rand.chance(0.5) ? 1 : 2;
        await VirtualInput.holdKeyUntil(ch, () => false, VirtualInput.rand.range(140, 280));
        await VirtualInput.sleep(200);
    }

    /**
     * A leftover open menu blocks hover-rebuild (buildMinimenu only runs while
     * !isMenuOpen), so the next gesture's poll can never see its entry. Drift
     * outside the 10px auto-close band (mouseLoop closes it without
     * dispatching) and verify, by wall-clock, that it actually closed.
     */
    private async closeStrayMenu(): Promise<void> {
        const vi = VirtualInput;
        for (let attempt = 0; attempt < 3 && reader.menu().open; attempt++) {
            const bounds = reader.menuCloseBounds();
            if (!bounds) {
                return;
            }

            // aim well clear of the band; pick the side with more room so the
            // target is never re-clamped back inside
            const leftRoom = bounds.x;
            const tx = leftRoom > 765 - (bounds.x + bounds.w) ? Math.max(4, bounds.x - vi.rand.range(30, 70)) : Math.min(761, bounds.x + bounds.w + vi.rand.range(30, 70));
            const ty = Math.min(498, Math.max(6, bounds.y + bounds.h / 2 + vi.rand.gaussian() * 30));
            await vi.moveTo(tx, ty);

            const deadline = performance.now() + 300;
            while (reader.menu().open && performance.now() < deadline) {
                await vi.nextFrame();
            }
        }
    }

    /** Gaussian point inside a box — clamped near the edges, never the exact
     *  center (the dataset bar: zero dead-center clicks). */
    private jitterInBox(box: ScreenRect): { x: number; y: number } {
        const vi = VirtualInput;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;

        let dx = vi.rand.gaussian() * vi.profile.clickSigma * (box.w / 2);
        let dy = vi.rand.gaussian() * vi.profile.clickSigma * (box.h / 2);
        dx = Math.min(box.w / 2 - 1, Math.max(-(box.w / 2 - 1), dx));
        dy = Math.min(box.h / 2 - 1, Math.max(-(box.h / 2 - 1), dy));

        return this.neverCenter({ x: cx + dx, y: cy + dy }, { x: cx, y: cy });
    }

    /** Guarantee the click pixel differs from the target-center pixel. */
    private neverCenter(point: { x: number; y: number }, center: { x: number; y: number }): { x: number; y: number } {
        const vi = VirtualInput;
        let { x, y } = point;
        while ((x | 0) === (center.x | 0) && (y | 0) === (center.y | 0)) {
            x += vi.rand.chance(0.5) ? 1 + vi.rand.next() : -1 - vi.rand.next();
            y += vi.rand.gaussian() * 0.8;
        }

        return { x, y };
    }

    private fail(msg: string): void {
        console.warn(`[lcbuddy] synthetic-fail: ${msg}`);
        this.logSink?.('warn', `synthetic-fail: ${msg}`);
    }
}

function stripPriority(action: number): number {
    return action >= PRIORITY ? action - PRIORITY : action;
}

/** Shortest signed distance between two yaw values (units of 2048/turn). */
function signedYawDiff(a: number, b: number): number {
    return ((a - b + 3072) & 0x7ff) - 1024;
}
