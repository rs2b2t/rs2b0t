import Tile from '../api/Tile.js';
import { WORLDMAP_KEY_NAMES } from '../../mapview/worldmapKeyNames.js';
import { boxKey } from './box.js';

type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    /** Step for number / range controls (e.g. 0.05 for opacity). Default 1 for integers. */
    step?: number;
    help?: string;
    options?: string[];
    /** Optional display labels keyed by the persisted option value. */
    optionLabels?: Record<string, string>;
    group?: string;
    showIf?: { key: string; anyOf: string[] };
    /** Render a freeform string as an HTML colour picker + hex field. */
    color?: boolean;
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

/**
 * Account / bot-wide settings (not nav). Shown under the panel "Global settings" button.
 * Storage namespace: `Global`.
 */
export const GLOBAL_SETTINGS_CORE: SettingsSchema = {
    lampSkill: {
        type: 'string',
        default: 'strength',
        options: LAMP_SKILLS,
        label: 'Genie lamp skill',
        help: 'which skill genie/lamp random events train'
    },
    bankCommonJunk: {
        type: 'boolean',
        default: true,
        label: 'Bank gems/fruit/beer/kebabs/caskets (default)'
    },
    useMageBank: {
        type: 'boolean',
        default: false,
        label: 'Allow the Mage Arena bank',
        help:
            'Off (default): never bank at Gundai, so nothing routes through the '
            + 'Wilderness to reach it. Getting there means slashing two webs at '
            + 'level ~55 Wilderness and climbing down, so it needs a wielded slash '
            + 'weapon and a script that only meant to stay around Ardougne must not '
            + 'pick it up for being a few tiles nearer. Turn on for bots already '
            + 'working up there.'
    },
    runAuto: {
        type: 'boolean',
        default: true,
        label: 'Auto re-enable run',
        help: 'flip the run orb back on once energy regenerates (the engine forces it off at 0)'
    },
    runEnergyMin: {
        type: 'number',
        default: 20,
        min: 0,
        max: 100,
        label: 'Re-enable run at energy %',
        help: 'higher = longer walk-regen phases with faster bursts; 0 = re-enable immediately'
    }
};

/**
 * World-walk / path paint settings. Shown under the panel "Nav settings" button.
 * Still stored under the `Global` namespace (same keys as before) so URL/storage stay stable.
 */
