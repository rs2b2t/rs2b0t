import type { WorldNumber } from '../../client/config/worlds.js';
import { WALK_OPTIONS } from '../api/map/WalkDestinations.js';
import { rosterError, type RosterActions, type RosterCommand, type RosterProfile, type RosterResult } from './RosterActions.js';

interface Options {
    tabs(): string[];
    activeTab(): string;
    worldRouting: boolean;
    edit(profile: RosterProfile): void;
}

type Kind = RosterCommand['kind'];
const LABELS: Record<Kind, string> = { assign: 'Assign script', copy: 'Copy settings', travel: 'Travel to', world: 'Join world', start: '▷ Start', stop: '□ Stop' };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
}

function button(text: string, click: () => void, id = ''): HTMLButtonElement {
    const el = node('button', '', text);
    el.type = 'button';
    el.id = id;
    el.onclick = click;
    return el;
}

function select(id: string): HTMLSelectElement {
    const el = node('select');
    el.id = id;
    return el;
}

function choices(el: HTMLSelectElement, values: string[]): void {
    if (JSON.stringify(Array.from(el.options).map(option => option.value)) === JSON.stringify(values)) return;
    const previous = el.value;
    el.replaceChildren(...values.map(value => {
        const option = node('option', '', value);
        option.value = value;
        return option;
    }));
    if (values.includes(previous)) el.value = previous;
}

export class RosterPanel {
    readonly el = node('div', 'mbx-roster-overlay');
    private dialog = node('section', 'mbx-roster-dialog');
    private tabs = node('div', 'mbx-roster-tabs');
    private search = node('input');
    private count = node('strong');
    private tbody = node('tbody');
    private scopeLabel = node('span');
    private paneTitle = node('h3');
    private description = node('p');
    private script = select('mbx-roster-script');
    private source = select('mbx-roster-source');
    private destination = select('mbx-roster-destination');
    private world = select('mbx-roster-world');
    private preview = node('dl', 'mbx-roster-preview');
    private scriptHint = node('p', 'mbx-roster-muted');
    private note = node('p', 'mbx-roster-note');
    private targetCount = node('p', 'mbx-roster-muted');
    private message = node('span');
    private apply = button('', () => { void this.run(); }, 'mbx-roster-apply');
    private all = node('input');
    private fields = new Map<Kind | 'script' | 'source', HTMLElement>();
    private rows = new Map<string, HTMLTableRowElement>();
    private selected = new Set<string>();
    private results = new Map<string, RosterResult>();
    private kind: Kind = 'assign';
    private scope: string | null;
    private opener?: HTMLElement;
    private pending = false;
    private opened = false;
    private background = new Map<Element, string | null>();
    private selectVisible = button('Select tab', () => { for (const profile of this.visible()) this.selected.add(profile.username); this.refresh(); });

