# RockCrab combat styles: melee / mage / range

Approved design (2026-07-14). Adds a `combatStyle` setting to RockCrab; the
wake → stack → pile → kill loop is unchanged for all styles (point-blank
fighting — no kiting, no safespots). Style differences are confined to gear
assertion, the sustain/bank gate, and ranged ammo collection. The script
withdraws its own gear from the bank when it isn't already carried/worn.

## Settings

- `combatStyle`: `melee` (default) | `mage` | `range`
- `weapon`: item to wield for mage/range (e.g. `Staff of fire`, `Shortbow`).
  Withdrawn from bank and wielded if absent; clean refusal (log + stop) if
  neither carried nor banked. Melee keeps current behavior (whatever is
  wielded; no weapon management).
- mage: `spell` (display name, e.g. `Fire Strike`), `runesWithdraw` (casts'
  worth of runes per bank trip).
- range: `ammo` (e.g. `Bronze arrow`), `ammoWithdraw`, `collectAt` (ground
  stack maturity threshold, default 20).

## Mage: autocast (all engine-verified)

Wielding a staff swaps the combat tab to `combat_staff_2`. Arm sequence
(idempotent, re-run each session — `attackstyle_magic` is a session varp):

1. Click `combat_staff_2:auto_choose` (com id 353) → `staff_spells` panel.
2. Click `staff_spells:ssbN` (com ids 1830–1845; N = spell index in the
   strike/bolt/blast/wave × wind/water/earth/fire grid) → sets the perm
   `autocast_spell` varp (59, NOT transmitted) and `attackstyle_magic = 2`.
3. Click `combat_staff_2:auto_toggle` (com id 349) → `attackstyle_magic = 3`.

Verify armed: `varp(108) === 3` (`attackstyle_magic`, transmit=yes). After
that, ordinary Attack on crabs autocasts. Casting consumes runes from the
pack; the staff's element is free (`magic_staff_table`).

## Spell/staff data

Generated module (gen-cluedb pattern): `tools/combat/gen-spelldb.ts` parses
`skill_combat/configs/magic/magic_combat_spells.dbrow` (name, levelrequired,
runesrequired triples, spell enum → ssbN index) and
`skill_magic/configs/magic_staff.dbrow` (staff obj → provided rune) into
`src/bot/api/combat/data/spelldb.ts`; `--check` drift gate. Runtime helper
derives per-cast rune needs for (spell, wielded staff) by zeroing the staff's
element — mirrors `~staff_runes`.

## Range: ammo collection

Each shot drops 1 ammo on the target's tile (`ranged_dropammo_npc`, skipped
when the tile is map_blocked). The engine merges owned stackable ground objs
per tile (`World.addObj` → `changeObj` → OBJ_COUNT) and the client updates
`obj.count` in place, exposed via `GroundItems` `.count` — stack size IS
readable. Merging resets the despawn timer, so actively-fed stacks persist;
abandoned stacks despawn on `^lootdrop_duration`.

Collection rules (pure decision module):
- collect a stack when `count >= collectAt` (mature);
- force-collect all matching stacks when the quiver is empty or before
  leaving the field (bank run, reset run, clue solve);
- age backstop: stacks whose count hasn't changed for ~90s get collected
  (despawn safety margin);
- log quiver-delta vs recovered counts (worn quiver readable via Equipment).

## Sustain / banking

The existing eat/bank gate gains style checks: mage = runes for ≥1 cast in
pack; range = quiver non-empty OR collectable ground ammo. PeriodicBank/
BankRun withdraw style consumables alongside food; gear (weapon) withdrawn
and wielded on start and after death recovery.

## Testing

- Pure unit tests: spell db derivation (rune needs w/ staff substitution),
  ssbN index mapping, ammo-collection decisions (counts/ages/quiver states).
- Drift gates: spelldb `--check` against content (pack-gated test, same
  machine-gating as the clue audit).
- Live smokes: mage variant (arm autocast, verify varp 108 = 3, kill a crab,
  rune count decrements) and range variant (fire, watch OBJ_COUNT stack grow,
  collect at threshold) — autocast clicks and stack reads deserve live proof.

## Out of scope

Safespotting, style rotation, non-elemental/lunar-style staves, crossbow
special-casing beyond the ammo name, arrow breakage modelling (this engine
drops 100% of ammo unless the tile is blocked).
