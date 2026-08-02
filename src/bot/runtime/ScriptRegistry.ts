import type { AbstractBot } from '../api/Bot.js';
import type { SettingsSchema } from './Settings.js';

export interface ScriptMeta {
    name: string;
    description: string;
    version?: string;
    category?: string;
    tags?: string[];
    origin?: string;
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

class ScriptRegistryImpl {
    private metas = new Map<string, ScriptMeta>();
    private changeListeners = new Set<() => void>();

    register(meta: ScriptMeta): void {
        this.metas.set(meta.name, meta);
        this.notify();
    }

    /** Drop a registration. External scripts and test fixtures both need to leave. */
    unregister(name: string): boolean {
        const removed = this.metas.delete(name);
        if (removed) {
            this.notify();
        }

        return removed;
    }

    private notify(): void {
        for (const listener of this.changeListeners) {
            try {
                listener();
            } catch (err) {
                console.error('[rs2b0t] registry listener error', err);
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
