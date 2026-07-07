import type { AbstractBot } from '../api/Bot.js';
import { ScriptRegistry, type ScriptMeta } from './ScriptRegistry.js';
import type { SettingsSchema } from './Settings.js';

export interface BotManifest {
    /** Manifest format tag the loader recognizes. */
    __lcbuddyManifest: 1;
    name: string;
    description?: string;
    version?: string;
    /** Primary category for the library filter (usually a skill). */
    category?: string;
    /** Free-form tags for filtering/search. */
    tags?: string[];
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

export type BotManifestInput = Omit<BotManifest, '__lcbuddyManifest'>;

/**
 * Script manifest helper (Slice 7). External scripts default-export
 * `defineBot({...})`; the loader registers the result. Works for built-ins
 * too.
 */
export function defineBot(manifest: BotManifestInput): BotManifest {
    if (!manifest || typeof manifest.name !== 'string' || manifest.name.length === 0 || typeof manifest.create !== 'function') {
        throw new Error('defineBot requires { name, create }');
    }

    return { __lcbuddyManifest: 1, ...manifest };
}

export function isBotManifest(value: unknown): value is BotManifest {
    return typeof value === 'object' && value !== null && (value as BotManifest).__lcbuddyManifest === 1;
}

/** Register (or hot-replace) a manifest in the script registry. */
export function registerScript(manifest: BotManifestInput, origin?: string): ScriptMeta {
    const tagged = isBotManifest(manifest) ? manifest : defineBot(manifest);
    const meta: ScriptMeta = {
        name: tagged.name,
        description: tagged.description ?? '',
        version: tagged.version,
        category: tagged.category,
        tags: tagged.tags,
        origin,
        settingsSchema: tagged.settingsSchema,
        create: tagged.create
    };

    ScriptRegistry.register(meta);
    return meta;
}
