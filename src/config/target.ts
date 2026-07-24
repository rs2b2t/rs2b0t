export interface Target {
    wsHost: string;
    tls: boolean;
    // Host serving the game cache: /crc, the jag archives and the on-demand socket.
    // Empty means "wherever this page came from" — the client is served by the game
    // server itself, or by a proxy that forwards those paths. Only a build hosted
    // somewhere else entirely (GitHub Pages) has to name the game host, and that
    // host must then send CORS headers for the archive fetches.
    cacheHost: string;
}

const LIVE_HOST = 'w1.rs2b2t.com';

// Which server a `pages` build plays on. Baked at build time so a fork hosting its
// own client can point at its own server; defaults to rs2b2t.
const PAGES_ORIGIN = process.env.PAGES_GAME_ORIGIN || `https://${LIVE_HOST}`;

export function resolveTarget(name: string, locationHost = '', isHttps = false): Target {
    if (name === 'live') {
        return { wsHost: LIVE_HOST, tls: true, cacheHost: '' };
    }
    if (name === 'pages') {
        const host = PAGES_ORIGIN.replace(/^https?:\/\//, '');
        return { wsHost: host, tls: PAGES_ORIGIN.startsWith('https:'), cacheHost: host };
    }
    return { wsHost: locationHost, tls: isHttps, cacheHost: '' };
}

const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

export const TARGET: Target =
    typeof window !== 'undefined'
        ? resolveTarget(TARGET_NAME, window.location.host, window.location.protocol === 'https:')
        : resolveTarget(TARGET_NAME);

// Where a cache request has to go: same-origin (unchanged) unless the build names a
// cache host, in which case it is addressed absolutely.
export function cacheUrl(path: string, target: Target = TARGET): string {
    return target.cacheHost ? `${target.tls ? 'https' : 'http'}://${target.cacheHost}${path}` : path;
}
