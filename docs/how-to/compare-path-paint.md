[Manual](../README.md) › [Nav](../nav/README.md) › Compare path paint

# Compare pack and client paint

Paints the pack route and the client's actual walk-click route together, to see where
they diverge.

## Turn it on in a running client

1. Append to the client URL:

   ```text
   ?Global.showNavPath=true
   ```

2. Add either or both opt-in layers:

   ```text
   &Global.navPathSceneExpand=true&Global.navPathClientSegment=true
   ```

## Read the paint

| Colour | Means |
|---|---|
| Red | pack path, scene-expanded where possible |
| Client trail | the last walk-click as the client routed it, trimmed to the player as you move |
| Green | transports |
| White outline | pack click target |

The client trail is solid while walking. With run on, tiles alternate between the
primary colour and yellow. It falls back to a scene-flag BFS when the client buffer is
empty.

## Run the harnesses

```bash
# Focused paint compare (classic pure-walk, dual paint on)
HEADED=1 bun e2e/nav-path-paint-live.ts
HEADED=1 CASES=lumb-dray,varrock-edge bun e2e/nav-path-paint-live.ts
HEADED=1 LIMIT=1 PATH_PAINT_SCENE_EXPAND=0 bun e2e/nav-path-paint-live.ts

# Stress suite, paint cases only
HEADED=1 CASES=path-paint,paint-compare bun e2e/nav-stress-live.ts

# Script routes with paint (PATH_PAINT=1 by default)
HEADED=1 LIMIT=10 USE_TELEPORTS=0 bun e2e/nav-script-routes-live.ts
HEADED=1 LIMIT=2 PATH_PAINT=0 bun e2e/nav-script-routes-live.ts
```

All three harnesses take `PATH_PAINT_SCENE_EXPAND=0|1` and `PATH_PAINT_CLIENT_SEG=0|1`.

## Settings

| Control | Default | Effect |
|---|---|---|
| `Global.navPathSceneExpand` | `false` | Expand pack segments with a scene-flag BFS when both ends are in the loaded scene |
| `Global.navPathClientSegment` | `false` | After each successful walk click, paint the exact `tryMove` tiles |
| `Global.navPathColorClient` | `#00D4FF` | Solid trail colour while walking |
| `Global.navPathColorClientRunAlt` | `#FFFF00` | Alternate tile colour while running |

## Code map

| Concern | File |
|---|---|
| Scene/Chebyshev expand | `src/bot/event/webwalk/geometry/pathExpand.ts` |
| Publish and client segment | `src/bot/event/webwalk/pathPublish.ts` |
| Walk expand and segment publish | `src/bot/event/webwalk/WalkExecutor.ts` |
| Scene paint and path line | `src/bot/event/webwalk/pathScenePaint.ts` |
| Settings | `src/bot/runtime/Settings.ts` |
| Client walk and path capture | `src/client/shell/Client.ts` |
| Adapter world path | `src/bot/adapter/ClientAdapter.ts` |
| Step flags, fallback BFS | `src/bot/event/webwalk/geometry/localReach.ts` |

## See also

- [Why the painted route diverges](../decisions/client-vs-pack-path.md)
