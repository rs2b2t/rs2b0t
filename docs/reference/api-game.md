[Manual](../README.md) › [Scripting API](../API.md) › Game

# Game

## Game

```ts
Game.ingame(): boolean
Game.tile(): WorldTile | null   // local player tile, null before login/scene load
Game.energy(): number           // run energy
Game.runEnabled(): boolean
Game.weight(): number
Game.inCombat(): boolean        // health bar showing
Game.animating(): boolean
Game.tick(): number             // server ticks since client boot
Game.combatMode(): number       // current raw com_mode varp
Game.combatStyleMode(style: 'attack' | 'strength' | 'controlled' | 'defence'): number | null
Game.hasCombatStyle(style): boolean
Game.setCombatStyle(style): boolean
Game.setCombatMode(mode: number): boolean // exact numeric mode (for ranged styles)
Game.myName(): string | null
Game.cameraYaw(): number
Game.cameraPitch(): number
Game.setCameraYaw(yaw: number): boolean
Game.openSideTab(tab: number): Promise<boolean>
Game.castOnNpc(spell: string, npc: Npc): Promise<boolean>
Game.teleport(name: string): Promise<boolean>
Game.castOnLoc(spell: string, loc: Loc): Promise<boolean>
Game.castOnItem(spell: string, item: InvItem): Promise<boolean>  // Superheat Item on a pack ore
Game.sceneReady(): boolean       // the scene is built and takes input
Game.sceneState(): number        // 0 idle/loading, 1 building, 2 ready
Game.combatStyleResolution(style): CombatStyleResolution | null
Game.combatStyles(): readonly CombatModeLabel[] | null   // every mode the weapon offers, with its label
Game.autoRetaliateOn(): boolean
Game.setAutoRetaliate(on: boolean): boolean
Game.attackedByPlayer(): boolean // the local player's target is another player
```

Send nothing before `Game.sceneReady()` is true: menu and walk packets injected
while the scene is still building soft-fail or retry (#445).

### Camera (client-only)

Orbit camera read/write is **client-side only**. Nothing is sent to the game
server except the client's own camera-report packets, which are already
rate-limited (`sendCameraDelay = 20` ticks between reports).

| Method | Returns | Notes |
|---|---|---|
| `cameraYaw()` | `0–2047` | Client orbit yaw units (**not** degrees). |
| `cameraPitch()` | number | Client pitch units. |
| `setCameraYaw(yaw)` | `boolean` | Local mutation / dispatch availability. **Does not** wait for the view to settle; a `true` result only means the client accepted the write. |

For automatic path-facing during walks, prefer Global **`navCameraFollow`**
(default `false`) rather than driving yaw from scripts every tick, see
[World-walking → Path camera](../reference/nav-walker.md#path-camera).

```ts
// One-shot face east (client units: east ≈ 1536)
if (Game.setCameraYaw(1536)) {
    await Execution.delay(200); // optional settle; API does not wait
}
```

Melee styles are resolved from the Accurate, Aggressive, Controlled, or
Defensive labels on the equipped weapon's combat interface. This handles
duplicate and unusual layouts without guessing from the weapon name, button
count, or ordinal order. If a requested style is unavailable, the last defensive
button is selected (including controlled on a three-mode weapon).

`Game.teleport()` accepts Varrock, Lumbridge, Falador, Camelot, Ardougne,
Watchtower, or Trollheim. Names are case-insensitive and may include `Cast` and
the `teleport` suffix. An unknown name returns `false` without opening a tab or
clicking a component.

Spell casting does not require magic side tab 6 to be active. The client keeps
the loaded magic root addressable while another side tab is displayed, so both
`Game.castOnNpc()` and `Game.teleport()` resolve and dispatch directly against
that root without changing the player's current tab. There is no separate tab or
root-availability gate: targeted casts return `false` naturally when their spell
component cannot be resolved, while teleports can still use their static fallback
component when live interface lookup is unavailable.

For a recognised teleport, the current interface button is resolved by its
displayed name. If that live lookup fails, the matching 2004 component ID is
used as a compatibility fallback. A `true` result only means the component click
was dispatched; it does not prove the server accepted the cast. Scripts should
wait for the expected tile or plane change to confirm arrival.

```ts
if (await Game.teleport('Camelot')) {
    await Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile?.x === 2757 && tile.z === 3478;
    }, 8000);
}
```

---

## World primitives

```ts
interface WorldTile { x: number; z: number; level: number; }

class Tile implements WorldTile {
    constructor(x: number, z: number, level?: number);
    static from(tile: WorldTile): Tile;
    distanceTo(other: WorldTile): number;   // Chebyshev (game movement metric)
    translate(dx: number, dz: number): Tile;
    equals(other: WorldTile): boolean;
}

abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    contains(tile: WorldTile): boolean;
    getRandomTile(): Tile;
}
```

### reader

`reader` is the raw client reader every object above is built on. It is exported
untyped (`Record<string, (...args) => unknown>`), so reach for it only when no API
object covers the read. `reader.varp(id)` is the common case ([Quests](api-quests.md)).

---

## See also

- [Scripting API index](../API.md)
