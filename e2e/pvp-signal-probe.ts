/** PvP combat-signal probe: what the client can see when another player attacks. Two accounts in the wilderness — the victim samples every candidate raw client field ~10x/sec while the attacker drives OP_PLAYER2 ("Attack"). No bot code is touched and no script runs on either side, so this measures the deployed client.
 *  Scenarios: A idle_attacked (does self faceEntity get set), B npcfight_attacked (does retaliate re-target), C retaliate_off (the dependency plus varp 172 polarity), D npcfight_clean (negative control — self faceEntity stays <32768), E disengage (how fast the signal decays). */

//   HEADED=1 bun e2e/pvp-signal-probe.ts
//   BASE=http://localhost:8888 bun e2e/pvp-signal-probe.ts
import { appendFileSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8888' });
const OUT = process.env.OUT ?? '/private/tmp/claude-501/-Users-elliottriplett-code-rs2b0t/cc2acb14-438d-4a98-8272-fd65bec50360/scratchpad/pvp-probe.jsonl';
const stamp = Date.now().toString(36).slice(-6);
const VICTIM = process.env.VICTIM_NAME || `pvv${stamp}`;
const ATTACKER = process.env.ATTACKER_NAME || `pva${stamp}`;

/** option_nodef (content/pack/varp.pack:173). 0 = auto-retaliate ON. */
const RETALIATE_VARP = 172;
/** ClientAdapter's spare menu slot; OP_PLAYER2 shares the number by coincidence. */
const SCRATCH_SLOT = 499;
const OP_PLAYER2 = 499;

const DRAGON_FIELD = { x: 3096, z: 3814, level: 0 };
/** Low, quiet wilderness — no aggressive NPCs to muddy the idle scenarios. */
const QUIET_WILDY = { x: 3096, z: 3560, level: 0 };
/** Outside the wilderness, for parking the attacker during the control run. */
const EDGEVILLE = { x: 3094, z: 3493, level: 0 };

interface Row {
    t: number;
    loopCycle: number;
    deltime: number;
    selfSlot: number;
    tile: { x: number; z: number; level: number } | null;
    retaliateVarp: number;
    self: {
        faceEntity: number;
        combatCycle: number;
        health: number;
        totalHealth: number;
        damageValues: number[];
        damageCycles: number[];
        primaryAnim: number;
    };
    hp: number;
    players: { id: number; name: string | null; faceEntity: number; combatCycle: number; d: number }[];
    npcs: { idx: number; name: string | null; faceEntity: number; combatCycle: number; d: number }[];
}

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/** Installs a self-contained sampler in the page; drained from Node between phases. */
async function installSampler(page: Page, retaliateVarp: number): Promise<void> {
    await page.evaluate(varpIdx => {
        const g = globalThis as never as {
            rs2b0t: { client: Record<string, never> };
            __rs2b0t: { Skills: { effective(n: string): number } };
            __probe?: { rows: unknown[]; timer: number; phase: string };
        };
        if (g.__probe) {
            clearInterval(g.__probe.timer);
        }
        const rows: unknown[] = [];
        const tick = (): void => {
            const c = g.rs2b0t.client as never as Record<string, never>;
            const lp = c.localPlayer as never as Record<string, never> | null;
            if (!lp) {
                return;
            }
            const baseX = c.mapBuildBaseX as never as number;
            const baseZ = c.mapBuildBaseZ as never as number;
            const px = baseX + ((lp.x as never as number) >> 7);
            const pz = baseZ + ((lp.z as never as number) >> 7);

            const players: unknown[] = [];
            for (let i = 0; i < (c.playerCount as never as number); i++) {
                const id = (c.playerIds as never as number[])[i];
                const p = (c.players as never as Record<string, never>[])[id];
                if (!p) {
                    continue;
                }
                const x = baseX + ((p.x as never as number) >> 7);
                const z = baseZ + ((p.z as never as number) >> 7);
                players.push({
                    id,
                    name: p.name ?? null,
                    faceEntity: p.faceEntity,
                    combatCycle: p.combatCycle,
                    d: Math.max(Math.abs(x - px), Math.abs(z - pz))
                });
            }

            const npcs: unknown[] = [];
            for (let i = 0; i < (c.npcCount as never as number); i++) {
                const idx = (c.npcIds as never as number[])[i];
                const n = (c.npc as never as Record<string, never>[])[idx];
                if (!n) {
                    continue;
                }
                const x = baseX + ((n.x as never as number) >> 7);
                const z = baseZ + ((n.z as never as number) >> 7);
                const d = Math.max(Math.abs(x - px), Math.abs(z - pz));
                if (d > 12) {
                    continue;
                }
                npcs.push({
                    idx,
                    name: (n.type as never as { name?: string } | null)?.name ?? null,
                    faceEntity: n.faceEntity,
                    combatCycle: n.combatCycle,
                    d
                });
            }

            rows.push({
                t: Date.now(),
                phase: g.__probe?.phase ?? '',
                loopCycle: (c.constructor as never as { loopCycle: number }).loopCycle,
                deltime: c.deltime,
                selfSlot: c.selfSlot,
                tile: { x: px, z: pz, level: c.minusedlevel },
                retaliateVarp: (c.var as never as number[])[varpIdx] ?? -1,
                self: {
                    faceEntity: lp.faceEntity,
                    combatCycle: lp.combatCycle,
                    health: lp.health,
                    totalHealth: lp.totalHealth,
                    damageValues: Array.from(lp.damageValues as never as number[]),
                    damageCycles: Array.from(lp.damageCycles as never as number[]),
                    primaryAnim: lp.primaryAnim
                },
                hp: g.__rs2b0t.Skills.effective('hitpoints'),
                players,
                npcs
            });
        };
        g.__probe = { rows, phase: '', timer: setInterval(tick, 100) as never as number };
    }, retaliateVarp);
}

async function setPhase(page: Page, phase: string): Promise<void> {
    await page.evaluate(p => {
        (globalThis as never as { __probe: { phase: string } }).__probe.phase = p;
    }, phase);
}

async function drain(page: Page): Promise<Row[]> {
    return page.evaluate(() => {
        const pr = (globalThis as never as { __probe: { rows: unknown[] } }).__probe;
        const out = pr.rows.slice();
        pr.rows.length = 0;
        return out as never as Row[];
    });
}

/** Drive OP_PLAYER2 ("Attack", granted by wilderness_enter) at a named player. */
async function attackPlayer(page: Page, targetName: string): Promise<boolean> {
    return page.evaluate(
        ([name, slot, op]) => {
            const c = (globalThis as never as { rs2b0t: { client: Record<string, never> } }).rs2b0t
                .client as never as Record<string, never>;
            const norm = (s: string | null): string => (s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
            let idx = -1;
            for (let i = 0; i < (c.playerCount as never as number); i++) {
                const id = (c.playerIds as never as number[])[i];
                const p = (c.players as never as Record<string, never>[])[id];
                if (p && norm(p.name as never as string) === norm(name as string)) {
                    idx = id;
                    break;
                }
            }
            if (idx < 0) {
                return false;
            }
            (c.menuAction as never as number[])[slot as number] = op as number;
            (c.menuParamA as never as number[])[slot as number] = idx;
            (c.menuParamB as never as number[])[slot as number] = 0;
            (c.menuParamC as never as number[])[slot as number] = 0;
            (c.doAction as never as (n: number) => void).call(c, slot as number);
            return true;
        },
        [targetName, SCRATCH_SLOT, OP_PLAYER2] as const
    );
}

/** Victim attacks the nearest attackable NPC, to establish the mid-fight state. */
async function attackNearestNpc(page: Page): Promise<string | null> {
    return page.evaluate(async () => {
        const q = (
            globalThis as never as {
                __rs2b0t: {
                    Npcs: {
                        query(): {
                            results(): {
                                name: string | null;
                                distance(): number;
                                actions(): string[];
                                interact(a: string): boolean | Promise<boolean>;
                            }[];
                        };
                    };
                };
            }
        ).__rs2b0t.Npcs.query().results();
        const target = q
            .filter(n => n.actions().includes('Attack'))
            .sort((a, b) => a.distance() - b.distance())[0];
        if (!target) {
            return null;
        }
        const ok = await target.interact('Attack');
        return ok ? target.name : null;
    });
}

/** The attacker's own chat, which is the decisive evidence for a refused attack.
 *  Why: pvp_in_combat_check mes()es the reason ("Someone else is already fighting your opponent." / "I'm already under attack.") rather than failing silently. */
async function chatOf(page: Page, n = 20): Promise<string[]> {
    return page.evaluate(
        c =>
            (globalThis as never as { __rs2b0t: { reader: { chat(k: number): { text: string }[] } } }).__rs2b0t.reader
                .chat(c)
                .map(l => l.text)
                .filter(t => t.length > 0),
        n
    );
}

function tileOf(page: Page): Promise<{ x: number; z: number; level: number } | null> {
    return page.evaluate(
        () =>
            (globalThis as never as { __rs2b0t: { Game: { tile(): { x: number; z: number; level: number } | null } } })
                .__rs2b0t.Game.tile()
    );
}

/** True once our own target is an NPC — i.e. we are mid-NPC-fight. */
function inNpcFight(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const lp = (globalThis as never as { rs2b0t: { client: Record<string, never> } }).rs2b0t.client
            .localPlayer as never as { faceEntity: number } | null;
        return lp !== null && lp.faceEntity >= 0 && lp.faceEntity < 32768;
    });
}

