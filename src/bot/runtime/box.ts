import { botFrameUrl } from '../../client/config/worlds.js';

// docs/decisions/architecture.md#per-instance-storage
// Why: same-origin multibox frames share sessionStorage, so `?box=<account>` namespaces each bot.
// Standalone tabs use the empty box id and their own sessionStorage.
export function boxId(): string {
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

export function boxKey(suffix: string, id = boxId()): string {
    // Why: every standalone setting under rs2b0t:set: contains a literal colon in its suffix.
    if (id === 'set') suffix = suffix.replaceAll('%', '%25').replaceAll(':', '%3A');
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

export function boxSuffix(key: string, prefix: string, id: string): string | null {
    if (!key.startsWith(prefix) || (id === 'set' && key.includes(':', prefix.length))) return null;
    const suffix = key.slice(prefix.length);
    return id === 'set' ? suffix.replaceAll('%3A', ':').replaceAll('%25', '%') : suffix;
}

// Why: one build serves /rs2b0t/index.html and local dev's /bot.html, and a relative path resolves to a file beside either.
// Why: './wall' would only work under the hosted Caddy rewrite.
export function wallLinkHref(box: string, current?: URL): string | null {
    if (box !== '') return null;
    if (!current || !current.search) return './multibox.html';
    const url = botFrameUrl(current, '');
    url.searchParams.delete('box');
    return `./multibox.html${url.search}`;
}
