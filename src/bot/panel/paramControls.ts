import { settingOptionLabel, type SettingDef, type SettingsSchema } from '../runtime/Settings.js';
import { el } from './dom.js';
import { WorldMapPicker } from './WorldMapPicker';

interface SettingGroup {
    name: string;
    keys: string[];
}

export function groupSchema(schema: SettingsSchema): SettingGroup[] {
    const byName = new Map<string, string[]>([['', []]]);
    for (const [key, def] of Object.entries(schema)) {
        const name = def.group ?? '';
        const keys = byName.get(name);
        if (keys) {
            keys.push(key);
        } else {
            byName.set(name, [key]);
        }
    }
    return [...byName.entries()].filter(([, keys]) => keys.length > 0).map(([name, keys]) => ({ name, keys }));
}

export function isVisible(def: SettingDef, valueOf: (key: string) => string): boolean {
    if (!def.showIf) {
        return true;
    }
    const value = valueOf(def.showIf.key).trim().toLowerCase();
    return def.showIf.anyOf.some(v => v.toLowerCase() === value);
}

export function visibilityDeps(schema: SettingsSchema): Set<string> {
    const deps = new Set<string>();
    for (const def of Object.values(schema)) {
        if (def.showIf) {
            deps.add(def.showIf.key);
        }
    }
    return deps;
}

type ControlKind =
    | 'checkbox' | 'slider' | 'number' | 'dropdown' | 'text' | 'color' | 'multiselect' | 'taglist' | 'tile';

export function resolveControl(def: SettingDef): ControlKind {
    switch (def.type) {
        case 'boolean':
            return 'checkbox';
        case 'number':
            return def.min !== undefined && def.max !== undefined ? 'slider' : 'number';
        case 'tile':
            return 'tile';
        case 'string':
            if (def.color) {
                return 'color';
            }
            return def.options && def.options.length > 0 ? 'dropdown' : 'text';
        case 'string[]':
            return def.options && def.options.length > 0 ? 'multiselect' : 'taglist';
    }
}

function numberStep(def: SettingDef): string {
    if (def.step !== undefined && Number.isFinite(def.step) && def.step > 0) {
        return String(def.step);
    }
    // Fractional ranges need a fractional step; integers keep step=1.
    if (
        def.min !== undefined &&
        def.max !== undefined &&
        (def.min % 1 !== 0 || def.max % 1 !== 0 || (typeof def.default === 'number' && def.default % 1 !== 0))
    ) {
        return '0.01';
    }
    return '1';
}

/** Normalize #RGB / #RRGGBB for <input type="color"> (needs #rrggbb). */
function toColorInputValue(raw: string, fallback = '#000000'): string {
    const t = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(t)) {
        return `#${t.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(t)) {
        return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`.toLowerCase();
    }
    const fb = fallback.replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(fb)) {
        return `#${fb.toLowerCase()}`;
    }
    return '#000000';
}

