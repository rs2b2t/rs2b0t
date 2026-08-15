import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene } from '../../exec/prompts.js';
import { pickaxeAt } from '../knightssword/supplies.js';
import { BOB, DOMMIK, NS_ID, NS_LOC, NS_NAME, NS_TILE, URHNEY } from './areas.js';

/** Kept through any deposit this quest issues. */
export const NS_TOOLS: readonly string[] = [
    'ghostspeak amulet', 'mirror', 'journal', 'druidic spell', 'a used spell',
    'mort myre fungi', 'mort myre stem', 'mort myre pear',
    'silver sickle', 'silver sickle(b)', 'druid pouch', 'sickle mould',
    'silver ore', 'silver bar', 'coins',
    'bronze pickaxe', 'iron pickaxe', 'steel pickaxe', 'mithril pickaxe', 'adamant pickaxe', 'rune pickaxe'
];

export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
export const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;

const scanBank: QuestStep = { kind: 'scanBank' };
const withdraw = (name: string, id: number, qty = 1): QuestStep => ({ kind: 'withdraw', items: [{ name, qty, id }] });

/** Every word with either spirit needs the amulet worn. */
export function amulet(snap: QuestSnapshot): QuestStep | null {
    if (snap.wornIds?.has(NS_ID.GHOSTSPEAK)) {
        return null;
    }
    if (heldId(snap, NS_ID.GHOSTSPEAK) > 0) {
        return { kind: 'equip', item: NS_NAME.GHOSTSPEAK };
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    if (bankedId(snap, NS_ID.GHOSTSPEAK) > 0) {
        return withdraw(NS_NAME.GHOSTSPEAK, NS_ID.GHOSTSPEAK);
    }
    // Why: Urhney hands out a replacement on "I've lost the amulet.", so a lost one is never a park.
    return { kind: 'talk', stop: URHNEY };
}

/** Walk to the furnace and answer the make menu whatever opened it. */
async function atFurnace(
    log: (m: string) => void,
    open: (furnace: Loc) => Promise<boolean>,
    product: string,
    expect: () => boolean
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(NS_TILE.FURNACE, { radius: 2, attempts: 4, timeoutMs: 300_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: the furnace is two locs and only one carries `op2=Smelt`, so the op-bearing half is preferred and the other is only a use-on target.
    const furnace = Locs.query().name(NS_LOC.FURNACE).action('Smelt').within(8).nearest()
        ?? Locs.query().name(NS_LOC.FURNACE).within(8).nearest();
    if (!furnace) {
        log('no Furnace in reach of the Al Kharid stand');
        return false;
    }
    if (!(await open(furnace))) {
        log('the Al Kharid furnace did not answer');
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 8000))) {
        log('the make menu never opened');
        return false;
    }
    if (!(await ChatDialog.makeX(product, 1))) {
        log(`no '${product}' in the menu: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    return Execution.delayUntil(expect, 30_000);
}

async function smeltSilver(log: (m: string) => void): Promise<boolean> {
    return atFurnace(
        log,
        furnace => Promise.resolve(furnace.interact('Smelt')),
        'Silver',
        () => Inventory.countById(NS_ID.SILVER_BAR) > 0
    );
}

// Why: the furnace's `Smelt` op opens the ore-to-bar menu alone — silver craft is an `oplocu`, so the bar is used on the furnace and no op expresses it.
// Why: casting the sickle is a members-only option and this world is members everywhere (`Environment.node.members`), so the Al Kharid furnace serves.
// Why: the option only appears while the mould is held, so a missing mould reads as "no Silver sickle in the menu" rather than as a refusal.

async function castSickle(log: (m: string) => void): Promise<boolean> {
    return atFurnace(
        log,
        async furnace => {
            const bar = Inventory.items().find(i => i.id === NS_ID.SILVER_BAR);
            return bar ? bar.useOn(furnace) : false;
        },
        NS_NAME.SICKLE,
        () => Inventory.countById(NS_ID.SICKLE) > 0
    );
}

// Why: the shared helper's last resort is the bronze pickaxe ground spawn at Rimmington, 360 tiles the wrong side of Al Kharid.
// Why: Bob stocks five of them 70 tiles from the mine, and this quest carries coin for the mould anyway.

/** A pickaxe, bank first, then Bob's counter in Lumbridge. */
function pickaxe(snap: QuestSnapshot, miningLevel: number): QuestStep | null {
    const step = pickaxeAt(snap, miningLevel);
    if (!step || step.kind !== 'grabGround') {
        return step;
    }
    return { kind: 'buy', item: 'Bronze pickaxe', qty: 1, shop: BOB, estGp: 500 };
}

/** Bank first, then Al Kharid: mould, ore, bar, cast. Null once a sickle is in hand. */
export function sickleStep(snap: QuestSnapshot, miningLevel?: number): QuestStep | null {
    if (heldId(snap, NS_ID.SICKLE_BLESSED) > 0 || heldId(snap, NS_ID.SICKLE) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    if (bankedId(snap, NS_ID.SICKLE_BLESSED) > 0) {
        return withdraw(NS_NAME.SICKLE_BLESSED, NS_ID.SICKLE_BLESSED);
    }
    if (bankedId(snap, NS_ID.SICKLE) > 0) {
        return withdraw(NS_NAME.SICKLE, NS_ID.SICKLE);
    }
    if (heldId(snap, NS_ID.MOULD) === 0) {
        if (bankedId(snap, NS_ID.MOULD) > 0) {
            return withdraw(NS_NAME.MOULD, NS_ID.MOULD);
        }
        // Why: `buy` funds itself from the bank when the pack is short, so this quest carries no standing coin float.
        return { kind: 'buy', item: NS_NAME.MOULD, qty: 1, shop: DOMMIK, estGp: 200 };
    }
    if (heldId(snap, NS_ID.SILVER_BAR) > 0) {
        return { kind: 'custom', name: 'cast the silver sickle', run: castSickle };
    }
    if (bankedId(snap, NS_ID.SILVER_BAR) > 0) {
        return withdraw(NS_NAME.SILVER_BAR, NS_ID.SILVER_BAR);
    }
    if (heldId(snap, NS_ID.SILVER_ORE) > 0) {
        return { kind: 'custom', name: 'smelt a silver bar', run: smeltSilver };
    }
    if (bankedId(snap, NS_ID.SILVER_ORE) > 0) {
        return withdraw(NS_NAME.SILVER_ORE, NS_ID.SILVER_ORE);
    }
    // Why: mining without a pickaxe raises no refusal at all — the rock does not answer — so the tool is sourced before the rocks are walked to.
    return pickaxe(snap, miningLevel ?? Skills.level('mining'))
        ?? { kind: 'mineRock', rock: 'Silver', item: NS_NAME.SILVER_ORE, qty: 1, anchor: NS_TILE.SILVER_ROCKS };
}