    constructor(private actions: RosterActions, private options: Options) {
        this.scope = options.activeTab();
        this.el.id = 'mbx-roster';
        this.el.hidden = true;
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-modal', 'true');
        this.dialog.setAttribute('aria-labelledby', 'mbx-roster-title');
        const header = node('header');
        const title = node('strong', '', 'manage bots');
        title.id = 'mbx-roster-title';
        header.append(title, node('span', 'mbx-roster-muted', 'multibox'), button('×', () => this.close(), 'mbx-roster-close'));
        header.lastElementChild!.setAttribute('aria-label', 'Close manage bots');
        const filters = node('div', 'mbx-roster-filters');
        this.search.id = 'mbx-roster-search';
        this.search.type = 'search';
        this.search.placeholder = 'Search profiles…';
        this.search.setAttribute('aria-label', 'Search profiles');
        this.search.oninput = () => this.changeScope();
        filters.append(this.tabs, this.search);
        const toolbar = node('div', 'mbx-roster-toolbar');
        this.count.id = 'mbx-roster-count';
        toolbar.append(this.count);
        for (const kind of Object.keys(LABELS) as Kind[]) {
            if (kind === 'world' && !options.worldRouting) continue;
            const action = button(LABELS[kind], () => { this.kind = kind; this.refresh(); });
            action.dataset.action = kind;
            toolbar.append(action);
        }
        const content = node('div', 'mbx-roster-content');
        const roster = node('div', 'mbx-roster-list');
        const scopeBar = node('div', 'mbx-roster-scope');
        scopeBar.append(this.scopeLabel, this.selectVisible, button('Clear', () => { this.selected.clear(); this.refresh(); }));
        const table = node('table');
        table.id = 'mbx-roster-table';
        const thead = node('thead');
        const headings = node('tr');
        const check = node('th');
        this.all.type = 'checkbox';
        this.all.setAttribute('aria-label', 'Select visible profiles');
        this.all.onchange = () => {
            for (const profile of this.visible()) {
                if (this.all.checked) this.selected.add(profile.username);
                else this.selected.delete(profile.username);
            }
            this.refresh();
        };
        check.append(this.all);
        headings.append(check, ...['Profile / settings', 'Script', 'World', 'State / result', ''].map(name => node('th', '', name)));
        thead.append(headings); table.append(thead, this.tbody); roster.append(scopeBar, table);
        const pane = node('aside', 'mbx-roster-pane');
        pane.append(this.paneTitle, this.description);
        for (const [key, label, input] of [
            ['script', 'Script', this.script], ['source', 'Copy from profile', this.source],
            ['travel', 'Destination', this.destination], ['world', 'World', this.world]
        ] as const) {
            const field = node('label', 'mbx-roster-field', label);
            field.append(input); pane.append(field); this.fields.set(key, field);
            input.onchange = () => this.refresh();
        }
        choices(this.destination, WALK_OPTIONS);
        choices(this.world, ['1', '2', '3']);
        this.preview.id = 'mbx-roster-preview';
        this.scriptHint.id = 'mbx-roster-script-hint';
        this.message.id = 'mbx-roster-message';
        this.message.setAttribute('role', 'status');
        this.message.setAttribute('aria-live', 'polite');
        pane.append(this.scriptHint, this.preview, this.note, this.targetCount, this.apply);
        content.append(roster, pane);
        const status = node('div', 'mbx-roster-status');
        status.append(node('span', '', 'Copies stay independent. Edit any profile afterward.'), this.message);
        const footer = node('footer');
        footer.append(node('span', 'mbx-roster-muted', 'Close this panel to return to the focused bot.'), button('Done', () => this.close(), 'mbx-roster-done'));
        this.dialog.append(header, filters, toolbar, content, status, footer);
        this.el.append(this.dialog);
        this.el.onclick = event => { if (event.target === this.el) this.close(); };
        this.el.onkeydown = event => this.keydown(event);
    }

    open(opener?: HTMLElement): void {
        if (!this.opened) { this.scope = this.options.activeTab(); this.opened = true; }
        if (opener || this.el.hidden) this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
        for (let ancestor: HTMLElement | null = this.el; ancestor && ancestor !== document.body && ancestor.parentElement; ancestor = ancestor.parentElement) {
            for (const sibling of Array.from(ancestor.parentElement.children)) {
                if (sibling === ancestor || this.background.has(sibling)) continue;
                this.background.set(sibling, sibling.getAttribute('inert'));
                sibling.setAttribute('inert', '');
            }
        }
        this.el.hidden = false;
        this.refresh();
        this.el.querySelector<HTMLButtonElement>('#mbx-roster-close')!.focus();
    }

    close(): void {
        if (this.el.hidden) return;
        this.el.hidden = true;
        for (const [element, inert] of this.background) {
            if (inert === null) element.removeAttribute('inert');
            else element.setAttribute('inert', inert);
        }
        this.background.clear();
        this.opener?.focus();
    }

