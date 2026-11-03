export const SCRIPT_WORLD_SWITCH_REASON = 'JiveTT checkpoint world switch';
export interface WorldResumeRequest {
    account: string;
    world: number;
    returnWorld: number;
    settings: Record<string, unknown>;
}
export interface WorldResumeCheckpoint extends WorldResumeRequest { version: 1; at: number }
export interface WorldResumePort {
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    key: string;
    worlds: readonly number[];
    current(): { account: string | null; world: number | null; safe: boolean; script: string | null; state: string };
    defer(work: () => void): void;
    switchWorld(world: number): Promise<boolean>;
    cancelSwitch(): void;
    resume(settings: Record<string, unknown>): void;
}
const identity = (name: string): string => name.trim().toLowerCase().replaceAll('_', ' ');

export class WorldResumeController {
    private generation = 0;
    private switching = false;
    private cancelled = false;
    constructor(private readonly port: WorldResumePort) {}

    pending(account?: string): WorldResumeCheckpoint | null {
        if (this.cancelled) return null;
        try {
            const value: unknown = JSON.parse(this.port.storage.getItem(this.port.key) ?? 'null');
            if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
                || !('account' in value) || typeof value.account !== 'string' || !('world' in value) || typeof value.world !== 'number'
                || !('returnWorld' in value) || typeof value.returnWorld !== 'number' || !('at' in value) || typeof value.at !== 'number'
                || !('settings' in value) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)
                || !this.port.worlds.includes(value.world) || !this.port.worlds.includes(value.returnWorld)
                || Date.now() - value.at > 10 * 60000 || value.at > Date.now() + 1000
                || (account !== undefined && identity(value.account) !== identity(account))) return null;
            return value as WorldResumeCheckpoint;
        } catch { return null; }
    }

    request(request: WorldResumeRequest): boolean {
        const current = this.port.current();
        if (this.switching || this.pending() || !current.safe || current.script !== 'JiveTT' || current.state !== 'running'
            || !current.account || identity(current.account) !== identity(request.account) || current.world === request.world
            || !this.port.worlds.includes(request.world) || !this.port.worlds.includes(request.returnWorld)) return false;
        const checkpoint: WorldResumeCheckpoint = { ...request, version: 1, at: Date.now() };
        try { this.port.storage.setItem(this.port.key, JSON.stringify(checkpoint)); } catch { return false; }
        this.cancelled = false;
        this.schedule(checkpoint);
        return true;
    }

    private schedule(checkpoint: WorldResumeCheckpoint): void {
        this.switching = true;
        const generation = ++this.generation;
        this.port.defer(() => {
            if (generation !== this.generation || !this.pending(checkpoint.account)) return;
            void this.port.switchWorld(checkpoint.world).then(success => {
                if (generation !== this.generation) return;
                this.switching = false;
                if (!success) this.cancel();
            }).catch(() => { if (generation === this.generation) this.cancel(); });
        });
    }

    resume(): boolean {
        const checkpoint = this.pending();
        const current = this.port.current();
        if (!checkpoint || !current.safe || !current.account || identity(current.account) !== identity(checkpoint.account)
            || ['running', 'paused', 'stopping'].includes(current.state)) return false;
        if (current.world !== checkpoint.world) {
            if (!this.switching) this.schedule(checkpoint);
            return false;
        }
        this.port.storage.removeItem(this.port.key);
        this.switching = false;
        this.port.resume(checkpoint.settings);
        return true;
    }

    cancel(): void {
        this.generation++;
        const pending = this.switching || this.pending() !== null;
        this.switching = false;
        this.cancelled = true;
        try { this.port.storage.removeItem(this.port.key); } catch (error) { void error; }
        if (pending) this.port.cancelSwitch();
    }
}

let controller: WorldResumeController | null = null;
export const ScriptWorldResume = {
    install(port: WorldResumePort): void { controller = new WorldResumeController(port); },
    request(request: WorldResumeRequest): boolean { return controller?.request(request) ?? false; },
    pending(account?: string): WorldResumeCheckpoint | null { return controller?.pending(account) ?? null; },
    resume(): boolean { return controller?.resume() ?? false; },
    cancel(): void { controller?.cancel(); }
};
