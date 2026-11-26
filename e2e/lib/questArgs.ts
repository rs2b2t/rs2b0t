export interface QuestArgs {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    deploy: boolean;
}

interface QuestFlags<T> {
    switches?: Record<string, Partial<T>>;
    values?: Record<string, (value: string) => Partial<T>>;
}

export function parseQuestArgs<T extends QuestArgs & { food?: string; stats?: number }>(
    argv: readonly string[],
    defaults: T,
    flags: QuestFlags<NoInfer<T>> = {}
): T {
    const args = { ...defaults };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') {
            args.deploy = false;
            continue;
        }
        if (flags.switches && Object.hasOwn(flags.switches, flag)) {
            Object.assign(args, flags.switches[flag]);
            continue;
        }
        const value = argv[++i];
        if (value === undefined) break;
        if (flag === '--base') args.base = value;
        else if (flag === '--user') args.user = value;
        else if (flag === '--stage') args.stage = Number(value);
        else if (flag === '--until') args.until = Number(value);
        else if (flag === '--minutes') args.minutes = Number(value);
        else if (flag === '--tick') args.tickMs = Number(value);
        else if (flag === '--food' && 'food' in args) args.food = value;
        else if (flag === '--stats' && 'stats' in args) args.stats = Number(value);
        else if (flags.values && Object.hasOwn(flags.values, flag)) Object.assign(args, flags.values[flag](value));
    }
    return args;
}
