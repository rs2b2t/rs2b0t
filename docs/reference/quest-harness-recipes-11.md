[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (G)

Per-quest seed and stage commands, with what each recipe has proven.

## Gertrude's Cat — stage-scoped harness

[`e2e/gertrudes-cat-245-live.ts`](../../e2e/gertrudes-cat-245-live.ts). Members
content, so `:8890` only — the broken fence refuses from the south on a free
world.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar fluffs N`, then relog so the quest list recolours |
| `--until N` | 6 | stop at this stage; 6 waits for the journal to go green |
| `--tick N` | 300 | server tick in ms; 200 is the measured baseline |
| `--minutes N` | 60 | wall-clock budget |
| `--stats N` | 99 | every skill, set before the bank seed |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-deploy` | off | skip the build and copy |

It deploys **its own copy of the client** through `deployIsolatedClient`:
everything in `out/` lands in `public/bot/<user>/`, and a generated
`bot-<user>.html` points at it, so a concurrent session's deploy cannot decide
what this run executes. The copy is swept on exit. `out/collision.lcnav.gz` is
baked first when it is missing, since `build:bot` does not produce it and a
client without it walks on the 52-tile scene stepper.

`--stage 4` and `--stage 5` also write `%fluffs_crate`, the packed coord that
says which crate holds the kitten. The server picks it when Fluffs eats the
sardine, so a bare `setvar fluffs 4` describes a state the quest cannot reach
and every crate reads empty. The harness seeds the **last** crate the module
searches, so a jumped stage still proves all six.

The bank seed is 2M coins and 40 lobsters. The bucket, the cow, the doogle
leaves and Gerrant's sardine all have a source in the world, and seeding one
hides whether the bot can find it.

What the legs proved, at `--tick 200` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 1 → 2 | PASS, 1 min | the market, the wait for the brothers to pair up, `coins 1000→900` |
| 2 → 3 | PASS, 5 min | the doogle spawns, Gerrant's sardine, the Lumbridge bucket and cow, the fence, the ladder, the milk |
| 3 → 4 | PASS, 4 min | the sardine chain on its own, and the doogle sardine |
| 4 → 5 | PASS, 2 min | the corner crate, the kitten, the hand-over |
| 4 → 6 | PASS, 4 min | the same, plus the walk out of the yard and a Maze random event on the way |
| 5 → 6 | PASS, 1 min | the reward talk, the pet kitten, the chocolate cake and stew, 1 quest point |
| 0 → 6 | PASS, 7 min | the uncheated run: 16 steps, no parks, nothing seeded but coins and food |

## The Grand Tree — stage-scoped harness

[`e2e/grand-tree-247-live.ts`](../../e2e/grand-tree-247-live.ts). Members content, so
`:8890` only.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar grandtree N`, then relog so the quest list recolours |
| `--until N` | 160 | stop at this stage; 160 waits for the journal to go green |
| `--tick N` | 300 | server tick in ms; 300 is double speed |
| `--minutes N` | 90 | wall-clock budget |
| `--stats N` | 70 | every skill, not max — the demon is what the floor exists for |
| `--root N` | 15 | which of the fifteen roots holds the rock, for `--stage 150` |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-tele` | off | start where the account already stands |
| `--no-deploy` | off | skip the build and copy |

`--stage` accepts only the sixteen values `%grandtree` takes (0, 10, … 150); anything else
is a state the content never writes. Stage starts are chosen by continent: 0 to 70 at the
Ardougne East bank, 80 at the Grand Tree bank, 90 at the glider crash site in the Karamja
jungle, 100 and up at the Grand Tree bank.

The bank seed is coins, lobsters and a rune melee kit — `rune_chainbody` rather than
`rune_platebody`, which wants Dragon Slayer. Every quest item is left in the world: the bark
sample and the translation book come from the King, the scroll from Hazelmere, the journal
from Glough's cupboard, the lumber order from the foreman, the key from Anita, the twigs
from the King again and the rock out of the roots.

Stats are **70 across the board rather than max**, because the quest ends on a level-172
Black Demon with 157 hitpoints and 152 defence, and the question this harness answers is
whether a 70 account holds Protect from Melee through it.

What the legs proved, at `--tick 300` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 0 → 20 | PASS, 4 min | the walk in from Ardougne, the Femi gate crossing, the King's trapdoor cutscene, Hazelmere's island ladder |
| 20 → 70 | PASS, 4 min | the five-page translation, Glough, the King, Charlie through the cage, the cupboard's south-only stand |
| 80 → 90 | PASS, 3 min | the glider off the top of the tree, the Ka-Lu-Min gate, the foreman's three questions |
| 90 → 110 | PASS, 7 min | the six-hundred-tile walk home, Femi's cart, Anita's unbaked staircase, the chest — through a death in the jungle |
| 110 → 160 | PASS, 5 min | the twigs on their pillars, the Black Demon, the roots, the quest-complete scroll |
| 150 → 160, `--root 15` | PASS, 4 min | the worst-case sweep: all fifteen roots in order, the rock in the last |
| 0 → 160 | PASS, 16 min | the uncheated run: 31 steps, no parks, nothing seeded but coins, lobsters and a banked rune kit |

The demon fought at 70 across the board in a rune melee kit under Protect from Melee:
**63 seconds, one Attack click held from start to finish, hitpoints never left 70/70, prayer
70 → 22**. Nothing about the kit is load-bearing except how long it takes.

`%daconia_rock_root` is rolled by the King's stage-140 dialogue, so a jump straight to 150
leaves it 0 — a value no root in `daconia_coords` answers, which the sweep would walk
forever. `--root N` writes it, and 15 is the default because it is the longest walk.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Her)](quest-harness-recipes-19.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
- [Gertrude's Cat pitfalls](../decisions/quest-pitfalls-19.md)
- [The Grand Tree pitfalls](../decisions/quest-pitfalls-20.md)
