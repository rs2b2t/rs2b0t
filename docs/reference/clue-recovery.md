[Manual](../README.md) › [Clues](../CLUES.md) › Recovery

# Clue recovery and routing

## Recovery before abandonment

After four attempts without progress, the solver closes blocking interfaces and
requests a fresh route, then returns to the nearest bank. It rebuilds the clue
pack, keeping the scroll, casket, puzzle box and any earned riddle key. JiveDragons
withdraws 12 Sharks again. The original equipment record and credit for an
already-killed guardian survive this reset.

Each clue leg gets one bank reset. Event interruptions and restocks do not renew
that allowance. If the fresh attempt also stalls, the clue is abandoned. A failed
bank walk or incomplete deposit keeps recovery pending. Confirmed unmet quest
requirements still report their blocker directly. Death stops recovery, and a
live fight must be escaped before gear restoration or host handoff. A confirmed
supply shortage restores the host outfit and waits for supplies to change
without renewing the reset allowance.

During clue upkeep, the solver drops rotten food one slot per pass, after eating
if needed. Rejected drops are retried on later passes.

## Guardians behind fences

Guardians explicitly targeting the player can be tracked within 32 tiles;
unclaimed candidates remain limited to 12 tiles. A displaced guardian gets a
short walking approach to a reachable melee tile with teleports disabled.
Adjacent fences are checked against collision data. The approach is followed by fresh identity,
health and ownership checks. An unreachable approach requests bank recovery.

The approach chooses a cardinal neighbour that is reachable and has an open
collision edge to the mage. It walks to that exact tile instead of treating
one tile of geometric distance across a fence as melee range. Food upkeep
continues during the walk. Failed approaches use the same bank-reset allowance;
a second failure cannot release the host while the guardian is still attacking.

## Isafdar teleport policy

Lord Iorwerth and other Isafdar clues preserve the caller's teleport policy on
the mainland approach to Arandar and after leaving for a mainland bank.
Obstacle crossings inside Isafdar stay on foot. A disabled teleport setting is
respected, and the navigation catalog still checks rune and quest requirements.

## Validation

Regression tests cover the desert-to-Iorwerth approach, outgoing bank travel,
teleports disabled, full-pack rebuilding, preserved keys and equipment records,
12-Shark preparation, interrupted deposits, event yields, repeated failures,
post-kill dig recovery, offset guardians, blocked fence edges and safe retreat.
These changes have automated coverage; the earlier live Entrana and Kharazi
runs did not exercise these new recovery paths.
