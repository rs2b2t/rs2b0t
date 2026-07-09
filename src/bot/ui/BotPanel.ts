import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { AutoRelogin } from '../runtime/AutoRelogin.js';
import { Credentials } from '../runtime/Credentials.js';
import { loadFromFile, loadFromUrl, type LoadResult } from '../runtime/loader.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { GLOBAL_SETTINGS, SettingsStore } from '../runtime/Settings.js';
import ScriptLibrary from './ScriptLibrary.js';
import ParamsModal from './ParamsModal.js';
import { summarize } from './paramControls.js';

/**
 * Live state panel + script controls. Plain DOM, no framework. The only
 * DOM-dependent code outside bot.html/main.ts, by design — keeps a headless
 * build viable later.
 */
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
    private loadUrlInput: HTMLInputElement;
    private loadStatus: HTMLElement;
    private settingsBox: HTMLElement;
    private paramsModal!: ParamsModal;

    private banner: HTMLElement;
    private stateCell: HTMLElement;
    private playerCell: HTMLElement;
    private tileCell: HTMLElement;
    private energyCell: HTMLElement;
    private countsCell: HTMLElement;
    private modalsCell: HTMLElement;
    private tickCell: HTMLElement;
    private statsGrid: HTMLElement;
    private chatList: HTMLElement;

    private statCells: { level: HTMLElement; cell: HTMLElement }[] = [];
    private lastRender = 0;

    constructor(root: HTMLElement, host: BotHostImpl) {
        this.host = host;

        root.replaceChildren();

        const title = el('div', 'lcb-title');
        title.textContent = 'LCBuddy2';
        root.appendChild(title);

        this.banner = el('div', 'lcb-banner');
        root.appendChild(this.banner);

        const script = el('div', 'lcb-section');
        script.appendChild(sectionTitle('script'));

        // the library modal is the picker; the panel shows the current choice
        this.library = new ScriptLibrary(name => this.selectScript(name));
        this.selectedScript = ScriptRegistry.list()[0]?.name ?? '';

        const pick = el('div', 'lcb-buttons');
        this.scriptName = el('span', 'lcb-current-script');
        pick.appendChild(this.scriptName);
        this.browseBtn = button(pick, 'Browse…', () => this.library.open());
        script.appendChild(pick);

        const buttons = el('div', 'lcb-buttons');
        this.startBtn = button(buttons, 'Start', () => this.handleStart());
        this.pauseBtn = button(buttons, 'Pause', () => this.handlePause());
        this.stopBtn = button(buttons, 'Stop', () => ScriptRunner.stop());
        script.appendChild(buttons);

        this.scriptStatus = row(script, 'status');

        // Slice 7: load external scripts (URL with cache-busting reload, or
        // a local file). Trusted code, no sandbox.
        const loadRow = el('div', 'lcb-buttons');
        this.loadUrlInput = document.createElement('input');
        this.loadUrlInput.className = 'lcb-input';
        this.loadUrlInput.type = 'text';
        this.loadUrlInput.placeholder = 'script URL (dist/bot.js)';
        loadRow.appendChild(this.loadUrlInput);
        button(loadRow, 'Load URL', () => void this.handleLoad(loadFromUrl(this.loadUrlInput.value.trim())));
        script.appendChild(loadRow);

        const fileRow = el('div', 'lcb-buttons');
        const filePick = document.createElement('input');
        filePick.type = 'file';
        filePick.accept = '.js,.mjs';
        filePick.style.display = 'none';
        filePick.addEventListener('change', () => {
            const file = filePick.files?.[0];
            if (file) {
                void this.handleLoad(loadFromFile(file));
            }
            filePick.value = '';
        });
        button(fileRow, 'Load file…', () => filePick.click());
        fileRow.appendChild(filePick);
        script.appendChild(fileRow);

        this.loadStatus = el('div', 'lcb-load-status');
        script.appendChild(this.loadStatus);
        root.appendChild(script);

        // settings: the selected script's tunable parameters
        const settings = el('div', 'lcb-section');
        settings.appendChild(sectionTitle('parameters'));
        this.settingsBox = el('div', 'lcb-settings');
        settings.appendChild(this.settingsBox);

        // shared-across-scripts settings; built once so it's always present
        // regardless of the selected script (unlike the per-script Edit button)
        const globalBtn = document.createElement('button');
        globalBtn.className = 'lcb-button lcb-param-edit';
        globalBtn.textContent = 'Global settings';
        globalBtn.title = 'Settings shared across all scripts (e.g. genie lamp skill); a script’s own value overrides these';
        globalBtn.addEventListener('click', () => this.paramsModal.open('Global', GLOBAL_SETTINGS));
        settings.appendChild(globalBtn);

        root.appendChild(settings);

        this.paramsModal = new ParamsModal(
            () => isActiveState(ScriptRunner.state),
            () => this.renderSettings()
        );

        ScriptRegistry.onChange(() => {
            this.ensureSelection();
            this.renderSettings();
        });

        // credentials: saved locally so the bot can (re)log in itself
        root.appendChild(this.buildCredentials());

        const status = el('div', 'lcb-section');
        status.appendChild(sectionTitle('status'));
        this.stateCell = row(status, 'state');
        this.playerCell = row(status, 'player');
        this.tileCell = row(status, 'tile');
        this.energyCell = row(status, 'energy');
        this.countsCell = row(status, 'nearby');
        this.modalsCell = row(status, 'modals');
        this.tickCell = row(status, 'tick');
        root.appendChild(status);

        const stats = el('div', 'lcb-section');
        stats.appendChild(sectionTitle('stats'));
        this.statsGrid = el('div', 'lcb-stats');
        stats.appendChild(this.statsGrid);
        root.appendChild(stats);

        const chat = el('div', 'lcb-section');
        chat.appendChild(sectionTitle('chat'));
        this.chatList = el('div', 'lcb-chat');
        chat.appendChild(this.chatList);
        root.appendChild(chat);

        const logSection = el('div', 'lcb-section');
        logSection.appendChild(sectionTitle('log'));
        this.logBox = el('div', 'lcb-log');
        logSection.appendChild(this.logBox);
        root.appendChild(logSection);

        ScriptRunner.onChange(() => {
            this.renderScriptControls();
            this.renderLog();
            // re-render the parameters section so the Edit button reflects active state
            this.renderSettings();
        });

        // stat cells are created once (sparse over unused skill ids), updated in place
        for (let i = 0; i < reader.skillCount(); i++) {
            if (!reader.skillUsed(i)) {
                continue;
            }

            const cell = el('div', 'lcb-stat');
            const name = el('span', 'lcb-stat-name');
            name.textContent = reader.stat(i).name.slice(0, 3);
            const level = el('span', 'lcb-stat-level');
            level.textContent = '-';
            cell.appendChild(name);
            cell.appendChild(level);
            this.statsGrid.appendChild(cell);
            this.statCells[i] = { level, cell };
        }

        host.addDrawListener(() => this.maybeRender());
        this.render();
        this.ensureSelection();
        this.renderScriptControls();
        this.renderSettings();
    }

    private async handleLoad(pending: Promise<LoadResult>): Promise<void> {
        this.loadStatus.textContent = 'loading…';
        this.loadStatus.className = 'lcb-load-status';

        const result = await pending;
        if (result.ok) {
            this.loadStatus.textContent = `loaded '${result.name}'`;
            this.loadStatus.className = 'lcb-load-status lcb-load-ok';
            if (result.name && !isActiveState(ScriptRunner.state)) {
                this.selectScript(result.name);
            }
        } else {
            this.loadStatus.textContent = `load failed: ${result.error}`;
            this.loadStatus.className = 'lcb-load-status lcb-load-error';
        }
    }

    /** Set the active script choice (from the library or a load) and refresh. */
    private selectScript(name: string): void {
        if (!ScriptRegistry.get(name)) {
            return;
        }
        this.selectedScript = name;
        this.scriptName.textContent = name;
        this.renderSettings();
        this.renderScriptControls();
    }

    /** Keep the selection valid as the registry changes (loads/hot-reload). */
    private ensureSelection(): void {
        if (!ScriptRegistry.get(this.selectedScript)) {
            this.selectScript(ScriptRegistry.list()[0]?.name ?? '');
        } else {
            this.scriptName.textContent = this.selectedScript;
        }
    }

    /** Render the selected script's parameters as a read-only summary + Edit button. */
    private renderSettings(): void {
        this.settingsBox.replaceChildren();
        const meta = ScriptRegistry.get(this.selectedScript);
        const schema = meta?.settingsSchema;
        if (!meta || !schema || Object.keys(schema).length === 0) {
            const none = el('div', 'lcb-dim');
            none.textContent = '(no parameters)';
            this.settingsBox.appendChild(none);
            return;
        }

        const active = isActiveState(ScriptRunner.state);

        const summary = el('div', 'lcb-param-summary');
        for (const [key, def] of Object.entries(schema)) {
            const item = el('span', 'lcb-param-sitem');
            const k = el('span', 'lcb-param-skey');
            k.textContent = key;
            const v = el('span', 'lcb-param-sval');
            v.textContent = summarize(def, SettingsStore.displayString(meta.name, key, def));
            item.appendChild(k);
            item.appendChild(v);
            summary.appendChild(item);
        }
        this.settingsBox.appendChild(summary);

        const edit = document.createElement('button');
        edit.className = 'lcb-button lcb-param-edit';
        edit.textContent = '✎ Edit parameters';
        edit.disabled = active;
        edit.addEventListener('click', () => this.paramsModal.open(meta.name, schema));
        this.settingsBox.appendChild(edit);
    }

    private buildCredentials(): HTMLElement {
        const sec = el('div', 'lcb-section');
        sec.appendChild(sectionTitle('credentials'));
        const saved = Credentials.get();

        const userInput = document.createElement('input');
        userInput.className = 'lcb-input';
        userInput.type = 'text';
        userInput.placeholder = 'username';
        userInput.value = saved?.username ?? '';
        sec.appendChild(labeled('user', userInput));

        const passInput = document.createElement('input');
        passInput.className = 'lcb-input';
        passInput.type = 'password';
        passInput.placeholder = 'password';
        passInput.value = saved?.password ?? '';
        sec.appendChild(labeled('pass', passInput));

        const status = el('div', 'lcb-load-status');

        const buttons = el('div', 'lcb-buttons');
        button(buttons, 'Save', () => {
            Credentials.save(userInput.value.trim(), passInput.value);
            status.textContent = 'saved locally (plaintext)';
            status.className = 'lcb-load-status lcb-load-ok';
        });
        button(buttons, 'Log in', () => {
            const ok = AutoRelogin.loginNow();
            status.textContent = ok ? 'logging in…' : 'save creds first / already ingame';
            status.className = `lcb-load-status ${ok ? 'lcb-load-ok' : 'lcb-load-error'}`;
        });
        button(buttons, 'Clear', () => {
            Credentials.clear();
            userInput.value = '';
            passInput.value = '';
            status.textContent = 'cleared';
            status.className = 'lcb-load-status';
        });
        sec.appendChild(buttons);

        const autoRow = el('div', 'lcb-setting lcb-setting-bool');
        const auto = document.createElement('input');
        auto.type = 'checkbox';
        auto.addEventListener('change', () => AutoRelogin.setAutoLogin(auto.checked));
        const autoLabel = el('span', 'lcb-setting-label');
        autoLabel.textContent = 'auto-login on title screen';
        autoLabel.title = 'Unattended: log in by itself whenever sitting on the title screen with saved creds';
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
            console.error('[lcbuddy] start failed', err);
            return;
        }

        // follow the new run's log
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
            const mode = state === 'running' || state === 'paused' ? ` [${ActionRouter.driver.mode}]` : '';
            const text = `${name}: ${state}${extra}${mode}`;
            // while the runtime Supervisor is handling a random event the script
            // is paused — surface the event in place of the loop status
            this.scriptStatus.textContent = ctx.activeEvent ? `⚡ ${ctx.activeEvent}` : text;
        }
        this.scriptStatus.className = `lcb-value lcb-state-${state}`;
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
            const div = el('div', `lcb-log-line lcb-log-${line.level}`);
            const time = new Date(line.time).toTimeString().slice(0, 8);
            div.textContent = `${time} ${line.msg}`;
            this.logBox.appendChild(div);
        }

        if (atBottom) {
            this.logBox.scrollTop = this.logBox.scrollHeight;
        }
    }

    /** Throttle DOM updates to ~5Hz; the draw hook fires at up to 50Hz. */
    private maybeRender(): void {
        const now = performance.now();
        if (now - this.lastRender < 200) {
            return;
        }

        this.lastRender = now;
        this.render();
    }

    private render(): void {
        const missing = this.host.selfTestMissing;
        if (!reader.attached()) {
            this.banner.className = 'lcb-banner lcb-banner-warn';
            this.banner.textContent = 'adapter: not attached';
        } else if (missing.length > 0) {
            this.banner.className = 'lcb-banner lcb-banner-error';
            this.banner.textContent = `adapter self-test FAILED — missing: ${missing.join(', ')}`;
        } else {
            this.banner.className = 'lcb-banner lcb-banner-ok';
            this.banner.textContent = 'adapter self-test: ok';
        }

        const ingame = reader.ingame();
        this.stateCell.textContent = ingame ? 'ingame' : 'title screen';

        this.playerCell.textContent = reader.localPlayerName() ?? '-';

        const tile = reader.worldTile();
        this.tileCell.textContent = tile ? `${tile.x}, ${tile.z}, ${tile.level}` : '-';

        this.energyCell.textContent = ingame ? `${reader.energy()}% / ${reader.weight()} kg` : '-';
        this.countsCell.textContent = ingame ? `${reader.playerCount()} players, ${reader.npcCount()} npcs` : '-';

        const modals = reader.modals();
        this.modalsCell.textContent = `main ${modals.main} / side ${modals.side} / chat ${modals.chat}`;

        const mean = this.host.tickMeanMs;
        this.tickCell.textContent = `${this.host.tickCount}${mean > 0 ? ` (${mean.toFixed(0)}ms)` : ''}`;

        for (let i = 0; i < reader.skillCount(); i++) {
            if (!reader.skillUsed(i)) {
                continue;
            }

            const stat = reader.stat(i);
            const target = this.statCells[i];
            target.level.textContent = ingame ? `${stat.effective}/${stat.base}` : '-';
            target.cell.title = `${stat.name}: ${stat.xp} xp`;
        }

        const lines = reader.chat(6);
        this.chatList.replaceChildren();
        for (const line of lines) {
            const div = el('div', 'lcb-chat-line');
            div.textContent = line.username ? `${line.username}: ${line.text}` : line.text;
            this.chatList.appendChild(div);
        }
        if (lines.length === 0) {
            const div = el('div', 'lcb-chat-line lcb-dim');
            div.textContent = '(no messages)';
            this.chatList.appendChild(div);
        }

        // ctx.activeEvent flips mid-run without a state transition (the
        // Supervisor doesn't fire onChange), so refresh the script-status line
        // on this ~5Hz render tick to show/clear the ⚡ event banner promptly
        this.renderScriptControls();
    }
}

function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function sectionTitle(text: string): HTMLElement {
    const node = el('div', 'lcb-section-title');
    node.textContent = text;
    return node;
}

function row(parent: HTMLElement, label: string): HTMLElement {
    const line = el('div', 'lcb-row');
    const key = el('span', 'lcb-key');
    key.textContent = label;
    const value = el('span', 'lcb-value');
    value.textContent = '-';
    line.appendChild(key);
    line.appendChild(value);
    parent.appendChild(line);
    return value;
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.className = 'lcb-button';
    node.textContent = label;
    node.addEventListener('click', onClick);
    parent.appendChild(node);
    return node;
}

function labeled(label: string, input: HTMLElement): HTMLElement {
    const rowEl = el('div', 'lcb-setting');
    const key = el('span', 'lcb-setting-label');
    key.textContent = label;
    rowEl.appendChild(key);
    rowEl.appendChild(input);
    return rowEl;
}

function isActiveState(state: string): boolean {
    return state === 'running' || state === 'paused' || state === 'stopping';
}
