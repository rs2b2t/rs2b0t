[Manual](../README.md) › [Dev and deploy](../DEV.md) › GatheringBot smoke

# GatheringBot behaviour smoke

After camps look right, run the live script harness (needs a **fresh deploy** so
`out/botclient.js` matches `GatheringBot` / location tables):

```bash
bun run verify:gatheringbot                 # all scenarios
bun run verify:gatheringbot -- mining       # mine-bank + mine-power + buy-pick + …
bun run verify:gatheringbot -- fish-cook-bank
bun run verify:gatheringbot -- fish-bank-raw-cook
BUDGET_S=180 bun run verify:gatheringbot -- mine-bank
HEADED=1 bun e2e/gatheringbot-test.ts acquire
HEADED=1 BUDGET_S=180 bun e2e/gatheringbot-test.ts   # headed full suite
# Two-account mule handoff (Gatherer + Mule at SE Varrock iron):
HEADED=1 BUDGET_S=180 bun e2e/gatheringbot-mule-pair-test.ts
# Two-account Fisher: Gatherer raw → Cooker cook+bank at Catherby:
HEADED=1 BUDGET_S=240 bun e2e/gatheringbot-cooker-pair-test.ts
# Path to every curated cook surface (pier + distinct bank ranges):
HEADED=1 BUDGET_S=120 bun e2e/gatheringbot-range-path-test.ts
CAMPS=Seers,Catherby bun e2e/gatheringbot-range-path-test.ts
```

Scenarios (filter by id or tag: `mining` / `fishing` / `wc` / `acquire` / `path` /
`endgame`):

| id | what it proves |
| --- | --- |
| `mine-bank` / `mine-power` | SW Varrock tin bank loop vs drop mode |
| `mine-bank-rimmington` | Rimmington iron → Falador East (long soft-home / second mine camp) |
| `mine-iron-se-varrock` / `mine-iron-dwarven-north` | Iron local-prefer: stay on near cluster (`maxDistToCamp`) |
| `mine-mule-gatherer-meet` | Single-account gatherer mule: full pack → meet + wait (no bank) |
| `fish-mule-gatherer-meet` | Fisher gatherer mule smoke at Draynor (raw haul, no bank) |
| *(pair harness)* | `gatheringbot-mule-pair-test.ts` — two accounts, full Gatherer↔Mule iron handoff |
| `fish-bank` / `fish-bank-barb` | Draynor net bank; Barbarian fly → Edgeville (wide membership + bank) |
| `fish-cook-bank` / `fish-cook-barb` / `fish-cook-seers` | Catherby Range; Barb outdoor Fire; Seers fly Range (pathable camp tele) |
| *(cooker pair)* | `gatheringbot-cooker-pair-test.ts` — Gatherer raw → Cooker cook+bank at Catherby |
| *(range path)* | `gatheringbot-range-path-test.ts` — walk to every curated pier/bank cook surface |
| `fish-cooker-solo` | Cooker mule with full raw pack → cook → bank (no partner trade needed once seeded) |
| `fish-bank-raw-cook` | Catherby bank-raw-then-cook (`givebank raw_lobster` 973 + pot+26 raw, N=1000) |
| `wc-bank` / `wc-bank-seers` / `wc-burn` | Draynor chop+bank; Seers trees bank; chop-then-burn |
| `mine-path-runite` / `fish-path-shark` | long path into Lava Maze (must mine runite — XP/ore, not flee-only) / Fishing Guild |
| `buy-pick` / `buy-axe` / `buy-net` | Buy/repair with **coins only** (no pre-granted tools) |
| `repair-axe-bob` | Seed broken steel axe → Bob item-on-NPC repair (`macro_broken_steel_hatchet`) |
| `repair-pick-nurmof` | Seed broken steel pick → Nurmof repair (`macro_broken_steel_pickaxe`) |
| `restock-fly-barb` | Gerrant multi-buy fly rod + feathers from Draynor bank |
| `auto-freeform-wc-willows-cg` | Auto outside every WC camp chunk → start-tile freeform |
| `auto-freeform-mine-skel` | Auto freeform at wilderness skeleton mine |
| `auto-freeform-fish-ardy-river` | Auto freeform at Ardougne river fly |
| `smith-rune-axe` | Buy/repair smith path (bars + hammer → rune axe) |

