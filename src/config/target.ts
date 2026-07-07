/**
 * Build-time server target. `bot.bundle.ts` bakes `process.env.RS2B0T_TARGET`
 * (and the matching RSA login key) per `TARGET=local|live`. `local` talks to
 * whatever origin served the page; `live` hardcodes the rs2b2t world host and
 * forces wss. Kept in `config/` (not `bot/`) so the client can import it.
 */
export interface Target {
    /** WebSocket host[:port] — the client opens `ws(s)://<wsHost>/`. */
    wsHost: string;
    /** true → wss, false → ws. */
    tls: boolean;
}

const LIVE_HOST = 'w1.rs2b2t.com';

export function resolveTarget(name: string, locationHost = '', isHttps = false): Target {
    if (name === 'live') {
        return { wsHost: LIVE_HOST, tls: true };
    }
    return { wsHost: locationHost, tls: isHttps };
}

// Baked by the bundler; undefined in unit tests / stock client → 'local'.
const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

export const TARGET: Target =
    typeof window !== 'undefined'
        ? resolveTarget(TARGET_NAME, window.location.host, window.location.protocol === 'https:')
        : resolveTarget(TARGET_NAME);
