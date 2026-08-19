[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Scorpion Catcher

One quest point, three scorpions, and three unrelated gates that the quest never
mentions.

- **A quest's requirements are what its scripts test, not what its journal prints.** The
  journal asks for 31 Prayer. Getting the three scorpions also needs Alfred Grimhand's
  Barcrawl (the outpost gate's guard turns everyone else away), the dusty key (the only
  door into the half of Taverley Dungeon the first scorpion is in) and membership of the
  monastery order (the ladder refuses anyone else). Each is a chain of its own, and none
  of the three is a requirement the record can express.
- **A varp that carries hints does not carry progress.** `%scorpcatcher` moves 0 → 1 → 2 → 3
  → 6 as the Seer talks, and stops there whether the character holds no scorpions or all
  three. Which ones are caught lives in the cage: eight `scorpcage` objs, one display name
  between them, and the id is the only thing that separates a cage holding A from a cage
  holding B and C.
- **A journal that counts the pack cannot see the bank.** `scorpcatcher_journal.rs2` tests
  `inv_total(inv, ...)` only, so a banked cage reads as nothing caught. Reading the obj id
  out of `bankIds` as well as `invIds` is what makes the quest resumable across a bank trip;
  reading the journal is not.
- **`Reach` answering an unreachable NPC by opening the door in front of it walks a run out
  of the room it is in.** Velrak has no `wanderrange`, so he drifts five tiles inside a cell
  whose internal walls make five tiles a walk; the shared talk primitive read that as
  unreachable, opened the cell door and left. Inside a sealed pocket, scene-step to the NPC
  and send the op — no door-opening fallback belongs there.
- **Two regions can share a bounding box and still be sealed from each other.** The corridor
  down from the Taverley ladder runs x 2881-2887 through the same z band as the deep half,
  separated by two tiles of solid rock at x 2888. A box test for "west of the dusty-key gate"
  therefore calls the way in the way through, and the leg skips the gate it is standing
  outside of.
- **Every door on this quest teleports rather than opens.** The cell door, the deep-dungeon
  gate and the secret wall all run `~open_and_close_door2`, which `p_teleport`s the character
  to the far side and reverts the loc three ticks later. Where the character is standing is
  the only oracle; the loc's own state has already changed back.
- **`check_axis` compares one axis, so the same op works from both sides.** The secret wall
  by the two coffins is entered and left by the same Search, and which way it goes is decided
  by whether the character's z matches the wall's. One primitive, a boolean, and no second
  loc to find.
- **A refused climb is a mesbox the walker reads as a quest lock.** `oploc1,monasteryladder`
  turns away anyone outside the order, and the navigator blacklists a door that answers like
  that for the rest of the session — which would strand the third scorpion for good. Ask
  Abbot Langley first, every pass; the redundant conversation costs two seconds and the
  blacklist costs the quest.
- **A modal the client has closed is one the server still has open.** The barcrawl card's
  first Read after a read of its own opened nothing: the client clears the main modal on
  the close it sends, the server clears it a tick or more later, and an `opheld` that
  arrives in between is dropped with no refusal. `drinkAt` had always survived it by
  reading three times; every other caller read once, called the card unreadable and failed
  a quest step — once per bar, ten bars. A send that can be dropped needs its own retry,
  not a caller who happens to have one.
- **A conversation that shuts its own chat box is not a conversation that ended.** The seer
  runs `if_close`, then three `mes` lines a `p_delay(3)` apart, and only then reopens with
  the hint that moves the varp. The shared driver gives a shut dialogue 1.5 seconds before
  calling it over, so it reported success with nothing granted and the leg re-walked to
  Seers' Village on every retry. A stop whose script has gaps longer than that needs its own
  driver and its own oracle — here, the seer's closing line.
- **Tile distance counts through walls.** Skipping the approach walk because the scorpion was
  "already adjacent" queued a use-on against a walk the server could not make, and the leg
  sat silent until its timeout ran out. Walk to it anyway: the walker opens the door the raw
  distance cannot see.
- **`huntmode=cowardly` is not shy.** Its `check_nottoostrong=outside_wilderness` is the
  double-combat-level rule, so the level 111 blue dragons between the gate and the coffins
  attack anything under 222. Their fire is a 30 max hit, 50 through a failed defence roll
  and 10 under Protect from Magic, which is the difference between walking that corridor at
  70 Prayer and dying in it.
- **The prayer comes down at the wall, not at the gate.** Nothing behind the coffin wall
  breathes, and the catch inside runs for as long as the scorpion takes to be cornered. A
  guard raised at the gate and dropped at the gate spends that stretch draining points
  for a room with nothing in it to protect against, so the toggle belongs on the wall
  crossing, which already knows which side of it the run is standing on.
- **`%poison` is not on the wire.** It is `scope=perm` with no transmit, so "am I poisoned"
  has no varp answer. The `"You have been poisoned!"` line `poison_player` opens with is the
  only reading there is, and it fires once on the transition out of zero — a mark taken
  before the leg and a `sawSince` after it is the oracle.
- **A cure drunk in reach of the thing that poisons is a cure taken back.** Antipoison sets
  `%poison = min(%poison,-5)`, and the poison timer counts a negative back up one per fire at
  30 ticks a fire — 90 seconds of immunity, not a permanent one. The eight poison spiders in
  the coffin corridor have `wanderrange=10`, which covers both sides of the wall crossing and
  most of the walk back east, so the dose only sticks once the dusty-key gate is shut.
- **One shop on the map sells the cure.** `3doseantipoison` is stocked by `generalshop7` in
  Musa Point and nowhere else, which puts a ferry each way between a Taverley leg and its
  antipoison. That is too expensive to make a provisioning requirement: a quest that parks
  when the bank has no potion is worse than one that walks the corridor uncured, so the trip
  is best-effort and the leg carries on without it.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Add a quest](../how-to/add-a-quest.md)
