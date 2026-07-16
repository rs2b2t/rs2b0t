// AIO quest engine — shared types. Type-only imports so the pure evaluators
// that consume these snapshots stay free of any client/DOM dependency (their
// tests run under bun:test with no game client). Live reads happen only in
// QuestEngine.ts, which converts game state into the plain snapshots here —
// the same "pure snapshots, no client at runtime" discipline as quests/types.ts.

import type Tile from '../../api/Tile.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js'; // type-only import, no client at runtime
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

/** Plain-data view of the world for ONE quest's decide(). Engine-assembled. */
export interface QuestSnapshot {
    journal: QuestStatus;              // this quest's journal colour
    inv: Map<string, number>;          // LOWERCASED display name -> inventory count
    worn: Set<string>;                 // LOWERCASED equipped item names
    /** Current no-progress count from the engine watchdog (0 = last step
     *  moved the world). Lets a PURE decide() rotate empty-handed probes
     *  (probeOrder[noProgress % probeOrder.length]) without module state —
     *  quest varps are never transmitted, so mid-quest stages with no
     *  inventory signal (Romeo & Juliet 30/40/60) are only reachable this way. */
    noProgress: number;
    /** Last-SEEN bank coin count (0 until a bank has been opened this run) —
     *  lets pure gather fns decide buy vs 'need ~N gp' wait. Same staleness
     *  contract as provisioning's bank counts. */
    bankCoins: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    /** Use `item` on another world entity or on a second held item. For
     *  targetKind 'item' the target is resolved from the pack (Inventory.first)
     *  and `anchor` is unused (item-on-item needs no world position) — e.g. use
     *  a Bucket of water on Clay to make Soft clay (Prince Ali). */
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc' | 'item'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'withdraw'; items: { name: string; qty: number }[] }
    /** Deposit every backpack item whose LOWERCASED name matches none of the
     *  `keep` substrings (worn equipment is untouched). Issued by the engine
     *  once per quest before provisioning so each quest starts with a clean
     *  pack — provisioning is bank-first, so anything deposited that the quest
     *  needs comes straight back via `withdraw`. */
    | { kind: 'deposit'; keep: string[] }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    /** Buy `qty` of `item` from the shop run by `shop.npc` (Trade op). The
     *  executor self-provisions coins: pack < estGp -> bank-leg withdraw of
     *  estGp first. Gather fns pair this with gpShort(): affordable -> buy,
     *  broke -> {kind:'wait', reason:`need ~N gp for <item>`} (wait-park
     *  surfaces it). estGp is a deliberate overestimate (shop prices climb as
     *  stock drops — ShopRunner's est×1.25 lesson). */
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestModule {
    record: QuestRecord;               // the existing quests/data record (one source of truth)
    hops?: LadderHop[];                // scripted level crossings the nav graph lacks
    /** NPC names this quest legitimately fights, surfaced through
     *  AIOQuester.grindTargets() so the random-event guard never mistakes the
     *  quarry for a hostile event (the ArdyFighter mechanism). */
    grind?: string[];
    /** Per acquirable item (LOWERCASED name): next step toward obtaining it.
     *  Called by provisioning when the bank lacks the item; `need` is how many
     *  more are required. decide-shaped so multi-leg gathers (windmill flour)
     *  re-plan from the snapshot each loop. */
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    /** LOWERCASED substring matchers for pack items the engine's between-quest
     *  deposit must KEEP: gather tools ('pickaxe', 'shears') and quest-internal
     *  items a mid-quest restart may be holding ('ghostspeak amulet', 'cadava').
     *  record.items names are always kept implicitly. Conservative (substring)
     *  on purpose — keeping too much is harmless, depositing a tool wedges. */
    tools?: string[];
    /** PURE quest brain: (journal, inv, worn) -> next step. */
    decide(snap: QuestSnapshot): QuestStep;
}
