[Manual](../README.md) › [Scripting API](../API.md) › Banking

# Banking helpers


High-level open / deposit helpers. **This is what scripts should call.**

```ts
Banking.open(opts?: {
    stand?: WorldTile | null;     // preset stand when no bank is already nearby
    boothName?: string;           // default 'Bank booth'
    boothOp?: string;             // default 'Use-quickly'
    obstacles?: string[];         // doors/gates on the way to stand (e.g. ['door','gate'])
    destination?: BankDestination;// force a bank when no booth in scene
    preferNearby?: boolean;       // default true; prefer a nearby bank
    nearbyRadius?: number;        // default NEARBY_BANK_RADIUS (14)
    log?: (msg: string) => void;
}): Promise<boolean>
// The caller handles deposits and the return trip.

NEARBY_BANK_RADIUS                // radius for a nearby bank
resolveBankOpenRoute(input)       // choose the bank route

Banking.bankNearest(opts: {
    deposit: (name: string) => boolean;
    commonJunk?: boolean;         // also bank gems/fruit/beer/kebabs/caskets (default true)
    destination?: BankDestination;
    returnTo?: WorldTile;
    boothName?: string;
    boothOp?: string;
    afterDeposit?: () => void | Promise<void>;
    log?: (msg: string) => void;
}): Promise<boolean>
```

**Open rules** (default `preferNearby: true`)

| Situation | Behaviour |
|---|---|
| usable booth within `nearbyRadius` | open it, **ignore** distant preset stand |
| nearest known bank within radius, stand far | walk that local bank |
| `stand` set, `obstacles` non-empty | walk opening doors/gates → `openBooth` |
| `stand` set, no obstacles | `walkResilient` → `openBooth` |
| no `stand`, booth in scene | `openNearestAccess` |
| no `stand`, no booth | web-walk nearest known bank, then open |

**Deposit helpers** (pass into `Bank.depositAllMatching` or `bankNearest.deposit`):

```ts
depositAllExcept(keep: Iterable<string>): (name: string) => boolean
// keep tools/bait; bank everything else

depositMatcher(own: (name) => boolean, includeCommon: boolean): (name, id?) => boolean
matchesCommonBankLoot(name: string, id?: number): boolean
COMMON_BANK_LOOT: string[]            // 'uncut', gem names, 'strange fruit', …
RANDOM_EVENT_CASKET_ID: number        // always treated as common loot
```

> **Default to `depositAllExcept`.** Reach for an allow-list (`depositMatcher`, or
> matching your own product by name) only when you can name every item the pack is
> allowed to accumulate, and you usually can't. Random events, gem-table rolls, drops
> and quest leavings all arrive unannounced, and anything the deposit misses **squats a
> slot on every future trip**. That is a slow leak, not a crash: the bot keeps working
> while each load quietly shrinks, so nothing fails and no test notices.
>
> Deny-listing inverts the failure. An unexpected item gets banked (harmless) instead of
> hoarded (compounding). Keep the list to what the script needs to hold, and
> keep the *specific* item, not the category: `CoalTrucks` keeps the one pickaxe
> `bestPickaxe` selected, so a spare or an unusable tier is banked rather than squatting
> a coal slot forever.

**Periodic bank settings** (combat/loot scripts):

```ts
PERIODIC_BANK_SETTINGS   // bankStrategy / bankEveryItems / bankEveryMinutes / bankCommonJunk
parseBankStrategy(label: string): 'off' | 'items' | 'time' | 'either'
shouldBankNow(strategy, { lootCount, minutesSinceLastBank, itemsThreshold, minutesThreshold }): boolean
```

```ts
// Preset location with a door between spots and bank
await Banking.open({
    stand: loc.bankStand,
    boothName: loc.boothName,
    boothOp: loc.boothOp,
    obstacles: loc.obstacles ?? [],
    log: m => this.log(m),
});
await Bank.depositAllMatching(depositAllExcept(['Small fishing net']));

// Use the nearest bank, deposit loot, then walk back.
await Banking.bankNearest({
    deposit: depositAllExcept(['Lobster pot']),
    returnTo: this.anchor,
    log: m => this.log(m),
});
```

## Item acquisition

Higher-level helpers for "make sure I have these items":

```ts
type ItemNeed = { name: string; count: number; source: ItemSource };

held(name: string): number          // item count across backpack slots, excluding worn gear
hasAll(needs: ItemNeed[]): boolean  // every need satisfied by current holdings
class AcquireTask implements Task { constructor(bot, needs: ItemNeed[]); } // obtains items
```

`AcquireTask` plugs into a `TaskBot` to gather/shop/withdraw a set of item needs.
See `src/bot/api/acquisition/ItemAcquisition.ts` and the bots that use it for usage.

---

## See also

- [Inventory, equipment and bank](api-items.md)
- [Scripting API index](../API.md)
