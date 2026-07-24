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
import { SettingsStore } from './runtime/Settings.js';
import { StallGuard } from './runtime/StallGuard.js';
import BotPanel from './ui/BotPanel.js';
import Overlay from './ui/Overlay.js';
import { installPaintInput } from './ui/PaintInput.js';
import { paintState } from './api/hud/paintLogic.js';
import './scripts/index.js';

export { BotClient, BotHost };

if (typeof document !== 'undefined' && document.getElementById('canvas')) {
    const params = new URLSearchParams(window.location.search);
    const nodeid = parseInt(params.get('nodeid') ?? '10', 10);
    const lowmem = params.get('lowmem') !== '0';
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

    if (params.get('run') !== '0') {
        RunManager.enable();
    }

    if (typeof document !== 'undefined' && window.top === window.self) {
        document.addEventListener('visibilitychange', () => {
            RenderGate.setMode(document.hidden ? 'background' : 'focused');
        });
    }

    (globalThis as Record<string, unknown>).rs2b0t = {
        client, host: BotHost, runner: ScriptRunner, registry: ScriptRegistry,
        reader, actions, navigator: Navigator,
        router: ActionRouter, scheduler: Scheduler,
        renderGate: RenderGate,
        setRenderMode: (mode: RenderMode) => RenderGate.setMode(mode),
        setCredentials: (u: string, p: string) => AutoRelogin.setCredentials(u, p),
        setAutoLogin: (on: boolean) => AutoRelogin.setAutoLogin(on),
        clueProgress: () => ClueExecutor.current,
        paint: paintState,
        clueTraces: () => readTraceRing(localStorage, TRACE_STORAGE_KEY),
        settings: {
            save: (name: string, key: string, raw: string) => SettingsStore.save(name, key, raw),
            saved: (name: string, key: string) => SettingsStore.saved(name, key)
        }
    };
}
