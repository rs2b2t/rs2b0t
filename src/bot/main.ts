import { actions, reader } from './adapter/ClientAdapter.js';
import BotClient from './runtime/BotClient.js';
import { BotHost } from './runtime/BotHost.js';
import { ClueExecutor, TRACE_STORAGE_KEY } from './api/ai/clues/ClueExecutor.js';
import { readTraceRing } from './api/ai/clues/ClueTrace.js';
import { BotDiag } from './runtime/diag/BotDiag.js';
import { Input } from './input/Input.js';
import { Navigator } from './event/webwalk/Navigator.js';
import { setNavPackHost } from './event/webwalk/navPack.js';
import { installAbi } from './runtime/abi.js';
import { AutoRelogin } from './runtime/AutoRelogin.js';
import type { LoginCoordination } from './runtime/LoginCoordination.js';
import { RenderGate, type RenderMode } from './runtime/RenderGate.js';
import { RunManager } from './runtime/RunManager.js';
import { WelcomeDismisser } from './runtime/WelcomeScreen.js';
import { Scheduler } from './runtime/Scheduler.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import { SettingsStore } from './runtime/Settings.js';
import { StallGuard } from './runtime/StallGuard.js';
import { RandomEventGuardian } from './runtime/RandomEventGuardian.js';
import BotPanel from './panel/BotPanel.js';
import Overlay from './panel/Overlay.js';
import { installPaintInput } from './panel/PaintInput.js';
import { paintState } from './paint/paintLogic.js';
import { BUILD_INFO, formatBuildInfo } from './runtime/buildInfo.js';
import './scripts/index.js';

export { BotClient, BotHost };

if (typeof document !== 'undefined' && document.getElementById('canvas')) {
    // Bots on a wall are same-origin iframes, so the top window is where the one
    // shared collision pack lives; a standalone bot is its own top window.
    setNavPackHost(window.top ?? window);

    const params = new URLSearchParams(window.location.search);
    const nodeid = parseInt(params.get('nodeid') ?? '10', 10);
    const lowmem = params.get('lowmem') !== '0';
    const members = params.get('members') !== '0';

    const client = new BotClient(nodeid, lowmem, members);

    const panelRoot = document.getElementById('bot-panel');
    let panel: BotPanel | null = null;
    if (panelRoot) {
        panel = new BotPanel(panelRoot, BotHost, {
            enabled: () => RenderGate.enabled,
            setEnabled: enabled => {
                RenderGate.setEnabled(enabled);
                document.body.classList.toggle('rs2b0t-renderer-off', !enabled);
            }
        });
    }

    const overlayCanvas = document.getElementById('overlay');
    if (overlayCanvas instanceof HTMLCanvasElement) {
        new Overlay(overlayCanvas);
    }

    const gameCanvas = document.getElementById('canvas');
    if (gameCanvas) {
        installPaintInput(gameCanvas);
    }

    installAbi();

    if (params.get('autorelogin') !== '0') {
        AutoRelogin.enable(params.get('autologin') === '1');
    }

    StallGuard.enable();

    WelcomeDismisser.enable();

    // Always solve randoms when the scene is live — not only while a script loops.
    if (params.get('randomevents') !== '0') {
        RandomEventGuardian.enable();
    }

    if (params.get('run') !== '0') {
        RunManager.enable();
    }

    if (typeof document !== 'undefined' && window.top === window.self) {
        document.addEventListener('visibilitychange', () => {
            RenderGate.setMode(document.hidden ? 'background' : 'focused');
        });
    }

    console.log(`[rs2b0t] build ${formatBuildInfo()}`);

    (globalThis as Record<string, unknown>).rs2b0t = {
        client, host: BotHost, runner: ScriptRunner, registry: ScriptRegistry,
        reader, actions, navigator: Navigator,
        input: Input, scheduler: Scheduler,
        renderGate: RenderGate,
        build: BUILD_INFO,
        diag: () => BotDiag.drain(),
        setRenderMode: (mode: RenderMode) => RenderGate.setMode(mode),
        setCredentials: (u: string, p: string) => AutoRelogin.setCredentials(u, p),
        setAutoLogin: (on: boolean) => AutoRelogin.setAutoLogin(on),
        isAutoLogin: () => AutoRelogin.isAutoLogin(),
        setLoginCoordination: (coordination: LoginCoordination | null) => AutoRelogin.setLoginCoordination(coordination),
        startSelectedScript: () => panel?.startSelectedScript(),
        stopScript: () => panel?.stopScript(),
        setRendererEnabled: (enabled: boolean) => panel?.setRendererEnabled(enabled),
        clueProgress: () => ClueExecutor.current,
        paint: paintState,
        clueTraces: () => readTraceRing(localStorage, TRACE_STORAGE_KEY),
        settings: {
            save: (name: string, key: string, raw: string) => SettingsStore.save(name, key, raw),
            saved: (name: string, key: string) => SettingsStore.saved(name, key)
        }
    };
}
