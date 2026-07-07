import type { AbstractBot } from '../api/Bot.js';
import type { SettingsSchema } from './Settings.js';

export interface ScriptMeta {
    name: string;
    description: string;
    version?: string;
    /** Primary category for the library filter (usually a skill). */
    category?: string;
    /** Free-form tags for filtering/search (f2p, members, banking, afk, ...). */
    tags?: string[];
    /** Where the script came from: undefined = built-in, else URL/file label. */
    origin?: string;
    /** Tunable parameters shown in the panel and resolvable from the URL. */
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

/** Available scripts. Built-ins register at module load (scripts/index.ts);
 *  external scripts register through the loader (Slice 7) — re-registering a
 *  name replaces it (the hot-reload path). */
class ScriptRegistryImpl {
    private metas = new Map<string, ScriptMeta>();
    private changeListeners = new Set<() => void>();

    register(meta: ScriptMeta): void {
        this.metas.set(meta.name, meta);
        for (const listener of this.changeListeners) {
            try {
                listener();
            } catch (err) {
                console.error('[lcbuddy] registry listener error', err);
            }
        }
    }

    list(): ScriptMeta[] {
        return [...this.metas.values()];
    }

    get(name: string): ScriptMeta | undefined {
        return this.metas.get(name);
    }

    onChange(cb: () => void): () => void {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }
}

export const ScriptRegistry = new ScriptRegistryImpl();
