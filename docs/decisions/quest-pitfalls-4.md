[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Fight Arena

Fight Arena added six, and the first two generalise past this quest.

- **A stage read taken while something is swinging comes back empty.** The end-to-end run
  spent twenty-four seconds and five attempts on `stage unavailable` at stage 12, standing
  in the arena being hit by General Khazard, and only moved when he happened to die to
  auto-retaliate. Reading the journal is opening a main modal, and the arena is the one
  place that punishes standing still. The fix is a cached last reading: the stage only
  ever moves forward, so an old one is a sound floor to act on where `wait` is not.
- **A stage the quest can skip is not a stage to wait for.** Killing the ogre with Justin
  and General Khazard both in range chains `justin_servil_saved` straight through
  `general_khazard_welldone` and `general_khazard_belong_nobody`, so stage 8 sets and
  clears inside one dialogue and is never observed. Every stage-8 branch has to be
  reachable from stage 9 as well.
- **Half a disguise is worse than none.** `fightarena_door1` lets a player through wearing
  *either* Khazard piece, but the drunk guard's `~wearing_khazard_armour` wants both — so
  an account holding one piece walks in and then loops at him forever. The chest re-issues
  whichever piece is missing at any stage above 0, which is also how this quest recovers
  from a death.
- **Each beast is caged until a script lets it out, and only the entry cutscenes do that.**
  `arena_enter` releases the scorpion at stage 9 and the ogre at stage 6; nothing releases
  Bouncer except the scorpion's death dialogue or a Servil asked in person. A bot that
  walked back in after a death swung at an empty arena for every tick of its budget, then
  repeated. Ask `jeremy_servil_arena` for the ogre and Justin for the other two.
- **`driveDialog` returns at the `if_close` that *starts* a cutscene.** Hengrad's line ends
  in forty ticks of forced movement, and the decide that followed opened the quest log on
  top of it. A talk whose dialogue ends in a ride has to wait for the landing, and the
  honest test for that is the pocket the player ends up in.
- **Protect from Melee is what the arena rests on, not the weapon.** All three beasts —
  including Bouncer at level 137 with 120 attack and 120 strength — died to an **unarmed**
  max-stats account without landing a single hit. Hitpoints never left 99 in any run. The
  kit only sets how long the fight takes.

Two more that are the engine rather than the quest:

- **Provisioning runs before the first `decide()`, and a sealed pocket has no booth.** A
  `--stage` leg that starts in the arena or a cell spends three minutes watching
  `no path to (2612,3092,0): unreachable` before the quest gets a turn. A run started outside was
  provisioned before it ever went in, and a death puts the account in Lumbridge where
  banking works, so this is a harness artefact — but it is three minutes of every
  mid-quest leg.
- **The engine serves one bundle to every session on the machine.** `bot.html` hardcodes
  `./bot/botclient.js`, and `navworker.js`, `ondemandworker.js` and `collision.lcnav.gz`
  are all fetched relative to that URL, so every harness deploying into `public/bot/`
  overwrites the others and the last writer decides what everyone runs. A neighbour that
  deployed between this harness's copy and its page load ran its own branch under this
  harness's name from one end of a leg to the other, and the symptom was a quest queue
  full of quests this branch does not implement. Nothing about the game server is involved: it speaks the same
  protocol to any client. `deployIsolatedClient` in
  [`e2e/lib/harness.ts`](../../e2e/lib/harness.ts) gives each run `public/bot/<tag>/` and
  a `bot-<tag>.html` that points at it, which removes the race instead of detecting it.
  The page is still served by the engine, so the origin, the websocket and the on-demand
  stream are unchanged.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Per-quest](quest-pitfalls-2.md)
- [Fight Arena's harness recipe](../reference/quest-harness-recipes-2.md)
