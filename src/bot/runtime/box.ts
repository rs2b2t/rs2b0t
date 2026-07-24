// Per-instance storage namespace. Every bot instance keeps its own credentials
// and settings under a "box" id so nothing bleeds between instances:
//   - a standalone bot.html tab -> box '' , isolated by its own sessionStorage
//   - a MultiBox iframe         -> box '<account>' , isolated within the tab's
//     shared sessionStorage (same-origin iframes share one sessionStorage)
// The MultiBox passes ?box=<account> when it spawns each iframe.
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