/** A single click gets dropped or cleared; a PKer keeps clicking. */
async function sustainAttack(page: Page, targetName: string, ms: number): Promise<number> {
    const until = Date.now() + ms;
    let sent = 0;
    while (Date.now() < until) {
        if (await attackPlayer(page, targetName)) {
            sent++;
        }
        await page.waitForTimeout(1200);
    }
    return sent;
}

/** Keep the victim engaged with an NPC for the full window. */
async function sustainNpcFight(page: Page, ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (!(await inNpcFight(page))) {
            await attackNearestNpc(page);
        }
        await page.waitForTimeout(1200);
    }
}

function readVarp(page: Page, idx: number): Promise<number> {
    return page.evaluate(
        i => (globalThis as never as { __rs2b0t: { reader: { varp(n: number): number } } }).__rs2b0t.reader.varp(i),
        idx
    );
}

/** Exercise the production toggle and report whether it moved the varp.
 *  Why: the design depends on this mechanism, so measure it rather than assume it. */
async function tryProductionToggle(page: Page, on: boolean): Promise<{ returned: boolean; controls: boolean; varp: number }> {
    const before = await readVarp(page, RETALIATE_VARP);
    const r = await page.evaluate(v => {
        const g = globalThis as never as {
            __rs2b0t: {
                Game: { setAutoRetaliate(b: boolean): boolean };
                reader: { retaliateControls(): { onComId: number; offComId: number } | null };
            };
        };
        return {
            controls: g.__rs2b0t.reader.retaliateControls() !== null,
            returned: g.__rs2b0t.Game.setAutoRetaliate(v)
        };
    }, on);
    await page.waitForTimeout(1500);
    const varp = await readVarp(page, RETALIATE_VARP);
    console.log(
        `    setAutoRetaliate(${on}): returned=${r.returned} controlsFound=${r.controls} varp ${before} -> ${varp} (want ${on ? 0 : 1})`
    );
    return { returned: r.returned, controls: r.controls, varp };
}

