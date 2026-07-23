import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { gatherBalls } from './sheepshearer.js';

const HASSAN: NpcStop = { npc: 'Hassan', anchor: new Tile(3302, 3163, 0), leash: 6, prefer: ['Can I help you? You must need some help here in the desert.'] };
const OSMAN: NpcStop = { npc: 'Osman', anchor: new Tile(3286, 3180, 0), leash: 6, prefer: ['Okay, I better go find some things.', 'What is the first thing I must do?', 'What is the second thing you need?'] };
const LEELA: NpcStop = { npc: 'Leela', anchor: new Tile(3113, 3263, 0), leash: 6, prefer: ['I hoped to get him drunk.'] };
const NED_WIG: NpcStop = { npc: 'Ned', anchor: new Tile(3100, 3258, 0), leash: 6, prefer: ['Ned, could you make other things from wool?', 'How about some sort of wig?', 'I have that now. Please, make me a wig.'] };
const ADVENTURE_SHOP = { npc: 'Aemad', anchor: new Tile(2614, 3293, 0) };
const AGGIE_PASTE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Could you think of a way to make skin paste?', 'Yes please. Mix me some skin paste.'] };
const AGGIE_DYE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
const KELI: NpcStop = { npc: 'Lady Keli', anchor: new Tile(3128, 3244, 0), leash: 6, prefer: ['Heard of you? You are famous in RuneScape!', 'Yes, of course I have heard of you.', 'What is your latest plan then?', 'Can you be sure they will not try to get him out?', 'Could I see the key please?', 'Could I touch the key for a moment?'] };
const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3226, 3399, 0), leash: 8, prefer: ['A glass of your finest ale please.', "I'll have a beer please."] };

const THESSALIA_SHOP = { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) };
const SHANTAY_SHOP = { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) };
const PORT_SARIM_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const LUMBY_SHOP = { npc: 'Shop keeper', anchor: new Tile(3209, 3247, 0) };

const ONION_PATCH = new Tile(3188, 3267, 0);
const CLAY_ROCKS = new Tile(2986, 3240, 0);
const LOGS_SPAWN = new Tile(3089, 3265, 0);
const PICKAXE_SPAWN = new Tile(2963, 3216, 0);

const JAIL_DOOR_NORTH = new Tile(3123, 3244, 0);
const PRINCE_TILE = new Tile(3123, 3242, 0);
const JOE_TILE = new Tile(3123, 3245, 0);
const JAIL_ANCHOR = new Tile(3126, 3245, 0);

const BLONDWIG_ID = 2419;

const DISGUISE = ['bronze key', 'wig', 'pink skirt', 'paste'];

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const packCoins = (snap: QuestSnapshot): number => snap.inv.get('coins') ?? 0;
const hasPickaxe = (snap: QuestSnapshot): boolean => {
    for (const name of snap.inv.keys()) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    for (const name of snap.worn) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    return false;
};

const PROBES: NpcStop[] = [LEELA, OSMAN, HASSAN];

function liveInvSnap(): QuestSnapshot {
    const inv = new Map<string, number>();
    for (const it of Inventory.items()) {
        if (it.name) {
            const key = it.name.toLowerCase();
            inv.set(key, (inv.get(key) ?? 0) + it.count);
        }
    }
    return { journal: 'inProgress', inv, worn: new Set(), noProgress: 0, bankCoins: 0 };
}

function hasBlondWig(): boolean {
    const wig = Inventory.first('Wig');
    return wig !== null && wig.id === BLONDWIG_ID;
}

function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

function jugWater(snap: QuestSnapshot, qty: number): QuestStep {
    return buyOrWait(snap, { kind: 'buy', item: 'Jug of water', qty, shop: SHANTAY_SHOP, estGp: 5 * qty });
}

function softClayChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'clay')) {
        if (!hasPickaxe(snap)) {
            return { kind: 'custom', name: 'get a pickaxe', run: ensurePickaxe };
        }
        return { kind: 'mineRock', rock: 'Clay', item: 'Clay', qty: 1, anchor: CLAY_ROCKS };
    }
    if (!has(snap, 'jug of water')) {
        return jugWater(snap, 2);
    }
    return { kind: 'useOn', item: 'Jug of water', targetKind: 'item', target: 'Clay', anchor: CLAY_ROCKS, product: 'Soft clay' };
}

function pasteChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'redberries')) {
        return buyOrWait(snap, { kind: 'buy', item: 'Redberries', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 });
    }
    if (!has(snap, 'pot of flour')) {
        return buyOrWait(snap, { kind: 'buy', item: 'Pot of flour', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 });
    }
    if (!has(snap, 'ashes')) {
        if (!has(snap, 'tinderbox')) {
            return buyOrWait(snap, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: LUMBY_SHOP, estGp: 5 });
        }
        if (!has(snap, 'logs')) {
            return { kind: 'grabGround', item: 'Logs', anchor: LOGS_SPAWN };
        }
        return { kind: 'custom', name: 'burn logs for ashes', run: burnForAshes };
    }
    if (!has(snap, 'bucket of water') && !has(snap, 'jug of water')) {
        return jugWater(snap, 1);
    }
    return { kind: 'talk', stop: AGGIE_PASTE };
}

