import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, isUnderground, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const TRAIBORN_KEY_ID = 2399;
const ROVIN_KEY_ID = 2400;
const DRAIN_KEY_ID = 2401;

const GYPSY: NpcStop = { npc: 'Gypsy', anchor: new Tile(3203, 3424, 0), leash: 6, prefer: [
    'Ok, here you go.',
    'Very interesting. What does that Aaargh bit mean?',
    "Who's Delrith?",
    "Okay, where is he? I'll kill him for you!",
    'Where can I find Silverlight?',
    "Okay, thanks. I'll do my best to stop the demon."
] };
const PRYSIN: NpcStop = { npc: 'Sir Prysin', anchor: new Tile(3205, 3473, 0), leash: 6, prefer: [
    'Gypsy Aris said I should come and talk to you.',
    'I need to find Silverlight.',
    "He's back and unfortunately I've got to deal with him.",
    'So give me the keys!',
    'Where does the wizard live?',
    "Well I'd better go key hunting.",
    "I'm still looking."
] };
const ROVIN: NpcStop = { npc: 'Captain Rovin', anchor: new Tile(3204, 3496, 2), leash: 6, prefer: ['Yes I know, but this is important.', "There's a demon who wants to invade this city."] };
const TRAIBORN: NpcStop = { npc: 'Traiborn', anchor: new Tile(3112, 3162, 1), leash: 2, prefer: ['I need to get a key given to you by Sir Prysin.', 'have you got any keys knocking around', "I'll get the bones for you"] };
const WIZ_INSIDE_STAND = new Tile(3105, 3160, 0);

const DRAIN_TILE = new Tile(3225, 3495, 0);
const SINK_TILE = new Tile(3224, 3494, 0);
const MANHOLE_TILE = new Tile(3237, 3458, 0);
const SEWER_LAND = new Tile(3237, 9858, 0);
const SEWER_KEY = new Tile(3225, 9897, 0);
const DELRITH_TILE = new Tile(3229, 3369, 0);
const WIZARD_ANCHOR = new Tile(3107, 3159, 0);
const WIZ_L1_STAND = new Tile(3105, 3160, 1);
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

const INCANTATION = 'Aber Camerinthum Purchai Gabindo';

const BONES_NEEDED = 25;

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const heldId = (id: number): boolean => Inventory.items().some(i => i.id === id);

function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

function fillBucket(snap: QuestSnapshot): QuestStep {
    if (has(snap, 'bucket')) {
        return { kind: 'useOn', item: 'Bucket', targetKind: 'loc', target: 'Sink', anchor: SINK_TILE, product: 'Bucket of water' };
    }
    return buyOrWait(snap, { kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 });
}

async function grindWizards(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Bones') >= BONES_NEEDED) {
        return true;
    }
    const drop = GroundItems.query().name('Bones').within(6).nearest();
    if (drop) {
        const before = Inventory.count('Bones');
        if (!(await drop.interact('Take'))) { return false; }
        await Execution.delayUntil(() => Inventory.count('Bones') > before, 6000);
        return false;
    }
    const wiz = Npcs.query().name('Wizard').action('Attack').where(n => !n.inCombat).within(10).nearest();
    if (!wiz) {
        await Traversal.walkResilient(WIZARD_ANCHOR, { radius: 3, attempts: 3, timeoutMs: 90_000, log });
        return false;
    }
    const idx = wiz.index;
    if (!(await wiz.interact('Attack'))) { return false; }
    await Execution.delayUntil(() => Game.inCombat(), 5000);
    await Execution.delayUntil(() => !Npcs.all().some(n => n.index === idx && /wizard/i.test(n.name ?? '')), 30_000);
    return false;
}

