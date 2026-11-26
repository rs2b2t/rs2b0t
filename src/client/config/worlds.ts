export const WORLDS = [
    { number: 1, nodeId: 10, origin: 'https://w1.rs2b2t.com' },
    { number: 2, nodeId: 11, origin: 'https://w2.rs2b2t.com' },
    { number: 3, nodeId: 12, origin: 'https://w3.rs2b2t.com' }
] as const;

export type WorldNumber = (typeof WORLDS)[number]['number'];

export type BotMode = 'single' | 'wall';

export function hostedWorld(host: string) {
    const hostname = new URL(`https://${host}`).hostname;
    return WORLDS.find(world => new URL(world.origin).hostname === hostname);
}

function explicitWorld(params: URLSearchParams, number?: WorldNumber) {
    let world;
    if (number != null) {
        world = WORLDS.find(candidate => candidate.number === number);
    } else {
        const values = params.getAll('world');
        if (values.length === 0) return undefined;
        if (values.length === 1) {
            world = WORLDS.find(candidate => String(candidate.number) === values[0]);
        }
    }
    if (!world) throw new Error('world must be 1, 2 or 3');
    return world;
}

export function resolveWorldNumber(host: string, params: URLSearchParams): WorldNumber {
    return (explicitWorld(params) ?? hostedWorld(host))?.number ?? 1;
}

export function resolveNodeId(host: string, params: URLSearchParams): number {
    const world = explicitWorld(params) ?? hostedWorld(host);
    if (world) {
        return world.nodeId;
    }
    const override = params.get('nodeid');
    if (override === null) {
        return 10;
    }
    if (!/^[1-9]\d{0,2}$/.test(override) || Number(override) > 255) {
        throw new Error('nodeid must be an integer from 1 to 255');
    }
    return Number(override);
}

function copyOptions(from: URLSearchParams, to: URLSearchParams): void {
    for (const key of ['lowmem', 'members']) {
        const value = from.get(key);
        if (value === '0' || value === '1') {
            to.set(key, value);
        }
    }
}

export function worldSwitchUrl(number: number, mode: BotMode, current: URL): URL {
    const world = WORLDS.find(candidate => candidate.number === number);
    if (!world) {
        throw new Error('Unknown world');
    }
    const path = current.pathname.endsWith('.html')
        ? mode === 'wall' ? 'multibox.html' : 'bot.html'
        : mode === 'wall' ? '/rs2b0t/wall' : '/rs2b0t/';
    const url = new URL(path, current);
    copyOptions(current.searchParams, url.searchParams);
    url.searchParams.set('world', String(world.number));
    const box = current.searchParams.get('box');
    if (mode === 'single' && box) url.searchParams.set('box', box);
    return url;
}

export function botFrameUrl(wall: URL, username: string, world?: WorldNumber): URL {
    const url = new URL('bot.html', wall);
    copyOptions(wall.searchParams, url.searchParams);
    const selected = explicitWorld(wall.searchParams, world);
    if (selected) {
        url.searchParams.set('world', String(selected.number));
    }
    url.searchParams.set('nodeid', String(selected?.nodeId ?? resolveNodeId(wall.host, wall.searchParams)));
    url.searchParams.set('box', username);
    return url;
}
