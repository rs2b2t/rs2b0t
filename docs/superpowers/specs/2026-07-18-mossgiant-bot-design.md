# MossGiant bot — design

## Goal

A combat/banking bot for the moss giants NW of Ardougne, mirroring RockCrab's
mage/range/melee selector but built around the *general* monster-combat pattern
(safespot with range/mage, or fight in proximity with melee — then loot and
bank), not RockCrab's crab-specific stack/aggro-reset machinery. All settings are
pick-lists / numbers / tile-pickers — no free text.

## Coordinates (defaults, exposed as tile settings)

- **Safespot / field anchor:** `(2553, 3406, 0)` — reaches all 4 giants for
  range/mage; also the walk-back anchor for every style.
- **Bank:** `(2615, 3332, 0)` — booth-adjacent tile at the north East-Ardougne bank.
- **Target NPC:** `Moss giant` (npc id 112, melee-only → the safespot tile is
  unreachable by the giants but attackable from).

## Components

### 1. Drop-table DB (`tools/combat/gen-dropdb.ts` → `src/bot/api/combat/data/dropdb.ts`)

Mirrors the `gen-spelldb` pattern (obj debugname → display name, `--check` drift
gate). Parses `scripts/drop tables/scripts/*.rs2`: each `[ai_queue3,<monster>]`
block's `obj_add(npc_coord, <obj>, ...)` calls, plus the config always-drop
(`npc_param(death_drop)`, e.g. `big_bones` → Big bones) and the shared
`~randomherb` / `~randomjewel` sub-tables (resolved from
`shared_droptables.rs2`; members branch, since this server is all-content).
Output: `DROP_DB: Record<string, string[]>` — monster display name → sorted
unique droppable item **display names**. Serves any monster's loot select.

Moss giant expected items: Big bones, Black square shield, Magic staff, Steel med
helm, Mithril sword, Mithril spear, Steel kiteshield, Law/Air/Earth/Chaos/Nature/
Cosmic/Death/Blood rune, Iron arrow, Steel arrow, Coins, Steel bar, Coal, Spinach
roll, + herbs (unidentified Guam…Dwarf weed) + gems (uncut Sapphire…Diamond) +
Rune javelin / key halves.

### 2. Equipment lists + shared helpers

- `src/bot/api/combat/equipment.ts` — curated `BOWS` and `STAFFS` display-name
  lists (era-appropriate). Drives the style-gated weapon dropdowns.
- `src/bot/api/combat/food.ts` — lift RockCrab's `FOOD_FORMS` / `FOOD_OPTIONS`
  / food-count helpers here so both bots share one copy.
- **Keep-list banking:** a deposit predicate `name => !keep(name)` where the
  keep-set = food forms + the spell's runes (mage) + ammo (range) + the wielded
  weapon. Banks *all* loot and random-event loot; keeps only what's needed.

### 3. `src/bot/scripts/MossGiant.ts`

`TaskBot`. Settings (all pick-list/number/tile):
`combatStyle` (mage/range/melee) · `staff` (dropdown, showIf mage) · `spell`
(dropdown, showIf mage) · `bow` (dropdown, showIf range) · `ammo` (dropdown,
showIf range) · `runesWithdraw`/`ammoWithdraw` · `food` (dropdown) +
`foodWithdraw` · `eatHp` · `panicHp` · `loot` (multi-select from
`DROP_DB['Moss giant']`, default = valuables) · `bankCommonJunk` · `safespotTile`
· `bankTile`.

Tasks (priority high→low): `ContinueDialog` · `DeathRecovery` · `Eat` (<eatHp) ·
`GearEquip` (wield staff/bow) · `SetAttackStyle` · `ArmAutocast` (mage,
runes-gated per the earlier fix) · `PanicBank` (HP<panicHp → walk to bank,
deposit loot, withdraw food, return; wait out regen if bank has no food) ·
`BankRun` (out of food/runes/ammo, or pack full → bank: keep-list deposit +
restock, walk back to safespot) · `LootCorpse` (loot-list drops on the ground in
the field → walk over, grab) · `ReturnToSafespot` (range/mage only: off the
safespot → walk back) · `Fight` (attack nearest alive Moss giant; range/mage
attack from the safespot without stepping off; melee walk in and fight).

Kill→loot→return cycle: Fight kills → LootCorpse grabs loot-list matches →
ReturnToSafespot re-mounts (2553,3406) for range/mage → Fight re-engages. Aggro
is passive (giants hit until their timer resets; Eat/PanicBank absorb it —
nothing to manage).

### 4. RockCrab updates

- Free-text `weapon` → the same style-gated `bow`/`staff` dropdowns.
- Loot banking → keep-list deposit (banks all loot + random loot).
- Use the shared `food.ts`. Do NOT touch the verified autocast/combat/crab logic.

## Testing

`tools/mossgiant-style-test.ts` (mirrors `rockcrab-style-test`): tele near the
giants, give gear/food(/runes), run melee + mage; assert kills logged, loot
picked up, autocast armed (mage), and that range/mage holds the safespot tile.
Plus `bun tsc`, `bun test`, and `gen-dropdb --check` in the suite.

## Out of scope (v1, follow-ups)

- Multi-bot etiquette (leaving other players' giants/loot alone).
- Generating the bow/staff lists from the content weapon-category enum (curated
  for v1).
