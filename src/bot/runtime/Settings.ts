import Tile from '../api/Tile.js';

/**
 * Per-bot parameters. A bot's manifest declares a
 * `settingsSchema`; the runner resolves values (schema default -> saved
 * localStorage edit -> URL override) and injects a SettingsBag onto the bot
 * before onStart. Bots read `this.settings.bool('gatherFeathers')` etc.
 *
 * URL override format: `?<ScriptName>.<key>=<value>` (case-insensitive name),
 * e.g. bot.html?ChickenKiller.gatherFeathers=true&RockCrab.stack=4 — same
 * parsed values the panel produces, for headless/scripted runs.
 */

type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

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
    /** Collapsible section this setting renders under; ungrouped settings
     *  render first, above every named group. Groups appear in schema order. */
    group?: string;
    /** Render only while another setting's CURRENT value is in `anyOf`
     *  (case-insensitive) — e.g. mage-only params behind combatStyle. Hidden
     *  settings still resolve normally at runtime; this is panel-only. */
    showIf?: { key: string; anyOf: string[] };
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
function settingToString(def: SettingDef, value: unknown): string {
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
const LAMP_SKILLS: string[] = [
    'attack', 'strength', 'ranged', 'magic', 'defence', 'hitpoints', 'prayer',
    'agility', 'herblore', 'thieving', 'crafting', 'runecraft', 'mining',
    'smithing', 'fishing', 'cooking', 'firemaking', 'woodcutting', 'fletching'
];

/** Reserved 'Global' namespace schema — settings that resolve as a fallback
 *  below per-script values (per-script overrides global). */
export const GLOBAL_SETTINGS: SettingsSchema = {
    lampSkill: { type: 'string', default: 'strength', options: LAMP_SKILLS, label: 'Genie lamp skill', help: 'which skill genie/lamp random events train' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank gems/fruit/beer/kebabs (default)' },
    runAuto: { type: 'boolean', default: true, label: 'Auto re-enable run', help: 'flip the run orb back on once energy regenerates (the engine forces it off at 0)' },
    runEnergyMin: { type: 'number', default: 20, min: 0, max: 100, label: 'Re-enable run at energy %', help: 'higher = longer walk-regen phases with faster bursts; 0 = re-enable immediately' }
};

const hasStorage = typeof localStorage !== 'undefined';

function storageKey(name: string, key: string): string {
    return `rs2b0t:set:${name}:${key}`;
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
     * The winning raw string (null = no override, use the default) and the def
     * to parse/format against, across the ONE precedence ladder: per-script URL
     * > per-script saved > (for global-eligible keys, not when resolving Global
     * itself) global URL > global saved > default. Global-eligible keys hand
     * back the Global schema's def so they parse/floor the same way regardless
     * of which bot asked. displayString and resolve both ride this ladder, so
     * the panel can never contradict what the bot runs.
     */
    private winningRaw(name: string, key: string, def: SettingDef): { raw: string | null; def: SettingDef } {
        const url = this.urlOverride(name, key);
        if (url !== null) {
            return { raw: url, def };
        }
        const saved = this.saved(name, key);
        if (saved !== undefined) {
            return { raw: saved, def };
        }
        if (name !== 'Global' && key in GLOBAL_SETTINGS) {
            const gdef = GLOBAL_SETTINGS[key];
            const gurl = this.urlOverride('Global', key);
            if (gurl !== null) {
                return { raw: gurl, def: gdef };
            }
            const gsaved = this.saved('Global', key);
            if (gsaved !== undefined) {
                return { raw: gsaved, def: gdef };
            }
            return { raw: null, def: gdef };
        }
        return { raw: null, def };
    }

    /** The string an input should show. */
    displayString(name: string, key: string, def: SettingDef): string {
        const w = this.winningRaw(name, key, def);
        return w.raw !== null ? w.raw : settingToString(w.def, w.def.default);
    }

    /** Resolve the full value map for a run: default <- saved <- URL. */
    resolve(name: string, schema: SettingsSchema): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, def] of Object.entries(schema)) {
            const w = this.winningRaw(name, key, def);
            out[key] = w.raw !== null ? parseValue(w.def, w.raw) : w.def.default;
        }
        return out;
    }

    /** Resolve the reserved Global namespace into a bag (for global-only reads). */
    globalBag(): SettingsBag {
        return new SettingsBag(this.resolve('Global', GLOBAL_SETTINGS));
    }
}

export const SettingsStore = new SettingsStoreImpl();
