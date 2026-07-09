import Tile from '../api/Tile.js';

/**
 * Per-bot parameters (Slice 7 finish). A bot's manifest declares a
 * `settingsSchema`; the runner resolves values (schema default -> saved
 * localStorage edit -> URL override) and injects a SettingsBag onto the bot
 * before onStart. Bots read `this.settings.bool('gatherFeathers')` etc.
 *
 * URL override format: `?<ScriptName>.<key>=<value>` (case-insensitive name),
 * e.g. bot.html?ChickenKiller.gatherFeathers=true&RockCrab.stack=4 — same
 * parsed values the panel produces, for headless/scripted runs.
 */

export type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

export interface SettingDef {
    type: SettingType;
    default: unknown;
    /** Human label for the panel (defaults to the key). */
    label?: string;
    /** number bounds (also used to clamp). */
    min?: number;
    max?: number;
    help?: string;
    /** string enums: the panel renders a dropdown and values are snapped to
     *  the list (case-insensitive) instead of free text. */
    options?: string[];
}

export type SettingsSchema = Record<string, SettingDef>;

/** Typed accessor handed to a bot as `this.settings`. */
export class SettingsBag {
    constructor(private readonly values: Record<string, unknown> = {}) {}

    bool(key: string, fallback = false): boolean {
        const v = this.values[key];
        return typeof v === 'boolean' ? v : fallback;
    }

    num(key: string, fallback = 0): number {
        const v = this.values[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    }

    str(key: string, fallback = ''): string {
        const v = this.values[key];
        return typeof v === 'string' ? v : fallback;
    }

    list(key: string, fallback: string[] = []): string[] {
        const v = this.values[key];
        return Array.isArray(v) ? (v as string[]) : fallback;
    }

    tile(key: string, fallback: Tile): Tile {
        const v = this.values[key];
        return v instanceof Tile ? v : fallback;
    }

    raw(): Record<string, unknown> {
        return { ...this.values };
    }
}

function parseValue(def: SettingDef, raw: string): unknown {
    switch (def.type) {
        case 'boolean':
            return raw === 'true' || raw === '1' || raw === 'yes';
        case 'number': {
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                return def.default;
            }
            return clampNum(n, def);
        }
        case 'string': {
            if (def.options && def.options.length > 0) {
                // snap to the declared option (URL overrides / stale saves)
                const wanted = raw.trim().toLowerCase();
                return def.options.find(o => o.toLowerCase() === wanted) ?? def.default;
            }
            return raw;
        }
        case 'string[]':
            return raw
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
        case 'tile':
            return parseTile(raw) ?? def.default;
        default:
            return def.default;
    }
}

function clampNum(n: number, def: SettingDef): number {
    let v = n;
    if (def.min !== undefined) {
        v = Math.max(def.min, v);
    }
    if (def.max !== undefined) {
        v = Math.min(def.max, v);
    }
    return v;
}

function parseTile(raw: string): Tile | null {
    const parts = raw.split(',').map(s => Number(s.trim()));
    if (parts.length < 2 || parts.some(p => !Number.isFinite(p))) {
        return null;
    }
    return new Tile(parts[0], parts[1], parts[2] ?? 0);
}

/** Serialize a resolved value back to the string form inputs/localStorage use. */
export function settingToString(def: SettingDef, value: unknown): string {
    if (def.type === 'tile' && value instanceof Tile) {
        return `${value.x},${value.z},${value.level}`;
    }
    if (def.type === 'string[]' && Array.isArray(value)) {
        return (value as string[]).join(', ');
    }
    if (def.type === 'boolean') {
        return value ? 'true' : 'false';
    }
    return String(value);
}

/** Genie/lamp skills (keys of LAMP_IF.skills) — the lampSkill dropdown options.
 *  Kept local to avoid a runtime→api import; handleLamp falls back to strength. */
export const LAMP_SKILLS: string[] = [
    'attack', 'strength', 'ranged', 'magic', 'defence', 'hitpoints', 'prayer',
    'agility', 'herblore', 'thieving', 'crafting', 'runecraft', 'mining',
    'smithing', 'fishing', 'cooking', 'firemaking', 'woodcutting', 'fletching'
];

