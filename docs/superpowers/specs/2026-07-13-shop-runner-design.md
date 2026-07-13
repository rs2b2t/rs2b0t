# ShopRunner (world shop-run supply loop) — Design

**Goal:** Stockpile training supplies by looping the world's shops and buying
their stock: **feathers, runes (elemental/mind/chaos/death), arrows +
arrowtips**. Runs on **any single account** — quest/level/members gates are
evaluated per account and ineligible shops drop off the route. Success = bank
quantities growing. GP exposure stays deliberately small: bank between shop
*clusters*, withdraw only the next leg's predicted cost, hard per-leg cap.
Buy amount per shop is a **selectable strategy**: complete buyout, or buy down
to x% of the shop's baseline stock (baselines baked in from content).

**Category:** Money making. Registered `ShopRunner`.

## Mechanic (verified in content/engine)

A shop is two joined pieces of static content — an `.inv` (stock) and the
keeper NPC's params (pricing). Engine = `~/code/rs2b2t-engine`, content =
`~/code/rs2b2t-content`.

- **Stock config** (`areas/area_varrock/configs/varrock.inv` `[runeshop]`):
  `scope=shared`, `restock=yes`, `stackall=yes`, `allstock=no`, and per slot
  `stockN=<obj>,<baseline>,<rate-ticks>`. Decoded to
  `stockobj/stockcount/stockrate` in engine `src/cache/config/InvType.ts:91`.
- **Restock loop** (engine `src/engine/World.ts:1157`, runs every 600 ms
  tick): below baseline → **+1 every `stockrate` ticks** (per slot); above
  baseline → −1 at the same rate; non-baseline junk in `allstock` stores → −1
  per 100 ticks. Restock fires on `tick % rate === 0` (global phase).
- **Stock is world-shared**: one `Inventory` singleton per shop
  (`World.invs`, `Player.ts:1474`) — other players deplete the same stock we
  do; predictions are upper bounds.
- **Price the player pays** (content `shop/scripts/shop.rs2:131-192`), with
  `d = stock − baseline`, `sell = shop_sell_multiplier` (1000 = 100%),
  `delta = shop_delta`:
  `pct = max(100, sell − clamp(d·delta, −5000, 1000))`;
  `unit = max(1, ⌊pct · oc_cost / 1000⌋)`. The buy loop **reprices every
  unit** at `S − i`. With sell=1000/delta=10: +1% of base value per unit below
  baseline, **capped at 6×** from −500 down, floored at 10% when overstocked.
  Buyout cost of a stack is therefore exactly computable.
- **Keeper params** (`varrock.npc` `[aubury]`): `owned_shop`, `shop_title`,
  `shop_sell_multiplier=1000`, `shop_buy_multiplier=550`, `shop_delta=10`
  (defaults in `shop/configs/shopkeeper.param`).
- **Protocol:** `opnpc3,_shop_keeper` (category trigger) →
  `~openshop_activenpc`; shop side `shop_template:inv` ops
  `Value/Buy 1/Buy 5/Buy 10`; buys are `InvButton{op, obj, slot, com}`. The
  bot already speaks all of this: `src/bot/api/hud/Shop.ts` —
  `open/isOpen/stock/buy/sell/close`, coms 3824/3900/3823, largest-step
  Buy 10/5/1 with held-count verification and no-progress stop (out of
  stock/coins). Smoke-tested by `tools/shop-test.ts`.
- **Gates live on doors/entrances, not shops**: Champions' Guild door checks
  `%qp < 32` (`champions_guild.rs2:1`); Zanaris door checks worn Dramen staff
  + members map (`quest_zanaris.rs2:89`). So eligibility is evaluated from
  account state, and a failed gate at runtime just looks like an unreachable
  shop.
- **Worked example — Aubury** (`runeshop`): elemental runes 2000 @ +1/10
  ticks (6 s), mind/body 1000 @ +1/10, chaos 1000 @ +1/100 (60 s), death
  1000 @ +1/150 (90 s). Fire rune `cost=4` → 4 gp at baseline. A bought-out
  death stack takes ~25 h to fully refill — slow shops *must* drop off most
  laps (this is the point of the stock model).
- **Enumerable:** 44 `.inv` files carry `stockN=` lines; 118 keeper param
  blocks reference 106 distinct `owned_shop` invs. Everything the bot needs
  is static text — no engine execution required.

## Data layers

