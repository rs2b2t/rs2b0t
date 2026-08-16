[Manual](../README.md) › [MultiBox](../MULTIBOX.md) › Reference

# MultiBox reference

`multibox.html` locally, `/rs2b0t/wall` on the hosted build.

## Slots

Each slot is an iframe running the ordinary single-instance `bot.html`, unmodified.
`MultiBoxController` owns the model; `DomSlotOps` owns the DOM. A slot exposes a narrow
`SlotHandle` (`setRenderMode`, `setCredentials`, `setAutoLogin`,
`setLoginCoordination`, `status`).

| Fact | Detail |
|---|---|
| Paint rate | Rail slots ~1 fps, focused slot every frame; the logical game loop stays full speed |
| Click handling | A `.mbx-hit` overlay sits above each iframe, because a click landing in the iframe goes to the game |
| Storage | Boxed per account via `?box=<account>`; same-origin iframes share one `sessionStorage` |
| `SlotStatus.player` | The logged-in character once known; a bot is added empty, so the tile has no name before that |
| Keyboard | Up/Down selects a neighbour, Shift+Up/Down moves the selected bot |
| Green dot | Logged in **and** script running; every other state is gray |
| Reordering | Preserves the client in each slot — rebuilding the iframe would drop the session |

## Tabs

`Main` always exists and cannot be renamed, deleted or moved. Deleting a custom tab
folds its bots into the tab to its left. New bots join the active tab; dropping a tile
on a chip files that bot there.

| Fact | Detail |
|---|---|
| Hidden tiles | Keep their iframe, session and slot position — reparenting an iframe reloads its client |
| Background tab | Bots run at render mode `hidden`, gating the same draw call the renderer switch does |
| Renderer switch | The user's own setting, never touched; a bot already off stays off |
| Focus memory | Per tab, per session; not vaulted |
| Persistence | Tab list, per-account membership and active tab live in the encrypted vault payload |
| Deleting a tab | Also clears it from saved profiles not currently loaded; those land in Main |

## Profiles and the vault

`ProfileVault` encrypts profiles at rest in `localStorage` with AES-GCM under a
PBKDF2-derived key (SHA-256, 310 000 iterations, per-vault salt and IV), using WebCrypto
— no dependency.

`VaultStatus` is `'empty' | 'locked' | 'plaintext-legacy' | 'unlocked'`.
`plaintext-legacy` is the migration state from an older build that stored profiles
unencrypted under a different key; it is detected rather than silently discarded.

`ProfileChooser` is the load-or-create screen and `VaultPrompt` the unlock prompt. Both
are DOM view modules named explicitly in the [DOM fence](import-fences.md).

## Login coordination

The production server permits four attempts for one client UID then rejects the fifth,
until that UID has been idle for 15 seconds. Every attempt refreshes that server-side
TTL, so the cooldown runs from the latest permit, not the first.

```ts
const LOGIN_BATCH_SIZE = 4;
const LOGIN_ATTEMPT_SPACING_MS = 1000;
const LOGIN_BATCH_COOLDOWN_MS = 16000;
```

A denied but due request keeps its FIFO place across polls, giving the canvas a live
`N bots in front`. Granting or removing a slot compacts the queue immediately.

## Resource telemetry

`ResourcePanel` shows bot count, CPU, RAM and bot traffic.

| Metric | Source |
|---|---|
| CPU (Linux) | Delta of cumulative `cpu.stat usage_usec` in the viewer's transient systemd cgroup-v2 scope |
| RAM (Linux) | `memory.current` in that scope |
| CPU/RAM (macOS) | The dedicated viewer's process tree |
| Traffic | Each bot client and cache worker counts its WebSocket application payload both ways and publishes deltas |

cgroup counters cover every browser thread and process and stay valid as content
processes come and go. HTTP assets, headers and transport overhead are not counted. The
card updates once per second by changing its own text — it never reloads or reparents an
iframe.

Bot count and traffic are measured in-browser and work on any wall.

## Diagnostics storage

Samples land in fixed-capacity columnar `DiagRing`s on two tiers: 1s for the last 10
minutes, 30s for the last 24 hours. A 27-bot wall costs about 6 MB for the full 24
hours.

Input lag comes from Event Timing, which Firefox implements while lacking Long Tasks.

## Backgrounding

The wall does not survive being backgrounded: the game loop is `setTimeout`-driven and
Chrome clamps hidden tabs to 1/sec, starving every bot at once. For unattended running
use the [Electron shell](../../desktop/README.md).

## See also

- [Telemetry never guesses](../decisions/multibox-telemetry-honesty.md)
- [Diagnose a slow wall](../how-to/diagnose-multibox.md)
