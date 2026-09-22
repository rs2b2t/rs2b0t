[Manual](../README.md) › [Dev and deploy](../DEV.md) › Live wall

# Run the live wall

The multibox rail reports bot count, CPU, RAM, and bot traffic. What those readings
mean, and the rule that no missing metric is ever replaced by a guess or a zero,
is documented in [MultiBox](../reference/multibox.md#resource-telemetry).

```bash
bun run b0t                         # dedicated Electron viewer (default)
B0T_VIEWER=chrome bun run b0t       # dedicated Chrome; CDP listens on :9223
B0T_VIEWER=firefox bun run b0t      # dedicated Firefox profile
B0T_VIEWER=none bun run b0t         # proxy only; CPU/RAM unavailable
```

Run `bun run b0t` again in another terminal to open another instance from the same
checkout. Each launch builds the current code into a private directory and chooses
the first free port starting at 8081. Source edits and later builds leave running
instances on their original build, including when you reload a window.

Electron instances share one set of saved accounts and settings, including across
different ports. Unlock the same vault passphrase in each window. Concurrent account
edits preserve each other's changes; bot sessions and builds remain independent.
`PORT=8082 bun run b0t` chooses a fixed port and fails if that port is busy.

The first launch migrates saved data from the existing localhost:8081 Electron
storage. Older app versions keep using their old storage, so restart those windows
once with the updated launcher to participate in shared settings. The old storage
is preserved. `B0T_PROFILE_DIR` can override the common saved-data directory.

Chrome and Firefox still use browser storage, with a dedicated profile for each
port under `~/.local/state/rs2b0t/` (or `$XDG_STATE_HOME/rs2b0t/`). Shared saved data
across ports is available in the Electron viewer.

One wall can run accounts on both live worlds. Start it with `bun run b0t`, open
**Add bot**, and choose **World 1** or **World 2** beside each saved profile or in
the new-profile form. **load all profiles** uses those saved choices. Existing
profiles keep the wall's default world until you assign one. Scripts, settings,
tabs and profile order stay attached to the account.

Saved World 3 profiles now use World 2 when you unlock the vault or import a
profile file. Credentials, tabs and script settings are preserved.

Each rail tile shows its script name, with a state label when paused, stopped or
crashed. The bot panel's status shows the connected world, or the target while
logged out. To move a loaded bot, choose its destination and click **Switch** on
that tile. Its script and reconnects stop. Log out in-game,
then click **Retry**. Only that bot reloads; the other bots keep running. Resume
login and scripts when ready. **Cancel** keeps the original world and leaves
scripts and auto-login stopped.

The launcher builds one local client and starts one proxy for both worlds. No
second Electron window or launcher is needed. Profile export/import preserves
world choices. Importing over an already-loaded profile changes its saved choice;
it does not interrupt that profile's current session.

For Chrome DevTools MCP, launch the managed Chrome viewer and configure MCP with
`--browser-url=http://127.0.0.1:9223`. Set `B0T_CDP_PORT` to choose another loopback
port. Additional Chrome instances select a free CDP port, recorded in their profile's
`DevToolsActivePort` file. A dedicated profile is intentional: an ordinary shared browser process includes
unrelated tabs and cannot provide honest bot-only CPU/RAM attribution.

Firefox automation must likewise use a dedicated profile. Do not attach an automation
agent to an everyday Firefox profile: it exposes that profile's cookies and sessions,
and its other tabs/extensions would contaminate capacity numbers.

For an externally managed *dedicated* browser, use
`B0T_RESOURCE_PID=<browser-root-pid> B0T_VIEWER=none bun run b0t`. On Linux that browser
must already be in a dedicated `rs2b0t-viewer-*` cgroup;
otherwise CPU/RAM are explicitly unavailable instead of silently including the terminal
or unrelated tabs.

The managed viewer and local proxy have separate lifecycle states:

- While the Electron/Chrome/Firefox viewer is running, its PID is registered and the
  CPU/RAM rows become live after the first sampling interval.
- If that viewer closes or crashes, the launcher immediately unregisters its PID and
  reports CPU/RAM as unavailable. The proxy deliberately remains available on `PORT`, so
  another already-loaded wall is not cut off merely because the managed window exited.
  The launcher continues supervising the proxy until the proxy exits or you explicitly
  stop it with Ctrl-C/TERM.
- If the proxy exits while a managed viewer is still open, the launcher reports the
  failure, closes and reaps only that owned viewer, and exits nonzero.
- `B0T_VIEWER=none` remains proxy-only. With `B0T_RESOURCE_PID`, it observes that
  externally managed dedicated browser; without one, CPU/RAM stay unavailable. The
  launcher never owns or kills an external PID.

Shutdown cleanup signals only the exact managed viewer and proxy child PIDs launched by
that invocation; it never searches for or kills a shared Firefox/Chrome process.

Each launch removes its private build directory at shutdown. Electron keeps saved
data in `Shared Storage/storage.json` under its original user-data directory and
removes its temporary browser cache at exit. The shared `out/` is only read for
cached navigation and worldmap assets.

To verify multiple instances with real Electron windows and temporary test data:

```bash
bun e2e/desktop-instances-test.ts
```

## See also

- [Build targets](../reference/build-targets.md)
