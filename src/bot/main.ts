import { actions, reader } from './adapter/ClientAdapter.js';
import { Chatter } from './behavior/Chatter.js';
import { Humanizer } from './behavior/Humanizer.js';
import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import { ActionRouter } from './input/ActionRouter.js';
import { VirtualInput } from './input/VirtualInput.js';
import { Navigator } from './nav/Navigator.js';
import { installAbi } from './runtime/abi.js';
import { AutoRelogin } from './runtime/AutoRelogin.js';
import { RenderGate, type RenderMode } from './runtime/RenderGate.js';
import { WelcomeDismisser } from './runtime/WelcomeScreen.js';
import { Scheduler } from './runtime/Scheduler.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import { StallGuard } from './runtime/StallGuard.js';
import BotPanel from './ui/BotPanel.js';
import Overlay from './ui/Overlay.js';
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

    // Slice 6 additive hook: bot.html?inputmode=synthetic forces every
    // script run synthetic (used by tools/synthetic-test.ts); default
    // behavior (no param) is untouched — scripts pick their own inputMode.
    const inputmode = params.get('inputmode');
    if (inputmode === 'synthetic' || inputmode === 'direct') {
        ActionRouter.force(inputmode);
    }

    const panelRoot = document.getElementById('bot-panel');
    if (panelRoot) {
        new BotPanel(panelRoot, BotHost);
    }

    const overlayCanvas = document.getElementById('overlay');
    if (overlayCanvas instanceof HTMLCanvasElement) {
        new Overlay(overlayCanvas);
    }

    // The stable script-facing ABI: externally-compiled scripts bind to
    // globalThis.__lcbuddy through the @lcbuddy/api shim (ADR-0004).
    installAbi();

    // Login keeper (Slice 7): re-login on disconnect while a script is active.
    // disable with bot.html?autorelogin=0; bot.html?autologin=1 also logs in
    // unprompted from the title screen using saved credentials (unattended).
    if (params.get('autorelogin') !== '0') {
        AutoRelogin.enable(params.get('autologin') === '1');
    }

    // Tier-2 stall recovery (Task 12): host-side frame listener that restarts a
    // hard-stalled script (frozen await the in-script watchdog can't reach),
    // preserving its anchor via RecoveryHints.
    StallGuard.enable();

    // Auto-close rs2b2t's login welcome_screen — it blocks all scene
    // interaction and would otherwise freeze every bot on the live server.
    WelcomeDismisser.enable();

    // Human-behaviour layer for every bot: run-energy management + fatigue
    // breaks. Disable with bot.html?humanize=0
    if (params.get('humanize') !== '0') {
        Humanizer.enable();
    }

    // Ambient social chatter — bots say human-like things now and then, so a
    // cluster reads like people hanging out. Mute with bot.html?chat=0
    if (params.get('chat') !== '0') {
        Chatter.enable();
    }

    // DevTools handle (works because this bundle never mangles names).
    (globalThis as Record<string, unknown>).lcbuddy = {
        client, host: BotHost, runner: ScriptRunner, registry: ScriptRegistry,
        reader, actions, navigator: Navigator, vinput: VirtualInput,
        router: ActionRouter, humanizer: Humanizer, scheduler: Scheduler,
        renderGate: RenderGate,
        setRenderMode: (mode: RenderMode) => RenderGate.setMode(mode),
        setCredentials: (u: string, p: string) => AutoRelogin.setCredentials(u, p),
        setAutoLogin: (on: boolean) => AutoRelogin.setAutoLogin(on)
    };
}
