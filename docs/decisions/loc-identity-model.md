[Manual](../README.md) › Loc identity

# Loc identity is a placement

Adapted from an [external note](https://gist.github.com/lulwut/5636d6a3010af2646d341efa9b605599).

Do not treat an object ID as the identity of a permanent object. Four concepts stay
separate:

| Concept | Is |
|---|---|
| Placement identity | scene generation, plane, world tile, shape/type |
| Raw ID | the loc ID placed in the map, or supplied by a live update |
| Effective ID | the currently visible definition after any transform |
| Version | a monotonically changing placement/state revision |

A tree becoming a stump can mean either that the placement now contains a different raw
ID, or that the same raw placement now resolves to a different effective ID. Both look
identical to a script; the engine reaches them differently.

Why it matters here: rs2b0t wraps a 2004-era client, so it reads that client's live
scene rather than reproducing a headless state pipeline. Whatever the engine did to
produce the change, the adapter sees the result.

This client's `LocType` supports varbit-selected multilocs. The scene retains the raw
placement ID and typecode for interaction packets. Menus, rendering, and bot snapshots
resolve the current child definition for its name and actions, and omit the placement
when the selected child is hidden or out of range. `LocSnapshot.id` remains the raw
placement ID; scripts use its effective name and actions without decoding transforms.
Varp packets invalidate cached snapshots so a new child is visible on the next read.

## See also

- [Loc state in the client](../reference/loc-identity.md)
