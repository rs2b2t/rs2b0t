import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { AutoRelogin } from '../runtime/AutoRelogin.js';
import { boxKey } from '../runtime/box.js';
import { Credentials } from '../runtime/Credentials.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { GLOBAL_SETTINGS, SettingsStore } from '../runtime/Settings.js';
import ScriptLibrary from './ScriptLibrary.js';
import ParamsModal from './ParamsModal.js';
import { isVisible, summarize } from './paramControls.js';
import { el } from './dom.js';

const SELECTED_SCRIPT_KEY = boxKey('selectedScript');

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

        const title = el('div', 'rs2b0t-title');
        title.textContent = 'rs2b0t';
        root.appendChild(title);

        this.banner = el('div', 'rs2b0t-banner');
        root.appendChild(this.banner);

        const script = el('div', 'rs2b0t-section');
        script.appendChild(sectionTitle('script'));

        this.library = new ScriptLibrary(name => this.selectScript(name));
        const remembered = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SELECTED_SCRIPT_KEY) : null;
        this.selectedScript = remembered && ScriptRegistry.get(remembered) ? remembered : (ScriptRegistry.list()[0]?.name ?? '');

        const pick = el('div', 'rs2b0t-buttons');
        this.scriptName = el('span', 'rs2b0t-current-script');
        pick.appendChild(this.scriptName);
        this.browseBtn = button(pick, 'Browse…', () => this.library.open());
        script.appendChild(pick);

        const buttons = el('div', 'rs2b0t-buttons');
        this.startBtn = button(buttons, 'Start', () => this.handleStart());
        this.pauseBtn = button(buttons, 'Pause', () => this.handlePause());
        this.stopBtn = button(buttons, 'Stop', () => ScriptRunner.stop());
        script.appendChild(buttons);

        this.scriptStatus = row(script, 'status');
        root.appendChild(script);

        const settings = el('div', 'rs2b0t-section');
        settings.appendChild(sectionTitle('parameters'));
        this.settingsBox = el('div', 'rs2b0t-settings');
        settings.appendChild(this.settingsBox);

        const globalBtn = document.createElement('button');
        globalBtn.className = 'rs2b0t-button rs2b0t-param-edit';
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

        root.appendChild(this.buildCredentials());

        const status = el('div', 'rs2b0t-section');
        status.appendChild(sectionTitle('status'));
        this.stateCell = row(status, 'state');
        this.playerCell = row(status, 'player');
        this.tileCell = row(status, 'tile');
        this.energyCell = row(status, 'energy');
        this.countsCell = row(status, 'nearby');
        this.modalsCell = row(status, 'modals');
        this.tickCell = row(status, 'tick');
        root.appendChild(status);

        const stats = el('div', 'rs2b0t-section');
        stats.appendChild(sectionTitle('stats'));
        this.statsGrid = el('div', 'rs2b0t-stats');
        stats.appendChild(this.statsGrid);
        root.appendChild(stats);

        const chat = el('div', 'rs2b0t-section');
        chat.appendChild(sectionTitle('chat'));
        this.chatList = el('div', 'rs2b0t-chat');
        chat.appendChild(this.chatList);
        root.appendChild(chat);

        const logSection = el('div', 'rs2b0t-section');
        logSection.appendChild(sectionTitle('log'));
        this.logBox = el('div', 'rs2b0t-log');
        logSection.appendChild(this.logBox);
        root.appendChild(logSection);

        ScriptRunner.onChange(() => {
            this.renderScriptControls();
            this.renderLog();
            this.renderSettings();
        });

        for (let i = 0; i < reader.skillCount(); i++) {
            if (!reader.skillUsed(i)) {
                continue;
            }

            const cell = el('div', 'rs2b0t-stat');
            const name = el('span', 'rs2b0t-stat-name');
            name.textContent = reader.stat(i).name.slice(0, 3);
            const level = el('span', 'rs2b0t-stat-level');
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

    private selectScript(name: string): void {
        if (!ScriptRegistry.get(name)) {
            return;
        }
        this.selectedScript = name;
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(SELECTED_SCRIPT_KEY, name);
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

        const status = el('div', 'rs2b0t-load-status');

        const buttons = el('div', 'rs2b0t-buttons');
        button(buttons, 'Save', () => {
            Credentials.save(userInput.value.trim(), passInput.value);
            status.textContent = 'saved locally (plaintext)';
            status.className = 'rs2b0t-load-status rs2b0t-load-ok';
        });
        button(buttons, 'Log in', () => {
            const ok = AutoRelogin.loginNow();
            status.textContent = ok ? 'logging in…' : 'save creds first / already ingame';
            status.className = `rs2b0t-load-status ${ok ? 'rs2b0t-load-ok' : 'rs2b0t-load-error'}`;
        });
        button(buttons, 'Clear', () => {
            Credentials.clear();
            userInput.value = '';
            passInput.value = '';
            status.textContent = 'cleared';
            status.className = 'rs2b0t-load-status';
        });
        sec.appendChild(buttons);

        const autoRow = el('div', 'rs2b0t-setting rs2b0t-setting-bool');
        const auto = document.createElement('input');
        auto.type = 'checkbox';
        auto.addEventListener('change', () => AutoRelogin.setAutoLogin(auto.checked));
        const autoLabel = el('span', 'rs2b0t-setting-label');
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
            const mode = state === 'running' || state === 'paused' ? ` [${ActionRouter.driver.mode}]` : '';
            const text = `${name}: ${state}${extra}${mode}`;
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
            const div = el('div', 'rs2b0t-chat-line');
            div.textContent = line.username ? `${line.username}: ${line.text}` : line.text;
            this.chatList.appendChild(div);
        }
        if (lines.length === 0) {
            const div = el('div', 'rs2b0t-chat-line rs2b0t-dim');
            div.textContent = '(no messages)';
            this.chatList.appendChild(div);
        }

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