    refresh(): void {
        if (this.el.hidden) return;
        const profiles = this.actions.profiles();
        if (this.scope !== null && !this.options.tabs().includes(this.scope)) {
            const active = this.options.activeTab();
            this.scope = this.options.tabs().includes(active) ? active : null;
            this.selected.clear();
        }
        const names = new Set(this.visible().map(profile => profile.username));
        for (const name of this.selected) if (!names.has(name)) this.selected.delete(name);
        this.refreshTabs(profiles);
        choices(this.script, this.actions.scripts());
        choices(this.source, profiles.map(profile => profile.username));
        const visible = this.visible();
        const current = new Set(visible.map(profile => profile.username));
        for (const [name, row] of this.rows) if (!current.has(name)) { row.remove(); this.rows.delete(name); }
        for (const profile of visible) this.refreshRow(profile);
        this.count.textContent = `${this.selected.size} selected`;
        this.targetCount.textContent = `${this.selected.size} profiles will be targeted.`;
        this.selectVisible.textContent = this.search.value.trim() || this.scope === null ? 'Select visible' : 'Select tab';
        this.scopeLabel.textContent = this.scope === null ? 'ALL PROFILES' : `${this.scope.toUpperCase()} TAB`;
        this.all.checked = visible.length > 0 && visible.every(profile => this.selected.has(profile.username));
        this.all.indeterminate = visible.some(profile => this.selected.has(profile.username)) && !this.all.checked;
        this.paneTitle.textContent = LABELS[this.kind].replace(/[▷□] /, '').toLowerCase();
        this.description.textContent = this.kind === 'copy' ? 'Use one bot’s configuration as the starting point for the others.' : this.kind === 'assign' ? 'Choose the script each selected profile will use.' : this.kind === 'travel' ? 'Start WalkTo for loaded, logged-in bots.' : this.kind === 'world' ? 'Switch loaded bots and save the world for unloaded profiles.' : `${this.kind === 'start' ? 'Start' : 'Stop'} scripts on the selected loaded bots.`;
        for (const [key, field] of this.fields) field.hidden = key === 'script' ? this.kind !== 'assign' && this.kind !== 'copy' : key === 'source' ? this.kind !== 'copy' : key !== this.kind;
        this.preview.hidden = this.kind !== 'copy';
        this.preview.replaceChildren();
        if (this.kind === 'copy' && this.source.value && this.script.value) {
            try {
                const values = Object.entries(this.actions.settings(this.source.value, this.script.value));
                this.preview.append(node('dt', 'mbx-roster-muted', 'SOURCE CONFIGURATION'));
                for (const [key, value] of values) this.preview.append(node('dt', '', key), node('dd', '', value));
                if (!values.length) this.preview.append(node('dd', '', 'No saved settings.'));
            } catch (err) { this.preview.append(node('dd', '', this.error(err))); }
        }
        this.scriptHint.hidden = this.script.options.length > 0 || (this.kind !== 'assign' && this.kind !== 'copy');
        this.scriptHint.textContent = 'Load a bot to discover available scripts.';
        this.note.hidden = this.kind !== 'copy';
        this.note.textContent = 'A one-time copy. Changing a bot later only changes that bot. Copying settings does not select the script.';
        this.apply.textContent = `${this.kind === 'copy' ? 'Copy to' : LABELS[this.kind].replace(/[▷□] /, '')} ${this.selected.size} profiles →`;
        const busy = this.pending || this.actions.busy;
        const active = document.activeElement;
        for (const control of Array.from(this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, select, button'))) {
            if (control.id !== 'mbx-roster-close' && control.id !== 'mbx-roster-done') control.disabled = busy;
        }
        this.apply.disabled = busy || !this.selected.size || ((this.kind === 'copy' || this.kind === 'assign') && !this.script.value) || (this.kind === 'copy' && !this.source.value);
        if (active instanceof HTMLElement && this.dialog.contains(active) && active.hasAttribute('disabled')) this.el.querySelector<HTMLButtonElement>('#mbx-roster-close')!.focus();
        for (const action of Array.from(this.el.querySelectorAll<HTMLButtonElement>('[data-action]'))) action.setAttribute('aria-pressed', String(action.dataset.action === this.kind));
    }

    private visible(): RosterProfile[] {
        const query = this.search.value.trim().toLowerCase();
        return this.actions.profiles().filter(profile => (this.scope === null || profile.tab === this.scope) && profile.username.toLowerCase().includes(query));
    }

    private changeScope(): void {
        this.selected.clear();
        this.refresh();
    }

    private refreshTabs(profiles: RosterProfile[]): void {
        const tabs: Array<string | null> = [null, ...this.options.tabs()];
        const keys = tabs.map(tab => tab ?? 'all');
        if (JSON.stringify(Array.from(this.tabs.children).map(el => (el as HTMLElement).dataset.scope)) !== JSON.stringify(keys)) {
            this.tabs.replaceChildren(...tabs.map(tab => {
                const el = button('', () => { this.scope = tab; this.changeScope(); });
                el.dataset.scope = tab ?? 'all';
                return el;
            }));
        }
        tabs.forEach((tab, index) => {
            const el = this.tabs.children[index];
            el.textContent = `${tab ?? 'All profiles'} ${profiles.filter(profile => tab === null || profile.tab === tab).length}`;
            el.setAttribute('aria-pressed', String(tab === this.scope));
        });
    }

    private refreshRow(profile: RosterProfile): void {
        let row = this.rows.get(profile.username);
        if (!row) {
            row = node('tr');
            row.dataset.profile = profile.username;
            row.dataset.username = profile.username;
            const input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', `Select ${profile.username}`);
            input.onchange = () => { if (input.checked) this.selected.add(profile.username); else this.selected.delete(profile.username); this.refresh(); };
            const checkbox = node('td'); checkbox.append(input);
            const name = node('td'); name.append(node('strong', '', profile.username), node('small', 'mbx-roster-muted'));
            const edit = node('td');
            const editButton = button('Edit ↗', () => { void this.edit(profile.username); });
            editButton.dataset.edit = ''; editButton.setAttribute('aria-label', `Edit ${profile.username}`); edit.append(editButton);
            row.append(checkbox, name, node('td'), node('td'), node('td'), edit);
            this.rows.set(profile.username, row); this.tbody.append(row);
        }
        row.classList.toggle('is-selected', this.selected.has(profile.username));
        row.querySelector('input')!.checked = this.selected.has(profile.username);
        const cells = row.cells;
        const script = this.actions.selectedScript(profile);
        let values = '';
        try { if (script) values = Object.values(this.actions.settings(profile.username, script)).join(' · '); } catch { values = ''; }
        cells[1].querySelector('small')!.textContent = values || (profile.slot ? profile.tab : `${profile.tab} · Saved profile`);
        cells[2].textContent = script || 'None';
        const slot = profile.slot;
        cells[3].textContent = !slot ? `W${profile.world} (saved)` : slot.switchingWorld !== null ? `${slot.world === null ? 'World' : `W${slot.world}`} → W${slot.switchingWorld}` : slot.ingame && slot.world !== null ? `W${slot.world}` : `W${slot.targetWorld} (target)`;
        const scriptState = slot ? slot.scriptState[0].toUpperCase() + slot.scriptState.slice(1) : '';
        const state = !slot ? 'Unloaded' : slot.switchingWorld !== null ? `Switching world · ${scriptState}` : !slot.ready ? 'Loading' : !slot.ingame ? `Logged out · ${scriptState}` : scriptState;
        const result = this.results.get(profile.username);
        cells[4].replaceChildren(node('span', profile.slot?.scriptState === 'running' ? 'is-running' : '', state));
        if (result) cells[4].append(node('small', `mbx-roster-result is-${result.state}`, result.message));
    }

    private async run(): Promise<void> {
        if (this.apply.disabled) return;
        const command: RosterCommand = this.kind === 'assign' ? { kind: 'assign', script: this.script.value } : this.kind === 'copy' ? { kind: 'copy', script: this.script.value, source: this.source.value } : this.kind === 'travel' ? { kind: 'travel', destination: this.destination.value } : this.kind === 'world' ? { kind: 'world', world: Number(this.world.value) as WorldNumber } : { kind: this.kind };
        this.pending = true;
        this.message.textContent = 'Applying changes…';
        this.refresh();
        try {
            await this.actions.run([...this.selected], command, result => { this.results.set(result.username, result); this.refresh(); });
            this.message.textContent = 'Action finished. See each profile’s result.';
        } catch (err) { this.message.textContent = this.error(err); }
        finally { this.pending = false; this.refresh(); }
    }

    private async edit(username: string): Promise<void> {
        const profile = this.actions.profiles().find(profile => profile.username === username);
        if (!profile || this.pending || this.actions.busy) return;
        const error = !profile.slot ? 'Load this profile before editing.' : !profile.slot.ready ? 'Client is loading. Try again when ready.' : profile.slot.switchingWorld !== null ? 'Wait for the world switch before editing.' : ['running', 'paused', 'stopping'].includes(profile.slot.scriptState) ? 'Stop the script before editing.' : '';
        if (error) { this.results.set(username, { username, state: 'skipped', message: error }); this.refresh(); return; }
        this.close();
        try { await this.options.edit(profile); }
        catch (err) { this.open(this.opener); this.message.textContent = this.error(err); }
    }

    private keydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(this.dialog.querySelectorAll<HTMLElement>('button, input, select')).filter(el => !el.hasAttribute('disabled') && !el.closest('[hidden]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }

    private error(err: unknown): string { return rosterError(err); }
}