1. **Generated shop DB** — `tools/shops/gen-shopdb.ts` parses
   `rs2b2t-content/scripts/**/*.{inv,npc,obj}` and emits committed
   `src/bot/shops/data/shopdb.ts`: per shop `{ inv, title, keepers[], sell,
   buy, delta, scope, items[{ obj, baseline, restockTicks, cost,
   stackable }] }`. `--check` mode re-generates and fails on drift (guards
   against content updates silently invalidating baked baselines).
2. **Curated route** — `src/bot/shops/data/route.ts`: clusters
   `{ id, bank { boothStand, name }, shops [{ shopId, keeperNpc, stand,
   buys [{ item, policy? }] }], gates [{ quest | skill | qp | members }] }`
   plus a fixed **cycle order** (geographic ring). Candidate v1 clusters for
   the buylist (shop titles below are candidates; the plan **must pin the
   real set + stand tiles by enumerating the generated DB** for buylist
   items):
   - **Varrock** — Aubury (runes), Lowe's (arrows) → Varrock East bank
   - **Port Sarim** — Betty (runes), Gerrant (feathers) → Draynor bank
   - members: **Catherby** — Hickton (arrows/arrowtips) → Catherby bank;
     **Fishing Guild** (feathers; fishing 68) → guild bank;
     **Yanille/Magic Guild** (runes; magic 66) → Yanille bank;
     **Ranging Guild** (arrows; ranged 40) → nearest bank per DB;
     **Shilo Village** (feathers; Shilo Village quest) → Shilo bank
3. **Nav coverage** — every shop stand and bank stand is appended to
   `NAV_TARGETS` (`src/bot/nav/data/navTargets.ts`) so the offline coverage
   gate (`tools/nav/coverage.ts`) proves each tile walkable before shipping
   (`expected:'island'` entries where OPLOC covers, e.g. Varrock East
   booths).

## Runtime

`ShopRunner extends TaskBot` (EssMiner/FlaxPicker shape) + two pure,
client-free modules: `StockModel.ts` and `Planner.ts`.

| Task (priority order) | Runs when | Behaviour |
|---|---|---|
| ContinueDialog | dialog open | continue (absorbs random-event chatter) |
| BankLeg | plan says bank (cluster start/end, out-of-coins, anomaly) | walk bank stand (`walkResilient` far / `openNearest` close), deposit purchases + **all coins**, withdraw next budget via `withdrawX('Coins', n)` (op label read off the item — space, not hyphen), hand planner the new gp |
| BuyLeg | at cluster, budget held, unvisited qualifying shop | walk shop stand, `Shop.open(keeper)` (3 retries), record `Shop.stock()` observation, buy each buylist item per policy via `Shop.buy`, record leftovers, `Shop.close()`, mark visited |
| Travel | plan's next stop ≠ here | `walkResilient(stand)` — retry-forever, Supervisor watchdog as backstop |
| Idle | no cluster qualifies | at bank, everything deposited; re-plan every ~30 s; wake at earliest predicted-qualify time |

**Planner** (pure) is consulted on every task completion: inputs (position,
gp/purchases held, stock model, route, eligibility, settings) → one decision
(`bank-now` / `buy shop X` / `travel to Y` / `idle until T`). Location-
agnostic by construction — after any disruption it just re-plans from the
current tile.

**StockModel** (pure): `expected(now) = min(baseline, lastSeen +
⌊elapsedMs/600/rate⌋)`. Never-visited shops assume full baseline (first lap
visits everything eligible). Observations: `Shop.stock()` on open + post-buy
leftovers. Persisted per account in localStorage
`rs2b0t:shoprun:<username>` as `{ shopInv: { obj: { count, atMs } } }` so
predictions survive relogin/crash.

**Worth-visiting rule:** cluster qualifies when
`Σ buyable units / Σ max buyable at baseline` (both under the active policy)
`≥ haulThreshold` (default 25%). Fast shops qualify almost every lap; a
bought-out death-rune stack drops out for hours.

**Buy policy** (the selectable strategy): `buyout` — buy to zero;
`floor(x%)` — buy until stock ≤ `⌈x% · baseline⌉` (baselines from shopdb).
Settings hold the global default; a per-item `policy` in route data wins.
Already-at-or-below floor ⇒ buy nothing.

