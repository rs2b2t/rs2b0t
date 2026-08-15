import { BUILD_INFO } from '../runtime/buildInfo.js';
import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../runtime/BotHost.js';
import { AutoRelogin } from '../runtime/AutoRelogin.js';
import { boxId, boxKey, wallLinkHref } from '../runtime/box.js';
import { Credentials } from '../runtime/Credentials.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { GLOBAL_SETTINGS_CORE, NAV_SETTINGS, SettingsStore } from '../runtime/Settings.js';
import ScriptLibrary from './ScriptLibrary.js';
import ParamsModal from './ParamsModal.js';
import { LoadoutPanel } from './LoadoutPanel.js';
import { isVisible, summarize } from './paramControls.js';
import { el } from './dom.js';

// Why: boxId() reads the live URL, so freezing this at module load pins the key to whatever box was current when BotPanel was first imported.
const selectedScriptKey = (): string => boxKey('selectedScript');
const rendererEnabledKey = (): string => boxKey('rendererEnabled');

interface RendererControl {
    enabled(): boolean;
    setEnabled(enabled: boolean): void;
}

export default class BotPanel {
    private host: BotHostImpl;

    private library!: ScriptLibrary;
    private selectedScript = '';
    private scriptName!: HTMLElement;
    private browseBtn!: HTMLButtonElement;
    private startBtn: HTMLButtonElement;
    private pauseBtn: HTMLButtonElement;
    private stopBtn: HTMLButtonElement;
    private scriptStatus: HTMLElement;
    private logBox: HTMLElement;
    private unsubLog: (() => void) | null = null;
    private settingsBox: HTMLElement;
    private paramsModal!: ParamsModal;
    private readonly loadoutPanel = new LoadoutPanel();
    private rendererControl?: RendererControl;
    private rendererToggle?: HTMLInputElement;

    private banner: HTMLElement;
    private stateCell: HTMLElement;
    private playerCell: HTMLElement;
    private tileCell: HTMLElement;
    private modalsCell: HTMLElement;

    private lastRender = 0;

