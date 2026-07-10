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
    // `local` AND `prod` both resolve same-origin — they talk to whatever origin
    // served the page. `prod` is a real, supported target (the client hosted ON
    // the game server at w1.rs2b2t.com/rs2b0t, same-origin, no proxy); it differs
    // from `local` only in the RSA login key baked by bot.bundle.ts. `live` is the
    // odd one out: it hardcodes the world host for the local reverse-proxy dev flow.
    return { wsHost: locationHost, tls: isHttps };
}

// Baked by the bundler; undefined in unit tests / stock client → 'local'.
const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

export const TARGET: Target =
    typeof window !== 'undefined'
        ? resolveTarget(TARGET_NAME, window.location.host, window.location.protocol === 'https:')
        : resolveTarget(TARGET_NAME);