Tags: `mining` / `fishing` / `wc` / `mule` / `local` / `acquire` / `path` / `endgame` / `freeform`.

**Location and leash — these assert product behaviour as well as the harness:**

- **Named camps** pin the **home** tile to the camp spot and floor **membership**
  (ReturnToAnchor / rock disk) to **64** (overridable per camp via `campRadius`).
  The UI `leashRadius` is ignored below that floor for membership. **Fishing spots**
  are any matching spot inside membership (nearest to player); freeform fish uses a
  hunt pad past the UI leash. Soft-home / prefer-local helpers live under `api/`
  (`GatherCamp`, `TargetPick`, `Anchor`).
- **Mine prefer-local:** matching rocks within 12 of the player win over far camp
  membership hits; post-deplete tiles are not soft-cooled (iron respawn ~6t).
- **Mule mode** (Miner/Fisher/Woodcutter): `muleMode` Off / Gatherer / Mule /
  **Cooker** / **Supplier** + `mulePartner`. Shared policy: `api/trade/PartnerTrade`;
  the mode is disabled under location None.
  - **Gatherer** — full haul → meet trade (no bank).
  - **Mule** — accept → bank (demo for ore/logs; see processor sketch below).
  - **Cooker** (Fisher) — accept raw → cook at camp range → bank cooked (`burntPolicy`).
  - **Supplier** (Fisher) — when bank has N raw (`bankRawBeforeCook`), withdraw → meet → trade.
  - Harness: `mine-mule-gatherer-meet`, `fish-mule-gatherer-meet`, `fish-cooker-solo`;
    pair iron e2e `gatheringbot-mule-pair-test.ts`; pair cook e2e
    `gatheringbot-cooker-pair-test.ts` (Gatherer raw → Cooker cook+bank).
- **Cook surfaces:** `api/catalogs/CookingRanges` catalogs map Ranges; fishing camps pin
  Catherby / Seers fly / Barb Fire / Guild / Draynor fireplace when useful.
  Harness: `fish-cook-bank` (Catherby), `fish-cook-barb`, `fish-cook-seers`.

**Processor scripts (sketch — not shipped):** Ore/log **Mule** banking is only a
demo. A realistic partner is a separate TaskBot that:

1. Camps the same meet tile as the GatheringBot Gatherer (`location` camp spot).
2. Uses `Trade` + `PartnerTrade.decideReceiverOfferScreen` / `isConfiguredPartner`.
3. After accept: path to smelter / anvil / GE / own bank and process the haul.
4. Returns to meet for the next trade.

Fisher **Cooker** is the in-tree example of a “processor mule” for fish.
- **Location Auto** alone keeps the raw `leashRadius`. Auto snaps only when the start
  tile shares a preset’s **64×64 map square**; otherwise freeform (null location,
  start-tile leash, nearest bank, player-relative fish). Auto is expert / may-die:
  **no mob flee** (spiders, dark wizards) — random events still run.
- **None** is power/drop mode (also floors membership to 64 from the start tile).
- **Named/None mob flee** kites *away* from the attacker (east-biased), not back onto
  the camp anchor while multi-combat pests sit on it.
- **Post-bank home** uses the soft arrive disk (8 tiles), not full membership (#154
  Catherby bank ≈ 36 from pier).

Asserts XP / held products / acquired tools / bank proximity. Exit nonzero on any FAIL.

Seeds use engine `give <obj> <qty>` (this Server tree has no `~item`/`~bankitem`).
`~clearinv` still works as a content debugproc. Redeploy the bot client yourself
when script code changes — the harness does not own engine `public/`.

Mainland setup always teles off Tutorial Island + `setvar tutorial 1000` then
**relogs** (side icons only unlock from the login payload). Engine-TS holds the old
session after unclean logout — harness probes from ~20s (`RELOG_COOLDOWN_MS` /
`RELOG_PROBE_MS` / `RELOG_RETRY_MS` override).

## See also

- [Gathering seed data](../reference/gathering-seeds.md)
