import type { TraceHost, TraceTask } from './jive-private-types.js';

export function installPrivateHostTraceFactory() {
    globalThis.__jiveHostTraceFactory = (source, capture) => {
        function isTask(value: unknown): value is TraceTask {
            return typeof value === 'object' && value !== null && 'execute' in value && typeof value.execute === 'function'
                && (!('clueStatus' in value) || value.clueStatus === undefined || typeof value.clueStatus === 'function');
        }
        function isHost(value: unknown): value is TraceHost {
            return typeof value === 'object' && value !== null && 'tasks' in value && Array.isArray(value.tasks)
                && value.tasks.every(isTask) && 'setStatus' in value && typeof value.setStatus === 'function'
                && (!('onStart' in value) || value.onStart === undefined || typeof value.onStart === 'function');
        }
        let active = true, current: TraceHost | null = null, statusBound = false;
        let state = { clueRan: false, solved: false };
        const restores: (() => void)[] = [], bound = new Set<TraceTask>();
        const unbind = () => {
            restores.splice(0).reverse().forEach(restore => restore());
            bound.clear();
            statusBound = false;
        };
        const sync = () => {
            if (!active) return;
            const bot = isHost(source.runner.bot) ? source.runner.bot : null;
            if (bot !== current) {
                unbind();
                current = bot;
                state = { clueRan: false, solved: false };
            }
            if (!bot) return;
            const own = state;
            const live = () => active && current === bot && own === state && source.runner.bot === bot;
            if (!statusBound) {
                const status = bot.setStatus, descriptor = Object.getOwnPropertyDescriptor(bot, 'setStatus');
                bot.setStatus = function (value) {
                    if (live() && bot.tasks.some(task => task.clueStatus) && value === 'clue solved') { own.solved = true; capture('solved'); }
                    return status.call(this, value);
                };
                restores.push(() => { if (descriptor) Object.defineProperty(bot, 'setStatus', descriptor); else Reflect.deleteProperty(bot, 'setStatus'); });
                if (bot.onStart) {
                    const start = bot.onStart, startDescriptor = Object.getOwnPropertyDescriptor(bot, 'onStart');
                    bot.onStart = async function () { await start.call(this); if (live()) sync(); };
                    restores.push(() => { if (startDescriptor) Object.defineProperty(bot, 'onStart', startDescriptor); else Reflect.deleteProperty(bot, 'onStart'); });
                }
                statusBound = true;
            }
            for (const task of bot.tasks) {
                if (bound.has(task)) continue;
                bound.add(task);
                const execute = task.execute, descriptor = Object.getOwnPropertyDescriptor(task, 'execute');
                task.execute = async function () {
                    if (live()) {
                        if (this.clueStatus) { own.clueRan = true; capture('solver-start'); }
                        else if (own.clueRan) capture(own.solved || bot.tasks.indexOf(task) > bot.tasks.findIndex(t => t.clueStatus) ? 'host-resume' : 'host-upkeep');
                    }
                    await execute.call(this);
                    if (live() && this.clueStatus) capture('solver-end');
                };
                restores.push(() => { if (descriptor) Object.defineProperty(task, 'execute', descriptor); else Reflect.deleteProperty(task, 'execute'); });
            }
        };
        const unchange = source.runner.onChange(sync);
        const untick = source.host.addTickListener(() => { sync(); capture('tick'); });
        sync();
        return {
            status() { sync(); return current?.tasks.find(task => task.clueStatus)?.clueStatus?.() ?? ''; },
            restore() {
                if (!active) return;
                active = false;
                unchange(); untick(); unbind(); current = null;
            },
        };
    };
}
