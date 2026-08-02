# Gathering / Anchor API Refactor + Shared Mule Loop

> **Status:** in progress on `refactor/gather-anchor-api`.  
> Phase 1 (pure extract) landed in `c85966f`.  
> **Scope expansion:** every gathering script gets a mule/partner loop in the style of NatureCrafter + FlaxRunner, including GatheringBot’s Miner / Fisher / Woodcutter.

**Goal:**  
1. Shared leash / soft-home / nearest-target policy in `api/` (Phase 1).  
2. Shared **mule/partner trade loop** API extracted from Nature/Flax, then adopted by GatheringBot and remaining gather scripts.

## Why mule is related (and not free)

NatureCrafter and FlaxRunner each reimplement:

| Concern | NatureCrafter | FlaxRunner | GatheringBot today |
| --- | --- | --- | --- |
| Mode | Master / Runner | Runner / Spinner | none |
| Partner name(s) | comma-separated | single | — |
| Meet / trade range | altar / ruins | `MEET_TILE` + `TRADE_RANGE` | — |
| Trade protocol | request → offer → accept ×2 | same via `Trade` | — |
| Safety | decline non-partners; empty own offer | similar | — |
| Haul | essence in / runes hold | flax → string | ore / fish / logs |

`Trade` HUD API already exists (`api/hud/Trade.ts`). What’s missing is a **reusable task/policy layer** (partner filter, open-trade ownership, offer-all product, confirm, decline strangers) so GatheringBot doesn’t grow another 600 lines of copy-paste.

## Feasibility

| Approach | Effort | Risk |
| --- | --- | --- |
| Same **commit** as Phase 1 pure extract | High | Mixes behavior-preserving move with new product feature; hard review |
| Same **branch**, sequential commits/PRs | Medium | **Recommended** — API extract first, then mule API, then GatheringBot modes |
| Separate branch after Phase 1 PR | Medium | Fine if Phase 1 should land alone |

**Recommendation:** bake mule into this **refactor program**, not into the already-committed Phase 1 diff. Next commits on `refactor/gather-anchor-api` (or a stacked PR) own mule.

## Branch

- **Name:** `refactor/gather-anchor-api` (current)  
- **Base:** `main` after #282  
- Optional stack: `feat/gatheringbot-mule` on top if mule needs longer review

---

## Phase 1 — API surface ✅

- [x] Soft-home → `api/Anchor.ts`  
- [x] Camp disks → `api/GatherCamp.ts`  
- [x] Prefer-local / cooldown → `api/TargetPick.ts`  
- [x] `Query.withinOf` + `nearestPreferLocal`  
- [x] Cook / Smelt / Smith / Flax use `withinOf`  
- [x] GatheringBot re-exports + unit tests green  

---

## Phase 2 — Shared mule partner API (new)

Extract the common trade choreography; leave world-specific meet tiles in each script.

### Proposed API

```
api/mule/
  PartnerTrade.ts     # parse partners, isConfiguredPartner, nearestPartner
  MuleTradeTasks.ts   # Task factories: AcceptPartnerTrade, OfferProductTrade, DeclineStrangers
  types.ts            # MuleMode, PartnerConfig, OfferSpec
```

Rough surface (names flexible):

```ts
parsePartnerList(raw: string): string[]
isConfiguredPartner(name: string | null, partners: string[]): boolean
nearestPartner(partners: string[], within?: number): Player | null

// While Trade.active(), own the loop (movement cancels trade)
createAcceptIncomingTradeTask(opts: {
  partners: string[];
  /** What we expect them to offer (name match / predicate) */
  acceptOffer?: (their: TradeItem[]) => boolean;
  onComplete?: (their: TradeItem[]) => void;
}): Task

createOfferAllTradeTask(opts: {
  partner: string;
  itemName: string;       // 'Iron ore' | 'Raw lobster' | 'Flax' | …
  meetWithin?: number;
}): Task
```

### Checklist

- [ ] Design PartnerTrade against NatureCrafter + FlaxRunner (diff both trade paths)  
- [ ] Implement pure helpers + unit tests (no live client)  
- [ ] Implement task factories using `Trade`  
- [ ] Refactor **FlaxRunner** to call shared tasks (behavior-preserving)  
- [ ] Refactor **NatureCrafter** (or one side only) if cost is low; else leave as second adopter  

**Non-goal here:** change Nature altar routing or Flax field carve logic.

---

## Phase 3 — GatheringBot mule modes (Miner / Fisher / Woodcutter)

Add settings + tasks on top of existing gather loop.

### Product shape (proposed)

| Setting | Values | Notes |
| --- | --- | --- |
| `muleMode` | `Off` / `Gatherer` / `Mule` | Off = today’s bank/drop only |
| `partner` | string (comma-ok) | Gatherer: mule name(s). Mule: gatherer name(s) |
| `meetTile` | tile or `Auto` | Auto = camp spot / bank stand / soft disk near camp |
| `tradeProduct` | Auto | Auto = product keywords already known (ore/raw fish/logs) |

**Gatherer loop:** gather until pack full (or threshold) → walk meet → trade all product → resume gather.  
**Mule loop:** wait at meet → accept trade from partner → bank product → return to meet.

Bank path for mule reuses existing camp `bankStand` + booth fields. Meet must be trade-safe (walkable, not behind a door-only trap — FlaxRunner lesson: meet *outside* the wheel house).

### Checklist

- [ ] Settings schema on Miner / Fisher / Woodcutter (via GatheringBot)  
- [ ] Gatherer: full-pack → meet → offer product (skip BankCatch when mule on)  
- [ ] Mule: idle at meet → accept → bank → return  
- [ ] Decline trades from non-partners  
- [ ] Power/None + mule: document (drop vs trade — prefer disable mule under None)  
- [ ] Unit tests for mode decisions / product offer lists  
- [x] Single-account smoke: `mine-mule-gatherer-meet` (meet + no bank; harness resets mule settings)  
- [ ] **Separate multi-harness e2e** (not in default suite): two accounts (Gatherer + Mule) coordinating via PM or shared ready flag; prove full trade + bank. Do not block Phase 2/3 on this.

---

## Phase 4 — Other gather scripts (optional follow-ons)

- [ ] CoalTrucks, EssMiner, CookBot (cooked product mule), etc.  
- [ ] ThievingBot soft-home alignment (from original Phase 2)  
- [ ] Fighter leash helpers (low priority)  

---

## Explicit non-goals (near term)

- Tick manip shipping  
- Rewriting Nature jungle pathing  
- Multibox orchestration UI (script settings + player names only)  
- Path-distance rock pick (still Chebyshev prefer-local)  

## Success criteria

- One trade-partner implementation under `api/mule/` (or equivalent)  
- FlaxRunner (and ideally Nature) thinner after adopt  
- GatheringBot supports Off / Gatherer / Mule without tripling BankCatch  
- Unit tests green; headed mule smoke optional  

## Resume prompt

```
Continue docs/superpowers/plans/2026-08-01-gather-anchor-api-refactor.md
Phase 2: extract shared mule PartnerTrade + trade tasks from FlaxRunner/NatureCrafter.
Then Phase 3: GatheringBot muleMode for Miner/Fisher/Woodcutter.
Branch: refactor/gather-anchor-api (already has Phase 1).
```