function listItems(value: string): string[] {
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function isTruthy(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function summarize(def: SettingDef, value: string): string {
    switch (resolveControl(def)) {
        case 'checkbox':
            return isTruthy(value) ? 'on' : 'off';
        case 'multiselect':
        case 'taglist': {
            const items = listItems(value);
            return items.length > 0 ? items.map(item => settingOptionLabel(def, item)).join(', ') : '(none)';
        }
        case 'dropdown':
            return settingOptionLabel(def, value);
        case 'tile': {
            const [x, z] = value.split(',').map(s => s.trim());
            return x && z ? `${x}, ${z}` : value;
        }
        case 'text':
            return value.trim().length > 0 ? value.trim() : '(empty)';
        case 'color': {
            const t = value.trim();
            return t.length > 0 ? t : '(empty)';
        }
        default:
            return value;
    }
}

interface ParamControl {
    edit(def: SettingDef, current: string, onChange: (raw: string) => void, opts: { disabled: boolean }): HTMLElement;
}

const CONTROLS: Record<ControlKind, ParamControl> = {
    checkbox: {
        edit(_def, current, onChange, { disabled }) {
            const box = el('input', 'rs2b0t-param-cb');
            box.type = 'checkbox';
            box.disabled = disabled;
            box.checked = isTruthy(current);
            box.addEventListener('change', () => onChange(box.checked ? 'true' : 'false'));
            const wrap = el('div', 'rs2b0t-ctl-checkbox');
            wrap.appendChild(box);
            return wrap;
        }
    },
    slider: {
        edit(def, current, onChange, { disabled }) {
            const wrap = el('div', 'rs2b0t-ctl-slider');
            const step = numberStep(def);
            const range = el('input', 'rs2b0t-param-range');
            range.type = 'range';
            range.min = String(def.min ?? 0);
            range.max = String(def.max ?? 100);
            range.step = step;
            range.value = current;
            range.disabled = disabled;
            const num = el('input', 'rs2b0t-param-num');
            num.type = 'number';
            num.min = range.min;
            num.max = range.max;
            num.step = step;
            num.value = current;
            num.disabled = disabled;
            const rng = el('span', 'rs2b0t-param-rangelbl');
            rng.textContent = `${range.min}–${range.max}`;
            range.addEventListener('input', () => {
                num.value = range.value;
                onChange(range.value);
            });
            num.addEventListener('input', () => {
                range.value = num.value;
                onChange(num.value);
            });
            num.addEventListener('change', () => {
                range.value = num.value;
                onChange(num.value);
            });
            wrap.appendChild(range);
            wrap.appendChild(num);
            wrap.appendChild(rng);
            return wrap;
        }
    },
    number: {
        edit(def, current, onChange, { disabled }) {
            const num = el('input', 'rs2b0t-param-num');
            num.type = 'number';
            if (def.min !== undefined) num.min = String(def.min);
            if (def.max !== undefined) num.max = String(def.max);
            num.step = numberStep(def);
            num.value = current;
            num.disabled = disabled;
            num.addEventListener('change', () => onChange(num.value.trim()));
            const wrap = el('div', 'rs2b0t-ctl-number');
            wrap.appendChild(num);
            return wrap;
        }
    },
    color: {
        edit(def, current, onChange, { disabled }) {
            const wrap = el('div', 'rs2b0t-ctl-color');
            Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            const fallback = typeof def.default === 'string' ? def.default : '#000000';
            const pick = document.createElement('input');
            pick.type = 'color';
            pick.className = 'rs2b0t-param-color';
            pick.value = toColorInputValue(current, fallback);
            pick.disabled = disabled;
            pick.title = 'Pick colour';
            Object.assign(pick.style, {
                width: '36px',
                height: '28px',
                padding: '0',
                border: '1px solid #333',
                background: '#111',
                cursor: disabled ? 'default' : 'pointer'
            });
            const hex = el('input', 'rs2b0t-param-text');
            hex.type = 'text';
            hex.value = current.startsWith('#') ? current : (current ? `#${current}` : fallback);
            hex.disabled = disabled;
            hex.placeholder = '#RRGGBB';
            hex.spellcheck = false;
            Object.assign(hex.style, { width: '7.5em', fontFamily: 'monospace' });
            pick.addEventListener('input', () => {
                hex.value = pick.value;
                onChange(pick.value);
            });
            hex.addEventListener('change', () => {
                const raw = hex.value.trim();
                const normalized = toColorInputValue(raw, fallback);
                pick.value = normalized;
                // Persist what the user typed if it was already a valid hex; else normalized.
                onChange(/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw) ? (raw.startsWith('#') ? raw : `#${raw}`) : normalized);
            });
            wrap.appendChild(pick);
            wrap.appendChild(hex);
            return wrap;
        }
    },
    dropdown: {
        edit(def, current, onChange, { disabled }) {
            const sel = el('select', 'rs2b0t-param-select');
            sel.disabled = disabled;
            for (const opt of def.options ?? []) {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = settingOptionLabel(def, opt);
                sel.appendChild(o);
            }
            const match = (def.options ?? []).find(o => o.toLowerCase() === current.trim().toLowerCase());
            sel.value = match ?? String(def.default);
            sel.addEventListener('change', () => onChange(sel.value));
            const wrap = el('div', 'rs2b0t-ctl-dropdown');
            wrap.appendChild(sel);
            return wrap;
        }
    },
    text: {
        edit(_def, current, onChange, { disabled }) {
            const input = el('input', 'rs2b0t-param-text');
            input.type = 'text';
            input.value = current;
            input.disabled = disabled;
            input.addEventListener('change', () => onChange(input.value.trim()));
            const wrap = el('div', 'rs2b0t-ctl-text');
            wrap.appendChild(input);
            return wrap;
        }
    },
    multiselect: {
        edit(def, current, onChange, { disabled }) {
            const wrap = el('div', 'rs2b0t-ctl-chips');
            const selected = new Set(listItems(current).map(s => s.toLowerCase()));
            const opts = def.options ?? [];
            const boxes: HTMLInputElement[] = [];
            opts.forEach(opt => {
                const chip = el('label', 'rs2b0t-param-chip');
                const box = el('input', 'rs2b0t-param-chipbox');
                box.type = 'checkbox';
                box.disabled = disabled;
                box.checked = selected.has(opt.toLowerCase());
                box.addEventListener('change', () => {
                    const chosen = opts.filter((_, i) => boxes[i].checked);
                    onChange(chosen.join(', '));
                });
                boxes.push(box);
                chip.appendChild(box);
                chip.appendChild(document.createTextNode(settingOptionLabel(def, opt)));
                wrap.appendChild(chip);
            });
            return wrap;
        }
    },
    taglist: {
        edit(_def, current, onChange, { disabled }) {
            const wrap = el('div', 'rs2b0t-ctl-chips');
            const items = listItems(current);
            const commit = () => onChange(items.join(', '));
            const rebuild = () => {
                wrap.replaceChildren();
                items.forEach((item, i) => {
                    const chip = el('span', 'rs2b0t-param-tag');
                    chip.appendChild(document.createTextNode(item));
                    if (!disabled) {
                        const x = el('button', 'rs2b0t-param-tagx');
                        x.type = 'button';
                        x.textContent = '✕';
                        x.addEventListener('click', () => { items.splice(i, 1); commit(); rebuild(); });
                        chip.appendChild(x);
                    }
                    wrap.appendChild(chip);
                });
                if (!disabled) {
                    const add = el('input', 'rs2b0t-param-tagadd');
                    add.type = 'text';
                    add.placeholder = '+ add';
                    add.addEventListener('keydown', e => {
                        if (e.key === 'Enter' && add.value.trim()) {
                            items.push(add.value.trim());
                            commit();
                            rebuild();
                        }
                    });
                    wrap.appendChild(add);
                }
            };
            rebuild();
            return wrap;
        }
    },
    tile: {
        edit(_def, current, onChange, { disabled }) {
            const wrap = el('div', 'rs2b0t-ctl-tile');
            const parts = current.split(',').map(s => s.trim());
            const fields: HTMLInputElement[] = [];

            (['x', 'z', 'lvl'] as const).forEach((name, i) => {
                const f = el('label', 'rs2b0t-param-tilef');
                f.appendChild(document.createTextNode(name));
                const inp = el('input', 'rs2b0t-param-tilein');
                inp.type = 'number';
                inp.value = parts[i] ?? '0';
                inp.disabled = disabled;
                inp.addEventListener('change', () => onChange(fields.map(x => x.value.trim() || '0').join(',')));
                fields.push(inp);
                f.appendChild(inp);
                wrap.appendChild(f);
            });

            if (!disabled) {
                const pickBtn = document.createElement('button');
                pickBtn.className = 'rs2b0t-button';
                pickBtn.type = 'button';
                pickBtn.textContent = 'Pick on Map';
                pickBtn.style.marginLeft = '8px';
                pickBtn.style.alignSelf = 'flex-end';

                pickBtn.addEventListener('click', async () => {
                    const result = await WorldMapPicker.open();
                    if (result) {
                        const { x, z, level } = result;
                        fields[0].value = String(x);
                        fields[1].value = String(z);
                        fields[2].value = String(level);
                        onChange(`${x},${z},${level}`);
                    }
                });

                wrap.appendChild(pickBtn);
            }

            return wrap;
        }
    }
};

export function renderControl(def: SettingDef, current: string, onChange: (raw: string) => void, opts: { disabled: boolean }): HTMLElement {
    return CONTROLS[resolveControl(def)].edit(def, current, onChange, opts);
}