/** Reserved 'Global' namespace schema — settings that resolve as a fallback
 *  below per-script values (per-script overrides global). */
export const GLOBAL_SETTINGS: SettingsSchema = {
    lampSkill: { type: 'string', default: 'strength', options: LAMP_SKILLS, label: 'Genie lamp skill', help: 'which skill genie/lamp random events train' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank gems/fruit/beer/kebabs (default)' }
};

const hasStorage = typeof localStorage !== 'undefined';

function storageKey(name: string, key: string): string {
    return `lcb:set:${name}:${key}`;
}

class SettingsStoreImpl {
    /** URL overrides, parsed once. */
    private urlParams: URLSearchParams | null = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;

    private urlOverride(name: string, key: string): string | null {
        if (!this.urlParams) {
            return null;
        }
        const wanted = `${name}.${key}`.toLowerCase();
        for (const [k, v] of this.urlParams.entries()) {
            if (k.toLowerCase() === wanted) {
                return v;
            }
        }
        return null;
    }

    /** Saved panel edit for one key, or undefined. */
    saved(name: string, key: string): string | undefined {
        if (!hasStorage) {
            return undefined;
        }
        const v = localStorage.getItem(storageKey(name, key));
        return v === null ? undefined : v;
    }

    save(name: string, key: string, rawString: string): void {
        if (hasStorage) {
            localStorage.setItem(storageKey(name, key), rawString);
        }
    }

    clear(name: string, key: string): void {
        if (hasStorage) {
            localStorage.removeItem(storageKey(name, key));
        }
    }

    /**
     * The string an input should show. Mirrors resolve()'s precedence so the
     * panel never contradicts what the bot runs: per-script URL > per-script
     * saved > (for global-eligible keys) global URL > global saved > global
     * default > schema default.
     */
    displayString(name: string, key: string, def: SettingDef): string {
        const url = this.urlOverride(name, key);
        if (url !== null) {
            return url;
        }
        const saved = this.saved(name, key);
        if (saved !== undefined) {
            return saved;
        }
        if (name !== 'Global' && key in GLOBAL_SETTINGS) {
            const gurl = this.urlOverride('Global', key);
            if (gurl !== null) {
                return gurl;
            }
            const gsaved = this.saved('Global', key);
            if (gsaved !== undefined) {
                return gsaved;
            }
            return settingToString(GLOBAL_SETTINGS[key], GLOBAL_SETTINGS[key].default);
        }
        return settingToString(def, def.default);
    }

    /** Resolve the full value map for a run: default <- saved <- URL. */
    resolve(name: string, schema: SettingsSchema): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, def] of Object.entries(schema)) {
            const url = this.urlOverride(name, key);
            if (url !== null) { out[key] = parseValue(def, url); continue; }
            const saved = this.saved(name, key);
            if (saved !== undefined) { out[key] = parseValue(def, saved); continue; }
            // global fallback for global-eligible keys (not when resolving Global itself)
            if (name !== 'Global' && key in GLOBAL_SETTINGS) {
                // parse + floor against the Global schema's def, not the
                // requesting bot's, so a global-eligible key resolves the same
                // way regardless of which bot asked for it
                const gdef = GLOBAL_SETTINGS[key];
                const gurl = this.urlOverride('Global', key);
                if (gurl !== null) { out[key] = parseValue(gdef, gurl); continue; }
                const gsaved = this.saved('Global', key);
                if (gsaved !== undefined) { out[key] = parseValue(gdef, gsaved); continue; }
                out[key] = gdef.default;
                continue;
            }
            out[key] = def.default;
        }
        return out;
    }

    /** Resolve the reserved Global namespace into a bag (for global-only reads). */
    globalBag(): SettingsBag {
        return new SettingsBag(this.resolve('Global', GLOBAL_SETTINGS));
    }
}

export const SettingsStore = new SettingsStoreImpl();
