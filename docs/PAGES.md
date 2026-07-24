# Hosting your fork on GitHub Pages

Fork the repo, flip one setting, and your fork's client is playable in a browser —
no server, no proxy, no local build:

```
main             ->  https://<user>.github.io/<repo>/
any other branch ->  https://<user>.github.io/<repo>/branch/<name>/
```

The client is static; the game itself still runs on rs2b2t. Pushing to a branch
republishes just that branch's folder, so `main` and every feature branch keep
their own URL side by side.

## Setup (once per fork)

1. **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / `(root)`.**
2. Push anything. The `pages` workflow builds and publishes; the first run creates
   `gh-pages` for you.

No secrets. The login key is public and rotates, so the build reads it back off the
client the server itself serves rather than pinning a copy.

Playing on a different server? Set the repository variable **`PAGES_GAME_ORIGIN`**
(Settings → Secrets and variables → Actions → Variables), e.g. `https://my.server`.

## What the server has to allow

A Pages-hosted client is **cross-origin**: the page comes from `github.io` while the
cache (`/crc` and the jag archives) comes from the game server. Browsers block those
reads unless the server says otherwise, so the game server must send
`Access-Control-Allow-Origin` on its cache endpoints.

Without it the client dies at the first request, before the title screen:

```
Access to fetch at 'https://<server>/crc' from origin 'https://<user>.github.io'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

That is the only thing needed — these are plain GETs, so there is no preflight, and
the game WebSocket is unaffected (sockets are not subject to CORS).

### Engine patch

In the engine's `src/web.ts`, the cache routes each return a bare `Response`:

```ts
} else if (url.pathname.startsWith('/crc')) {
    return new Response(Buffer.from(CrcBuffer.data));
} else if (url.pathname.startsWith('/title')) {
    return new Response(Buffer.from(OnDemand.cache.read(0, 1)!));
```

Give them a shared header:

```ts
// The client may be hosted off this server (a fork's GitHub Pages build), which
// makes these cache reads cross-origin. The archives are public, so allow them.
const CACHE_HEADERS = { 'Access-Control-Allow-Origin': '*' };
```

and pass it on each cache response:

```ts
} else if (url.pathname.startsWith('/crc')) {
    return new Response(Buffer.from(CrcBuffer.data), { headers: CACHE_HEADERS });
```

The routes that need it: `/crc`, `/title`, `/config`, `/interface`, `/media`,
`/versionlist`, `/textures`, `/wordenc`, `/sounds`.

Note this lets any page fetch the cache. That is already effectively possible —
`bun run b0t` proxies exactly these paths — so it removes friction rather than
granting anything new. If you would rather allow-list, echo the request's `Origin`
back instead of `*` (a literal wildcard subdomain is not valid in that header).

## How it fits together

`TARGET=pages` builds a client that addresses the game server absolutely instead of
assuming it was served by it (`src/config/target.ts`). Every other target — `local`,
`live`, `prod` — keeps fetching same-origin exactly as before, so the local dev flow,
`bun run b0t`, and the hosted prod client are unchanged.
