[Manual](README.md) › MultiBox

# MultiBox

The wall runs several accounts in one browser tab. One tab per account throttles every
tab but the front one to about 1 fps and starves its bot; in a single tab they all hold
full speed while that tab is visible.

`multibox.html` locally, or `/rs2b0t/wall` on the hosted build.

Run `sh tools/b0t-multi.sh 3` to open three numbered Electron walls. Each has
its own renderer and startup queue. They share one client build, local proxy,
login queue, and saved profile vault. The launcher distributes four concurrent
client starts and four pathfinding workers across the windows, with at least
one of each per window.

In **Manage bots**, choose **All profiles**, check the accounts for an instance,
enter a new or existing group name, and click **Move to group** or press Enter. Saved rail tabs
also appear as groups. In each window, click **Add bot** and **Load group** for
a different group. The number beside the group is its saved profile count.

## Pages

| Page | Covers |
|---|---|
| [MultiBox reference](reference/multibox.md) | slots, tabs, the vault, login coordination, telemetry sources |
| [Telemetry never guesses](decisions/multibox-telemetry-honesty.md) | the honesty rules, and why measurement is synchronous |
| [Diagnose a slow wall](how-to/diagnose-multibox.md) | reading the retained series, naming the function |

## See also

- [Dev and deploy](DEV.md), run modes, viewers, and the hosting pipeline
- [Running locally](how-to/run-locally.md#run-a-bot), opening a wall
- [`desktop/README.md`](../desktop/README.md), the unthrottled shell
