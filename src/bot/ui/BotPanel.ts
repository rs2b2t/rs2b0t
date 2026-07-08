import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../BotHost.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { AutoRelogin } from '../runtime/AutoRelogin.js';
import { Credentials } from '../runtime/Credentials.js';
import { loadFromFile, loadFromUrl, type LoadResult } from '../runtime/loader.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore, type SettingDef } from '../runtime/Settings.js';
import ScriptLibrary from './ScriptLibrary.js';

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
        root.appendChild(settings);

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
            // lock the parameter inputs while a script is active
            const active = isActiveState(ScriptRunner.state);
            this.settingsBox.querySelectorAll('input').forEach(i => ((i as HTMLInputElement).disabled = active));
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

    /** Render the selected script's settingsSchema as an editable form. */
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
        for (const [key, def] of Object.entries(schema)) {
            this.settingsBox.appendChild(this.buildSettingRow(meta.name, key, def, active));
        }

        const hint = el('div', 'lcb-dim');
        hint.textContent = active ? 'stop the script to change parameters' : 'changes apply on next Start';
        this.settingsBox.appendChild(hint);
    }

    private buildSettingRow(scriptName: string, key: string, def: SettingDef, active: boolean): HTMLElement {
        const rowEl = el('div', 'lcb-setting');
        const label = el('span', 'lcb-setting-label');
        label.textContent = def.label ?? key;
        if (def.help) {
            label.title = def.help;
        }

        const current = SettingsStore.displayString(scriptName, key, def);

        if (def.type === 'string' && def.options && def.options.length > 0) {
            const select = document.createElement('select');
            select.className = 'lcb-input';
            select.disabled = active;
            for (const option of def.options) {
                const opt = document.createElement('option');
                opt.value = option;
                opt.textContent = option;
                select.appendChild(opt);
            }
            const match = def.options.find(o => o.toLowerCase() === current.trim().toLowerCase());
            select.value = match ?? String(def.default);
            select.addEventListener('change', () => SettingsStore.save(scriptName, key, select.value));
            rowEl.appendChild(label);
            rowEl.appendChild(select);
            return rowEl;
        }

        // string[] with options -> a checkbox multi-select (e.g. Miner rock types)
        if (def.type === 'string[]' && def.options && def.options.length > 0) {
            const selected = new Set(
                current
                    .split(',')
                    .map(s => s.trim().toLowerCase())
                    .filter(Boolean)
            );
            const group = document.createElement('div');
            group.className = 'lcb-multiselect';
            group.style.display = 'flex';
            group.style.flexWrap = 'wrap';
            group.style.gap = '2px 12px';
            const boxes: HTMLInputElement[] = [];
            for (const option of def.options) {
                const optLabel = document.createElement('label');
                optLabel.className = 'lcb-multiselect-opt';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.disabled = active;
                cb.checked = selected.has(option.toLowerCase());
                cb.addEventListener('change', () => {
                    const chosen = def.options!.filter((_, i) => boxes[i].checked);
                    SettingsStore.save(scriptName, key, chosen.join(', '));
                });
                boxes.push(cb);
                optLabel.appendChild(cb);
                optLabel.appendChild(document.createTextNode(' ' + option));
                group.appendChild(optLabel);
            }
            rowEl.appendChild(label);
            rowEl.appendChild(group);
            return rowEl;
        }

        const input = document.createElement('input');
        input.disabled = active;

        if (def.type === 'boolean') {
            input.type = 'checkbox';
            input.checked = current === 'true' || current === '1' || current === 'yes';
            input.addEventListener('change', () => SettingsStore.save(scriptName, key, input.checked ? 'true' : 'false'));
            rowEl.classList.add('lcb-setting-bool');
            rowEl.appendChild(input);
            rowEl.appendChild(label);
        } else {
            input.className = 'lcb-input';
            input.type = def.type === 'number' ? 'number' : 'text';
            if (def.type === 'number') {
                if (def.min !== undefined) {
                    input.min = String(def.min);
                }
                if (def.max !== undefined) {
                    input.max = String(def.max);
                }
            }
            input.value = current;
            input.addEventListener('change', () => SettingsStore.save(scriptName, key, input.value.trim()));
            rowEl.appendChild(label);
            rowEl.appendChild(input);
        }

        return rowEl;
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
