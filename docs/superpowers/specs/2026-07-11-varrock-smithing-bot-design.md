# SmithingBot — Varrock anvil smithing — design

**Date:** 2026-07-11
**Status:** approved (design)
**Category:** Smithing

## Goal

Bar-on-anvil smithing at the Varrock West anvil: withdraw bars + a hammer, use a
bar on the Anvil, make the chosen item on the smithing panel until the bars run
low, bank the products, repeat. This is the bar→item half of smithing (the
SmelterBot does the ore→bar half).

## Domain facts (verified in `~/code/rs2b2t-content`)

- Anvil loc is named **"Anvil"** (`skill_smithing/configs/smithing/smithing.loc`).
- `oplocu,_anvil` — **using a bar on the Anvil opens the `smithing` interface**
  (`if_openmain`), a MAIN-modal panel of product COLUMNS, each with Make-1 / -5 /
  -10 buttons (`smithing.rs2` `inv_button1/2/3, smithing:column*`).
- **A hammer is required** (`inv_total(inv, hammer) < 1` → "You need a hammer").
- The client already exposes this panel: `reader.mainSkillMultiItems()` /
  `ChatDialog.isMainMakePanel()` / `ChatDialog.makeFromPanel(match, op)` (built
  for the tutorial anvil, `if_openmain`). So no new interface plumbing is needed.

## New files

- `src/bot/scripts/SmithingBot.ts` — `TaskBot`, category **Smithing**.
- (optional) `src/bot/scripts/SmithingBotLogic.ts` + test — only if a pure bit
  emerges (product/qty matching). Keep minimal.
- `tools/smithing-test.ts` — headless live smoke.

The implementer does NOT register the bot in `scripts/index.ts` (controller
registers it centrally). The bot MUST `export const SETTINGS: SettingsSchema`.

## Settings

| Key | Type | Default | Notes |
|---|---|---|---|
| `bar` | string (dropdown) | **Bronze** | Bronze/Iron/Steel/Mithril/Adamant/Rune — the bar to withdraw |
| `product` | string (dropdown) | **Dagger** | strict list: Dagger, Sword, Scimitar, Longsword, Mace, Warhammer, Battleaxe, 2h sword, Med helm, Full helm, Sq shield, Kite shield, Chainbody, Platebody, Nails, Dart tips, Arrowheads |
| `hammer` | string | `Hammer` | tool to keep; lives in the bank between cycles |
| `anvilName` | string | `Anvil` | anvil loc name |
| `anvilStand` | tile | `3188, 3425` | walkable tile by the Varrock West anvil (verify live) |
| `bankStand` | tile | `3185, 3440` | Varrock West bank |
| `bankBooth` | string | `Bank booth` | booth loc name |
| `obstacle` | string | `door, gate` | the anvil building has a door |
| `leashRadius` | number | 6 | anvil search radius |

`bar` and `product` use `type:'string'` + `options` (dropdowns). The panel shows
TIER-SPECIFIC names ("Bronze dagger"); match the `product` keyword against the
panel item names by substring (e.g. `product='Dagger'` → the "… dagger" column).

## Loop (TaskBot, priority order)

1. **ContinueDialog** — dismiss level-ups / "you need a hammer" mesboxes.
2. **BankTrip** — validate: no bars in the pack. Walk to `bankStand`
   (`walkOpening`), open the booth, **deposit the whole pack** (products + a
   leftover hammer + any stray bars), then withdraw **1 hammer** (read the real
   Withdraw-1 op off the item, like BankFletcher) and **Withdraw-All bars**
   (one bar type → All is correct here, unlike the smelter's mix). If the bank
   lacks the hammer or bars → log and idle. Then walk back toward `anvilStand`.
3. **Smith** — validate: bars in the pack AND no dialog open. Walk to the anvil
   (`walkOpening` opening the building door), use the last bar on the `Anvil`
   loc → the panel opens → `makeFromPanel(product, <Make-10 op>)` → wait for the
   bar count to drop → repeat until no bar makes the product (bars < the item's
   bar cost) or bars are gone. (Products stay in the pack; the bar count falling
   is the progress signal.)

Anvil↔bank is a short walk (like CookBot's range↔bank). No exact-count withdraw
needed (single bar type; Withdraw-All is right).

## onPaint HUD

Status + items smithed + trips + bars remaining + tick (CookBot-style).

## Testing

**Live (headless)** `tools/smithing-test.ts`: tele to Varrock West, seed bronze
bars + a hammer via `::~bankitem bronze_bar 5000` / `::~bankitem hammer 1`
(BEFORE `::~maxme` — maxme swallows the next typed command), `::~maxme` for the
smithing level, run, and assert (a) bronze daggers appear in the pack, (b) a full
withdraw→smith→bank cycle completes. Discover the real Anvil loc tile live (like
the flax/furnace bots) and note it for the default.

## Non-goals

- Smelting ore→bar (that's SmelterBot).
- Exact bar-count withdrawals (single bar type; Withdraw-All is correct).
- Blast furnace / cannonballs / dragon sq shield quest smithing.
- Walking to Varrock from elsewhere (start it at the West bank/anvil).
