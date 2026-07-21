/**
 * Standalone bot-client entry point (bot.html): boots BotClient, attaches the
 * adapter, exposes the __rs2b0t script ABI + window.rs2b0t debug handle, and
 * mounts the panel/overlay UI.
 */
import { actions, reader } from './adapter/ClientAdapter.js';
import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import { ClueExecutor, TRACE_STORAGE_KEY } from './clues/ClueExecutor.js';
import { readTraceRing } from './clues/ClueTrace.js';
import { ActionRouter } from './input/ActionRouter.js';
import { Navigator } from './nav/Navigator.js';
import { installAbi } from './runtime/abi.js';
import { AutoRelogin } from './runtime/AutoRelogin.js';
import { RenderGate, type RenderMode } from './runtime/RenderGate.js';
import { RunManager } from './runtime/RunManager.js';
import { WelcomeDismisser } from './runtime/WelcomeScreen.js';
import { Scheduler } from './runtime/Scheduler.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import { StallGuard } from './runtime/StallGuard.js';
import BotPanel from './ui/BotPanel.js';
import Overlay from './ui/Overlay.js';
import { installPaintInput } from './ui/PaintInput.js';
import { paintState } from './api/hud/paintLogic.js';
import './scripts/index.js';

export { BotClient, BotHost };

// Self-boot when loaded in a page that provides the game canvas (bot.html).
// Connection args mirror /rs2.cgi defaults; override via query string, e.g.
// bot.html?nodeid=10&members=0&lowmem=1
if (typeof document !== 'undefined' && document.getElementById('canvas')) {
    const params = new URLSearchParams(window.location.search);
    const nodeid = parseInt(params.get('nodeid') ?? '10', 10);
    const lowmem = params.get('lowmem') === '1';
    const members = params.get('members') !== '0';

    const client = new BotClient(nodeid, lowmem, members);

    const panelRoot = document.getElementById('bot-panel');
    if (panelRoot) {
        new BotPanel(panelRoot, BotHost);
    }

    const overlayCanvas = document.getElementById('overlay');
    if (overlayCanvas instanceof HTMLCanvasElement) {
        new Overlay(overlayCanvas);
    }

    // Interactive paints: capture-phase hit-testing on the game canvas so
    // clicks inside a bot's paint never reach the client (see PaintInput.ts)
    const gameCanvas = document.getElementById('canvas');
    if (gameCanvas) {
        installPaintInput(gameCanvas);
    }

    // The stable script-facing ABI: externally-compiled scripts bind to
    // globalThis.__rs2b0t through the @rs2b0t/api shim (ADR-0004).
    installAbi();

    // Login keeper: re-login on disconnect while a script is active.
    // disable with bot.html?autorelogin=0; bot.html?autologin=1 also logs in
    // unprompted from the title screen using saved credentials (unattended).
    if (params.get('autorelogin') !== '0') {
        AutoRelogin.enable(params.get('autologin') === '1');
    }

    // Tier-2 stall recovery: host-side frame listener that restarts a
    // hard-stalled script (frozen await the in-script watchdog can't reach),
    // preserving its anchor via RecoveryHints.
    StallGuard.enable();

    // Auto-close rs2b2t's login welcome_screen — it blocks all scene
    // interaction and would otherwise freeze every bot on the live server.
    WelcomeDismisser.enable();

    // Keep run toggled on whenever there's energy, for every bot (the walkers
    // don't manage run themselves). Disable with bot.html?run=0.
    if (params.get('run') !== '0') {
        RunManager.enable();
    }

    // Standalone hosted client: the frame loop keeps ticking while minimized
    // (WorkerClock is immune to background throttling), so the bot stays
    // connected — but drop draws to the background cadence to save CPU when the
    // tab is hidden. Skipped inside a MultiBox iframe (window.top !== self),
    // where the wall manager owns each cell's render mode.
    if (typeof document !== 'undefined' && window.top === window.self) {
        document.addEventListener('visibilitychange', () => {
            RenderGate.setMode(document.hidden ? 'background' : 'focused');
        });
    }

    // DevTools handle (works because this bundle never mangles names).
    (globalThis as Record<string, unknown>).rs2b0t = {
        client, host: BotHost, runner: ScriptRunner, registry: ScriptRegistry,
        reader, actions, navigator: Navigator,
        router: ActionRouter, scheduler: Scheduler,
        renderGate: RenderGate,
        setRenderMode: (mode: RenderMode) => RenderGate.setMode(mode),
        setCredentials: (u: string, p: string) => AutoRelogin.setCredentials(u, p),
        setAutoLogin: (on: boolean) => AutoRelogin.setAutoLogin(on),
        /** Live solve progress + the persisted last-5-failed-solve traces. */
        clueProgress: () => ClueExecutor.current,
        paint: paintState,
        clueTraces: () => readTraceRing(localStorage, TRACE_STORAGE_KEY)
    };
}
