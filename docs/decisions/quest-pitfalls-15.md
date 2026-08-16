[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Biohazard

Ten, and the first three are about doors the graph should never have owned.

- **The route the guide describes and the route the map allows can disagree by a building.**
  Every baked path to the mourners' cauldron ran in one headquarters door and
  out the other, and both are locked until the stew in that cauldron is poisoned. The way
  in is `mournerstewfence` at (2541,3331), a `Climb-over` railing with no `Open` op — so
  `derive-doors` never saw it and `derive-stairs` never looks at fences. A quest whose
  first step is unreachable is a missing *transport*, not a missing door.
- **Refusing a door is a decision about a region, not about a loc.** With
  `mournerstewdoor` in `SCRIPT_REFUSED` the building and its first floor become a pocket
  with no baked edge at all, so every bank leg decided in there walks at a booth the
  navigator can prove no route to. The module answers that with one guard: inside the
  pocket, a `withdraw`, `deposit` or `scanBank` is replaced by the walk out.
- **A gate that stops you to talk is not a gate the walker can cross.** The Varrock east
  gate searches everyone within two tiles of `bioguard1` while `%biohazard` is between 10
  and 13, over two dialogue pages, and it does it in *both* directions. The walker's door
  crossing polls for passage and gives up on the first page. The quest drives that gate
  itself, on both legs.
- **A stand tile the pack says is reachable can still be unreachable, because NPCs block.**
  The headquarters corridor is where the mourners themselves stand, and one on the tile the
  walker is clicking makes the *client's* own path search fail — every repath, every pass,
  four tiles short, with the distillator already in the pack. A hand-rolled
  `walkResilient(tile, radius 0)` then `interact` has no answer for that; `Reach.locOp` does,
  and it operates a wall door from either side of its edge rather than from one named tile.
- **West Ardougne has no bank, and the navigator says so about every bank.** A `scanBank`
  decided over the wall answers "unreachable" for every booth in the game and burns the
  step budget. The read is deferred to the mainland, and the stages before the gown are
  written not to need it.
- **`forceapproach` rotates with the placement angle.** Jerico's cupboard and the nurse's
  are both `forceapproach=east` at angle 1, which is *south*. The tile east of Jerico's is
  the cupboard's own second half and unwalkable, so the obvious stand is the one tile the
  loc can never be used from.
- **Three unreadable bits decide who ruined which vial.** `%bioerrand` is `scope=perm`
  with no transmit, so which errand boy holds which vial is not state to branch on. The
  pack is the oracle: vials in hand outside the quarter go to the boys, vials missing
  inside it come back from the inn. What that cannot express — a boy who drank his — is
  recovered by walking out to Elena, who reissues on `inv_total(inv, …) = 0` and so does
  not care what the bank holds.
- **Two objects that share a display name are the rule in this quest, not the exception.**
  Both halves of the priest suit render `Priest gown`, the full and the empty cage both
  render `Pigeon cage`, and the mourner's key renders `Key`. `Equipment.equip` reports the
  legs already worn once the top is on, and `Shop.buy` buys the top twice; both needed an
  id-keyed twin (`wear`, `Shop.buyById`).
- **A hand-back gated per item on `inv_freespace > 1` needs four slots, not one.** Elena
  returns three vials and the sample one at a time after taking the distillator, and a
  pack with three free silently loses the last. The leg banks down to six first.
- **The bundle race has a quiet half.** `public/bot` is shared, and a concurrent deploy
  that lands during boot replaces `navworker.js` as well as `botclient.js` — the client
  still prints this quest's queue while routing on somebody else's graph, so the assertion
  that catches a stolen `botclient.js` passes and the new transport reads as broken. Three
  runs died on that here. `deployIsolatedClient` removes the race rather than detecting it,
  and every live harness that adds a nav edge should use it.

## See also

- [The map](quest-pitfalls.md)
- [Shield of Arrav](quest-pitfalls-7.md)