/** Authoritative state set, independent of the UI path, so scenarios still run. */
async function forceRetaliate(page: Page, on: boolean): Promise<number> {
    await cheatQuiet(page, `setvar option_nodef ${on ? 0 : 1}`);
    await page.waitForTimeout(800);
    const varp = await readVarp(page, RETALIATE_VARP);
    console.log(`    forced retaliate ${on ? 'ON' : 'OFF'} via setvar -> varp ${varp} (want ${on ? 0 : 1})`);
    return varp;
}

/** ::tele leaves the scene un-rebuilt, so the player list can lag the arrival. */
async function waitForPlayerVisible(page: Page, name: string, timeoutMs = 30_000): Promise<boolean> {
    return page
        .waitForFunction(
            n => {
                const c = (globalThis as never as { rs2b0t: { client: Record<string, never> } }).rs2b0t
                    .client as never as Record<string, never>;
                const norm = (s: string | null): string => (s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                for (let i = 0; i < (c.playerCount as never as number); i++) {
                    const p = (c.players as never as Record<string, never>[])[(c.playerIds as never as number[])[i]];
                    if (p && norm(p.name as never as string) === norm(n as string)) {
                        return true;
                    }
                }
                return false;
            },
            name,
            { timeout: timeoutMs }
        )
        .then(() => true)
        .catch(() => false);
}

/** Persist and report per phase — a later phase failing must not cost earlier data. */
let total = 0;
async function collect(page: Page, phase: string, ms: number, attackerName: string): Promise<Row[]> {
    await page.waitForTimeout(ms);
    const rows = await drain(page);
    total += rows.length;
    if (rows.length > 0) {
        appendFileSync(OUT, `${rows.map(r => JSON.stringify(r)).join('\n')}\n`);
    }
    report(phase, rows, attackerName);
    console.log(`  (${total} samples written to ${OUT})`);
    return rows;
}

/** Summarise what the signal did during a phase. */
function report(phase: string, rows: Row[], attackerName: string): void {
    const norm = (s: string | null): string => (s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const selfFacedPlayer = rows.filter(r => r.self.faceEntity >= 32768);
    const selfFacedNpc = rows.filter(r => r.self.faceEntity >= 0 && r.self.faceEntity < 32768);
    const attackerTargetedUs = rows.filter(r =>
        r.players.some(p => norm(p.name) === norm(attackerName) && p.faceEntity - 32768 === r.selfSlot)
    );
    const tookDamage = rows.filter(r => r.self.damageCycles.some(c => c > r.loopCycle));

    console.log(`\n=== ${phase} (${rows.length} samples over ${rows.length ? ((rows[rows.length - 1].t - rows[0].t) / 1000).toFixed(1) : 0}s) ===`);
    console.log(`  retaliate varp(${RETALIATE_VARP}) : ${[...new Set(rows.map(r => r.retaliateVarp))].join(',')}  (0 = ON)`);
    console.log(`  self.faceEntity >= 32768 (a player) : ${selfFacedPlayer.length}/${rows.length} samples`);
    console.log(`  self.faceEntity is an npc          : ${selfFacedNpc.length}/${rows.length} samples`);
    console.log(`  attacker's faceEntity == our slot   : ${attackerTargetedUs.length}/${rows.length} samples`);
    console.log(`  samples showing fresh damage on us  : ${tookDamage.length}`);
    if (rows.length) {
        const t0 = rows[0].t;
        const firstDmg = tookDamage[0];
        const firstFlip = selfFacedPlayer[0];
        const firstTargeted = attackerTargetedUs[0];
        if (firstTargeted) {
            console.log(`  attacker targeted us at  +${((firstTargeted.t - t0) / 1000).toFixed(2)}s`);
        }
        if (firstDmg) {
            console.log(`  first damage on us at    +${((firstDmg.t - t0) / 1000).toFixed(2)}s`);
        }
        if (firstFlip) {
            console.log(`  our faceEntity flipped at +${((firstFlip.t - t0) / 1000).toFixed(2)}s  -> slot ${firstFlip.self.faceEntity - 32768}`);
            if (firstDmg) {
                console.log(`  >> lag from first hit to flip: ${((firstFlip.t - firstDmg.t) / 1000).toFixed(2)}s`);
            }
        } else {
            console.log('  our faceEntity NEVER pointed at a player');
        }
        const lastFlip = selfFacedPlayer[selfFacedPlayer.length - 1];
        if (lastFlip && firstFlip) {
            console.log(`  held player-target for    ${((lastFlip.t - firstFlip.t) / 1000).toFixed(1)}s (last sample +${((lastFlip.t - t0) / 1000).toFixed(1)}s)`);
        }
        // A phase that never established its own preconditions proves nothing —
        // run 2's scenario B looked like a disproof but was an idle attacker.
        const engagedPct = Math.round((attackerTargetedUs.length / rows.length) * 100);
        const npcPct = Math.round((selfFacedNpc.length / rows.length) * 100);
        console.log(`  PRECONDITIONS: attacker engaged ${engagedPct}% of samples | victim in npc-fight ${npcPct}%`);
    }
}

console.log(`pvp-signal-probe base=${base} victim=${VICTIM} attacker=${ATTACKER}`);
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const at = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

try {
    const victim = await (await browser.newContext()).newPage();
    const attacker = await (await browser.newContext()).newPage();

    console.log(`${at()} bring up victim '${VICTIM}'`);
    await mainlandAccount(victim, base, VICTIM);
    await maxmeAndClearDialogs(victim);
    await clearChatDialogs(victim);

    console.log(`${at()} bring up attacker '${ATTACKER}'`);
    await mainlandAccount(attacker, base, ATTACKER);
    await maxmeAndClearDialogs(attacker);
    await clearChatDialogs(attacker);
    await cheatQuiet(attacker, 'give rune_scimitar 1');
    await attacker.evaluate(async () => {
        const inv = (
            globalThis as never as {
                __rs2b0t: { Inventory: { items(): { name: string | null; interact(o: string): boolean | Promise<boolean> }[] } };
            }
        ).__rs2b0t.Inventory.items();
        const scim = inv.find(i => (i.name ?? '').toLowerCase().includes('scimitar'));
        if (scim) {
            await scim.interact('Wield');
        }
    });

    await installSampler(victim, RETALIATE_VARP);
    writeFileSync(OUT, '');

    /** Both parties in place and able to see each other before any attack. */
    async function stage(spot: { x: number; z: number; level: number }): Promise<void> {
        await cheatQuiet(victim, '~maxme');
        if (!(await teleTo(victim, spot, 12))) fail(`victim tele to ${spot.x},${spot.z} failed`);
        if (!(await teleTo(attacker, spot, 12))) fail(`attacker tele to ${spot.x},${spot.z} failed`);
        if (!(await waitForPlayerVisible(attacker, VICTIM))) fail('attacker never saw the victim after tele');
    }

    async function strike(phase: string): Promise<void> {
        await setPhase(victim, phase);
        await drain(victim);
        if (!(await attackPlayer(attacker, VICTIM))) fail(`${phase}: attack action did not dispatch`);
    }

    // --- A: idle victim, attacked -------------------------------------------
    console.log(`${at()} A: idle victim in quiet wilderness`);
    await stage(QUIET_WILDY);
    console.log(`${at()}   production toggle, ON:`);
    await tryProductionToggle(victim, true);
    await forceRetaliate(victim, true);
    await strike('A_idle_attacked');
    await collect(victim, 'A idle, attacked', 14_000, ATTACKER);
    console.log(`  attacker chat: ${JSON.stringify((await chatOf(attacker)).slice(0, 5))}`);

    // --- B: victim mid-NPC-fight, attacked ----------------------------------
    // Why: both sides are held engaged for the full window — run 2's B was inconclusive when the attacker never sustained its attack.
    console.log(`${at()} B: victim mid-NPC-fight at the dragon field`);
    await stage(DRAGON_FIELD);
    const npc = await attackNearestNpc(victim);
    console.log(`${at()}   victim attacking '${npc ?? 'NOTHING'}'`);
    await victim.waitForTimeout(2500);
    if (!(await inNpcFight(victim))) fail('B: victim is not in an NPC fight — precondition unmet');
    // Park the attacker on top of the victim so melee never falls out of range.
    const vTile = await tileOf(victim);
    if (vTile && !(await teleTo(attacker, vTile, 2))) fail('B: attacker could not close on the victim');
    if (!(await waitForPlayerVisible(attacker, VICTIM))) fail('B: attacker lost sight of the victim');
    await setPhase(victim, 'B_npcfight_attacked');
    await drain(victim);
    const [sentB] = await Promise.all([
        sustainAttack(attacker, VICTIM, 20_000),
        sustainNpcFight(victim, 20_000),
        collect(victim, 'B mid-NPC-fight, attacked', 20_000, ATTACKER)
    ]);
    console.log(`  (attacker re-issued Attack ${sentB}x)`);
    console.log(`  attacker chat: ${JSON.stringify((await chatOf(attacker)).slice(0, 8))}`);
    console.log(`  victim chat:   ${JSON.stringify((await chatOf(victim)).slice(0, 5))}`);

    // --- C: retaliate off ----------------------------------------------------
    console.log(`${at()} C: retaliate OFF`);
    await stage(QUIET_WILDY);
    console.log(`${at()}   production toggle, OFF:`);
    await tryProductionToggle(victim, false);
    if ((await forceRetaliate(victim, false)) !== 1) fail('C: could not force retaliate off');
    const cTile = await tileOf(victim);
    if (cTile && !(await teleTo(attacker, cTile, 2))) fail('C: attacker could not close on the victim');
    await setPhase(victim, 'C_retaliate_off');
    await drain(victim);
    const [sentC] = await Promise.all([
        sustainAttack(attacker, VICTIM, 16_000),
        collect(victim, 'C retaliate OFF, attacked', 16_000, ATTACKER)
    ]);
    console.log(`  (attacker re-issued Attack ${sentC}x)`);
    console.log(`  attacker chat: ${JSON.stringify((await chatOf(attacker)).slice(0, 5))}`);

    // --- D: NPC fight, no attacker (negative control) ------------------------
    console.log(`${at()} D: NPC fight with the attacker parked outside the wilderness`);
    await forceRetaliate(victim, true);
    await cheatQuiet(victim, '~maxme');
    if (!(await teleTo(attacker, EDGEVILLE, 10))) fail('attacker tele to Edgeville failed');
    if (!(await teleTo(victim, DRAGON_FIELD, 12))) fail('victim tele to dragon field failed');
    await victim.waitForTimeout(2500);
    const npcD = await attackNearestNpc(victim);
    console.log(`${at()}   victim attacking '${npcD ?? 'NOTHING'}'`);
    await setPhase(victim, 'D_npcfight_clean');
    await drain(victim);
    await collect(victim, 'D NPC fight, no attacker (control)', 25_000, ATTACKER);

    // --- E: attacker disengages ---------------------------------------------
    // An idle victim, so the signal is known to arm (per A); the measurement is whether it ever clears once the attacker is gone.
    console.log(`${at()} E: attacked, then the attacker leaves`);
    await stage(QUIET_WILDY);
    await forceRetaliate(victim, true);
    const eTile = await tileOf(victim);
    if (eTile && !(await teleTo(attacker, eTile, 2))) fail('E: attacker could not close on the victim');
    await setPhase(victim, 'E_disengage');
    await drain(victim);
    await sustainAttack(attacker, VICTIM, 8000);
    const armed = await victim.evaluate(() => {
        const lp = (globalThis as never as { rs2b0t: { client: Record<string, never> } }).rs2b0t.client
            .localPlayer as never as { faceEntity: number } | null;
        return lp !== null && lp.faceEntity >= 32768;
    });
    if (!armed) fail('E: signal never armed — cannot measure decay');
    console.log(`${at()}   signal armed; attacker leaving`);
    await teleTo(attacker, EDGEVILLE, 10);
    await collect(victim, 'E attacker disengages', 25_000, ATTACKER);

    console.log(`\ntotal ${total} samples -> ${OUT}`);
} finally {
    await browser.close();
}
