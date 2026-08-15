[Manual](../README.md) › [MultiBox](../MULTIBOX.md) › Telemetry honesty

# Telemetry never guesses

The resource card and diagnostics render one of the four readings below whenever a
metric cannot be measured. They never render a last-known value, an estimate derived
from host capacity, or a zero standing in for missing data.

| Reading | Means |
|---|---|
| `measuring…` | a second sample is still pending |
| `unavailable` | this metric's source cannot currently be measured |
| `offline` | the resource endpoint cannot be reached |
| `monitor error` | the endpoint answered with an invalid response |

Traffic shows a numeric `0 B/s` only after two unchanged browser-counter samples while
at least one bot publisher is present. An empty wall reports that no publisher appeared.

CPU and RAM come from the local proxy's `/__rs2b0t/resources`. A wall served straight
from an engine has no such endpoint, so those two rows are hidden rather than shown as
permanently `offline`. A monitor that answers but misbehaves is a different case and
still reports loudly.

Diagnostics follows the same rule. Unwritten ring slots read as `NaN`, never `0`. A
wrong-width sample, an unknown field, a nested phase, or a browser without Event Timing
all throw — a blind sampler silently reporting zero lag is worse than no sampler.

## Why measurement is synchronous

Timing an `async` body records the span's wall time, which includes every yield to the
other bots. That read 4–13× high and made a healthy wall look 130% oversubscribed. Only
an uninterrupted synchronous run is main-thread occupancy, so the timed hooks are
`BotHost.onFrame()` and `onDraw()` — synchronous, and where the cost lives (script and
producer work dwarfs the client's own loop by roughly 60×).

## Why stalls are measured from outside the main thread

A main-thread heartbeat cannot time the freeze it is stuck inside. `FreezeWatch` reuses
the worker-backed clock: the worker's timer fires on schedule and the resolve waits for
the main thread, so the overshoot past the requested delay is the starvation.

Do not trust `setTimeout(0)` drift as a starvation signal — an unfocused window clamps
timers to 1/sec, which looks identical to a wedged main thread. The worker-backed figure
is immune to that clamp.

## Why the coarse tier aggregates

Keeping 1 sample in 30 would discard the spikes worth having, so the 30s tier
aggregates rather than decimates.

## Why the renderer switch keeps the scene

Disabling rendering gates the draw call but keeps the iframe, canvas, scene, game loop,
script and WebSocket alive, so re-enabling draws the already-current scene on the next
frame. It is a CPU optimisation, not a headless-memory mode: correctness and instant
restoration take priority over reclaiming renderer memory.

## See also

- [MultiBox reference](../reference/multibox.md)
- [Diagnose a slow wall](../how-to/diagnose-multibox.md)
