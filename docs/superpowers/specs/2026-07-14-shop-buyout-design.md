# ShopBuyout — single-shop buyout bot

Approved in-session 2026-07-14. Alternative to ShopRunner: no routing, no
cluster planner — park at one shop's bank with a total gp budget and buy the
shop out repeatedly until the budget is spent.

## Target (defaults)

Lundail's Mage Arena rune shop (`magearena_runeshop` — nature/law/death/chaos/
cosmic + elementals at low prices, delta 30). Content-verified spawns
(maps/m39_73.jm2, npc pack ids 902/903): banker **Gundai (2534,4714)**, keeper
**Lundail (2534,4719)** — same underground Mage Bank room, safe once there.
There is NO bank booth loc in the room: banking goes through Gundai's dialog
(`opnpc1` → 2 chat pages → option "access my bank account" → `@openbank`).
The bot does NOT web-walk into the wilderness — the user parks it in the room.

## Behavior

Two alternating tasks (TaskBot, no decide()):

- **Bank** (validate: session not funded, or holding bought goods, or coins
  below the cheapest chosen unit's price): walk to `bankStand`; open the bank
  via banker dialog when `banker` is set (`talkThrough(banker, ['access my
  bank'])` then wait `Bank.isOpen()`), else `Bank.openNearest(bankBooth,
  bankOp)`; deposit everything bought (death insurance — runes stack, so this
  is safety not slot pressure); stop cleanly when `sessionSpent >= budgetGp`
  or bank coins < `stopFloorGp`; else withdraw
  `min(perTripGp, budgetGp - sessionSpent, bank coins)`.
- **Buy out** (validate: funded): walk to `shopStand`, `Shop.open(keeper)`,
  read live stock, `buyoutPlan()` allocates the carried coins valuable-first
  (descending item cost, same principle as the ShopRunner fix), `Shop.buy`
  each allocation, log per item incl. zero-buys, close. If a pass buys
  nothing (stock drained), wait `recheckSeconds` before reopening — elemental
  restock is 50 ticks, law/nature 300, so hammering the shop is pointless.

`buyItems` multi-select (options = the default shop's names, all selected by
default) filters what to buy. If the selection matches nothing in the OPEN
shop's stock (e.g. the bot was re-pointed at a different shop), it buys ALL
stock and logs a warning — the options list is baked to the default shop.

## Pure core (unit-tested)

`src/bot/shops/BuyoutLogic.ts` — `buyoutPlan(rec, stock, coins, chosen)`:
descending-cost allocation over live stock using `StockModel.unitPrice`,
stopping per item when coins run out. Tests: valuable-first order, coin
bound, chosen filter, empty-stock, fallback-to-all semantics live in the bot
(warning path) not the pure fn.

## Settings

budgetGp 250000 · perTripGp 100000 · stopFloorGp 5000 · recheckSeconds 60 ·
buyItems (multi-select, default all) · keeper 'Lundail' · banker 'Gundai'
(blank = use bankBooth/bankOp booth path) · shopStand (2533,4719) ·
bankStand (2533,4714) · bankBooth 'Bank booth' · bankOp 'Use-quickly'.

## Out of scope

Wilderness web-walking / pker evasion, DeathRecovery (the room is safe; the
trip is the user's job), multi-shop routing (that's ShopRunner), sell-side.