async function ensurePickaxe(log: (m: string) => void): Promise<boolean> {
    const isPick = (n: string | null | undefined): boolean => (n ?? '').toLowerCase().endsWith('pickaxe');
    if (Equipment.items().some(i => isPick(i.name)) || Inventory.items().some(i => isPick(i.name))) {
        return true;
    }
    if (await Bank.openNearest('Bank booth', 'Use-quickly', log)) {
        const banked = Bank.items().find(i => isPick(i.name));
        if (banked?.name) {
            log(`withdrawing ${banked.name} from the bank`);
            if (await Bank.withdrawX(banked.name, 1)) {
                return Execution.delayUntil(() => Inventory.items().some(i => isPick(i.name)), 3000);
            }
        }
    }
    return executeStep({ kind: 'grabGround', item: 'Bronze pickaxe', anchor: PICKAXE_SPAWN }, [], log);
}

async function dyeWigToBlond(log: (m: string) => void): Promise<boolean> {
    if (hasBlondWig()) {
        return true;
    }
    if (!Inventory.contains('Yellow dye')) {
        if (Inventory.count('Onion') < 2) {
            return executeStep({ kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_PATCH }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for yellow dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_DYE, [], log))) {
            return false;
        }
        await talkThrough('Aggie', AGGIE_DYE.prefer, log);
        return false;
    }
    const dye = Inventory.first('Yellow dye');
    const wig = Inventory.first('Wig');
    if (!dye || !wig) {
        return false;
    }
    if (!(await dye.useOn(wig))) {
        return false;
    }
    return Execution.delayUntil(() => hasBlondWig(), 8000);
}

async function wigPipeline(log: (m: string) => void): Promise<boolean> {
    if (hasBlondWig()) {
        return true;
    }
    if (!Inventory.contains('Wig')) {
        if (Inventory.count('Ball of wool') < 3) {
            return executeStep(gatherBalls(liveInvSnap(), 3), [], log);
        }
        if (!(await gotoNpc(NED_WIG, [], log))) {
            return false;
        }
        await talkThrough('Ned', NED_WIG.prefer, log);
    }
    return dyeWigToBlond(log);
}

async function osmanBriefingThenImprint(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(OSMAN, [], log))) {
        return false;
    }
    if (!(await talkThrough('Osman', OSMAN.prefer, log))) {
        log('  Osman offered no dialogue (already briefed) — proceeding to Keli');
    }
    if (!(await gotoNpc(KELI, [], log))) {
        return false;
    }
    await talkThrough('Lady Keli', KELI.prefer, log);
    return Inventory.contains('Key print');
}

async function burnForAshes(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Ashes')) {
        return true;
    }
    const tinder = Inventory.first('Tinderbox');
    const logsItem = Inventory.first('Logs');
    if (!tinder || !logsItem) {
        log('burnForAshes: missing tinderbox or logs');
        return false;
    }
    if (!(await tinder.useOn(logsItem))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => GroundItems.query().name('Ashes').within(3).nearest() !== null, 150_000))) {
        log('burnForAshes: no ashes appeared after the burn');
        return false;
    }
    const ash = GroundItems.query().name('Ashes').within(3).nearest();
    if (!ash || !(await ash.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains('Ashes'), 5000);
}

