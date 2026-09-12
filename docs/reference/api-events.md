[Manual](../README.md) › [Scripting API](../API.md) › Events and settings

# Events and settings

## Events

Subscribe with `this.on(...)` inside a bot (auto-removed on stop/crash) or the
standalone `events.on(...)`. Callbacks fire mid-frame, set flags, do work in
`loop()`.

```ts
interface EventMap {
    tick: { tick: number };
    'chat.message': { type: number; username: string | null; text: string };
    'skill.xp': { skill: number; name: string; xp: number; delta: number };
    'skill.level': { skill: number; name: string; level: number; previous: number };
    'inventory.changed': { slot: number; id: number; name: string | null; count: number; previousId: number; previousCount: number };
    'varp.changed': { index: number; value: number; previous: number };
}
```

```ts
this.on('skill.xp', e => { if (e.name === 'prayer') this.xp += e.delta; });
```

## Hostile random events

The shared random-event handler only flees when a hostile random is nearby and the
player has a visible, positive combat damage splat. Nearby spawns, zero-damage hits,
and poison ticks do not trigger evasion. Facing and targeting flags are not required.
This includes angry strange plants; pickable plants are still handled normally.

See [live verification](../how-to/verify-hostile-randoms.md) for the damage and
escape harness.

---

## Settings

Declare a `settingsSchema` on the manifest; it renders as a form in the panel and
is overridable per-run via `?ScriptName.key=value` in the URL. Read values at
runtime through `this.settings`.

```ts
type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';
interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
    options?: string[];   // persisted dropdown/multi-select values
    optionLabels?: Record<string, string>; // optional user-facing label by option value
    group?: string;       // panel group heading
}
type SettingsSchema = Record<string, SettingDef>;

interface SettingsBag {
    bool(key, fallback?): boolean;
    num(key, fallback?): number;
    str(key, fallback?): string;
    list(key, fallback?): string[];
    tile(key, fallback: Tile): Tile;
    raw(): Record<string, unknown>;
}
```

```ts
export default defineBot({
    name: 'Miner',
    settingsSchema: {
        rock:  { type: 'string', default: 'Copper rocks', label: 'Rock', options: ['Copper rocks', 'Tin rocks'] },
        power: { type: 'boolean', default: false, label: 'Power mine (drop ore)' },
        // or spread PERIODIC_BANK_SETTINGS into combat scripts
    },
    create: () => new Miner(),
});
// in the bot:  const rock = this.settings.str('rock', 'Copper rocks');
```

---

## See also

- [Scripting API index](../API.md)
