// docs/decisions/architecture.md#per-instance-storage
// Why: same-origin multibox frames share sessionStorage, so `?box=<account>` namespaces each bot.
// Standalone tabs use the empty box id and their own sessionStorage.
export function boxId(): string {
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

export function boxKey(suffix: string): string {
    const id = boxId();
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

// Why: one build serves /rs2b0t/index.html and local dev's /bot.html, and a relative path resolves to a file beside either.
// Why: './wall' would only work under the hosted Caddy rewrite.
export function wallLinkHref(box: string): string | null {
    return box === '' ? './multibox.html' : null;
}
