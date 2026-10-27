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
the mainland approach to Arandar. When the next clue or bank is outside Isafdar,
the solver checks for an immediate teleport before walking to an exit crossing.
This also applies after handing Iorwerth his solved puzzle box. The navigation
catalog checks rune, level and quest requirements against the current inventory.
The solver verifies the teleport landing before continuing from the new position.
An unavailable or failed teleport falls back to the crossings. Travel between
Isafdar pockets stays on foot, and a disabled teleport setting is respected.

When a trail moves from Kharazi to Isafdar, it cuts out of the jungle before
planning the Arandar approach. In the reverse direction, it leaves Isafdar,
reaches the Kharazi entrance and cuts into the jungle before walking to the dig.
A failed cut stops the journey instead of trying to walk through the boundary.
This includes clue 3562, `01 degrees 24 minutes North, 08 degrees 05 minutes West`.

## Hans patrol

Hans clues wait at the Lumbridge teleport tile `(3221,3218,0)` for up to 200
game ticks per pass, including time spent trying to open dialogue. A nearby,
reachable Hans can be approached without run energy. After waiting, a chase
requires at least 50% energy and confirmed running, and stops below 20% energy
or after 40 ticks. Failed approaches return to the waiting tile. Waiting alone
does not spend the clue's reset allowance. This applies to easy clue 2681 and
hard clue 2792.

## Validation

Regression tests cover the desert-to-Iorwerth approach, outgoing bank travel,
the Iorwerth puzzle hand-in followed by a mainland clue, failed teleport landings,
missing spell requirements and teleport allowlists, denylists and distance limits,
teleports disabled, full-pack rebuilding, preserved keys and equipment records,
12-Shark preparation, interrupted deposits, event yields, repeated failures,
post-kill dig recovery, offset guardians, blocked fence edges and safe retreat.
A simulated continuous trail covers Kharazi clue 3536 followed by Isafdar clue
3562; boundary tests cover both directions and failed cuts.
These changes have automated coverage; the earlier live Entrana and Kharazi
runs did not exercise these new recovery paths.
