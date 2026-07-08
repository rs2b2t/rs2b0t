import type { SettingDef } from '../runtime/Settings.js';

export type ControlKind =
    | 'checkbox' | 'slider' | 'number' | 'dropdown' | 'text' | 'multiselect' | 'taglist' | 'tile';

/** Pick the control kind from a SettingDef's shape (pure — no DOM). */
export function resolveControl(def: SettingDef): ControlKind {
    switch (def.type) {
        case 'boolean':
            return 'checkbox';
        case 'number':
            return def.min !== undefined && def.max !== undefined ? 'slider' : 'number';
        case 'tile':
            return 'tile';
        case 'string':
            return def.options && def.options.length > 0 ? 'dropdown' : 'text';
        case 'string[]':
            return def.options && def.options.length > 0 ? 'multiselect' : 'taglist';
    }
}

/** Split a comma-joined list value into trimmed, non-empty items. */
export function listItems(value: string): string[] {
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/** Compact read-only value string for the panel summary (pure). */
export function summarize(def: SettingDef, value: string): string {
    switch (resolveControl(def)) {
        case 'checkbox':
            return value === 'true' || value === '1' || value === 'yes' ? 'on' : 'off';
        case 'multiselect':
        case 'taglist': {
            const items = listItems(value);
            return items.length > 0 ? items.join(', ') : '(none)';
        }
        case 'tile': {
            const [x, z] = value.split(',').map(s => s.trim());
            return x && z ? `${x}, ${z}` : value;
        }
        case 'text':
            return value.trim().length > 0 ? value.trim() : '(empty)';
        default: // slider, number, dropdown
            return value;
    }
}
