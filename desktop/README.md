[Manual](../docs/README.md) › Desktop shell

# rs2b0t desktop client (Electron)

Runs the bot client as a standalone desktop window instead of a browser tab. A thin
shell over the page served by your engine, so the client's same-origin WebSocket and
asset fetches work unchanged. No client code changes.

Why: `webPreferences.backgroundThrottling: false`, the Chromium switches in `main.cjs`
and a power-save blocker disable the throttling a backgrounded browser tab imposes. A
hidden tab drops the game loop to ~1 fps and starves the bot, then replays at 2–5× on
refocus. Measured here: ~51 fps while hidden.

## Run

For live bots, run `bun run b0t` from the repository root. One Electron wall can
run profiles on World 1, World 2 and World 3 together. Choose a world per profile in
**Add bot**, then use **load all profiles**. Each rail tile shows its script name
and state; the status panel shows its connected world. A tile's **Switch** stops
that bot's script and reconnects; log out in-game, click **Retry**, then resume it
on the destination world.

For a local development engine:

1. Start the engine and deploy the client (`tools/deploy-local.sh`).
2. `cd desktop`
3. `bun install` (once, pulls Electron)
4. `bun run start` opens against `http://localhost:8081`

Point at another server with `bun run start -- --server=https://your-host`, or
`LCB_SERVER=… bun run start`.

## Package a distributable

```sh
bun run package        # electron-builder --dir -> desktop/dist/
```

## Facts

| | |
|---|---|
| Page loaded | `<server>/multibox.html` by default; explicit `.html` URLs are preserved |
| Rendering | Chromium, so behaviour matches the browser client |
| Panel, scripts, settings, saved credentials, auto-login, cursor trail | identical to the browser client |
| Multi-account | profiles run in the multibox wall within one window |
| Frame-gap hardening | the Scheduler shifts pending `Execution` deadlines across large frame gaps, so waits never falsely expire, independent of this shell |

## See also

- [Running locally](../docs/how-to/run-locally.md)
- [Manual index](../docs/README.md)
