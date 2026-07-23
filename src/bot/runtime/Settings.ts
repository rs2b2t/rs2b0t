import Tile from '../api/Tile.js';

type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
    options?: string[];
    group?: string;
    showIf?: { key: string; anyOf: string[] };
}

export type SettingsSchema = Record<string, SettingDef>;

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

const LAMP_SKILLS: string[] = [
    'attack', 'strength', 'ranged', 'magic', 'defence', 'hitpoints', 'prayer',
    'agility', 'herblore', 'thieving', 'crafting', 'runecraft', 'mining',
    'smithing', 'fishing', 'cooking', 'firemaking', 'woodcutting', 'fletching'
];

export const GLOBAL_SETTINGS: SettingsSchema = {
    lampSkill: { type: 'string', default: 'strength', options: LAMP_SKILLS, label: 'Genie lamp skill', help: 'which skill genie/lamp random events train' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank gems/fruit/beer/kebabs (default)' },
    runAuto: { type: 'boolean', default: true, label: 'Auto re-enable run', help: 'flip the run orb back on once energy regenerates (the engine forces it off at 0)' },
    runEnergyMin: { type: 'number', default: 20, min: 0, max: 100, label: 'Re-enable run at energy %', help: 'higher = longer walk-regen phases with faster bursts; 0 = re-enable immediately' }
};

const hasSession = typeof sessionStorage !== 'undefined';
const hasLocal = typeof localStorage !== 'undefined';

function storageKey(name: string, key: string): string {
    return `rs2b0t:set:${name}:${key}`;
}

class SettingsStoreImpl {
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

    saved(name: string, key: string): string | undefined {
        if (hasSession) {
            const v = sessionStorage.getItem(storageKey(name, key));
            if (v !== null) {
                return v;
            }
        }
        if (hasLocal) {
            const v = localStorage.getItem(storageKey(name, key));
            if (v !== null) {
                return v;
            }
        }
        return undefined;
    }

    save(name: string, key: string, rawString: string): void {
        if (hasSession) {
            sessionStorage.setItem(storageKey(name, key), rawString);
        }
    }

    clear(name: string, key: string): void {
        if (hasSession) {
            sessionStorage.removeItem(storageKey(name, key));
        }
        if (hasLocal) {
            localStorage.removeItem(storageKey(name, key));
        }
    }

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

    displayString(name: string, key: string, def: SettingDef): string {
        const w = this.winningRaw(name, key, def);
        return w.raw !== null ? w.raw : settingToString(w.def, w.def.default);
    }

    resolve(name: string, schema: SettingsSchema): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, def] of Object.entries(schema)) {
            const w = this.winningRaw(name, key, def);
            out[key] = w.raw !== null ? parseValue(w.def, w.raw) : w.def.default;
        }
        return out;
    }

    globalBag(): SettingsBag {
        return new SettingsBag(this.resolve('Global', GLOBAL_SETTINGS));
    }
}

export const SettingsStore = new SettingsStoreImpl();
