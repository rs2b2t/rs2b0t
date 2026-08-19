[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Regicide

Nine, and the first four are geography the quest only happens to expose.

- **Tirannwn is not one map.** A component report over the quest's own anchors answers FAIL for every
  pair inside the palisade: the forest is 38 sealed pockets, and each seam is a dense forest, a log
  balance, a pitfall, a tripwire or a sticks trap whose tile the collision pack marks blocked. A plain
  `walkResilient` toward anything past one reports "unreachable", which reads as a missing loc rather than
  as a missing route. `tools/nav/regicide-pockets.ts` derives the seam graph from the map and bakes it, and
  the module plans a chain of crossings across it.
- **The dense forests are all shut until stage 8.** `_regicide_cross_over` answers "You can see no way to
  get past this" below `^regicide_spoken_tracker2`, and that gate covers every one of the fourteen
  crossings, not only the ones into Tyras's camp. The route from the Isafdar entry to the elf camp before
  stage 8 is therefore a pitfall, a sticks trap, a second pitfall and a log balance — four seams, none of
  them a dense forest. Planning the "obvious" route through the trees parks the run at the first one.
- **A crossing's two sides cannot be found by looking around it.** The three dense forests west of the elf
  camp sit three tiles apart, so any ring search wide enough to reach a pitfall's landing tile also reaches
  past the neighbouring crossing — and then claims one seam does the work of three. Every side here is
  derived from the script that performs the crossing, and the five scripts disagree with each other about
  which angle means which axis: `_regicide_cross_over` reads north/south as the x axis and
  `regicide_jump_pitfall` reads it as the z axis.
- **The log balances span a chasm, so both their ends are unwalkable.** `regicide_logbalance*_start` does
  not block, but the ground under the log does — the tile the forcemove chain lands on is not one anything
  can stand on. The banks either side are what a leg walks to, and they are one to three tiles further out
  depending on the crossing. Assuming the fixed ±5 offset the script arithmetic gives produced three seams
  whose stand tiles were in no pocket at all.
- **The way back in is Iban's own temple door.** `open_iban_door` grows a branch at
  `%regicide_quest >= ^regicide_spoken_lathas` that teleports the player `loc + (-129, +64)` — the Well of
  Voyage room — instead of into the temple. So reaching Isafdar means walking the Underground Pass end to
  end again, and the Arandar palisade is no help: `arandar_gate` opens northbound at any stage and southbound
  only past `^regicide_killed_tyras`. The forest is entered through the pass and left through the gate.
- **Both of the pass's hard gates are permanent.** `cave_well` descends only with all four orb bits set and
  the temple doors open only with the three badges and the horn thrown, but both are `%ibanmulti` bits — an
  account that finished Underground Pass keeps them, so the second walk through is obstacles alone. A
  harness that seeds the stage varp without the bits is seeding a pass that cannot be crossed.
- **The still is a control problem, and its temperature is not readable.** `%regicide_still_total` and
  `%regicide_still_settings` are the only two varps in the quest with `transmit=yes`; `%temp` is `scope=temp`
  with none. Progress accrues only while the tar regulator is at full flow and the heat needle sits in bits
  19-24, the regulator is +2 pressure a tick and the valve one step open is -2 — the only pairing that holds
  the gauge still — and passing either needle's last bit resets the tally to zero. Coal at needle six or
  below with four ticks between lumps finishes in 36 game ticks on six coal; two lumps inside one softtimer
  period stack the +3 jump and blow the gauge every time.
- **`interface.pack` holds the server's component ids, not the client's.** The still's five controls are
  `com_129` to `com_132` and `com_120`, which the pack numbers 6174-6177 and 5061 — and pressing those does
  nothing at all. Six hundred presses of the pressure valve left it on bit 26 with no message either way.
  The client's own id is what `IF_BUTTON` has to carry, and the only stable handle on it is the label the
  component puts in the menu: `reader.buttonByText(root, 'Turn pressure valve up')`.
- **The rabbit has to be handed over last.** `regicide_cross_over3` clears `^regicide_given_rabbit`
  whenever it is taken inside mapsquare 34_49, and the walk from the Isafdar entry to the catapult takes
  that crossing. Feeding the guard before setting out spends the rabbit for nothing, and the
  catapult then answers "Oi! Don't mess with that" with no way to tell why.
- **Five NPCs are called "Tyras guard" and two items are called "Barrel bomb".** The camp guard, the tent
  guard, the old camp guard, the ordinary guards and the lazy one at the catapult all render the same name,
  and only the last takes the rabbit. The sealed barrel and the fused one share a display name too, as do
  the two half-mixes. Match by id.

## See also

- [Quest pitfalls: the map](quest-pitfalls.md)
- [Quest pitfalls: Underground Pass: the map](quest-pitfalls-29.md)
- [Quest pitfalls: Underground Pass: the live legs](quest-pitfalls-31.md)
- [Quest pitfalls: engine behaviour](quest-pitfalls-engine.md)
