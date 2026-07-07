# LCBuddy2 desktop client (Electron)

Runs the bot client as a standalone desktop window instead of a browser tab.
The point is one Electron setting — `webPreferences.backgroundThrottling: false`
(plus the Chromium switches in `main.cjs` and a power-save blocker) — which
disables the timer/`requestAnimationFrame` throttling a backgrounded browser
tab imposes. In a hidden tab the game loop drops to ~1 fps and the bot starves,
then replays everything at 2–5× on refocus; here the 50 fps loop keeps running
minimized, hidden, or occluded. (Measured: **~51 fps while hidden**.)

It's a thin shell — it loads the page **served by your engine** so the client's
same-origin WebSocket and asset fetches work unchanged. No client code changes.

## Run

```sh
# engine must be running and the client deployed (tools/deploy-local.sh)
cd desktop
bun install            # once (pulls Electron)
bun run start          # opens the window against http://localhost:8888

# point at another server:
bun run start -- --server=https://your-host        # or LCB_SERVER=… bun run start
```

The window loads `<server>/bot.html`. Everything else — panel, scripts,
settings, saved credentials, auto-login, cursor trail — is identical to the
browser client, just not throttled.

## Package a distributable

```sh
bun run package        # electron-builder --dir -> desktop/dist/
```

## Validate

```sh
# from the repo root, with Node (NOT bun — Playwright's Electron launcher uses
# Node's inspector socket, which Bun breaks):
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx tsx tools/desktop-test.ts
```

Launches the app, logs in, hides the window, and asserts the loop holds full
speed (>25 fps; throttled would be ~1) with no catch-up burst — plus a forced
2.5 s main-thread stall to confirm the scheduler's frame-gap insurance shifts
timers instead of falsely timing out.

## Notes

- Still Chromium underneath, so rendering/behaviour match the browser client.
- Multi-account: open multiple windows, each with its own Electron `session`
  partition for isolated localStorage (per-account saved creds + settings).
  (Not wired into `main.cjs` yet — single window for now.)
- The bot is also hardened independent of the shell: the Scheduler shifts
  pending `Execution` deadlines across any large frame gap (system sleep,
  throttling that slips through), so waits never falsely expire.
