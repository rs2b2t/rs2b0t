import type { AbstractBot } from '../api/Bot.js';
import { ScriptRegistry, type ScriptMeta } from './ScriptRegistry.js';
import type { SettingsSchema } from './Settings.js';

export interface BotManifest {
    __rs2b0tManifest: 1;
    name: string;
    description?: string;
    version?: string;
    category?: string;
    tags?: string[];
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

export type BotManifestInput = Omit<BotManifest, '__rs2b0tManifest'>;

export function defineBot(manifest: BotManifestInput): BotManifest {
    if (!manifest || typeof manifest.name !== 'string' || manifest.name.length === 0 || typeof manifest.create !== 'function') {
        throw new Error('defineBot requires { name, create }');
    }

    return { __rs2b0tManifest: 1, ...manifest };
}

export function isBotManifest(value: unknown): value is BotManifest {
    return typeof value === 'object' && value !== null && (value as BotManifest).__rs2b0tManifest === 1;
}

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