async function drainLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (isUnderground(here)) {
        if (!heldId(DRAIN_KEY_ID)) {
            if (!(await Traversal.walkResilient(SEWER_KEY, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
                return false;
            }
            const key = GroundItems.query().name('Key').where(g => g.id === DRAIN_KEY_ID).within(10).nearest()
                ?? GroundItems.query().name('Key').within(10).nearest();
            if (key) {
                await key.interact('Take');
                await Execution.delayUntil(() => heldId(DRAIN_KEY_ID), 6000);
            } else {
                log('drainLeg: no "Key" on the sewer floor — despawned? climbing out to re-pour');
            }
        }
        if (!(await Traversal.walkResilient(SEWER_LAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const up = Locs.query().action('Climb-up').within(8).nearest()
            ?? Locs.query().action('Climb up').within(8).nearest()
            ?? Locs.query().name('Manhole').within(8).nearest();
        if (!up) {
            log('drainLeg: LIVE-VERIFY — no Climb-up/Manhole at the sewer landing (3237,9858); confirm the Varrock-sewer exit');
            return false;
        }
        const op = up.actions().find(a => /climb.?up/i.test(a)) ?? up.actions()[0];
        if (op) { await up.interact(op); }
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && !isUnderground(t); }, 12_000);
        return false;
    }

    if (heldId(DRAIN_KEY_ID)) {
        return true;
    }
    if (Inventory.contains('Bucket of water')) {
        if (!(await Traversal.walkResilient(DRAIN_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const drain = Locs.query().name('Drain').within(8).nearest();
        const bucket = Inventory.first('Bucket of water');
        if (drain && bucket) {
            await bucket.useOn(drain);
            await Execution.delayUntil(() => !Inventory.contains('Bucket of water'), 6000);
        }
        if (!(await Traversal.walkResilient(MANHOLE_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const closed = Locs.query().name('Manhole').action('Open').within(6).nearest();
        if (closed) {
            await closed.interact('Open');
            await Execution.delayTicks(2);
        }
        const open = Locs.query().name('Manhole').action('Climb down').within(6).nearest();
        if (open) {
            await open.interact('Climb down');
            await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && isUnderground(t); }, 12_000);
        } else {
            log('drainLeg: no open Manhole to Climb down — retrying the Open next pass');
        }
        return false;
    }
    if (Inventory.contains('Bucket')) {
        if (!(await Traversal.walkResilient(SINK_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const sink = Locs.query().name('Sink').within(8).nearest();
        const bucket = Inventory.first('Bucket');
        if (sink && bucket) {
            await bucket.useOn(sink);
            await Execution.delayUntil(() => Inventory.contains('Bucket of water'), 6000);
        }
        return false;
    }
    await executeStep({ kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 }, [], log);
    return false;
}

async function keyHunt(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    if (isUnderground(here)) {
        return drainLeg(log);
    }

    const hasRovin = heldId(ROVIN_KEY_ID);
    const hasTraiborn = heldId(TRAIBORN_KEY_ID);
    const hasDrain = heldId(DRAIN_KEY_ID);

    if (hasRovin && hasTraiborn && hasDrain) {
        if (!(await gotoNpc(PRYSIN, [], log))) { return false; }
        await talkThrough('Sir Prysin', PRYSIN.prefer, log);
        return Execution.delayUntil(() => Inventory.contains('Silverlight'), 6000);
    }

    if (!hasRovin && !hasTraiborn && !hasDrain) {
        if (!(await gotoNpc(PRYSIN, [], log))) { return false; }
        await talkThrough('Sir Prysin', PRYSIN.prefer, log);
    }

    if (!hasRovin) {
        if (!(await gotoNpc(ROVIN, [], log))) { return false; }
        await talkThrough('Captain Rovin', ROVIN.prefer, log);
        return Execution.delayUntil(() => heldId(ROVIN_KEY_ID), 6000);
    }

    if (!hasTraiborn) {
        const level = Game.tile()?.level ?? 0;
        const bones = Inventory.count('Bones');

        if (!(bones > 0 && Inventory.isFull())) {
            if (level === 1) {
                await Reach.locOp({
                    name: 'Staircase', op: 'Climb-down', near: WIZ_L1_STAND,
                    expect: () => (Game.tile()?.level ?? 0) === 0, log
                });
                return false;
            }
            return grindWizards(log);
        }

        if (level !== 1) {
            const climbed = await Reach.locOp({
                name: 'Staircase',
                op: 'Climb-up',
                near: WIZ_INSIDE_STAND,
                expect: () => (Game.tile()?.level ?? 0) >= 1,
                log
            });
            if (climbed === 'unreachable') {
                log('demon: tower staircase unreachable — re-entering to re-plan');
            }
            return false;
        }
        if ((await Reach.npcDialog({ name: 'Traiborn', near: TRAIBORN.anchor, log })) !== 'done') {
            return false;
        }
        const beforeHand = Inventory.count('Bones');
        await talkThrough('Traiborn', TRAIBORN.prefer, log);
        await Execution.delayTicks(2);
        if (Inventory.count('Bones') < beforeHand || ChatDialog.isOpen()) {
            let lastBones = Inventory.count('Bones');
            let settled = 0;
            for (let i = 0; i < 60 && !heldId(TRAIBORN_KEY_ID); i++) {
                if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                await Execution.delayTicks(1);
                const now = Inventory.count('Bones');
                settled = (!ChatDialog.isOpen() && now === lastBones) ? settled + 1 : 0;
                lastBones = now;
                if (settled >= 8) { break; }
            }
        }
        return false;
    }

    if (!hasDrain) {
        return drainLeg(log);
    }
    return false;
}

async function fightDelrith(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains('Silverlight')) {
        if (Inventory.contains('Silverlight')) { await Equipment.equip('Silverlight'); }
        return false;
    }
    if (!ChatDialog.canContinue() && ChatDialog.options().length === 0) {
        if (!(await Traversal.walkResilient(DELRITH_TILE, { radius: 4, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const delrith = Npcs.query().name('Delrith').action('Attack').within(12).nearest();
        if (delrith) {
            await delrith.interact('Attack');
        } else if (Npcs.query().name('Weakened Delrith').within(12).nearest() === null) {
            log('fightDelrith: no Delrith at the stone circle (3229,3369) — LIVE-VERIFY the spawn');
            return false;
        }
    }
    return driveIncantation(log);
}

async function driveIncantation(_log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
        if (Quests.status('Demon Slayer') === 'complete') {
            return true;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const inc = opts.find(o => o.toLowerCase().includes(INCANTATION.toLowerCase()));
            await ChatDialog.chooseOption(inc ?? opts[opts.length - 1]);
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (!Game.inCombat()) {
            const d = Npcs.query().name('Delrith').action('Attack').within(12).nearest();
            if (d) {
                await d.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue() || ChatDialog.options().length > 0, 5000);
                continue;
            }
        }
        await Execution.delayTicks(2);
    }
    return Quests.status('Demon Slayer') === 'complete';
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: GYPSY }; }

    if (worn(snap, 'Silverlight')) { return { kind: 'custom', name: 'fight Delrith', run: fightDelrith }; }
    if (has(snap, 'Silverlight')) { return { kind: 'equip', item: 'Silverlight' }; }

    return { kind: 'custom', name: 'key hunt', run: keyHunt };
}

export const demonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'demon')!,
    bank: new Tile(3185, 3440, 0),
    food: 10,
    grind: ['delrith', 'weakened delrith', 'dark wizard', 'wizard'],
    gather: {
        'bucket of water': fillBucket,
        'bones': () => ({ kind: 'custom', name: 'grind bones', run: grindWizards })
    },
    tools: ['key', 'silverlight', 'bucket', 'bones', 'coins'],
    decide
};
