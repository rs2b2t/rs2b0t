[Manual](../README.md) › [Scripting API](../API.md) › Dialogue and trade

# Dialogue and trade

## ChatDialog

Drives NPC dialogs and skill "make" menus.

```ts
ChatDialog.isOpen(): boolean
ChatDialog.canContinue(): boolean          // "Click here to continue" up
ChatDialog.continue(): Promise<boolean>
ChatDialog.options(): string[]             // selectable option lines
ChatDialog.chooseOption(match?: string): Promise<boolean>  // contains match, or first
ChatDialog.isMakeMenu(): boolean           // "What would you like to make?"
ChatDialog.makeProducts(): string[]
ChatDialog.make(match?: string): Promise<boolean>  // contains match at the largest fixed qty
ChatDialog.makeOne(match?: string): Promise<boolean>   // Make-1, never opens the count dialog
ChatDialog.makeX(match: string, count: number): Promise<boolean>  // Make-X, waits for the count dialog to open and close
ChatDialog.texts(): string[]               // every line in the modal, the NPC's included
ChatDialog.isMainMakePanel(): boolean      // main-modal make panel (fletching, smithing)
ChatDialog.mainMakeProducts(): string[]
ChatDialog.makeFromPanel(match: string, op?: string): Promise<boolean>   // op defaults to the first
ChatDialog.makeFromPanelMax(match: string): Promise<boolean>             // the largest Make op
```

## Shop

```ts
Shop.isOpen(): boolean
Shop.open(npcName: string): Promise<boolean>   // must already be near the NPC
Shop.stock(): { name; count; slot }[]
Shop.buy(name: string, n: number): Promise<number>   // units actually bought
Shop.buyById(id: number, n: number): Promise<number>   // when two items share a display name
Shop.sell(name: string, n: number): Promise<number>
Shop.close(): Promise<void>
```

## Trade

Player-to-player trade. Both sides must "Trade with" each other, then accept
offer + confirm. Any movement or combat closes the modal, own the loop with a
dedicated task while `Trade.active()`.

```ts
Trade.active(): boolean
Trade.onOfferScreen(): boolean
Trade.onConfirmScreen(): boolean
Trade.partner(): string | null
Trade.myOffer(): TradeItem[]            // { id, name, count }
Trade.theirOffer(): TradeItem[]
Trade.request(playerName: string): Promise<boolean>
Trade.offerAll(itemName, pick?): Promise<boolean>
Trade.offer(itemName, n, pick?): Promise<boolean>   // Offer-X exact qty
Trade.removeAll(): Promise<boolean>     // take everything back off your own side
Trade.accept(): Promise<boolean>
Trade.decline(): Promise<void>
```

### Partner trade policy (`api/trade/PartnerTrade`)

Pure helpers shared by GatheringBot mule modes, FlaxRunner, and NatureCrafter:

```ts
parsePartnerList(raw: string): string[]
isConfiguredPartner(name, partners): boolean
decideReceiverOfferScreen({ partnerHeader, partners, myOfferSlots, theirProductCount })
decideGiverOfferScreen(myOfferSlots): 'offer' | 'accept' | 'wait'
parseMuleMode(raw): 'off' | 'gatherer' | 'mule' | 'cooker' | 'supplier'
muleGathererHandoffActive / muleReceiverActive / muleCookerActive / muleSupplierActive
```

GatheringBot pairs `muleMode` with `mulePartner`:

| Mode | Role |
| --- | --- |
| Gatherer | Full haul → trade at camp meet (no bank) |
| Mule | Accept → **bank** (demo for ore/logs; replace with a processor script) |
| Cooker | Accept **raw fish** → cook at camp range → bank cooked (`burntPolicy`) |
| Supplier | Withdraw raw from bank when N ready → trade at meet (pairs with Cooker) |

### Cooking ranges (`api/catalogs/CookingRanges`)

Map-pack catalog of `debugname=range` ovens + curated surfaces for fishing camps:

```ts
COOKING_RANGE_LOCS          // all Range SW tiles from Server maps
nearestCookingRange(origin, maxCheb?)
cookSurfaceForFishCamp(name, role?) // role: 'pier' | 'bank'
resolveFishCampCookSurface(name, spot, maxCheb?, role?)
FISH_CAMP_COOK_PLANS        // pier + optional bank surface per camp
```

**Pier vs bank role:** cook-then-bank uses the pier surface (short walk with raw);
bank-raw-then-cook prefers a surface near the bank when one is curated (e.g. Seers
village range).

**Two-step path:** a surface may set `approach` then `stand`. FishCook walks
`approach` first (e.g. exterior of Sinclair Large door), then `stand` next to the
Range, so pathfinding enters the building before aiming at the interior oven.

### Entity query helpers

```ts
Locs.query().name('…').withinOf(tile, radius).nearest()
Locs.query().… .nearestPreferLocal(preferRadius)  // local cluster first
```

See also `api/combat/TargetPick` (`pickNearestPreferLocal`) and `api/catalogs/GatherCamp` (membership disks).

## See also

- [Scripting API index](../API.md)