export const NAV_SETTINGS: SettingsSchema = {
    navTeleports: {
        type: 'boolean',
        default: false,
        label: 'Nav teleports',
        group: 'Routing',
        help:
            'When on, world walks may inject spell/jewellery teleport edges (runes or charged jewellery '
            + 'in inventory). Off by default so combat/escape law kits are not spent as routing hops. '
            + 'Per-walk override: walkTo({ useTeleportCatalog: true }) or NAV_PURE_WALK to force off. '
            + 'URL: ?Global.navTeleports=true.'
    },
    navPathStallTicks: {
        type: 'number',
        default: 9,
        min: 1,
        max: 60,
        label: 'Path stall repath (ticks)',
        group: 'Routing',
        help:
            'Server ticks with no tile change before repathing the published route. '
            + 'Default 9. Scripts may override per walk. URL: ?Global.navPathStallTicks=9.'
    },
    navPathDeviation: {
        type: 'number',
        default: 10,
        min: 1,
        max: 40,
        label: 'Path deviation repath (Chebyshev)',
        group: 'Routing',
        help:
            'If the player is farther than this from the published path, repath. '
            + 'Default 10 (observed client/baked path slop). URL: ?Global.navPathDeviation=10.'
    },
    navCameraFollow: {
        type: 'boolean',
        default: false,
        label: 'Camera follows path',
        group: 'Display',
        help:
            'While world-walking, ease the orbit camera toward the path heading '
            + '(client-only, smoothed each frame like arrow-key turns). Off by default. '
            + 'URL: ?Global.navCameraFollow=true.'
    },
    showNavPath: {
        type: 'boolean',
        default: false,
        label: 'Show nav path',
        group: 'Display',
        help:
            'Draw the current world-walk route on the game overlay (debug / operator). '
            + 'Does not change routing. Off by default. URL: ?Global.showNavPath=true. '
            + 'Sub-options appear when enabled (path/transport/text colours, hop labels).'
    },
    navPathShowText: {
        type: 'boolean',
        default: true,
        label: 'Hop labels',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help: 'Captions on doors / ladders / teles (Open Door, Varrock teleport, …)'
    },
    navPathTextSize: {
        type: 'number',
        default: 11,
        min: 8,
        max: 28,
        label: 'Hop label size (px)',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] }
    },
    navPathColorPath: {
        type: 'string',
        default: '#FF0000',
        label: 'Path colour',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help: 'HTML #RGB / #RRGGBB — remaining walk tiles (default red)'
    },
    navPathColorTransport: {
        type: 'string',
        default: '#00FF00',
        label: 'Transport colour',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help: 'HTML #RGB / #RRGGBB — door / ladder / tele hops (default green)'
    },
    navPathColorClick: {
        type: 'string',
        default: '#FFFFFF',
        label: 'Click target colour',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help: 'Outline on the next walk click tile'
    },
    navPathColorText: {
        type: 'string',
        default: '#FFFFFF',
        label: 'Hop label colour',
        group: 'Path paint',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help: 'HTML #RGB / #RRGGBB — transport captions (default white)'
    },
    navPathSceneExpand: {
        type: 'boolean',
        default: false,
        label: 'Scene-aware path expand (experimental)',
        group: 'Experimental',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help:
            'Experimental debug: fill pack path segments with live scene collision '
            + 'BFS when both ends are on-screen (instead of Chebyshev diagonals). '
            + 'Can change corridor snap. Off by default.'
    },
    navPathClientSegment: {
        type: 'boolean',
        default: false,
        label: 'Paint client walk trail (experimental)',
        group: 'Experimental',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        help:
            'Experimental debug: after each walk click, paint the exact client '
            + 'tryMove tiles (solid when walking; alternate colours when run is on). '
            + 'Compare to the pack path. Off by default.'
    },
    navPathColorClient: {
        type: 'string',
        default: '#00D4FF',
        label: 'Client trail colour (experimental)',
        group: 'Experimental',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help:
            'Primary colour for the experimental client-walk trail (solid when walking). '
            + 'Default cyan #00D4FF.'
    },
    navPathColorClientRunAlt: {
        type: 'string',
        default: '#FFFF00',
        label: 'Client run alt colour (experimental)',
        group: 'Experimental',
        showIf: { key: 'showNavPath', anyOf: ['true'] },
        color: true,
        help:
            'When run is on, client-walk tiles alternate primary / this colour. '
            + 'Default yellow #FFFF00.'
    }
};

/** Full Global storage schema = core + nav (URL / SettingsStore.globalBag). */
export const GLOBAL_SETTINGS: SettingsSchema = {
    ...GLOBAL_SETTINGS_CORE,
    ...NAV_SETTINGS
};

/**
 * Settings for the tile map picker only (in-picker Settings modal).
 * Not shown under Global settings. Storage namespace: {@link MAP_PICKER_SETTINGS_NS}.
 * URL: `?MapPicker.showBasemap=false` etc.
 */
export const MAP_PICKER_SETTINGS_NS = 'MapPicker';

