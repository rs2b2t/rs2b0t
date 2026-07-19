# GreenDragon bot — design

## Goal

Kill green dragons in the deep wilderness N of Edgeville and bank their bones +
hides. A clone of the MossGiant/monster template, adapted for a wilderness
target with dragonfire + PvP.

## Facts (verified)

- **Dragons cluster** at (3081–3122, 3810–3824) — density centre ~(3094,3812),
  wilderness **level ~37**. Field anchor **(3096, 3814)**, radius 22.
- **Bank:** Edgeville **(3094, 3493)** — straight south, out of the wilderness.
- **Dragonfire:** blocked by wearing the anti-dragon shield (obj 1540, display
  **"Dragonfire shield"** in this content) — `dragon.rs2` checks `worn`. REQUIRED.
- **Bow conflict:** a bow uses `righthand`+`lefthand` → can't wear the shield →
  **no RANGE style** (v1). Melee (1h weapon + shield) and mage (staff + shield) only.
- **Teleport limit:** standard teleports fail above **level 20** wilderness
  (`teleport.rs2`). Varrock teleport (com **1164**, magic tab **6**) costs **1 law
  + 3 air + 1 fire**, level 25. So the tele-escape must run SOUTH to ≤ level 20
  (z ≲ 3665) before casting.
- **Green dragons in DROP_DB** already: Dragon bones, Dragonhide, runes, gems, gear.

## Components (reuse the monster template)

New `src/bot/scripts/GreenDragon.ts` + a curated `MELEE_WEAPONS` list added to
`equipment.ts`. Reuses everything MossGiant does (Autocast, CombatStyleLogic,
DROP_DB loot multi-select, keep-list banking, food/keepList helpers).

### Settings (pick-lists/numbers/tiles)
`combatStyle` (melee/mage) · `meleeStyle` (showIf melee) · `weapon` — 1h melee
dropdown (showIf melee) / `staff` dropdown (showIf mage) · `shield` (default
"Dragonfire shield") · `spell` + `runesWithdraw` (showIf mage) · `food` +
`foodWithdraw` · `eatHp` · `panicHp` · `loot` (drop-table, default Dragon bones +
Dragonhide + valuables) · `escape` (**Flee to bank** | **Teleport to Varrock**) ·
`anchorTile` · `bankTile`.

### Tasks (priority)
`ContinueDialog` · `DeathRecovery` · `Eat` · `GearEquip` (wield weapon/staff **+
equip the anti-dragon shield**) · `SetAttackStyle` · `ArmAutocast` (mage) ·
**`Escape`** · `BankRun` · `LootCorpse` · `Fight` (proximity — no safespot; the
shield tanks the fire, dragon melee is weak).

### Escape (the wilderness-specific part)
Triggers when `hpFrac() < panicHp` OR a non-local **player is within threat range**
(deep wildy = treat any nearby player as a PKer). Execute by mode:
- **Flee:** walk south to the Edgeville bank (out of the wilderness).
- **Teleport to Varrock:** run south until ≤ level 20 (z ≤ 3665), then open the
  magic tab + click Varrock teleport (com 1164) and confirm the jump to Varrock;
  needs the tele runes (kept + withdrawn when this mode is set). Falls back to
  flee if runes are missing or the cast doesn't land.

After either escape the bot is safe; normal BankRun (Edgeville) deposits the loot
and it walks back to the anchor. Banks **frequently** (pack-full) to cap wildy loss.

### Banking
Keep-list: bank everything except food / spell runes / weapon / **shield** / (tele
mode) Varrock tele runes. So all loot + random loot deposit.

## Testing

`greendragon-style-test` at (3096,3814): give melee gear + Dragonfire shield +
food, assert shield equipped, kills, loot (bones/hide), and survival through the
dragonfire (HP doesn't cliff). Dev world spawns the dragons, so it's live-verifiable.

## Out of scope (v1)
- RANGE style (needs antifire potions — bow blocks the shield).
- Teleport-escape landing bank at Varrock (it walks back via Edgeville instead).
- Smart PKer discrimination (v1 flees from any nearby player).