async function jailbreak(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(LEELA, [], log))) {
        return false;
    }
    await talkThrough('Leela', LEELA.prefer, log);

    if (!hasBlondWig()) {
        log('wig is not blond yet — completing the dye before the handover');
        return dyeWigToBlond(log);
    }

    if (!(await Traversal.walkResilient(JAIL_ANCHOR, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const keli = Npcs.query().name('Lady Keli').within(8).nearest();
    let tied = false;
    if (keli) {
        const rope = Inventory.first('Rope');
        if (rope) {
            await rope.useOn(keli);
            await Execution.delayUntil(() => ChatDialog.canContinue() || !Npcs.query().name('Lady Keli').within(12).nearest(), 4000);
            for (let i = 0; i < 8 && ChatDialog.canContinue(); i++) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
            }
            tied = !Npcs.query().name('Lady Keli').within(12).nearest();
        }
        if (!tied) {
            if (Inventory.count('Rope') < 1) {
                await executeStep({ kind: 'buy', item: 'Rope', qty: 1, shop: ADVENTURE_SHOP, estGp: 40 }, [], log);
                return false;
            }
            if (Inventory.count('Beer') < 3) {
                if (!(await gotoNpc(BARTENDER, [], log))) {
                    return false;
                }
                await talkThrough('Bartender', BARTENDER.prefer, log);
                return false;
            }
            if (!(await Traversal.walkResilient(JOE_TILE, { radius: 3, attempts: 2, timeoutMs: 60_000, log }))) {
                return false;
            }
            const joe = Npcs.query().name('Joe').within(6).nearest();
            for (let fed = 0; joe && fed < 3 && Inventory.count('Beer') > 0; fed++) {
                const beer = Inventory.first('Beer');
                if (!beer || !(await beer.useOn(joe))) {
                    break;
                }
                await Execution.delayUntil(() => ChatDialog.canContinue(), 5000);
                for (let i = 0; i < 40 && (ChatDialog.canContinue() || ChatDialog.options().length > 0); i++) {
                    if (ChatDialog.canContinue()) {
                        await ChatDialog.continue();
                    } else {
                        const opts = ChatDialog.options();
                        await ChatDialog.chooseOption(opts[opts.length - 1]);
                    }
                    await Execution.delayTicks(1);
                }
            }
            return false;
        }
    }

    if (!(await Traversal.walkResilient(JAIL_DOOR_NORTH, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const key = Inventory.first('Bronze key');
    const door = Locs.query().name('Prison Door').within(6).nearest();
    if (key && door) {
        await key.useOn(door);
        await Execution.delayUntil(() => Game.tile()?.z !== undefined && (Game.tile()?.z ?? 9999) <= 3243, 4000);
    }

    if (!(await Traversal.walkResilient(PRINCE_TILE, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await talkThrough('Prince Ali', [], log);
    for (let i = 0; i < 6 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
    if (Inventory.contains('Bronze key')) {
        return false;
    }

    if (!(await gotoNpc(HASSAN, [], log))) {
        return false;
    }
    await talkThrough('Hassan', [], log);
    return true;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: HASSAN }; }

    const all4 = DISGUISE.every(item => has(snap, item));

    if (all4) {
        if (packCoins(snap) < 30 && gpShort(snap, 30) === 0) {
            return { kind: 'withdraw', items: [{ name: 'Coins', qty: 40 }] };
        }
        return { kind: 'custom', name: 'jailbreak', run: jailbreak };
    }

    if (has(snap, 'key print')) {
        if (!has(snap, 'bronze bar')) {
            return buyOrWait(snap, { kind: 'buy', item: 'Bronze bar', qty: 1, shop: SHANTAY_SHOP, estGp: 60 });
        }
        return { kind: 'talk', stop: OSMAN };
    }

    if (!has(snap, 'bronze key') && !has(snap, 'key print')) {
        if (has(snap, 'soft clay')) {
            return { kind: 'custom', name: 'osman briefing + keli imprint', run: osmanBriefingThenImprint };
        }
        const midClayBuild = has(snap, 'clay') || has(snap, 'jug of water');
        if (!midClayBuild && !has(snap, 'bronze bar') && snap.noProgress === 0) {
            return { kind: 'talk', stop: LEELA };
        }
        return softClayChain(snap);
    }

    if (!has(snap, 'wig') || has(snap, 'yellow dye') || has(snap, 'onion')) {
        return { kind: 'custom', name: 'wig pipeline', run: wigPipeline };
    }

    if (!has(snap, 'paste')) {
        return pasteChain(snap);
    }

    if (!has(snap, 'pink skirt')) {
        return buyOrWait(snap, { kind: 'buy', item: 'Pink skirt', qty: 1, shop: THESSALIA_SHOP, estGp: 10 });
    }

    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const princeali: QuestModule = {
    record: QUESTS.find(r => r.id === 'prince')!,
    bank: new Tile(3093, 3243, 0),
    tools: ['pickaxe', 'bronze key', 'key print', 'wig', 'paste', 'pink skirt', 'rope', 'beer', 'soft clay', 'clay', 'yellow dye', 'onion', 'ball of wool', 'shears', 'redberries', 'pot of flour', 'ashes', 'bucket', 'jug', 'tinderbox', 'logs', 'bronze bar', 'coins'],
    gather: {
        'redberries': s => buyOrWait(s, { kind: 'buy', item: 'Redberries', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 }),
        'pot of flour': s => buyOrWait(s, { kind: 'buy', item: 'Pot of flour', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 }),
        'tinderbox': s => buyOrWait(s, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: LUMBY_SHOP, estGp: 5 }),
        'bronze bar': s => buyOrWait(s, { kind: 'buy', item: 'Bronze bar', qty: 1, shop: SHANTAY_SHOP, estGp: 60 }),
        'pink skirt': s => buyOrWait(s, { kind: 'buy', item: 'Pink skirt', qty: 1, shop: THESSALIA_SHOP, estGp: 10 }),
        'rope': s => buyOrWait(s, { kind: 'buy', item: 'Rope', qty: 1, shop: ADVENTURE_SHOP, estGp: 40 })
    },
    decide
};
