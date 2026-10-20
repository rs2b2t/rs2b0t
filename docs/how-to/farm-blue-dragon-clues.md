[Manual](../README.md) › [Clues](../CLUES.md) › Blue dragon farming

# Farm blue dragon clues with melee

In JiveDragons, choose **taverley-blue**, **heroes-blue** or **gutanoth-blue**
under **Dragon site**, set **Combat style** to
**melee**, and enable **Drink super sets** and **Solve clue drops**. Choose a
one-handed weapon and keep a Dragonfire shield available. Melee
follows targets into reach; Nearby mode returns to the configured anchor
between fights. It finishes an attacking dragon before selecting another.
An attacking baby dragon is handled defensively and does not count toward
the farming kill total; passive babies are left alone. Heroes' Guild melee
uses navigation to open the pen gate before attacking.

**Gu'Tanoth targets** selects **dragons**, **demons** or **both**. Both prefers
dragons and kills greater demons between spawns. Stand 1 can see both for
mage and range. Melee also defends against an attacking dragon, demon or
ogre chieftain when it blocks combat with the selected target. Ogre shamans
are never attacked. The guild requires Heroes' Quest; the Enclave requires
Watch Tower.

See [switching stands and alternating spawns](change-dragon-stands.md) for
live controls and melee target selection.

Each bank trip carries one Super attack(3), Super strength(3), and
Super defence(3). The loadout carry list can override each potion's dose form
and quantity. The script drinks another dose when that skill's boost decays
to within 10% of its base level. Keep food and escape runes stocked as well.
Banking deposits leftover one- and two-dose supers and replaces them with
three-dose flasks. An unused three-dose flask stays in the inventory.
Custom loadouts restock their selected dose form and quantity.

With melee selected, hard clues require 60 Attack, Lost City complete, and a
Dragon longsword, Dragon dagger or Dragon dagger(p). The solver keeps an eligible
equipped weapon, including the farming longsword. With range selected, it uses
the configured bow, arrows and ranged attack style instead. It tops up arrows
to the configured withdrawal quantity when stock permits, and does not require
the melee unlocks or withdraw a dragon dagger. Guardians are fought from a
reachable firing position within seven tiles; running out of arrows requests a restock.
Both styles require Superantipoison and 12 Sharks. Initial clue banking and
restocks both target 12 Sharks. The solver reserves
a slot for a puzzle box without reducing the initial 12 Sharks and retrieves
the current clue's box if it was banked.
Food used during travel does not invalidate that initial bank preparation.
A guardian fight requires more than three Sharks and withdraws when three
remain, keeping them available for the escape.

Before solving a clue, the script leaves the dragon lair when needed and
chooses the nearest reachable bank from its current position. Starting with
a clue near another bank does not send it back to the dragon farming bank. While the
solver owns the equipment, dragon banking cannot interrupt it because the
inventory contains Sharks instead of the configured farming food. After the
trail, the script deposits every inventory item and withdraws the configured
dragon supplies. This banks rewards, clue tools and surplus teleport runes,
keeping only the route's expected runes, such as Earth and Law for Watchtower.
A failed bank attempt keeps that restock pending. Before leaving the reward
tile, the solver drops edible food as needed to collect spilled rewards. A
failed pickup keeps the clue task active. Noted food counts as loot, so it is
banked and cannot prevent a food restock or be selected for eating.
The return to the bank uses the trail's teleport policy. Guardian fights
reissue attacks periodically because eating cancels the outgoing attack
even while the wizard keeps hitting the player. Potion preparation confirms
consumption before digging and yields if an event interrupts it.

## Live check

With the local engine running, run:

```sh
bun e2e/jivedragons-melee-clue-live.ts
bun e2e/jivedragons-melee-clue-live.ts --guardian
bun e2e/jivedragons-melee-clue-live.ts --site heroes-blue
bun e2e/jivedragons-melee-clue-live.ts --site gutanoth-blue --targets demons
bun e2e/jivedragons-melee-clue-live.ts --site gutanoth-blue --targets dragons --guardian
bun e2e/jivedragons-potion-restock-live.ts
bun e2e/jivedragons-longsword-clue-live.ts
bun e2e/jivedragons-longsword-clue-live.ts --guardian
```

Each case creates a fresh account with 75 Attack, Strength and Defence,
90 Hitpoints, 70 Prayer, 80 Magic and 40 Agility. It starts with a stocked
inventory at the dragon camp. After a melee kill and all three super potions,
it seeds a final hard-clue step, then requires a completed trail, another
dragon bank trip and a further kill without dying. The guardian case uses
the Saradomin Wizard clue at Feldip. Travel after the initial placement runs
through the script's navigation.

The potion restock check starts at the bank with Super attack(1), Super
strength(2), and Super defence(3). It verifies the partial flasks are banked,
the inventory holds one three-dose flask of each, and the unused defence
flask does not cause an extra withdrawal. It starts with 20 noted Lobsters
and no edible food, then checks the notes are banked and five edible Lobsters
are withdrawn.

The longsword checks start with a full inventory and no dagger available.
They require puzzle-box or Saradomin Wizard completion with the longsword,
collection of spilled rewards, and a full inventory reset at the bank.

## Recorded results

See [recorded blue dragon clue checks](../e2e/blue-dragon-clue-results.md) for the farming, guardian, potion, puzzle and Entrana results.