export const MAP_PICKER_SETTINGS: SettingsSchema = {
    showBasemap: {
        type: 'boolean',
        default: true,
        label: 'Show basemap',
        group: 'Display',
        help:
            'On (default): classic worldmap terrain + optional Key / multi / free layers. '
            + 'Off: original collision-dot grid with named destination markers. '
            + 'Clicks always snap to nearest walkable tile either way.'
    },
    // Dot style only applies in classic mode (basemap off).
    dotColor: {
        type: 'string',
        default: '#0a3d7a',
        label: 'Walkable colour',
        group: 'Display',
        color: true,
        showIf: { key: 'showBasemap', anyOf: ['false'] },
        help: 'Walkable-dot colour when basemap is off (default #0a3d7a).'
    },
    dotAlpha: {
        type: 'number',
        default: 0.85,
        min: 0.05,
        max: 1,
        step: 0.05,
        label: 'Walkable opacity',
        group: 'Display',
        showIf: { key: 'showBasemap', anyOf: ['false'] },
        help: '0.05–1 in steps of 0.05 (default 0.85). Only when basemap is off.'
    },
    // Pre-baked per-type Key overlays (deploy gen:basemap) — free toggles, no MapView.
    keyIconTypes: {
        type: 'string[]',
        default: [],
        options: [...WORLDMAP_KEY_NAMES],
        // Worldmap Key panel labels type 38 as "???"; visually these are minigame sites.
        optionLabels: { '???': 'Minigames' },
        label: 'Key icons',
        group: 'Worldmap layers',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help:
            'Which Key legend types to draw (Bank, Altar, Fishing Spot, …). '
            + 'Each type is a pre-baked transparent overlay — toggle free, no rebuild. '
            + 'Minigames is Jagex’s “???” Key row (mapfunction type 38). '
            + 'Default none = terrain only.'
    },
    showPlaceLabels: {
        type: 'boolean',
        default: false,
        label: 'Place names',
        group: 'Worldmap layers',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help:
            'Town / area names from the classic worldmap labels pack (pre-baked overlay). '
            + 'Default off. Free — no rebuild.'
    },
    showMultiTint: {
        type: 'boolean',
        default: false,
        label: 'Multicombat areas',
        group: 'Worldmap layers',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Red multicombat tint (pre-baked). Free — no rebuild.'
    },
    showFreeTint: {
        type: 'boolean',
        default: false,
        label: 'Free-to-play areas',
        group: 'Worldmap layers',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Green free-to-play tint (pre-baked). Free — no rebuild.'
    },
    // Live Rebuild is rare — deploy already bakes terrain + Key/labels/multi/free.
    bakeLabels: {
        type: 'boolean',
        default: false,
        label: 'Stamp labels into rebuild',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Prefer Worldmap layers → Place names (pre-baked). Only for live Rebuild stamps.'
    },
    bakeBorders: {
        type: 'boolean',
        default: false,
        label: 'Map-square borders',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: '64×64 map-square grid when regenerating (dev).'
    },
    bakeNpcs: {
        type: 'boolean',
        default: false,
        label: 'NPC dots',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'NPC positions from worldmap data when regenerating.'
    },
    bakeItems: {
        type: 'boolean',
        default: false,
        label: 'Item dots',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Ground-item positions when regenerating.'
    },
    bakeKeyIcons: {
        type: 'boolean',
        default: false,
        label: 'Stamp Key icons into rebuild',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Prefer Worldmap layers → Key icons (pre-baked per type).'
    },
    bakeMultimap: {
        type: 'boolean',
        default: false,
        label: 'Stamp multicombat into rebuild',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Prefer Worldmap layers → Multicombat areas (pre-baked).'
    },
    bakeFreemap: {
        type: 'boolean',
        default: false,
        label: 'Stamp free-to-play into rebuild',
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help: 'Prefer Worldmap layers → Free-to-play areas (pre-baked).'
    },
    skipRebuildConfirm: {
        type: 'boolean',
        default: false,
        label: "Don't ask before rebuild",
        group: 'Basemap rebuild',
        showIf: { key: 'showBasemap', anyOf: ['true'] },
        help:
            'Rebuild map… re-runs MapView (tab freezes). Mainly useful after a game update or if you '
            + 'want a custom stamp (labels / higher detail). Everyday Key layers need no rebuild.'
    }
};

const hasSession = typeof sessionStorage !== 'undefined';
const hasLocal = typeof localStorage !== 'undefined';

// Two box-scoped layers (see box.ts): sessionStorage is the live-tab authority,
// localStorage the durable copy a fresh instance of the same box reloads.
function storageKey(name: string, key: string): string {
    return boxKey(`set:${name}:${key}`);
}

export type SettingChangeListener = (name: string, key: string, value: string) => void;

class SettingsStoreImpl {
    private urlParams: URLSearchParams | null = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    /** Same-tab subscribers (open modals). `storage` events only fire across tabs. */
    private changeListeners = new Set<SettingChangeListener>();

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
        for (const fn of this.changeListeners) {
            try {
                fn(name, key, rawString);
            } catch {
                /* listener errors must not break save */
            }
        }
    }

    /**
     * Subscribe to SettingsStore.save (same tab). Returns unsubscribe.
     * Used so an open map picker stays aligned with Global settings edits.
     */
    onChange(listener: SettingChangeListener): () => void {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }

    /** True when `?Name.key=` wins over saved/default (toggle cannot stick). */
    isUrlOverride(name: string, key: string): boolean {
        return this.urlOverride(name, key) !== null;
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
