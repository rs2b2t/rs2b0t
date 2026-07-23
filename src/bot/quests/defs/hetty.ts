import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import { gotoNpc, talkThrough } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const HETTY: NpcStop = {
    npc: 'Hetty',
    anchor: new Tile(2970, 3207, 0),
    leash: 6,
    prefer: ['I am in search of a quest.', 'Yes help me become one with my darker side.']
};
const CAULDRON = new Tile(2967, 3205, 0);
const RANGE = new Tile(2970, 3209, 0);
const RATS = new Tile(2955, 3204, 0);
const ONION_FIELD = new Tile(2950, 3251, 0);
const BETTY_SHOP = { npc: 'Betty', anchor: new Tile(3011, 3260, 0) };
const WYDIN_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const DRAYNOR_BANK = new Tile(3093, 3243, 0);

const INGREDIENTS = ['rats tail', 'onion', 'eye of newt', 'burnt meat'];

function gpShort(snap: QuestSnapshot, estGp: number): number {
    return Math.max(0, estGp - (snap.inv.get('coins') ?? 0) - snap.bankCoins);
}

function startedOr(snap: QuestSnapshot, step: QuestStep): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: HETTY };
    }
    return step;
}

export const gatherOnion = (snap: QuestSnapshot): QuestStep =>
    startedOr(snap, { kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_FIELD });

export const gatherEyeOfNewt = (snap: QuestSnapshot): QuestStep =>
    startedOr(snap, gpShort(snap, 20) > 0
        ? { kind: 'wait', reason: 'need ~20 gp for Eye of newt' }
        : { kind: 'buy', item: 'Eye of newt', qty: 1, shop: BETTY_SHOP, estGp: 20 });

export const gatherRatsTail = (snap: QuestSnapshot): QuestStep =>
    startedOr(snap, { kind: 'custom', name: 'kill a rat for its tail', run: killRatGrabTail });

export const gatherBurntMeat = (snap: QuestSnapshot): QuestStep =>
    startedOr(snap, (snap.inv.has('cooked meat') || snap.inv.has('raw beef'))
        ? { kind: 'custom', name: 'burn the meat on the range', run: burnMeat }
        : gpShort(snap, 20) > 0
            ? { kind: 'wait', reason: 'need ~20 gp for Raw beef' }
            : { kind: 'buy', item: 'Raw beef', qty: 2, shop: WYDIN_SHOP, estGp: 20 });

async function killRatGrabTail(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Rats tail')) {
        return true;
    }
    const drop = GroundItems.query().name('Rats tail').within(8).nearest();
    if (drop) {
        log('picking up the dropped Rats tail');
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains('Rats tail'), 6000);
    }
    log('walking to the Rimmington rats to get a tail');
    if (!(await Traversal.walkResilient(RATS, { radius: 5, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const rat = Npcs.query().name('Rat').action('Attack').where(n => !n.inCombat).within(10).nearest();
    if (!rat) {
        log('killRatGrabTail: no free Rat near the anchor — LIVE-VERIFY the Rimmington spawn');
        return false;
    }
    Game.setCombatStyle(1);
    log('attacking a Rat for its tail');
    if (!(await rat.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(
        () => GroundItems.query().name('Rats tail').within(8).nearest() !== null || Npcs.query().name('Rat').within(1).nearest() === null,
        6000
    );
    return false;
}

async function burnMeat(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Burnt meat')) {
        return true;
    }
    if (!(await Traversal.walkResilient(RANGE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const oven = () => Locs.query().name('Range').where(l => l.tile().distanceTo(RANGE) <= 6).nearest();
    for (let n = 0; n < 12 && !Inventory.contains('Burnt meat'); n++) {
        if (ChatDialog.isMakeMenu()) {
            if (!(await ChatDialog.make('meat'))) {
                await ChatDialog.make();
            }
            await Execution.delayTicks(2);
            continue;
        }
        const meat = Inventory.first('Cooked meat') ?? Inventory.first('Raw beef');
        if (!meat) {
            return false;
        }
        const range = oven();
        if (!range) {
            return false;
        }
        const cookedBefore = Inventory.count('Cooked meat');
        const burntBefore = Inventory.count('Burnt meat');
        log(meat.name === 'Cooked meat' ? 'burning the cooked meat on the range' : 'cooking the raw beef on the range');
        if (!(await meat.useOn(range))) {
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayUntil(
            () => ChatDialog.isMakeMenu() || Inventory.count('Burnt meat') > burntBefore || Inventory.count('Cooked meat') !== cookedBefore,
            6000
        );
    }
    return Inventory.contains('Burnt meat');
}

async function handInAndDrink(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(HETTY, [], log))) {
        return false;
    }
    log('handing the four ingredients to Hetty');
    await talkThrough('Hetty', [], log);
    if (!(await Traversal.walkResilient(CAULDRON, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const cauldron = Locs.query().name('Cauldron').action('Drink From').within(8).nearest();
    if (!cauldron) {
        log('handInAndDrink: no Cauldron[Drink From] near Hetty — LIVE-VERIFY');
        return false;
    }
    log('drinking from the cauldron to finish the quest');
    if (!(await cauldron.interact('Drink From'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return true;
}

function gatherFor(name: string, snap: QuestSnapshot): QuestStep {
    switch (name) {
        case 'onion': return gatherOnion(snap);
        case 'rats tail': return gatherRatsTail(snap);
        case 'eye of newt': return gatherEyeOfNewt(snap);
        case 'burnt meat': return gatherBurntMeat(snap);
        default: return { kind: 'wait', reason: `no gatherer for ${name}` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: HETTY }; }
    const need = INGREDIENTS.filter(i => !snap.inv.has(i));
    if (need.length === 0) {
        return { kind: 'custom', name: 'hand in the ingredients and drink the potion', run: handInAndDrink };
    }
    return gatherFor(need[0], snap);
}

export const hetty: QuestModule = {
    record: QUESTS.find(r => r.id === 'hetty')!,
    bank: DRAYNOR_BANK,
    grind: ['Rat'],
    tools: ['coins', 'raw beef', 'cooked meat'],
    gather: {
        'onion': gatherOnion,
        'rats tail': gatherRatsTail,
        'eye of newt': gatherEyeOfNewt,
        'burnt meat': gatherBurntMeat
    },
    decide
};
