import Tile from '../api/Tile.js';
import { boxKey } from './box.js';

type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
    options?: string[];
    /** Optional display labels keyed by the persisted option value. */
    optionLabels?: Record<string, string>;
    group?: string;
    showIf?: { key: string; anyOf: string[] };
}

/** Return an option's display label without changing its persisted value. */
export function settingOptionLabel(def: SettingDef, value: string): string {
    const option = def.options?.find(candidate => candidate.toLowerCase() === value.trim().toLowerCase());
    return option === undefined ? value : (def.optionLabels?.[option] ?? option);
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
        case 'boolean': {
            const normalized = raw.trim().toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes';
        }
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
            return raw.trim();
        }
        case 'string[]': {
            const values = raw
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            if (!def.options || def.options.length === 0) {
                return values;
            }
            return values.flatMap(value => {
                const wanted = value.toLowerCase();
                const option = def.options!.find(candidate => candidate.toLowerCase() === wanted);
                return option === undefined ? [] : [option];
            });
        }
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
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank gems/fruit/beer/kebabs/caskets (default)' },
    runAuto: { type: 'boolean', default: true, label: 'Auto re-enable run', help: 'flip the run orb back on once energy regenerates (the engine forces it off at 0)' },
    runEnergyMin: { type: 'number', default: 20, min: 0, max: 100, label: 'Re-enable run at energy %', help: 'higher = longer walk-regen phases with faster bursts; 0 = re-enable immediately' },
    navEngine: {
        type: 'string',
        default: 'classic',
        options: ['classic', 'v2'],
        optionLabels: {
            classic: 'Classic (stable)',
            v2: 'Nav v2 (experimental)'
        },
        label: 'World walker',
        help:
            'Classic is the long-standing pathfinder. Nav v2 may route through spell teleports, '
            + 'logs transport hops, and filters skill/item-gated shortcuts using live stats. '
            + 'Default classic so existing scripts keep prior behaviour. Change applies on the next walk.'
    },
    showNavPath: {
        type: 'boolean',
        default: false,
        label: 'Show nav path',
        help:
            'Draw the current world-walk route on the game overlay (debug / operator). '
            + 'Does not change routing. Off by default. URL: ?Global.showNavPath=true. '
            + 'Sub-options appear when enabled (path/transport/text colours, hop labels).'
    },
    // ── Nav path paint (visible when showNavPath) — SP-aligned colours ──
    navPathShowText: {
        type: 'boolean',
        default: true,
        label: 'Hop labels',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'Captions on doors / ladders / teles (Open Door, Varrock teleport, …)'
    },
    navPathTextSize: {
        type: 'number',
        default: 11,
        min: 8,
        max: 28,
        label: 'Hop label size (px)',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] }
    },
    navPathColorPath: {
        type: 'string',
        default: '#FF0000',
        label: 'Path colour',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'HTML #RGB / #RRGGBB — remaining walk tiles (SP Path default red)'
    },
    navPathColorTransport: {
        type: 'string',
        default: '#00FF00',
        label: 'Transport colour',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'HTML #RGB / #RRGGBB — door / ladder / tele hops (SP Transports default green)'
    },
    navPathColorClick: {
        type: 'string',
        default: '#FFFFFF',
        label: 'Click target colour',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'Outline on the next walk click tile'
    },
    navPathColorText: {
        type: 'string',
        default: '#FFFFFF',
        label: 'Hop label colour',
        group: 'Nav path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'HTML #RGB / #RRGGBB — transport captions (SP Text default white)'
    }
};

const hasSession = typeof sessionStorage !== 'undefined';
const hasLocal = typeof localStorage !== 'undefined';

// Two box-scoped layers (see box.ts): sessionStorage is the live-tab authority,
// localStorage the durable copy a fresh instance of the same box reloads.
function storageKey(name: string, key: string): string {
    return boxKey(`set:${name}:${key}`);
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
        if (hasLocal) {
            localStorage.setItem(storageKey(name, key), rawString);
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
