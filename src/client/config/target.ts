export interface Target {
    wsHost: string;
    tls: boolean;
}

const LIVE_HOST =
    (process.env.RS2B2T_WS ?? '').replace(/^wss?:\/\//i, '').replace(/[/]+$/, '') ||
    'w1.rs2b2t.com';

export function resolveTarget(name: string, locationHost = '', isHttps = false): Target {
    if (name === 'live') {
        return { wsHost: LIVE_HOST, tls: true };
    }
    return { wsHost: locationHost, tls: isHttps };
}

const TARGET_NAME = process.env.RS2B0T_TARGET ?? 'local';

export const TARGET: Target =
    typeof window !== 'undefined'
        ? resolveTarget(TARGET_NAME, window.location.host, window.location.protocol === 'https:')
        : resolveTarget(TARGET_NAME);
