import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3045, 3257, 0), leash: 8, prefer: ['Not very busy in here today, is it?'] };

const GENERAL: NpcStop = { npc: 'General Wartface', anchor: new Tile(2957, 3510, 0), leash: 6, prefer: ['Do you want me to pick an armour colour for you?'] };

const AGGIE_ANCHOR = new Tile(3086, 3259, 0);
const AGGIE_RED: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make red dye?', 'Okay, make me some red dye please.'] };
const AGGIE_YELLOW: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
const AGGIE_BLUE: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make blue dye?', 'Okay, make me some blue dye please.'] };

const WYSON: NpcStop = { npc: 'Wyson the gardener', anchor: new Tile(3013, 3377, 0), leash: 10, prefer: ["I'm looking for woad leaves.", 'How about 20 coins?'] };

const GOBLIN_FARM = new Tile(2958, 3507, 0);
const ONION_PATCH = new Tile(3188, 3267, 0);
const PORT_SARIM_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const qty = (snap: QuestSnapshot, name: string): number => snap.inv.get(name) ?? 0;

async function farmGoblinMail(log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().name('Goblin mail').within(15).nearest();
    if (drop) {
        const before = Inventory.count('Goblin mail');
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count('Goblin mail') > before, 6000);
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const goblin = Npcs.query().name('Goblin').action('Attack').within(15)
        .where(n => !n.inCombat && !n.targetsAnotherPlayer()).nearest();
    if (goblin) {
        if (!(await goblin.interact('Attack'))) {
            return false;
        }
        await Execution.delayUntil(() => Game.inCombat() || !goblin.valid(), 4000);
        return false;
    }
    await Traversal.walkResilient(GOBLIN_FARM, { radius: 4, attempts: 2, timeoutMs: 90_000, log });
    return false;
}

async function makeBlueDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Blue dye')) {
        return true;
    }
    if (Inventory.count('Woad leaf') < 2) {
        if (Inventory.count('Coins') < 20) {
            log('need ~20 coins for woad leaves');
            return false;
        }
        if (!(await gotoNpc(WYSON, [], log))) {
            return false;
        }
        await talkThrough(WYSON.npc, WYSON.prefer, log);
        return false;
    }
    if (Inventory.count('Coins') < 5) {
        log('need ~5 coins for blue dye');
        return false;
    }
    if (!(await gotoNpc(AGGIE_BLUE, [], log))) {
        return false;
    }
    await talkThrough(AGGIE_BLUE.npc, AGGIE_BLUE.prefer, log);
    return Execution.delayUntil(() => Inventory.contains('Blue dye'), 8000);
}

async function makeOrangeDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Orange dye')) {
        return true;
    }
    if (!Inventory.contains('Red dye')) {
        if (Inventory.count('Redberries') < 3) {
            return executeStep({ kind: 'buy', item: 'Redberries', qty: 3, shop: PORT_SARIM_SHOP, estGp: 60 }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for red dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_RED, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_RED.npc, AGGIE_RED.prefer, log);
        return false;
    }
    if (!Inventory.contains('Yellow dye')) {
        if (Inventory.count('Onion') < 2) {
            return executeStep({ kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_PATCH }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for yellow dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_YELLOW, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_YELLOW.npc, AGGIE_YELLOW.prefer, log);
        return false;
    }
    return executeStep({ kind: 'useOn', item: 'Red dye', targetKind: 'item', target: 'Yellow dye', anchor: AGGIE_ANCHOR, product: 'Orange dye' }, [], log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: BARTENDER }; }

    const plainMail = qty(snap, 'goblin mail');
    const orangeMail = has(snap, 'orange goblin mail');
    const blueMail = has(snap, 'blue goblin mail');

    if (has(snap, 'orange dye') && !orangeMail && plainMail >= 1) {
        return { kind: 'useOn', item: 'Orange dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Orange goblin mail' };
    }
    if (has(snap, 'blue dye') && !blueMail && plainMail >= 2) {
        return { kind: 'useOn', item: 'Blue dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Blue goblin mail' };
    }

    return { kind: 'talk', stop: GENERAL };
}

export const goblindiplomacy: QuestModule = {
    record: QUESTS.find(r => r.id === 'gobdip')!,
    bank: new Tile(3093, 3243, 0),
    tools: ['goblin mail', 'dye', 'woad', 'redberries', 'onion', 'coins'],
    grind: ['Goblin'],
    gather: {
        'goblin mail': () => ({ kind: 'custom', name: 'farm goblin mail', run: farmGoblinMail }),
        'orange dye': () => ({ kind: 'custom', name: 'make orange dye', run: makeOrangeDye }),
        'blue dye': () => ({ kind: 'custom', name: 'make blue dye', run: makeBlueDye })
    },
    decide
};
