# BankFletcher — bank-standing fletcher — design

**Date:** 2026-07-10
**Status:** approved (design)
**Category:** Fletching

## Goal

A **bank-standing** fletcher: stand at a bank, withdraw a full pack of logs,
knife-fletch them into the chosen product (arrow shafts or an unstrung bow),
deposit the products, and repeat. Fills the gap the existing `Fletcher`
(`ProcessingBot`) leaves — that one only fletches logs already in the pack and
never banks.

## Domain facts (verified in `~/code/rs2b2t-content`)

- Knife-on-logs → `cut_logs.rs2 fletch_log` → a **make menu**. For normal logs
  (shaft recipe): three options — **"15 Arrow Shafts"**, **"Short Bow"**
  (unstrung), **"Long Bow"** (unstrung). Other log types shift the bow tiers.
- Fletching is `map_members`-gated; rs2b2t is a members world, so it works.
- This is the standard skill-multi menu `ChatDialog.isMakeMenu()/make()` already
  drives (same as `ProcessingBot`'s Fletcher preset).

## New files

- `src/bot/scripts/BankFletcher.ts` — `TaskBot`, category **Fletching**.
- (optional) `src/bot/scripts/BankFletcherLogic.ts` + test — only if a pure bit
  emerges (e.g. product-option matching). Keep minimal; skip if trivial.
- `tools/bankfletcher-test.ts` — headless live smoke.

The implementer does NOT register the bot in `scripts/index.ts` — the controller
registers all three new bots centrally to avoid a merge conflict. The bot MUST
`export const SETTINGS: SettingsSchema` so the controller can wire it.

## Settings

| Key | Type | Default | Notes |
|---|---|---|---|
| `material` | string | `Logs` | log item to withdraw (substring; resolve exact bank name like CookBot) |
| `product` | string (dropdown) | `Arrow shafts` | options: `Arrow shafts`, `Short bow`, `Long bow` |
| `knife` | string | `Knife` | tool to keep in the pack |
| `bankStand` | tile | — (set live) | where to stand; default a sane bank, verified in the smoke |
| `bankBooth` | string | `Bank booth` | booth loc name |
| `leashRadius` | number | 6 | booth search radius |

`product` uses `type:'string' + options` (the Global-lampSkill dropdown
mechanism). Match it against `ChatDialog.makeProducts()` leniently — the menu may
expose item names (`Shortbow (u)`) or label text (`Short Bow`), so match on the
distinguishing keyword (`shaft`/`arrow`, `short`, `long`), not an exact string.

## Loop (TaskBot, priority order)

1. **ContinueDialog** — dismiss level-ups / stray continues.
2. **BankTrip** — validate: no logs in the pack. Open the booth, **deposit the
   whole inventory** (products + leftovers), then withdraw **1 knife** and
   **Withdraw-All logs** (read the real `Withdraw All` op off the item's own
   ops, like CookBot — a hardcoded label silently withdraws nothing). The knife
   lives in the bank between cycles, so this needs no keep-item logic. If the
   bank has no logs (or no knife) → log and idle a few ticks.
3. **Fletch** — validate: logs in the pack AND no dialog open. Use the knife on
   the last log → answer the make menu with `product` (largest offered qty) →
   wait until the log count drops (or a dialog/menu appears), repeat until no
   logs remain. (Mirrors CookBot's cook-one-at-a-time loop; the make-X option
   fletches a batch per interaction.)

Bank-standing: no walking between withdraw and fletch — the knife is item-on-item,
no loc/oven needed, so everything happens on `bankStand`.

## onPaint HUD

Status + product made + trips + logs remaining + tick (CookBot-style).

## Testing

- **Unit:** any pure helper (product matching) if extracted; else none.
- **Live (headless)** `tools/bankfletcher-test.ts`: tele to a bank (e.g. a Varrock
  bank), seed logs + a knife via `::~bankitem logs 5000` / `::~bankitem knife 1`,
  set `?BankFletcher.product=Arrow shafts`, run, and assert arrow shafts appear in
  the pack and a full withdraw→fletch→deposit cycle completes. Then a second phase
  with `product=Short bow` asserting unstrung shortbows are produced.
  (Debugprocs need `::~`; `::~maxme` for the fletching level; maxme dialogs
  swallow the next typed command — do setup before maxme or clear dialogs.)

## Non-goals

- Stringing bows / cutting higher log tiers beyond the make-menu options.
- Buying logs; walking to a bank from elsewhere (start it at the bank).
- Dart/bolt fletching, headless arrows.
