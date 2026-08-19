[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Temple of Ikov

Thirty-one in all; the seven here are engine behaviour rather than quest facts.

- **A weight check is a loadout constraint the pathfinder cannot see.** The lava bridge
  runs `if (weight >= 0) @ikov_bridgefail`, so the crossing is a property of what the
  pack is carrying rather than of where it is standing. Boots of lightness are -10lb
  worn, a yew shortbow is 3lb, an iron axe is 5lb and a lobster is 350g. The first live
  crossing went into the lava carrying the axe and the bow it had fletched a minute earlier, which
  is why the module banks everything outside the crossing kit *before* it goes
  underground — there is no booth past the ladder.
- **Only non-stackables weigh anything, and the client is told a truncated kilogram.**
  `calculateRunWeight` skips `type.stackable`, so coins and ice arrows are free, and
  `UpdateRunWeight` sends `trunc(grams / 1000)` — a client reading 0 is anywhere from
  -999g to +999g. The server tests grams, so the guard demands a client-visible
  *negative* rather than a non-positive.
- **A use-on sent while a booth is still closing opens nothing.** The first knife-on-logs
  after a withdraw failed on three separate runs and the retry worked every time, so the
  fletch closes whatever main modal is up and settles before it sends the op.
- **A shop behind a quest gate is not a shop.** The Ardougne Armoury stocks the iron
  axe the yew needs and sits inside the Combat Training Camp, whose gates answer "This
  is a restricted area" until Biohazard is complete. They are baked as ordinary door
  edges, so the pathfinder routes at them and the walker spends its three strikes
  proving otherwise. Aemad's Adventuring Supplies, in East Ardougne, stocks the same axe.
- **A crossing with no op is still a crossing.** The bridge is a `mapzoneenter` timer
  plus `inzone`, so there is nothing to click: walking onto (2648–2650, 9828–9829)
  *is* the action, and the direction comes from a bit that toggles on every crossing
  rather than from which bank you started on. Two consequences — the far side is the
  only oracle, and every other walk in the dungeon has to exclude those six tiles or
  the pathfinder ferries the bot across in the middle of an unrelated leg.
- **A `~slash_checker` reads the equipped weapon and nothing else.** The web sealing the
  boots alcove answers `Slash` with "Only a sharp blade can cut through this sticky
  web" to a character holding a knife in the pack — the `oplocu` branch is the one that
  names the knife explicitly, so cutting it is a use-on, not an op. It also succeeds one
  attempt in two, so the leg retries rather than reading one failure as a wall.
- **Two stages can render one journal page, and the fix is idempotence rather than a
  finer oracle.** `%ikov` 20 (trap disarmed) and 30 (lever pulled) print the same lines,
  and nothing else the client can see separates them. Both ops live on the same lever
  and neither does harm when repeated, so the module searches and pulls on every pass
  through that stage instead of trying to tell them apart.

The other twenty-four are the quest's own shape: the route on the [second page](quest-pitfalls-25.md), the fights and the farm on the [third](quest-pitfalls-26.md).

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Temple of Ikov: the route](quest-pitfalls-25.md)
- [Temple of Ikov: the fights](quest-pitfalls-26.md)
- [Shield of Arrav](quest-pitfalls-7.md)
- [Temple of Ikov's harness recipe](../reference/quest-harness-recipes-9.md)
- [Add a quest](../how-to/add-a-quest.md)