**GP handling:** budget = Σ predicted per-unit prices of planned buys across
the cluster (exact curve above) × 1.25, rounded up to the next 1k, capped at
`maxGpPerLeg`; when the cap trims, planned units drop from the priciest tail
until the plan fits. Out of coins mid-cluster (`Shop.buy` no-progress) →
bank early and re-budget once; still short → skip the rest of the cluster
this lap. Coins are deposited in full at every BankLeg — the bot never walks
with more than one leg's budget.

## Settings

| Key | Default | Notes |
|---|---|---|
| `strategy` | `Buyout` | dropdown: `Buyout` / `Floor %` — global default; per-item route overrides win |
| `floorPct` | `50` | only used when strategy = Floor % |
| `haulThreshold` | `25%` | min predicted haul fraction to visit a cluster |
| `maxGpPerLeg` | `100k` | hard cap on any single withdrawal |
| `stopFloorGp` | `5k` | bank+held coins below this → clean stop |
| `membersWorld` | `true` | gates members clusters; wrong value degrades to benign logged skips |

## Gates & stops

- `onStart` + every login: eligibility per cluster — quests via
  `Quests.status(name) === 'complete'` (journal colour), QP via
  `Quests.points()` (varp 101), skills via live levels, members via the
  setting. Ineligible clusters drop off the ring; **zero eligible clusters →
  stop** with a message naming the cheapest unmet gate.
- Bank+held coins `< stopFloorGp` at start or any BankLeg → stop: "out of
  operating gp".
- Repeated shop-open failure (3×) → skip shop this lap (logged); whole-
  cluster failure → skip cluster this lap; never wedge the loop on one shop.
- Random-event supervisor stays active as with every bot.

## Overlay & logs (smoke-asserted shapes)

Overlay: status, `stop <cur> → next <id>`, gp carried, session haul per item
(`feathers +2140  deathrune +630 …`), last skip reason. Logs:
`[shoprun] withdraw <n>gp cluster=<id>`,
`[shoprun] buy shop=<inv> item=<obj> n=<n> spent=<gp>`,
`[shoprun] skip cluster=<id> haul=<p>%<<t>%`,
`[shoprun] banked cluster=<id>`,
`[shoprun] idle until ~<mm:ss> best=<id> <p>%`, and every stop-case message.

## Testing

- **Unit** (`test/shops/*.test.ts`): StockModel — restock convergence and
  baseline cap, elapsed-ms→ticks math, price curve (fire rune 4 gp at
  baseline; pct caps at 6000 from d=−500; floor 100; per-unit sum =
  exact buyout cost); Planner — qualify/skip at threshold edges, budget
  ×1.25/round-1k/cap-trim, ring-order next-stop with skips, idle wake time,
  out-of-gp trim; policy math — buyout vs floor unit counts incl.
  already-below-floor ⇒ 0.
- **Generator:** fixture `.inv`/`.npc`/`.obj` snippets → exact expected
  records; `--check` drift guard wired into CI/test run.
- **Nav:** coverage gate green over all new `NAV_TARGETS` entries.
- **Smoke** (`tools/shoprun-test.ts`, local engine, `shop-test.ts` pattern):
  seed coins cheat + tele near Varrock East, run `ShopRunner` with a
  **smoke route override** (Varrock cluster = Aubury only — otherwise
  Lowe's untouched stock keeps the cluster qualifying) at floor 50% and a
  small `maxGpPerLeg`; assert the leg end-to-end — `withdraw` log → Aubury
  buys with held-count growth → `banked` log with bank deltas → immediate
  re-plan **skips** the cluster (`skip cluster=varrock` log = stock model
  works). Add to `run-all-smokes`.
- Live verification on rs2b2t after merge, per repo habit.

## Risks / non-goals

- **Live competition:** world-shared stock makes predictions optimistic;
  cost is an occasional wasted stop, corrected by the on-arrival read.
- **Restock phase:** engine restocks on `tick % rate === 0`, so
  `expected()` can be ±1 unit — irrelevant at haul scale.
- **Coins withdraw op:** bank op labels use spaces and an X-dialog
  (`withdrawX`); the smoke must confirm Coins expose `Withdraw-X` on this
  engine build before trusting budget withdrawals.
- **Stackability:** the whole v1 buylist stacks (runes/feathers/arrows/
  tips). Planner asserts every buylist item is stackable (shopdb flag) at
  startup — non-stackable buylists (inventory pressure, bank-early logic)
  are out of scope.
- **Non-goals:** trading supplies to other accounts, parallel multi-runner
  de-confliction, resale/arbitrage logic, auto members-world detection,
  Zanaris/gear shops, selling to shops.
