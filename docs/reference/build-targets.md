[Manual](../README.md) › [Dev and deploy](../DEV.md) › Build targets

# Build targets

The bundle bakes a server target (`TARGET=…`) that fixes how the client resolves the
game WebSocket host and which RSA login modulus it uses:

- **`local`** (default), **same-origin**: `wsHost = window.location.host`. Local dev key;
  Use `./tools/deploy-local-key.sh <engine>` to derive the RSA values automatically when deploying against a stock engine.
- **`proxy`**, used by `bun run b0t`, routes each profile's selected world through
  `tools/live-proxy.ts` on the serving origin. Game sockets, cache sockets,
  CRC/JAG downloads and login-key refreshes all use the same world prefix.
  Key via `LIVE_RSAN`; the launcher checks both live worlds' keys before building.
- **`live`**, retains the direct `w1.rs2b2t.com` + `wss` target for older harnesses
  without an explicit world. An explicit `?world=1` or `?world=2` uses the serving
  origin's world proxy. Key via `LIVE_RSAN`.
- **`prod`**, **same-origin** like `local`, but bakes the **production** modulus via
  `PROD_RSAN`. This is the client hosted *on* the game server (`w1.rs2b2t.com/rs2b0t`);
  ordinary clients use that game origin. Mixed-world profiles use its allowlisted
  `/__rs2b0t/world/1` and `/__rs2b0t/world/2` routes. Install those routes on both
  game proxies before publishing a mixed-world hosted build. The build aborts if
  `PROD_RSAN` is unset.

## See also

- [Run the live wall](../how-to/run-the-live-wall.md)
