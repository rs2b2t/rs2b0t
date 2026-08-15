[Manual](../README.md) › [Nav](../nav/README.md) › Verify transports

# Verify transport coverage

## Run the unit gates

```bash
bun test test/event/webwalk/travelCatalog.test.ts test/event/webwalk/transportQuestReqs.test.ts \
         test/event/webwalk/specialRequires.test.ts test/event/webwalk/specialCrossingMatch.test.ts
```

## Check curated endpoints are walkable in the pack

```bash
bun tools/nav/curated-travel-probe.ts
```

## Scan content for families and disabled buckets

```bash
CONTENT_DIR=~/experiments/Server/content bun tools/nav/content-transport-audit.ts
```

## Run transport-heavy routes live

```bash
bun tools/nav/transport-heavy-routes.ts --write --n=14 --explain
HEADED=1 TRANSPORT_HEAVY=1 LIMIT=14 ENERGY_REFILL_AT=25 bun e2e/nav-script-routes-live.ts
```

Quest seeds and the relog are automatic. `TH-ess-round-*` pins the essence roundtrip:
teleport to the wizard, walk into the mine, portal out. `EssenceSession` is set by the
entry hop only — there is no `setvar exit_essence_mine_coord`.

## Seed a quest gate by hand

1. `setvar <varp> <complete>` from the table in [transport reference](../reference/transports-2004.md#quest-seeds).
2. **Relog.** `Quests.status` reads the quest-list colour, which is pushed at login.

## See also

- [Transport reference](../reference/transports-2004.md)
- [What counts as a transport](../decisions/transport-scope.md)
