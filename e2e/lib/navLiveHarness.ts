/** Shared helpers for operator nav live harnesses (tools/nav-*-live.ts, nav-*-smoke.ts): cheat tele placement, energy/HP sustain, tick rate, path paint settings, inventory seed and a generic walkTo probe loop.
 *  Why: the pacing defaults below keep outer walk polls multi-second and sustain throttled, so cheats settle without sub-100ms spins. */
import type { Page } from 'playwright-core';

import { setSettings } from './harness.js';
import { cheatQuiet } from '../tutorial/harness.js';

// ── pacing (shared — do not invent tighter loops in callers) ────────────────

/** Outer mid-walk poll period (done/tile/stuck). Default 2s. */
export const DEFAULT_WALK_POLL_MS = 2000;

/** Energy + HP sustain period. Default 5s (see maybeSustain). */
export const DEFAULT_SUSTAIN_EVERY_S = 5;

/** Post-cheat / post-drop settle. */
export const DEFAULT_SETTLE_MS = 400;

/** Tele / inv-seed arrival polls (not 20–150ms spins). */
export const DEFAULT_ARRIVAL_POLL_MS = 400;

/** Runner stop wait step. */
export const DEFAULT_STOP_POLL_MS = 500;

/**
 * Outer walk poll ms from env: `WALK_POLL_MS` or `WALK_POLL_S` (seconds).
 * Floor 500ms — sub-second fleet polls are unnecessary for nav research.
 */
export function walkPollMsFromEnv(fallback = DEFAULT_WALK_POLL_MS): number {
    const rawS = process.env.WALK_POLL_S;
    const rawMs = process.env.WALK_POLL_MS;
    let ms = fallback;
    if (rawMs !== undefined && rawMs !== '') {
        ms = Number(rawMs);
    } else if (rawS !== undefined && rawS !== '') {
        ms = Number(rawS) * 1000;
    }
    if (!Number.isFinite(ms) || ms < 500) {
        return 500;
    }
    return Math.min(15_000, ms);
}

// ── types ───────────────────────────────────────────────────────────────────

export type NavTile = { x: number; z: number; level: number };

export type NavWalkResult = {
    walkOk: boolean;
    tile: NavTile | null;
    logs: string[];
};

export type NavPaintFlags = {
    paint: boolean;
    sceneExpand: boolean;
    clientSeg: boolean;
    /** Product tele catalog preference in SettingsStore (navTeleports). */
    teleports: boolean;
    /** Yaw-follow camera while painting. Default true when paint is on. */
    cameraFollow: boolean;
    pathColor: string;
    clientColor: string;
};

export type SeedSpec = {
    debug: string;
    /** Charged display name (e.g. /Amulet of glory\(/). */
    match: RegExp;
    /**
     * Depleted form with no charge paren (e.g. /^Amulet of glory$/).
     * When present, top-up drops these to free slots before re-seeding charged.
     */
    uncharged?: RegExp;
    qty?: number;
    label?: string;
};

// ── env ─────────────────────────────────────────────────────────────────────

/** True unless env is explicitly "0" or "false". */
export function envDefaultOn(name: string): boolean {
    const v = process.env[name];
    return v !== '0' && v !== 'false';
}

/** True only when env is "1" or "true". */
export function envDefaultOff(name: string): boolean {
    const v = process.env[name];
    return v === '1' || v === 'true';
}

export function useTeleportsFromEnv(): boolean {
    return envDefaultOn('USE_TELEPORTS');
}

export function energyRefillAtFromEnv(fallback = 25): number {
    return Number(process.env.ENERGY_REFILL_AT ?? fallback);
}

/** PATH_PAINT / SCENE_EXPAND / CLIENT_SEG + tele flag for settings. */
export function pathPaintFlagsFromEnv(opts?: {
    /** Override teleports setting (default USE_TELEPORTS). */
    teleports?: boolean;
    /** When paint off, force cameraFollow false. Default: follow paint. */
    cameraFollow?: boolean;
}): NavPaintFlags {
    const paint = envDefaultOn('PATH_PAINT');
    const sceneExpand =
        paint
        && process.env.PATH_PAINT_SCENE_EXPAND !== '0'
        && process.env.PATH_PAINT_SCENE_EXPAND !== 'false';
    const clientSeg =
        paint
        && process.env.PATH_PAINT_CLIENT_SEG !== '0'
        && process.env.PATH_PAINT_CLIENT_SEG !== 'false';
    const teleports = opts?.teleports ?? useTeleportsFromEnv();
    const cameraFollow = opts?.cameraFollow ?? paint;
    return {
        paint,
        sceneExpand,
        clientSeg,
        teleports,
        cameraFollow,
        pathColor: '#FF0000',
        clientColor: '#00D4FF'
    };
}

// ── geometry / placement ────────────────────────────────────────────────────

