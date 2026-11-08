import { resolveWorldNumber, type WorldNumber } from './worlds.js';

export interface Target {
    wsHost: string;
    tls: boolean;
    world?: WorldNumber;
    httpPrefix?: string;
}

const LIVE_HOST = 'w1.rs2b2t.com';

export function supportsWorldRouting(name = process.env.RS2B0T_TARGET ?? 'local'): boolean {
    return name === 'live' || name === 'proxy' || name === 'prod';
}

export function resolveTarget(name: string, locationHost = '', isHttps = false, params = new URLSearchParams()): Target {
    if (params.has('world')) resolveWorldNumber(locationHost, params);
    if (name === 'proxy' || (params.has('world') && (name === 'live' || name === 'prod'))) {
        const world = resolveWorldNumber(locationHost, params);
        const httpPrefix = `/__rs2b0t/world/${world}`;
        return { wsHost: locationHost + httpPrefix, tls: isHttps, world, httpPrefix };
    }
    if (name === 'live') {
        return { wsHost: LIVE_HOST, tls: true };
    }
    return { wsHost: locationHost, tls: isHttps };
}

const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

export const TARGET: Target = typeof window !== 'undefined' ? resolveTarget(TARGET_NAME, window.location.host, window.location.protocol === 'https:', new URLSearchParams(window.location.search)) : resolveTarget(TARGET_NAME);

export function gameHttpUrl(path: string, target: Target = TARGET): string {
    return (target.httpPrefix ?? '') + path;
}