    constructor(root: HTMLElement, host: BotHostImpl, renderer?: RendererControl) {
        this.host = host;

        root.replaceChildren();

        const title = el('div', 'rs2b0t-title');
        title.textContent = 'rs2b0t';
        const wallHref = wallLinkHref(boxId());
        if (wallHref) {
            const wall = document.createElement('a');
            wall.className = 'rs2b0t-wall-link';
            wall.href = wallHref;
            wall.textContent = 'MultiBox';
            wall.title = 'Run several accounts in one tab';
            title.appendChild(wall);
        }
        root.appendChild(title);

        const buildLine = el('div', 'rs2b0t-build');
        buildLine.textContent = BUILD_INFO.label;
        buildLine.title = `commit ${BUILD_INFO.commit}${BUILD_INFO.dirty ? ' (dirty tree)' : ''}\nbuilt ${BUILD_INFO.builtAt || '—'}`;
        root.appendChild(buildLine);

        this.banner = el('div', 'rs2b0t-banner');
        root.appendChild(this.banner);

        const script = el('div', 'rs2b0t-section');
        script.appendChild(sectionTitle('script'));

        this.library = new ScriptLibrary(name => this.selectScript(name));
        const remembered = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(selectedScriptKey()) : null)
            ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(selectedScriptKey()) : null);
        this.selectedScript = remembered && ScriptRegistry.get(remembered) ? remembered : (ScriptRegistry.list()[0]?.name ?? '');

        const pick = el('div', 'rs2b0t-buttons');
        this.scriptName = el('span', 'rs2b0t-current-script');
        pick.appendChild(this.scriptName);
        this.browseBtn = button(pick, 'Browse…', () => this.library.open());
        script.appendChild(pick);

        const buttons = el('div', 'rs2b0t-buttons');
        this.startBtn = button(buttons, 'Start', () => this.startSelectedScript());
        this.pauseBtn = button(buttons, 'Pause', () => this.handlePause());
        this.stopBtn = button(buttons, 'Stop', () => this.stopScript());
        script.appendChild(buttons);

        this.scriptStatus = row(script, 'status');
        root.appendChild(script);

        const settings = el('div', 'rs2b0t-section');
        settings.appendChild(sectionTitle('parameters'));
        this.settingsBox = el('div', 'rs2b0t-settings');
        settings.appendChild(this.settingsBox);

        const settingsBtns = el('div', 'rs2b0t-settings-btns');
        const globalBtn = document.createElement('button');
        globalBtn.className = 'rs2b0t-button rs2b0t-param-edit';
        globalBtn.textContent = 'Global settings';
        globalBtn.title =
            'Account and bot-wide options (lamp skill, run, bank junk). Script params still override when set.';
        globalBtn.addEventListener('click', () =>
            this.paramsModal.open('Global', GLOBAL_SETTINGS_CORE, {
                title: 'Global settings',
                showGlobalExtra: true
            })
        );
        const navBtn = document.createElement('button');
        navBtn.className = 'rs2b0t-button rs2b0t-param-edit';
        navBtn.textContent = 'Nav settings';
        navBtn.title =
            'World-walk routing, path stickiness, and path paint. Stored under Global (same keys as before).';
        navBtn.addEventListener('click', () =>
            this.paramsModal.open('Global', NAV_SETTINGS, {
                title: 'Nav settings',
                showGlobalExtra: false,
                intro:
                    'These settings are intended for script authors. Defaults are known-safe. Changing them without '
                    + 'understanding the effect can break scripts that assume those defaults.'
            })
        );
        const loadoutBtn = document.createElement('button');
        loadoutBtn.className = 'rs2b0t-button rs2b0t-param-edit';
        loadoutBtn.textContent = 'Loadouts';
        loadoutBtn.title = 'Gear and supplies you have declared, for scripts to wear.';
        loadoutBtn.addEventListener('click', () => this.loadoutPanel.open());

        settingsBtns.appendChild(globalBtn);
        settingsBtns.appendChild(navBtn);
        settingsBtns.appendChild(loadoutBtn);
        settings.appendChild(settingsBtns);

        root.appendChild(settings);

        this.paramsModal = new ParamsModal(
            () => isActiveState(ScriptRunner.state),
            () => this.renderSettings()
        );
        document.body.appendChild(this.loadoutPanel.root);
        this.paramsModal.setGlobalExtra(this.buildCredentials());

        ScriptRegistry.onChange(() => {
            this.ensureSelection();
            this.renderSettings();
        });

        const status = el('div', 'rs2b0t-section');
        status.appendChild(sectionTitle('status'));
        this.stateCell = row(status, 'state');
        this.playerCell = row(status, 'player');
        this.tileCell = row(status, 'tile');
        this.modalsCell = row(status, 'modals');
        root.appendChild(status);

        const logSection = el('div', 'rs2b0t-section');
        logSection.appendChild(sectionTitle('log'));
        this.logBox = el('div', 'rs2b0t-log');
        logSection.appendChild(this.logBox);
        root.appendChild(logSection);

        if (renderer) {
            root.appendChild(this.buildRendererControls(renderer));
        }

        ScriptRunner.onChange(() => {
            this.renderScriptControls();
            this.renderLog();
            this.renderSettings();
        });

        host.addDrawListener(() => this.maybeRender(200));
        if (renderer) {
            // Renderer-off clients deliberately emit no draw events. Their panel
            // still updates at a cheap 1 Hz from the untouched logical frame loop.
            host.addFrameListener(() => {
                if (!renderer.enabled()) {
                    this.maybeRender(1000);
                }
            });
        }
        this.render();
        this.ensureSelection();
        this.renderScriptControls();
        this.renderSettings();
    }

    startSelectedScript(): void {
        if (isActiveState(ScriptRunner.state)) {
            return;
        }
        this.handleStart();
    }

    stopScript(): void {
        ScriptRunner.stop('Stop button (bot panel)');
    }

    setRendererEnabled(enabled: boolean): void {
        if (!this.rendererControl || !this.rendererToggle) {
            return;
        }
        this.rendererToggle.checked = enabled;
        localStorage.setItem(rendererEnabledKey(), enabled ? '1' : '0');
        this.rendererControl.setEnabled(enabled);
    }

    private selectScript(name: string): void {
        if (!ScriptRegistry.get(name)) {
            return;
        }
        this.selectedScript = name;
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(selectedScriptKey(), name);
        }
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(selectedScriptKey(), name);
        }
        this.scriptName.textContent = name;
        this.renderSettings();
        this.renderScriptControls();
    }

    private ensureSelection(): void {
        if (!ScriptRegistry.get(this.selectedScript)) {
            this.selectScript(ScriptRegistry.list()[0]?.name ?? '');
        } else {
            this.scriptName.textContent = this.selectedScript;
        }
    }

    private renderSettings(): void {
        this.settingsBox.replaceChildren();
        const meta = ScriptRegistry.get(this.selectedScript);
        const schema = meta?.settingsSchema;
        if (!meta || !schema || Object.keys(schema).length === 0) {
            const none = el('div', 'rs2b0t-dim');
            none.textContent = '(no parameters)';
            this.settingsBox.appendChild(none);
            return;
        }

        const active = isActiveState(ScriptRunner.state);

        const summary = el('div', 'rs2b0t-param-summary');
        const valueOf = (key: string): string => (schema[key] ? SettingsStore.displayString(meta.name, key, schema[key]) : '');
        for (const [key, def] of Object.entries(schema)) {
            if (!isVisible(def, valueOf)) {
                continue;
            }
            const item = el('span', 'rs2b0t-param-sitem');
            const k = el('span', 'rs2b0t-param-skey');
            k.textContent = key;
            const v = el('span', 'rs2b0t-param-sval');
            v.textContent = summarize(def, SettingsStore.displayString(meta.name, key, def));
            item.appendChild(k);
            item.appendChild(v);
            summary.appendChild(item);
        }
        this.settingsBox.appendChild(summary);

        const edit = document.createElement('button');
        edit.className = 'rs2b0t-button rs2b0t-param-edit';
        edit.textContent = '✎ Edit parameters';
        edit.disabled = active;
        edit.title = active
            ? 'Stop the script to edit its parameters. Global settings stay editable while it runs.'
            : 'Open script parameters';
        edit.addEventListener('click', () => this.paramsModal.open(meta.name, schema));
        this.settingsBox.appendChild(edit);
    }

    private buildCredentials(): HTMLElement {
        const sec = el('div', 'rs2b0t-section');
        sec.appendChild(sectionTitle('credentials'));
        const saved = Credentials.get();

        const userInput = document.createElement('input');
        userInput.className = 'rs2b0t-input';
        userInput.type = 'text';
        userInput.placeholder = 'username';
        userInput.value = saved?.username ?? '';
        sec.appendChild(labeled('user', userInput));

        const passInput = document.createElement('input');
        passInput.className = 'rs2b0t-input';
        passInput.type = 'password';
        passInput.placeholder = 'password';
        passInput.value = saved?.password ?? '';
        sec.appendChild(labeled('pass', passInput));

        Credentials.onChange(creds => {
            userInput.value = creds?.username ?? '';
            passInput.value = creds?.password ?? '';
        });

        const status = el('div', 'rs2b0t-load-status');

        const buttons = el('div', 'rs2b0t-buttons');
        button(buttons, 'Save', () => {
            AutoRelogin.setCredentials(userInput.value.trim(), passInput.value);
            if (boxId() !== '' && window.parent !== window) {
                window.parent.postMessage({ type: 'rs2b0t:profile-save', username: userInput.value.trim(), password: passInput.value }, window.location.origin);
            }
            status.textContent = 'saved locally (plaintext)';
            status.className = 'rs2b0t-load-status rs2b0t-load-ok';
        });
        button(buttons, 'Log in', () => {
            // Why: reading only the last Saved account makes a freshly typed login do nothing, or log in as the wrong bot, until Save is pressed first.
            AutoRelogin.setCredentials(userInput.value.trim(), passInput.value);
            const ok = AutoRelogin.loginNow();
            status.textContent = ok ? 'logging in…' : 'enter a username / already ingame';
            status.className = `rs2b0t-load-status ${ok ? 'rs2b0t-load-ok' : 'rs2b0t-load-error'}`;
        });
        button(buttons, 'Clear', () => {
            AutoRelogin.setCredentials('', '');
            status.textContent = 'cleared';
            status.className = 'rs2b0t-load-status';
        });
        sec.appendChild(buttons);

        const autoRow = el('div', 'rs2b0t-setting rs2b0t-setting-bool');
        const auto = document.createElement('input');
        auto.type = 'checkbox';
        // Mirror runtime state (?autologin=1 / Multibox). enable() may run after the
        // panel is built, so listen for changes instead of painting once (#215).
        auto.checked = AutoRelogin.isAutoLogin();
        auto.addEventListener('change', () => AutoRelogin.setAutoLogin(auto.checked));
        AutoRelogin.onAutoLoginChange(on => {
            auto.checked = on;
        });
        const autoLabel = el('span', 'rs2b0t-setting-label');
        autoLabel.textContent = 'auto-login on title screen';
        autoLabel.title =
            'Unattended: log in by itself whenever sitting on the title screen with saved creds. Off = stay on the title screen until you press Log in (or start a script — a running script still reconnects after a disconnect).';
        autoRow.appendChild(auto);
        autoRow.appendChild(autoLabel);
        sec.appendChild(autoRow);

        sec.appendChild(status);
        return sec;
    }

    private handleStart(): void {
        const meta = ScriptRegistry.get(this.selectedScript);
        if (!meta) {
            return;
        }

        try {
            ScriptRunner.start(meta);
        } catch (err) {
            console.error('[rs2b0t] start failed', err);
            return;
        }

        this.unsubLog?.();
        this.unsubLog = ScriptRunner.ctx?.onLog(() => this.renderLog()) ?? null;
        this.renderLog();
    }

    private handlePause(): void {
        if (ScriptRunner.state === 'paused') {
            ScriptRunner.resume();
        } else {
            ScriptRunner.pause();
        }
    }

    private renderScriptControls(): void {
        const state = ScriptRunner.state;
        const active = state === 'running' || state === 'paused' || state === 'stopping';

        this.startBtn.disabled = active;
        this.pauseBtn.disabled = !(state === 'running' || state === 'paused');
        this.pauseBtn.textContent = state === 'paused' ? 'Resume' : 'Pause';
        this.stopBtn.disabled = !active || state === 'stopping';
        this.browseBtn.disabled = active;

        const ctx = ScriptRunner.ctx;
        if (!ctx) {
            this.scriptStatus.textContent = 'idle';
        } else {
            const name = ScriptRunner.meta?.name ?? '?';
            const extra = state === 'crashed' && ctx.crashError ? ` — ${ctx.crashError.message}` : ` — ${ctx.loopCount} loops`;
            const text = `${name}: ${state}${extra}`;
            this.scriptStatus.textContent = ctx.activeEvent ? `⚡ ${ctx.activeEvent}` : text;
        }
        this.scriptStatus.className = `rs2b0t-value rs2b0t-state-${state}`;
    }

    private renderLog(): void {
        const ctx = ScriptRunner.ctx;
        if (!ctx) {
            this.logBox.replaceChildren();
            return;
        }

        const atBottom = this.logBox.scrollTop + this.logBox.clientHeight >= this.logBox.scrollHeight - 4;

        this.logBox.replaceChildren();
        for (const line of ctx.log.slice(-200)) {
            const div = el('div', `rs2b0t-log-line rs2b0t-log-${line.level}`);
            const time = new Date(line.time).toTimeString().slice(0, 8);
            div.textContent = `${time} ${line.msg}`;
            this.logBox.appendChild(div);
        }

        if (atBottom) {
            this.logBox.scrollTop = this.logBox.scrollHeight;
        }
    }

    private buildRendererControls(renderer: RendererControl): HTMLElement {
        this.rendererControl = renderer;
        const rendering = el('div', 'rs2b0t-section');
        rendering.appendChild(sectionTitle('rendering'));

        const rendererRow = el('label', 'rs2b0t-setting rs2b0t-setting-bool');
        const rendererToggle = document.createElement('input');
        this.rendererToggle = rendererToggle;
        rendererToggle.type = 'checkbox';
        const savedEnabled = localStorage.getItem(rendererEnabledKey());
        rendererToggle.checked = savedEnabled === null ? renderer.enabled() : savedEnabled !== '0';
        const rendererLabel = el('span', 'rs2b0t-setting-label');
        rendererLabel.textContent = 'game renderer';
        rendererLabel.title = 'Stop drawing while the bot, script, connection, and complete scene keep running';
        rendererRow.append(rendererToggle, rendererLabel);
        rendering.appendChild(rendererRow);

        const note = el('div', 'rs2b0t-dim rs2b0t-render-note');
        note.textContent = 'Rail previews stay at 1 FPS. Rendering never pauses the bot.';
        rendering.appendChild(note);

        rendererToggle.addEventListener('change', () => {
            this.setRendererEnabled(rendererToggle.checked);
        });

        renderer.setEnabled(rendererToggle.checked);
        return rendering;
    }

    private maybeRender(minimumIntervalMs: number): void {
        const now = performance.now();
        if (now - this.lastRender < minimumIntervalMs) {
            return;
        }

        this.lastRender = now;
        this.render();
    }

    private render(): void {
        const missing = this.host.selfTestMissing;
        if (!reader.attached()) {
            this.banner.hidden = false;
            this.banner.className = 'rs2b0t-banner rs2b0t-banner-warn';
            this.banner.textContent = 'adapter: not attached';
        } else if (missing.length > 0) {
            this.banner.hidden = false;
            this.banner.className = 'rs2b0t-banner rs2b0t-banner-error';
            this.banner.textContent = `adapter self-test FAILED — missing: ${missing.join(', ')}`;
        } else {
            this.banner.hidden = true;
            this.banner.textContent = '';
        }

        const ingame = reader.ingame();
        const scene = reader.sceneState();
        // Ready = logged in + scene fully built (2). Show partial scene so operators
        // do not confuse "ingame" with "safe to inject" (#445).
        this.stateCell.textContent = !ingame
            ? 'title screen'
            : scene === 2
                ? 'ready (scene 2)'
                : `ingame · scene ${scene} (wait)`;

        this.playerCell.textContent = reader.localPlayerName() ?? '-';

        const tile = reader.worldTile();
        this.tileCell.textContent = tile ? `${tile.x}, ${tile.z}, ${tile.level}` : '-';

        const modals = reader.modals();
        this.modalsCell.textContent = `main ${modals.main} / side ${modals.side} / chat ${modals.chat}`;

        this.renderScriptControls();
    }
}

function sectionTitle(text: string): HTMLElement {
    const node = el('div', 'rs2b0t-section-title');
    node.textContent = text;
    return node;
}

function row(parent: HTMLElement, label: string): HTMLElement {
    const line = el('div', 'rs2b0t-row');
    const key = el('span', 'rs2b0t-key');
    key.textContent = label;
    const value = el('span', 'rs2b0t-value');
    value.textContent = '-';
    line.appendChild(key);
    line.appendChild(value);
    parent.appendChild(line);
    return value;
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.className = 'rs2b0t-button';
    node.textContent = label;
    node.addEventListener('click', onClick);
    parent.appendChild(node);
    return node;
}

function labeled(label: string, input: HTMLElement): HTMLElement {
    const rowEl = el('div', 'rs2b0t-setting');
    const key = el('span', 'rs2b0t-setting-label');
    key.textContent = label;
    rowEl.appendChild(key);
    rowEl.appendChild(input);
    return rowEl;
}

function isActiveState(state: string): boolean {
    return state === 'running' || state === 'paused' || state === 'stopping';
}
