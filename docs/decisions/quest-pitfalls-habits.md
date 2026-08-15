[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: tooling and verification habits

Two habits fall out of the tool lesson, and both cost hours here:

- **Seed a stage test with only what that stage produces, never with its tools.** Every
  Watch Tower stage-10 test handed the bot a pickaxe, so all of them passed and the
  quest still could not mine. Only the uncheated run found it.
- **Guarding a requirement by location inverts it.** "Skip the pickaxe check inside the
  enclave, because one cannot be fetched from there" describes the state that
  must walk back out. Source before entering, and let the pocket-escape handle the rest.

Prince Ali Rescue added four more, and each is a class of bug rather than a one-off:

- **A quest-internal varp the client cannot read is not state you may branch on.**
  `prince_keystatus` decides whether Osman forges the key or refuses, and it is
  `scope=perm` with no `transmit`. The durable answer is a step that *acts and then reads
  the result*: talk to Osman, and treat a print still in the pack as proof the key was
  already forged, so the same step goes on to collect it from Leela. Counters and
  `noProgress` tie-breaks are not a substitute — they turn a crash window into a wedge
  that holds an unusable print forever.
- **Display names collide, and the collisions are the quest items.** `plainwig`
  and `blondwig` both render `Wig`, and only the blond one satisfies any check. `Beer`,
  `Pot of flour`, `Logs` and `Coins` each have a twin too. Wherever two objects share a
  name, `snap.invIds` is the only correct lookup — `snap.inv` silently accepts the wrong
  one and every downstream check passes for the wrong reason.
- **An NPC you delete can come back inside the window you needed.** Lady Keli respawns
  100 ticks after `npc_del`, five tiles from the cell door, and the door refuses the key
  while she is within ten. Anything whose respawn timer is shorter than the work it
  unblocks has to run as one step, and its stage has to be re-entrant with the
  consumable needed to redo it — hence two ropes.
- **A stage the quest can only reach one way is an oracle.** Leela promotes to stage 30
  only while the key is in the pack, so from 30 on the key provably existed: forging is
  impossible, a missing key is unambiguously a loss to be re-issued, and every clay leg
  can go quiet. Reading a stage for what it *proves* replaces the varp you cannot see.

Dragon Slayer added four, all of which came from reading the engine rather than a guide:

- **A locked door baked as an ordinary edge is worse than no edge at all.** Every one of
  Melzar's seven coloured doors advertises `op1=Open` and answers "This door is securely
  locked", so `derive-doors` baked all seven. The navigator then routed straight at them
  and the walker looped forever a tile short. They belong in `SCRIPT_REFUSED`, with the
  quest driving them by key — as do the Oracle's magic door, Elvarg's gates and Crandor's
  secret wall.
- **A key is not a door opener.** `open_and_close_door` `p_teleport`s the player through
  and deletes the key in the same script. "Open it, then walk through" never happens, so
  a leg is done when the key is *gone* and the player has *landed on the far side* —
  neither test alone is enough.
- **Derive the route from the collision pack, not from a guide.** Melzar's Maze is eleven
  unclimbable ladders, four floors and three decoy doors per colour. BFSing the baked
  exit masks with each colour as a gate produced the exact chain in seconds, and it is
  not the route any wiki describes.
- **Same-named monsters are the rule inside a quest area, not the exception.** Six
  ordinary `giantrat1` share the display name "Giant rat" with the one
  `dragonslayer_giantrat` that drops the red key, and every other floor is stocked the
  same way. Worse, they are aggressive: `Game.inCombat()` reads *our* health bar, so a
  decoy landing one hit parks a "wait until out of combat" guard indefinitely. Target by
  npc id, and wait only on being locked onto the right one.

Two habits about verification, both of which cost live runs here:

- **A live harness runs the built bundle, not your source.** The page loads
  `botclient.js`; until it is rebuilt and copied into the engine's `public/bot/`, every
  run silently exercises the old code. A `--stage 100` jump that kept buying redberries
  looked like a journal-parsing bug for three runs and was a stale bundle. Harnesses
  should build and deploy themselves rather than trust the operator.
- **Before believing a "this is broken server-side" note, check its date against the nav
  fixes.** `sheepshearer` avoided the Lumbridge spinning wheel for a fortnight on the
  strength of a probe taken six days before the multi-level loc-snapshot settle landed.
  A level-1 loc queried in the tick after a climb reads back empty, and blank is not
  absent — the wheel works.

Family Crest added four more, and the first two generalise past this quest:

- **A door whose lock is a lever is still a locked door.** The perfect-gold mine's four
  doors each advertise `op1=Open` and answer "This door is locked" unless their own
  combination of three levers is set — and the combination that opens one shuts another.
  They belong in `SCRIPT_REFUSED` alongside Melzar's, with the module driving the chain.
  BFS over the collision pack with `(tile, lever-bits)` as the node produced the exact
  thirteen-leg route; a flood with the doors removed then named the four rooms they cut
  the mine into, which is what makes the walk between legs a plain walk.
- **A lever's model is not its state.** `loc_change(loc, 500)` reverts the lever to its
  down model after five minutes and leaves the varp bit set, so a lever that *looks* down
  may well be up. Reading the loc is reading a lie; the "The lever is now up." line is
  emitted when the bit changes. Set levers by pulling until the message confirms
  the state you want, rather than reading and deciding.
- **An unread bank is not an empty bank.** `snap.bankIds` is empty until something opens
  a booth, so "is the pickaxe banked?" answers *no* on the first decide tick and the
  fallback shop wins. The bot walked from Ardougne to Nurmof in the Dwarven Mine for a
  pickaxe that was in the bank. Any bank-then-shop chain has to check `snap.bankKnown`
  and scan first — `fromBank` does; a bare `banked(...) > 0` test does not.
- **`Sustain` only runs where a step calls it.** The hook the host installs is pumped by
  `Sustain.run()`, not by the tick loop, so a custom step that fights for two minutes —
  the hellhounds by the gold rocks, or Chronozon — never eats unless it pumps the hook
  itself. Every long loop in a `custom` step needs one.
- **A stage past a hand-over is a claim the item exists; when it does not, look for the
  re-issue path before writing a `wait`.** Holding one fragment at stage 10 and none of
  the others parked forever on "waiting to combine". Both brothers have a "I have lost
  the piece you gave me." branch that hands theirs over again — gated on *neither* the
  pack nor the bank holding it, which is also why nothing in the module ever banks one.
- **A safespot is derivable, and "walkable" is not enough.** For a size-N melee NPC:
  BFS the placements it can slide between, take every tile those placements touch, and
  the walkable remainder is the safespot set — *intersected with the component you can
  reach*, because the passage that looks ideal on the map is often a sealed
  island, and `exitMask` does not cross door edges, so a flood seeded outside a gate
  never sees the room behind it. Whether a shut gate blocks the cast is not something
  the configs answer, so the module proves the spot at runtime — three casts that do
  not land, or the demon's body coming within two tiles, and it drops back to the fight
  it already knows works. **Not** "did my hitpoints drop": that cannot tell the demon
  from something else hitting you, and using it as the signal made the bot abandon a
  spot that was working.
- **Geometry is necessary, not sufficient — check what else patrols there.** Chronozon's
  search returns several tiles the demon provably cannot reach. The east alcove is one,
  and it sits three tiles from poison spiders with `wanderrange=10`, so the bot is safe
  from the demon and chewed on throughout the fight. The south end of the chamber is eleven
  away, past their limit. Read the neighbours' `wanderrange` and `maxrange` as well as the
  target's footprint.
- **Auto-retaliate is what breaks a safespot.** Anything that hits you — a spider,
  a stray skeleton — draws a swing back, and the swing walks the character off the
  tile the plan depends on. `Game.setAutoRetaliate(false)` for the duration,
  restored in a `finally` so a thrown step does not leave it off.
- **Preparation must stop at the door.** A `decide()` that tops up food or potions
  re-runs every tick, so eating three sharks mid-fight drops the pack under the
  threshold and the bot walks out of the dungeon to re-bank. Gate the
  provisioning block on being outside the fight area; once through, the fight owns
  what it is carrying.
- **Poison is invisible to the client.** `%poison` is `scope=perm` with no transmit, so
  it reads 0 whether or not you are dying of it. The oracle is the "You have been
  poisoned!" line, and antipoison sets `%poison = min(%poison, -5)` — a cure *and*
  about ninety seconds of immunity, so drinking on arrival is worth a dose.
- **Bank the coin float before the wilderness.** Nothing past the last shop needs coin,
  and a death there drops it. The top-up has to be conditional on something still being
  unbought, or it and the deposit take turns undoing each other.

- **The engine serves one bundle to every session.** `public/bot` is shared and `bot.html`
  hard-codes `./bot/botclient.js`, so a concurrent session's deploy landing inside the fifteen
  seconds a harness spends booting hands the run somebody else's branch — and the symptom is a
  quest queue full of quests you did not write. Assert your own build loaded, from something the
  bundle itself prints (the AIOQuester queue line naming the quest), and fail in the first minute
  rather than spending the budget.

## See also

- [Engine behaviour](quest-pitfalls-engine.md)
- [Per-quest](quest-pitfalls-2.md)
