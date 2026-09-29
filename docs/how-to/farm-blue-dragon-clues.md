[Manual](../README.md) › [Clues](../CLUES.md) › Blue dragon farming

# Farm blue dragon clues with melee

In JiveDragons, choose **taverley-blue**, **heroes-blue** or **gutanoth-blue**
under **Dragon site**, set **Combat style** to
**melee**, and enable **Drink super sets** and **Solve clue drops**. Choose a
one-handed weapon and keep a Dragonfire shield available. Melee
follows targets into reach; it returns to the configured anchor
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

Each bank trip carries one Super attack(3), Super strength(3), and
Super defence(3). The loadout carry list can override each potion's dose form
and quantity. The script drinks another dose when that skill's boost decays
to within 10% of its base level. Keep food and escape runes stocked as well.

Hard clues require 60 Attack, Lost City complete, a Dragon dagger or
Dragon dagger(p), Superantipoison, and at least 15 Sharks. These are separate
from the food and weapon used for dragon farming. The solver checks this kit
before starting the trail.
Food used during travel does not invalidate that initial bank preparation.
A guardian fight requires more than three Sharks and withdraws when three
remain, keeping them available for the escape.

The script leaves the dungeon and banks before solving a clue. While the
solver owns the equipment, dragon banking cannot interrupt it because the
inventory contains Sharks instead of the configured farming food. After the
trail, the script banks again to restore dragon supplies before returning.
A failed bank attempt keeps that restock pending.
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
```

Each case creates a fresh account with 75 Attack, Strength and Defence,
90 Hitpoints, 70 Prayer, 80 Magic and 40 Agility. It starts with a stocked
inventory at the dragon camp. After a melee kill and all three super potions,
it seeds a final hard-clue step, then requires a completed trail, another
dragon bank trip and a further kill without dying. The guardian case uses
the Saradomin Wizard clue at Feldip. Travel after the initial placement runs
through the script's navigation.

## Recorded results

Local engine runs at normal 600 ms ticks on 2026-09-29. Each passed the
complete farming, clue, restock and resumed-kill assertions without deaths.

| Site and target | Clue | Result |
|---|---|---|
| Taverley blue dragons | Final hard map step | [Passed](../e2e/jivedragons-taverley-blue-both-map-live.png) |
| Heroes' Guild blue dragon | Final hard map step | [Passed](../e2e/jivedragons-heroes-blue-both-map-live.png) |
| Gu'Tanoth greater demons | Final hard map step | [Passed](../e2e/jivedragons-gutanoth-blue-demons-map-live.png) |
| Gu'Tanoth blue dragons | Final hard coordinate step with Saradomin Wizard | [Passed](../e2e/jivedragons-gutanoth-blue-dragons-guardian-live.png) |