export function cheb(a: NavTile, b: NavTile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function teleCmd(t: NavTile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

/**
 * Cheat-tele the character to `spot` (engine `tele` command).
 * This is placement seed, not a product spell/jewellery teleport.
 */
async function teleArriveExact(page: Page, spot: NavTile, maxDist: number): Promise<void> {
    // ~5 × ~3s max wait — not 6×16×150ms evaluate storms.
    for (let a = 0; a < 5; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 8; p++) {
            const t = await page.evaluate(() => {
                const g = globalThis as never as {
                    __rs2b0t: { reader: { worldTile(): NavTile | null } };
                };
                return g.__rs2b0t.reader.worldTile();
            });
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(DEFAULT_SETTLE_MS);
                return;
            }
            await page.waitForTimeout(DEFAULT_ARRIVAL_POLL_MS);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z},L${spot.level} failed`);
}

/**
 * After placement, pick a walkable stand near `origin` (scene collision).
 * Script anchors often sit on solid locs (search furniture, digs, rocks).
 */
async function nearestWalkableStandLive(
    page: Page,
    origin: NavTile,
    radius = 3
): Promise<NavTile | null> {
    return page.evaluate(
        ({ origin: o, radius: r }) => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): NavTile | null };
                    Reachability?: { walkable(t: NavTile): boolean };
                };
            };
            const walkable = (t: NavTile): boolean => {
                try {
                    return g.__rs2b0t.Reachability?.walkable(t) ?? false;
                } catch {
                    return false;
                }
            };
            if (walkable(o)) {
                return o;
            }
            const me = g.__rs2b0t.reader.worldTile();
            if (me && me.level === o.level && walkable(me) && Math.max(Math.abs(me.x - o.x), Math.abs(me.z - o.z)) <= r) {
                return me;
            }
            for (let rad = 1; rad <= r; rad++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    for (let dz = -rad; dz <= rad; dz++) {
                        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) {
                            continue;
                        }
                        const t = { x: o.x + dx, z: o.z + dz, level: o.level };
                        if (walkable(t)) {
                            return t;
                        }
                    }
                }
            }
            return null;
        },
        { origin, radius }
    );
}

/**
 * Cheat-tele to a **walkable** stand at/near `spot`.
 * Never leaves the character on top of an unwalkable loc (search furniture, etc.).
 */
export async function teleArrive(page: Page, spot: NavTile, maxDist = 12): Promise<void> {
    await teleArriveExact(page, spot, maxDist);
    const stand = await nearestWalkableStandLive(page, spot, 3);
    if (!stand) {
        // Scene may not have flags yet; accept placement and let pathfinder snap.
        return;
    }
    if (stand.x === spot.x && stand.z === spot.z && stand.level === spot.level) {
        return;
    }
    await teleArriveExact(page, stand, maxDist);
}

// ── energy / HP sustain (cheap polls — multi-suite MacBook friendly) ────────

/** Client energy 0–100. Prefer Game.energy(). */
export async function readRunEnergy(page: Page): Promise<number> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Game?: { energy(): number };
                reader: { energy(): number };
            };
        };
        try {
            return g.__rs2b0t.Game?.energy() ?? g.__rs2b0t.reader.energy();
        } catch {
            return g.__rs2b0t.reader.energy();
        }
    });
}

/** Effective / base hitpoints (1 if unread). */
export async function readHp(page: Page): Promise<{ effective: number; base: number }> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Skills: {
                    effective(n: string): number;
                    level(n: string): number;
                };
            };
        };
        try {
            return {
                effective: g.__rs2b0t.Skills.effective('hitpoints'),
                base: g.__rs2b0t.Skills.level('hitpoints')
            };
        } catch {
            return { effective: 1, base: 1 };
        }
    });
}

/** Full energy + run on via the content debugproc `~energy`.
 *  Why: plain `energy` is not an engine cheat and is silently ignored. */
export async function restoreRunEnergy(page: Page): Promise<boolean> {
    if (!(await cheatQuiet(page, '~energy', DEFAULT_SETTLE_MS + 100))) {
        return false;
    }
    await page.waitForTimeout(DEFAULT_SETTLE_MS);
    return (await readRunEnergy(page)) >= 90;
}

/**
 * Full HP via engine `setstat hitpoints <level>` (sets base + current).
 * No dedicated ~heal debugproc; this is the stock full-restore path.
 */
export async function restoreHp(page: Page, level = 99): Promise<boolean> {
    const lv = Math.max(1, Math.min(99, level | 0));
    if (!(await cheatQuiet(page, `setstat hitpoints ${lv}`, DEFAULT_SETTLE_MS + 100))) {
        return false;
    }
    await page.waitForTimeout(DEFAULT_SETTLE_MS);
    const hp = await readHp(page);
    return hp.effective >= Math.min(lv, hp.base) - 1;
}

/** Mid-walk: refill when energy ≤ lowAt. Logs when it fires. */
export async function maybeRefillEnergy(page: Page, lowAt = 25): Promise<boolean> {
    const e = await readRunEnergy(page);
    if (e > lowAt) {
        return false;
    }
    const ok = await restoreRunEnergy(page);
    const after = await readRunEnergy(page);
    console.log(
        `    energy refill: ${e}% → ${after}% (threshold ≤${lowAt}${ok ? '' : ', ~energy may have been busy/p_finduid'})`
    );
    return ok;
}

/**
 * Mid-walk HP top-up when effective ≤ lowAt.
 * Uses setstat (engine cheat) — not invuln; combat can still land between ticks.
 */
export async function maybeRestoreHp(page: Page, lowAt = 40, level = 99): Promise<boolean> {
    if (lowAt <= 0) {
        return false;
    }
    const before = await readHp(page);
    if (before.effective > lowAt) {
        return false;
    }
    const target = Math.max(before.base, Math.min(99, level | 0));
    const ok = await restoreHp(page, target);
    const after = await readHp(page);
    console.log(
        `    hp restore: ${before.effective}/${before.base} → ${after.effective}/${after.base}`
        + ` (threshold ≤${lowAt}${ok ? '' : ', setstat may have failed'})`
    );
    return ok;
}

export type SustainOpts = {
    /** Energy % threshold; omit/undefined = off. */
    energyRefillAt?: number;
    /** Effective HP threshold; 0/omit = off. */
    hpRefillAt?: number;
    /** setstat hitpoints target (default 99). */
    hpLevel?: number;
    /**
     * Min seconds between sustain checks (default 5).
     * Avoids per-second evaluate spam when many suites share a machine.
     */
    everySec?: number;
};

/** HP_REFILL_AT env: default 40; 0/false disables. */
export function hpRefillAtFromEnv(fallback = 40): number {
    const v = process.env.HP_REFILL_AT;
    if (v === '0' || v === 'false') {
        return 0;
    }
    if (v === undefined || v === '') {
        return fallback;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** SUSTAIN_EVERY_S env: default 5. Floor 2 so we never poll harder than that. */
export function sustainEverySecFromEnv(fallback = DEFAULT_SUSTAIN_EVERY_S): number {
    const n = Number(process.env.SUSTAIN_EVERY_S ?? fallback);
    if (!Number.isFinite(n) || n < 2) {
        return 2;
    }
    return Math.min(60, n);
}

/**
 * Throttled energy + HP sustain. Call from the walk poll; returns quickly when
 * not due. Single decision path so 6 concurrent fleets stay light.
 */
export async function maybeSustain(
    page: Page,
    opts: SustainOpts,
    lastAtMs: { t: number }
): Promise<void> {
    const everyMs = (opts.everySec ?? 5) * 1000;
    const now = Date.now();
    if (now - lastAtMs.t < everyMs) {
        return;
    }
    lastAtMs.t = now;

    const wantEnergy = opts.energyRefillAt !== undefined;
    const wantHp = opts.hpRefillAt !== undefined && opts.hpRefillAt > 0;
    if (!wantEnergy && !wantHp) {
        return;
    }

    // One evaluate for both gauges when either is watched.
    const snap = await page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Game?: { energy(): number };
                reader: { energy(): number };
                Skills: { effective(n: string): number; level(n: string): number };
            };
        };
        let energy = -1;
        let hp = 1;
        let hpBase = 1;
        try {
            energy = g.__rs2b0t.Game?.energy() ?? g.__rs2b0t.reader.energy();
        } catch {
            /* ignore */
        }
        try {
            hp = g.__rs2b0t.Skills.effective('hitpoints');
            hpBase = g.__rs2b0t.Skills.level('hitpoints');
        } catch {
            /* ignore */
        }
        return { energy, hp, hpBase };
    });

    if (wantEnergy && snap.energy >= 0 && snap.energy <= (opts.energyRefillAt as number)) {
        const ok = await restoreRunEnergy(page);
        const after = await readRunEnergy(page).catch(() => -1);
        console.log(
            `    energy refill: ${snap.energy}% → ${after}% (threshold ≤${opts.energyRefillAt}`
            + `${ok ? '' : ', ~energy may have been busy/p_finduid'})`
        );
    }
    if (wantHp && snap.hp <= (opts.hpRefillAt as number)) {
        const target = Math.max(snap.hpBase, Math.min(99, opts.hpLevel ?? 99));
        const ok = await restoreHp(page, target);
        const after = await readHp(page).catch(() => ({ effective: -1, base: -1 }));
        console.log(
            `    hp restore: ${snap.hp}/${snap.hpBase} → ${after.effective}/${after.base}`
            + ` (threshold ≤${opts.hpRefillAt}${ok ? '' : ', setstat may have failed'})`
        );
    }
}

export async function setTickRate(
    page: Page,
    ms: number,
    opts?: { strict?: boolean }
): Promise<void> {
    if (!(await cheatQuiet(page, `speed ${ms}`))) {
        throw new Error(`could not send speed ${ms}`);
    }
    const confirmed = await page.evaluate(expected => {
        const g = globalThis as never as {
            __rs2b0t: { reader: { chat(n: number): { text: string }[] } };
        };
        return g.__rs2b0t.reader.chat(16).some(l =>
            l.text.includes(`World speed was changed to ${expected}ms`)
        );
    }, ms);
    if (!confirmed) {
        if (opts?.strict !== false) {
            // Default soft: warn (travel-live style). Pass strict:true for throw.
        }
        if (opts?.strict === true) {
            throw new Error(`server did not confirm speed ${ms}ms`);
        }
        console.warn(`WARN: speed ${ms}ms not confirmed in chat`);
        return;
    }
    console.log(`  tick rate → ${ms}ms`);
}

// ── path paint settings ─────────────────────────────────────────────────────

/**
 * Dual red pack path + cyan client segment + optional camera follow / tele flag.
 * Applies both setSettings and SettingsStore.save (relog drops store).
 */
export async function applyNavPaintSettings(
    page: Page,
    flags: NavPaintFlags = pathPaintFlagsFromEnv()
): Promise<void> {
    await setSettings(page, 'Global', {
        showNavPath: flags.paint,
        navCameraFollow: flags.cameraFollow,
        navPathSceneExpand: flags.sceneExpand,
        navPathClientSegment: flags.clientSeg,
        navPathColorClient: flags.clientColor,
        navPathColorPath: flags.pathColor,
        navTeleports: flags.teleports
    });
    await page.evaluate(
        f => {
            const g = globalThis as never as {
                __rs2b0t: {
                    SettingsStore: { save(name: string, key: string, raw: string): void };
                };
            };
            const s = g.__rs2b0t.SettingsStore;
            s.save('Global', 'showNavPath', f.paint ? 'true' : 'false');
            s.save('Global', 'navCameraFollow', f.cameraFollow ? 'true' : 'false');
            s.save('Global', 'navPathSceneExpand', f.sceneExpand ? 'true' : 'false');
            s.save('Global', 'navPathClientSegment', f.clientSeg ? 'true' : 'false');
            s.save('Global', 'navPathColorClient', f.clientColor);
            s.save('Global', 'navPathColorPath', f.pathColor);
            s.save('Global', 'navTeleports', f.teleports ? 'true' : 'false');
        },
        {
            paint: flags.paint,
            sceneExpand: flags.sceneExpand,
            clientSeg: flags.clientSeg,
            cameraFollow: flags.cameraFollow,
            teleports: flags.teleports,
            clientColor: flags.clientColor,
            pathColor: flags.pathColor
        }
    );
}

// ── inventory seed (tele kit) ───────────────────────────────────────────────

/** Charged jewellery for OD Rub (plan scans inventory names). */
export const JEWELLERY_SEEDS: readonly SeedSpec[] = [
    {
        debug: 'ring_of_dueling_8',
        match: /Ring of dueling\(/,
        uncharged: /^Ring of dueling$/,
        label: 'duel ring'
    },
    {
        debug: 'amulet_of_glory_4',
        match: /Amulet of glory\(/,
        uncharged: /^Amulet of glory$/,
        label: 'glory'
    },
    {
        debug: 'necklace_of_minigames_8',
        match: /Games necklace\(/,
        uncharged: /^Games necklace$/,
        label: 'games neck'
    }
];

export const RUNE_SEEDS: readonly SeedSpec[] = [
    { debug: 'lawrune', match: /Law rune/i, qty: 80 },
    { debug: 'airrune', match: /Air rune/i, qty: 200 },
    { debug: 'firerune', match: /Fire rune/i, qty: 80 },
    { debug: 'waterrune', match: /Water rune/i, qty: 80 },
    { debug: 'earthrune', match: /Earth rune/i, qty: 80 }
];

export async function invHas(page: Page, match: RegExp): Promise<boolean> {
    return page.evaluate(pattern => {
        const g = globalThis as never as {
            __rs2b0t: { Inventory: { items(): { name: string | null }[] } };
        };
        const rx = new RegExp(pattern, 'i');
        return g.__rs2b0t.Inventory.items().some(it => it.name !== null && rx.test(it.name));
    }, match.source);
}

export async function invIsFull(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: { Inventory: { isFull(): boolean } };
        };
        return g.__rs2b0t.Inventory.isFull();
    });
}

/**
 * Drop backpack items whose display name matches `match` (e.g. uncharged glory).
 * Returns how many Drop ops were attempted.
 */
export async function dropInvMatching(page: Page, match: RegExp): Promise<number> {
    const dropped = await page.evaluate(async pattern => {
        const g = globalThis as never as {
            __rs2b0t: {
                Inventory: {
                    items(): { name: string | null; interact(action: string): boolean | Promise<boolean> }[];
                };
            };
        };
        const rx = new RegExp(pattern, 'i');
        let n = 0;
        // Snapshot names first — Drop mutates the list mid-iteration.
        const names = g.__rs2b0t.Inventory.items()
            .map(it => it.name)
            .filter((name): name is string => name !== null && rx.test(name));
        for (const name of names) {
            const item = g.__rs2b0t.Inventory.items().find(it => it.name === name);
            if (!item) {
                continue;
            }
            try {
                await item.interact('Drop');
                n++;
            } catch {
                /* mid-script drop can race; caller may retry seed */
            }
        }
        return n;
    }, match.source);
    if (dropped > 0) {
        await page.waitForTimeout(DEFAULT_SETTLE_MS);
    }
    return dropped;
}

/** Drop depleted charge jewellery so `give` can place charged copies. */
export async function dropUnchargedJewellery(page: Page, specs: readonly SeedSpec[] = JEWELLERY_SEEDS): Promise<number> {
    let total = 0;
    for (const j of specs) {
        if (j.uncharged) {
            total += await dropInvMatching(page, j.uncharged);
        }
    }
    return total;
}

/** Seed inventory via engine `give`; `debugOrCmd` takes a bare debug name, "name qty", or legacy "~item name qty".
 *  Why: content `~item` silently no-ops mid-script after long walks, where `give` has no p_finduid busy-guard. */
export async function seedItem(
    page: Page,
    debugOrCmd: string,
    displayMatch: string | RegExp,
    qty = 1,
    tries = 8
): Promise<void> {
    const re =
        typeof displayMatch === 'string'
            ? new RegExp(displayMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            : displayMatch;
    const m = /^(?:~item\s+)?(\S+)(?:\s+(\d+))?$/.exec(debugOrCmd.trim());
    const debugName = m?.[1] ?? debugOrCmd;
    const resolvedQty = m?.[2] !== undefined ? Number(m[2]) : qty;
    const cmds = [`give ${debugName} ${resolvedQty}`, `~item ${debugName} ${resolvedQty}`];
    // Fewer tries × coarser polls (was 8×4×200ms evaluate storm).
    const maxTries = Math.min(tries, 6);
    for (let i = 0; i < maxTries; i++) {
        await cheatQuiet(page, cmds[i % cmds.length]!);
        for (let poll = 0; poll < 3; poll++) {
            await page.waitForTimeout(DEFAULT_ARRIVAL_POLL_MS);
            const ok = await page.evaluate(pattern => {
                const g = globalThis as never as {
                    __rs2b0t: { Inventory: { items(): { name: string | null }[] } };
                };
                const rx = new RegExp(pattern, 'i');
                return g.__rs2b0t.Inventory.items().some(
                    it => it.name !== null && rx.test(it.name)
                );
            }, re.source);
            if (ok) {
                return;
            }
        }
    }
    const inv = await page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Inventory: { items(): { count?: number; name: string | null }[] };
            };
        };
        return g.__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => `${i.count ?? 1}× ${i.name}`)
            .join(', ');
    });
    throw new Error(
        `could not seed ${debugName} via give/~item (want ~ ${re}); inv=${inv || 'empty'}`
    );
}

export async function seedRunes(page: Page): Promise<void> {
    for (const r of RUNE_SEEDS) {
        if (!(await invHas(page, r.match))) {
            await seedItem(page, r.debug, r.match, r.qty ?? 1);
        }
    }
}

// ── 377-style prep helpers (tools-only; condition → seed/fix) ───────────────

/** Wait until the client is ingame with the scene fully built (`sceneState === 2`).
 *  Why: seeding while sceneState ≠ 2 thrashes; polls at {@link DEFAULT_STOP_POLL_MS} rather than sub-100ms. */
export async function waitSceneReady(page: Page, timeoutMs = 45_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ok = await page.evaluate(() => {
            try {
                const c = (globalThis as never as {
                    rs2b0t?: { client?: { ingame: boolean; sceneState: number } };
                }).rs2b0t?.client;
                return !!(c?.ingame && c.sceneState === 2);
            } catch {
                return false;
            }
        });
        if (ok) {
            return true;
        }
        await page.waitForTimeout(DEFAULT_STOP_POLL_MS);
    }
    return false;
}

/**
 * Batch `give <debug> <qty>` after scene ready (377 `giveItems`).
 * Prefer this over raw give spam mid-zone-rebuild.
 */
export async function giveItems(
    page: Page,
    items: readonly (readonly [string, number] | { name: string; qty?: number })[],
    opts?: { waitScene?: boolean }
): Promise<string[]> {
    if (opts?.waitScene !== false) {
        const ok = await waitSceneReady(page, 45_000);
        if (!ok) {
            console.warn('giveItems: scene not ready after 45s — sending give anyway');
        }
    }
    const failed: string[] = [];
    for (const entry of items) {
        const name = 'name' in entry ? entry.name : entry[0];
        const qty = 'name' in entry ? (entry.qty ?? 1) : (entry[1] ?? 1);
        const cmd = `give ${name} ${qty | 0}`;
        if (!(await cheatQuiet(page, cmd, DEFAULT_SETTLE_MS))) {
            failed.push(cmd);
        }
    }
    if (failed.length) {
        console.warn('giveItems failed:', failed.join('; '));
    }
    return failed;
}

/**
 * Batch engine `setstat <skill> <level>` (377 `setStats`).
 * Sets base + current; useful for skill gates and HP restore without ~maxme dialogs.
 */
export async function setStats(
    page: Page,
    stats: Record<string, number> | readonly (readonly [string, number])[],
    opts?: { waitMs?: number }
): Promise<string[]> {
    const waitMs = opts?.waitMs ?? DEFAULT_SETTLE_MS;
    const entries = Array.isArray(stats)
        ? stats
        : Object.entries(stats).map(([k, v]) => [k, v] as const);
    const failed: string[] = [];
    for (const [skill, level] of entries) {
        const cmd = `setstat ${String(skill).toLowerCase()} ${Number(level) | 0}`;
        if (!(await cheatQuiet(page, cmd, waitMs))) {
            failed.push(cmd);
        }
    }
    return failed;
}

/**
 * Full run energy + run on (377 `fillRunEnergy` name; same as {@link restoreRunEnergy}).
 */
export async function fillRunEnergy(page: Page): Promise<boolean> {
    return restoreRunEnergy(page);
}

/**
 * Condition → act: if inv lacks `match`, seed via give (377 mid-quest top-up style).
 * Returns true when item was already present or seed succeeded.
 */
export async function ensureInvItem(
    page: Page,
    debugName: string,
    match: RegExp | string,
    qty = 1
): Promise<boolean> {
    const re =
        typeof match === 'string'
            ? new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            : match;
    if (await invHas(page, re)) {
        return true;
    }
    try {
        await seedItem(page, debugName, re, qty);
        return true;
    } catch {
        return false;
    }
}

/** Ensure one charged copy of each jewellery seed is present.
 *  Why: depleted copies are dropped first, or a full pack of uncharged glories blocks `give amulet_of_glory_4` (#555 / P10). */
export async function ensureJewellery(
    page: Page,
    opts?: { useTeleports?: boolean }
): Promise<void> {
    const useTele = opts?.useTeleports ?? useTeleportsFromEnv();
    if (!useTele) {
        return;
    }
    for (const j of JEWELLERY_SEEDS) {
        if (await invHas(page, j.match)) {
            continue;
        }
        if (j.uncharged && (await invHas(page, j.uncharged))) {
            await dropInvMatching(page, j.uncharged);
        }
        // Pack may still be full of other uncharged jewellery — free those too.
        if (await invIsFull(page)) {
            await dropUnchargedJewellery(page);
        }
        await seedItem(page, j.debug, j.match, 1);
    }
}

/**
 * Seed runes + charged jewellery so product walkTo may cast/Rub.
 * When useTeleports is false, still seeds runes (spell tests can re-enable).
 */
export async function seedTeleKit(
    page: Page,
    stamp: () => string,
    opts?: { useTeleports?: boolean; waitScene?: boolean }
): Promise<void> {
    const useTele = opts?.useTeleports ?? useTeleportsFromEnv();
    // 377 lesson: seed after scene 2 so inv lists are populated.
    if (opts?.waitScene !== false) {
        const ok = await waitSceneReady(page, 30_000);
        if (!ok) {
            console.warn(`${stamp()} seedTeleKit: scene not ready — seeding anyway`);
        }
    }
    await seedRunes(page);
    if (useTele) {
        await ensureJewellery(page, { useTeleports: true });
        console.log(
            `${stamp()} seeded tele kit: runes + ${JEWELLERY_SEEDS.map(j => j.label).join(', ')} (real OD may Rub)`
        );
    } else {
        console.log(`${stamp()} seeded tele runes only (USE_TELEPORTS=0)`);
    }
}

// ── stuck / harness-abort helpers ───────────────────────────────────────────

/** Convert planner path cost (run-tile units, see edgeCosts.ts) to optimistic wall-clock seconds at the live tick rate.
 *  ticks ≈ cost / 2; wall ≈ ticks * tickMs. */
export function pathCostToEstSec(cost: number, tickMs: number): number {
    if (!(cost > 0) || !(tickMs > 0)) {
        return 0;
    }
    return (cost / 2) * (tickMs / 1000);
}

/** Last `path: cost N` line from walk logs (null if none yet). */
export function parsePathCostFromLogs(logs: readonly string[]): number | null {
    let last: number | null = null;
    for (const line of logs) {
        const m = /path:\s*cost\s+(\d+)/i.exec(line);
        if (m) {
            last = Number(m[1]);
        }
    }
    return last !== null && Number.isFinite(last) ? last : null;
}

/**
 * True when a leg failure means the multi-leg suite is no longer valid research
 * (wedged runner, kit seed death, tele placement failure) — not a product OD fail.
 */
export function isHarnessDeathDetail(detail: string): boolean {
    return (
        /is still running/i.test(detail)
        || /could not seed/i.test(detail)
        || /tele to .+\bfailed\b/i.test(detail)
        || /HARNESS_DEATH/i.test(detail)
    );
}

/** STUCK_ABORT default on; set 0/false to disable per-leg stuck kill. */
export function stuckAbortFromEnv(): StuckAbortOpts | undefined {
    if (!envDefaultOn('STUCK_ABORT')) {
        return undefined;
    }
    return {
        factor: Number(process.env.STUCK_FACTOR ?? 2.5) || 2.5,
        minElapsedMs: (Number(process.env.STUCK_MIN_S ?? 20) || 20) * 1000,
        noMoveMs: (Number(process.env.STUCK_NOMOVE_S ?? 12) || 12) * 1000,
        tickMs: Number(process.env.TICK_MS ?? 300) || 300
    };
}

/** HARNESS_SUITE_ABORT default on — kill travel suite on harness death. */
export function harnessSuiteAbortFromEnv(): boolean {
    return envDefaultOn('HARNESS_SUITE_ABORT');
}

// ── generic walkTo probe ────────────────────────────────────────────────────

export type StuckAbortOpts = {
    /**
     * Abort leg when elapsed ≥ max(minElapsedMs, factor × estMs) and the
     * character has not moved for noMoveMs. Est from planner path cost.
     */
    factor: number;
    minElapsedMs: number;
    noMoveMs: number;
    /** Game tick length used by the live harness (for cost → wall seconds). */
    tickMs: number;
};

export type RunNavWalkOpts = {
    dest: NavTile;
    budgetMs: number;
    radius?: number;
    useTeleports?: boolean;
    distanceBeforeTeleport?: number;
    allowTeleportIds?: string[];
    /** globalThis key for result (default __navLiveWalk). */
    resultKey?: string;
    scriptNamePrefix?: string;
    /** When set, mid-walk energy watch refills at this threshold. */
    energyRefillAt?: number;
    /**
     * When set (>0), mid-walk HP restore via setstat when effective ≤ threshold.
     * Checked on the same throttled sustain cadence as energy (not every second).
     */
    hpRefillAt?: number;
    /** setstat hitpoints target when restoring (default 99). */
    hpLevel?: number;
    /** Sustain poll period seconds (default 5). */
    sustainEverySec?: number;
    /** Log mid-walk position every N seconds (default 20). 0 = off. */
    progressEverySec?: number;
    /**
     * Outer poll period for done/tile/stuck (default {@link DEFAULT_WALK_POLL_MS}).
     * Prefer ≥1s; sub-second is almost never useful for multi-suite fleets.
     */
    pollMs?: number;
    /**
     * Per-leg early stop when wall time ≫ path-cost estimate and no tile move
     * (door thrash / pathfind loop). Does not abort the suite.
     */
    stuckAbort?: StuckAbortOpts;
};

type WalkSlot = {
    walkOk: boolean;
    tile: NavTile | null;
    logs: string[];
};

type WalkMidSlot = {
    tile: NavTile | null;
    pathCost: number | null;
    logs: string[];
};

/**
 * Stop the page runner if it is still active and wait until idle/stopped.
 * Required after harness poll timeout so the next leg can `start` (#554 / P1).
 */
export async function ensureRunnerStopped(
    page: Page,
    reason = 'harness stop',
    waitMs = 15_000
): Promise<void> {
    await page.evaluate(stopReason => {
        const g = globalThis as never as {
            rs2b0t?: { runner?: { state: string; stop(reason: string): void } };
        };
        const runner = g.rs2b0t?.runner;
        if (!runner) {
            return;
        }
        const state = runner.state;
        if (state === 'running' || state === 'paused' || state === 'stopping') {
            try {
                runner.stop(stopReason);
            } catch {
                /* already stopping / reason edge — next poll still waits */
            }
        }
    }, reason);

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        const state = await page.evaluate(() => {
            const g = globalThis as never as {
                rs2b0t?: { runner?: { state: string } };
            };
            return g.rs2b0t?.runner?.state ?? 'idle';
        });
        if (state === 'stopped' || state === 'idle' || state === 'crashed') {
            return;
        }
        await page.waitForTimeout(DEFAULT_STOP_POLL_MS);
    }
}

/** Start a one-shot LoopingBot that calls Traversal.walkTo and poll until done; the result slot is configurable so concurrent harnesses stay isolated.
 *  Why: the runner is always stopped before return, including on poll timeout, or multi-leg suites cascade with `'Nav…' is still running`; {@link RunNavWalkOpts.stuckAbort} ends a leg whose wall time far exceeds the planner estimate with no movement (door thrash), failing that leg alone. */
export async function runNavWalk(page: Page, opts: RunNavWalkOpts): Promise<NavWalkResult> {
    const resultKey = opts.resultKey ?? '__navLiveWalk';
    const midKey = `${resultKey}__mid`;
    const teleOn = opts.useTeleports !== false;
    const radius = opts.radius ?? 4;
    const progressEvery = opts.progressEverySec ?? 20;
    const pollMs = opts.pollMs ?? walkPollMsFromEnv();
    const stuck = opts.stuckAbort;
    const walkStartedAt = Date.now();
    let lastTile: NavTile | null = null;
    let lastMoveAt = walkStartedAt;
    let stuckReason: string | null = null;
    /** Throttle sustain so N concurrent fleets do not evaluate every outer poll. */
    const sustainClock = { t: 0 };
    const maxPolls = Math.ceil(opts.budgetMs / pollMs) + 20;

    try {
        await page.evaluate(
            ({
                destination,
                budgetMs,
                allowTeleportIds,
                distanceBeforeTeleport,
                teleOn,
                radius,
                resultKey,
                midKey,
                prefix
            }) => {
                const g = globalThis as never as Record<string, unknown> & {
                    __rs2b0t: {
                        reader: { worldTile(): NavTile | null };
                        LoopingBot: new () => { loop(): unknown; log(m: string): void };
                        Traversal: {
                            walkTo(
                                dest: NavTile,
                                o: {
                                    radius?: number;
                                    timeoutMs?: number;
                                    log?: (m: string) => void;
                                    useTeleportCatalog?: boolean;
                                    policy?: {
                                        useTeleports?: boolean;
                                        distanceBeforeTeleport?: number;
                                        allowTeleportIds?: string[];
                                    };
                                }
                            ): Promise<boolean>;
                        };
                        registerScript(m: { name: string; create(): unknown }): unknown;
                    };
                    rs2b0t: { runner: { start(meta: unknown): void; stop(reason: string): void } };
                };
                (g as Record<string, unknown>)[resultKey] = undefined;
                (g as Record<string, unknown>)[midKey] = {
                    tile: null,
                    pathCost: null,
                    logs: []
                } satisfies WalkMidSlot;

                const publishMid = (logs: string[], pathCost: number | null): void => {
                    (g as Record<string, unknown>)[midKey] = {
                        tile: g.__rs2b0t.reader.worldTile(),
                        pathCost,
                        logs: logs.slice(-24)
                    } satisfies WalkMidSlot;
                };

                class Probe extends g.__rs2b0t.LoopingBot {
                    override async loop(): Promise<void> {
                        const logs: string[] = [];
                        let pathCost: number | null = null;
                        try {
                            const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                                radius,
                                timeoutMs: budgetMs,
                                useTeleportCatalog: teleOn,
                                policy: {
                                    useTeleports: teleOn,
                                    distanceBeforeTeleport: distanceBeforeTeleport ?? 0,
                                    ...(allowTeleportIds ? { allowTeleportIds } : {})
                                },
                                log: m => {
                                    logs.push(m);
                                    this.log(m);
                                    const cm = /path:\s*cost\s+(\d+)/i.exec(m);
                                    if (cm) {
                                        pathCost = Number(cm[1]);
                                    }
                                    publishMid(logs, pathCost);
                                }
                            });
                            (g as Record<string, unknown>)[resultKey] = {
                                walkOk,
                                tile: g.__rs2b0t.reader.worldTile(),
                                logs
                            } satisfies WalkSlot;
                        } catch (e) {
                            (g as Record<string, unknown>)[resultKey] = {
                                walkOk: false,
                                tile: g.__rs2b0t.reader.worldTile(),
                                logs: [...logs, String(e)]
                            } satisfies WalkSlot;
                        } finally {
                            publishMid(logs, pathCost);
                            g.rs2b0t.runner.stop('harness stop');
                        }
                    }
                }
                g.rs2b0t.runner.start(
                    g.__rs2b0t.registerScript({
                        name: `${prefix}${Date.now()}`,
                        create: () => new Probe()
                    })
                );
            },
            {
                destination: opts.dest,
                budgetMs: opts.budgetMs,
                allowTeleportIds: opts.allowTeleportIds,
                distanceBeforeTeleport: opts.distanceBeforeTeleport,
                teleOn,
                radius,
                resultKey,
                midKey,
                prefix: opts.scriptNamePrefix ?? 'NavLive'
            }
        );

        for (let i = 0; i < maxPolls; i++) {
            // One page.evaluate per outer poll: done + mid tile/cost (no separate energy/hp).
            const poll = await page.evaluate(
                ({ resultKey, midKey }) => {
                    const g = globalThis as never as Record<string, unknown> & {
                        __rs2b0t: { reader: { worldTile(): NavTile | null } };
                        rs2b0t: { runner: { state: string } };
                    };
                    const state = g.rs2b0t.runner.state;
                    const done =
                        g[resultKey] !== undefined
                        && (state === 'stopped' || state === 'idle');
                    const slot = g[midKey] as WalkMidSlot | undefined;
                    return {
                        done,
                        tile: slot?.tile ?? g.__rs2b0t.reader.worldTile(),
                        pathCost: slot?.pathCost ?? null
                    };
                },
                { resultKey, midKey }
            );
            if (poll.done) {
                break;
            }

            if (poll.tile) {
                if (!lastTile || cheb(poll.tile, lastTile) > 0) {
                    lastMoveAt = Date.now();
                }
                lastTile = poll.tile;
            }

            if (stuck && poll.pathCost !== null && poll.pathCost > 0 && !stuckReason) {
                const elapsedMs = Date.now() - walkStartedAt;
                const noMoveMs = Date.now() - lastMoveAt;
                const estSec = pathCostToEstSec(poll.pathCost, stuck.tickMs);
                const estMs = estSec * 1000;
                const thresholdMs = Math.max(stuck.minElapsedMs, stuck.factor * estMs);
                if (elapsedMs >= thresholdMs && noMoveMs >= stuck.noMoveMs) {
                    stuckReason =
                        `harness stuck abort: elapsed=${Math.round(elapsedMs / 1000)}s `
                        + `est=${estSec.toFixed(1)}s cost=${poll.pathCost} `
                        + `noMove=${Math.round(noMoveMs / 1000)}s `
                        + `factor=${stuck.factor} (thrash vs path-cost estimate)`;
                    console.log(`    …${stuckReason}`);
                    await ensureRunnerStopped(page, 'harness stuck abort').catch(() => undefined);
                    // Give walkTo a moment to settle into the result slot after stop.
                    for (let w = 0; w < 12; w++) {
                        const settled = await page.evaluate(
                            ({ resultKey }) => {
                                const g = globalThis as never as Record<string, unknown> & {
                                    rs2b0t: { runner: { state: string } };
                                };
                                return (
                                    g[resultKey] !== undefined
                                    && (g.rs2b0t.runner.state === 'stopped'
                                        || g.rs2b0t.runner.state === 'idle'
                                        || g.rs2b0t.runner.state === 'crashed')
                                );
                            },
                            { resultKey }
                        );
                        if (settled) {
                            break;
                        }
                        await page.waitForTimeout(DEFAULT_STOP_POLL_MS);
                    }
                    break;
                }
            }

            // Energy + HP on a shared slow cadence (default 5s), not every outer poll.
            await maybeSustain(
                page,
                {
                    energyRefillAt: opts.energyRefillAt,
                    hpRefillAt: opts.hpRefillAt,
                    hpLevel: opts.hpLevel,
                    everySec: opts.sustainEverySec ?? DEFAULT_SUSTAIN_EVERY_S
                },
                sustainClock
            ).catch(() => undefined);

            // Progress ~every progressEvery seconds (scale by poll period).
            const progressEveryPolls = Math.max(1, Math.round((progressEvery * 1000) / pollMs));
            if (progressEvery > 0 && i > 0 && i % progressEveryPolls === 0) {
                const costNote =
                    poll.pathCost !== null
                        ? ` cost=${poll.pathCost} est≈${pathCostToEstSec(poll.pathCost, stuck?.tickMs ?? 300).toFixed(0)}s`
                        : '';
                console.log(
                    `    …walking ${poll.tile ? `${poll.tile.x},${poll.tile.z}` : '?'}${costNote}`
                );
            }
            await page.waitForTimeout(pollMs);
        }
    } finally {
        // Poll timeout (or evaluate throw) must not leave the runner running for the next leg.
        await ensureRunnerStopped(page, stuckReason ? 'harness stuck abort' : 'harness timeout').catch(
            () => undefined
        );
        await page
            .evaluate(({ midKey }) => {
                const g = globalThis as never as Record<string, unknown>;
                delete g[midKey];
            }, { midKey })
            .catch(() => undefined);
    }

    const result = await page.evaluate(
        ({ resultKey }) => {
            const g = globalThis as never as Record<string, unknown>;
            const r = g[resultKey] as WalkSlot | undefined;
            delete g[resultKey];
            return r ?? null;
        },
        { resultKey }
    );
    if (!result) {
        const logs = ['no result (timeout)'];
        if (stuckReason) {
            logs.unshift(stuckReason);
        }
        return { walkOk: false, tile: lastTile, logs };
    }
    if (stuckReason && !result.logs.some(l => l.includes('harness stuck abort'))) {
        return {
            walkOk: false,
            tile: result.tile ?? lastTile,
            logs: [...result.logs, stuckReason]
        };
    }
    return result;
}
