import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory, type InvItem } from '../../api/hud/Inventory.js';
import { Skills } from '../../api/hud/Skills.js';
import { Sustain } from '../../api/Sustain.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { QuestFood } from '../food.js';

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
const VARROCK_FUNDING_MAN = new Tile(3240, 3405, 0);
const AL_KHARID_FUNDING_MAN = new Tile(3279, 3188, 0);
const KEBAB_SELLER = new Tile(3272, 3182, 0);

export const GOBLIN_MAIL_FOOD_TARGET = 20;
export const GOBLIN_MAIL_FOOD_RESTOCK_FLOOR = 4;
export const GOBLIN_DIPLOMACY_COIN_TARGET = 200;
export const GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE = 100;
const FALLBACK_FOOD = 'Kebab';
const AL_KHARID_TOLL = 10;
const AL_KHARID_ENTRY_CASH = AL_KHARID_TOLL + 3;
const GOBLIN_DIPLOMACY_FUNDING_TARGET = GOBLIN_DIPLOMACY_COIN_TARGET + AL_KHARID_TOLL;
const FUNDING_MAN_LEASH = 24;
const SAFE_PICKPOCKET_HP = 3;
const FUNDING_STALL_MS = 120_000;
const FUNDING_REGEN_WAIT_MS = 60_000;
const GOBLIN_REATTACK_MS = 5000;
const GOBLIN_REJECT_MS = 15_000;
const GOBLIN_DISENGAGE_GRACE_MS = 5000;
let goblinMailTargetIndex: number | null = null;
let goblinMailTargetEngaged = false;
let goblinMailLastAttackAt = 0;
let goblinMailDisengagedAt = 0;
let goblinMailRejectedTargetIndex: number | null = null;
let goblinMailRejectedUntil = 0;
let goblinMailOwner: string | null = null;

function releaseGoblinMailTarget(): void {
    goblinMailTargetIndex = null;
    goblinMailTargetEngaged = false;
    goblinMailLastAttackAt = 0;
    goblinMailDisengagedAt = 0;
}

function resetGoblinMailCombat(): void {
    releaseGoblinMailTarget();
    goblinMailRejectedTargetIndex = null;
    goblinMailRejectedUntil = 0;
}

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const qty = (snap: QuestSnapshot, name: string): number => snap.inv.get(name) ?? 0;

function combatFoodNames(): string[] {
    const configured = QuestFood.name?.trim();
    return [...new Map([configured, FALLBACK_FOOD].filter((name): name is string => Boolean(name)).map(name => [name.toLowerCase(), name])).values()];
}

function combatFoodCount(snap: QuestSnapshot): number {
    return combatFoodNames().reduce((total, food) => total + qty(snap, food.toLowerCase()), 0);
}

function liveCombatFoodCount(): number {
    return combatFoodNames().reduce((total, food) => total + Inventory.count(food), 0);
}

function liveItem(name: string): InvItem | null {
    return Inventory.items().find(item => item.name?.toLowerCase() === name.toLowerCase()) ?? null;
}

function inGoblinMailField(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.level === GOBLIN_FARM.level && Math.max(Math.abs(tile.x - GOBLIN_FARM.x), Math.abs(tile.z - GOBLIN_FARM.z)) <= 18;
}

function inAlKharidFundingArea(tile: ReturnType<typeof Game.tile>): boolean {
    return tile !== null && tile.level === 0 && tile.x >= 3230 && tile.x <= 3330 && tile.z >= 3120 && tile.z <= 3227;
}

function fundingMan(anchor: Tile) {
    return Npcs.query()
        .name('Man')
        .action('Pickpocket')
        .where(npc => npc.tile().distanceTo(anchor) <= FUNDING_MAN_LEASH)
        .nearest();
}

async function reachFundingMan(anchor: Tile, log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(anchor, { radius: 6, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (fundingMan(anchor) || (await Execution.delayUntil(() => fundingMan(anchor) !== null, 15_000))) {
        return true;
    }
    log(`no pickpocketable Man returned within ${FUNDING_MAN_LEASH} tiles of (${anchor.x},${anchor.z})`);
    return false;
}

async function clearFundingDialog(): Promise<void> {
    for (let pages = 0; pages < 12 && ChatDialog.canContinue(); pages++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
}

async function pickpocketFundingMan(anchor: Tile, log: (message: string) => void): Promise<boolean> {
    let man = fundingMan(anchor);
    if (!man) {
        if (!(await reachFundingMan(anchor, log))) {
            return false;
        }
        man = fundingMan(anchor);
    }
    if (!man) {
        return false;
    }

    const coinsBefore = Inventory.count('Coins');
    const xpBefore = Skills.xp('thieving');
    const hpBefore = Skills.effective('hitpoints');
    if (!(await man.interact('Pickpocket'))) {
        await Execution.delayTicks(2);
        return true;
    }
    const resolved = await Execution.delayUntil(() => Inventory.count('Coins') > coinsBefore || Skills.xp('thieving') > xpBefore || Skills.effective('hitpoints') < hpBefore || ChatDialog.canContinue(), 8000);
    if (!resolved) {
        log(`pickpocketing Man at ${man.tile()} produced no coin, XP, health, or dialogue change`);
        await Execution.delayTicks(2);
        return true;
    }
    await clearFundingDialog();
    if (Skills.effective('hitpoints') < hpBefore) {
        await Execution.delayTicks(8);
    }
    return true;
}

async function buyOneKebab(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const seller = Npcs.query().name('Kebab seller').action('Talk-to').within(8).nearest();
    if (!seller) {
        log(`no talkable Kebab seller near (${KEBAB_SELLER.x},${KEBAB_SELLER.z})`);
        return false;
    }
    const before = Inventory.count(FALLBACK_FOOD);
    if (!(await seller.interact('Talk-to'))) {
        return false;
    }
    for (let step = 0; step < 40; step++) {
        if (Inventory.count(FALLBACK_FOOD) > before) {
            return true;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const yes = options.find(option => option.trim().toLowerCase() === 'yes please.');
            if (!yes || !(await ChatDialog.chooseOption(yes))) {
                log(`Kebab seller offered unexpected options: [${options.join(' | ')}]`);
                return false;
            }
        }
        await Execution.delayTicks(1);
    }
    log('Kebab seller did not complete a purchase within 40 dialogue steps');
    return false;
}

async function eatFundingKebab(): Promise<boolean> {
    const kebab = liveItem(FALLBACK_FOOD);
    if (!kebab) {
        return false;
    }
    const before = Inventory.count(FALLBACK_FOOD);
    if (!(await kebab.interact('Eat'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(FALLBACK_FOOD) < before, 5000);
}

async function eatCarriedCombatFood(): Promise<boolean> {
    const item = Inventory.items().find(candidate => {
        const name = candidate.name?.toLowerCase();
        return name !== undefined && combatFoodNames().some(food => food.toLowerCase() === name) && candidate.actions().some(action => /^(eat|drink)$/i.test(action));
    });
    if (!item) {
        return false;
    }
    const action = item.actions().find(candidate => /^(eat|drink)$/i.test(candidate));
    if (!action) {
        return false;
    }
    const before = liveCombatFoodCount();
    if (!(await item.interact(action))) {
        return false;
    }
    return Execution.delayUntil(() => liveCombatFoodCount() < before, 5000);
}

async function restoreFundingHealth(canBuyKebabs: boolean, log: (message: string) => void): Promise<boolean> {
    while (Skills.effective('hitpoints') < SAFE_PICKPOCKET_HP) {
        if (await eatCarriedCombatFood()) {
            continue;
        }
        if (canBuyKebabs && Inventory.count('Coins') > 0) {
            if (!(await buyOneKebab(log)) || !(await eatFundingKebab())) {
                return false;
            }
            continue;
        }
        log(`waiting up to ${FUNDING_REGEN_WAIT_MS / 1000}s for ${SAFE_PICKPOCKET_HP} Hitpoints before another Man pickpocket`);
        if (!(await Execution.delayUntil(() => Skills.effective('hitpoints') >= SAFE_PICKPOCKET_HP, FUNDING_REGEN_WAIT_MS))) {
            log(`still below ${SAFE_PICKPOCKET_HP} Hitpoints with no usable food or Kebab funds — pausing funding`);
            return false;
        }
    }
    return true;
}

async function farmFundingCoins(anchor: Tile, target: number, canBuyKebabs: boolean, log: (message: string) => void): Promise<boolean> {
    if (!(await reachFundingMan(anchor, log))) {
        return false;
    }
    let reportedHundreds = Math.floor(Inventory.count('Coins') / 100);
    let lastEvidenceAt = performance.now();
    while (Inventory.count('Coins') < target) {
        const coinsBefore = Inventory.count('Coins');
        const xpBefore = Skills.xp('thieving');
        const hpBefore = Skills.effective('hitpoints');
        if (!(await restoreFundingHealth(canBuyKebabs, log)) || !(await pickpocketFundingMan(anchor, log))) {
            return false;
        }
        if (Inventory.count('Coins') !== coinsBefore || Skills.xp('thieving') !== xpBefore || Skills.effective('hitpoints') !== hpBefore) {
            lastEvidenceAt = performance.now();
        } else if (performance.now() - lastEvidenceAt >= FUNDING_STALL_MS) {
            log(`no cash, Thieving XP, or Hitpoints change for ${FUNDING_STALL_MS / 1000}s at the verified Man`);
            return false;
        }
        const hundreds = Math.floor(Inventory.count('Coins') / 100);
        if (hundreds > reportedHundreds) {
            reportedHundreds = hundreds;
            log(`Goblin Diplomacy funding: ${Inventory.count('Coins')}/${target} gp`);
        }
    }
    return true;
}

async function earnGoblinDiplomacyCoins(log: (message: string) => void): Promise<boolean> {
    if (Inventory.count('Coins') >= GOBLIN_DIPLOMACY_FUNDING_TARGET) {
        return true;
    }
    if (!inAlKharidFundingArea(Game.tile())) {
        if (Inventory.count('Coins') < AL_KHARID_ENTRY_CASH) {
            log(`earning ${AL_KHARID_ENTRY_CASH} gp for the Al Kharid toll and a food reserve`);
            if (!(await farmFundingCoins(VARROCK_FUNDING_MAN, AL_KHARID_ENTRY_CASH, false, log))) {
                return false;
            }
        }
        if (!(await Traversal.walkResilient(AL_KHARID_FUNDING_MAN, { radius: 6, attempts: 4, timeoutMs: 240_000, log }))) {
            return false;
        }
        if (!inAlKharidFundingArea(Game.tile())) {
            log('did not cross the Al Kharid toll gate into the verified Man/Kebab area');
            return false;
        }
    }

    log(`pickpocketing the Al Kharid Man to ${GOBLIN_DIPLOMACY_FUNDING_TARGET} gp, buying exact Kebabs when hurt`);
    return farmFundingCoins(AL_KHARID_FUNDING_MAN, GOBLIN_DIPLOMACY_FUNDING_TARGET, true, log);
}

async function buyGoblinMailFood(log: (message: string) => void): Promise<boolean> {
    if (Inventory.count('Coins') < GOBLIN_DIPLOMACY_COIN_TARGET && !(await earnGoblinDiplomacyCoins(log))) {
        return false;
    }
    if (liveCombatFoodCount() >= GOBLIN_MAIL_FOOD_TARGET) {
        return true;
    }
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 4, timeoutMs: 240_000, log }))) {
        return false;
    }
    while (liveCombatFoodCount() < GOBLIN_MAIL_FOOD_TARGET) {
        if (Inventory.count('Coins') < 1 || Inventory.isFull() || !(await buyOneKebab(log))) {
            return false;
        }
    }
    return true;
}

function foodAcquisitionSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const mail = ['goblin mail', 'orange goblin mail', 'blue goblin mail'];
    const withFood = ['coins', ...mail, ...combatFoodNames().map(name => name.toLowerCase())];
    const hasSpillover = [...snap.inv.keys()].some(name => !withFood.includes(name.toLowerCase()));
    return {
        kind: 'deposit',
        keep: hasSpillover ? withFood : ['coins', ...mail],
        bank: goblindiplomacy.bank,
        exactKeep: true
    };
}

export function goblinMailGatherStep(snap: QuestSnapshot, need = 1): QuestStep {
    const carriedFood = combatFoodCount(snap);
    const heldCoins = qty(snap, 'coins');
    const foodReady = inGoblinMailField(snap.tile) ? carriedFood > GOBLIN_MAIL_FOOD_RESTOCK_FLOOR : carriedFood >= GOBLIN_MAIL_FOOD_TARGET;
    if (!inGoblinMailField(snap.tile) || !foodReady) {
        resetGoblinMailCombat();
    }
    if (foodReady) {
        const makeMailSpace = foodAcquisitionSpace(snap, Math.max(1, need) + (heldCoins > 0 ? 0 : 1));
        if (makeMailSpace) {
            return makeMailSpace;
        }
        if (heldCoins >= GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE) {
            return { kind: 'custom', name: 'farm goblin mail', run: farmGoblinMail };
        }
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: goblindiplomacy.bank };
    }

    const missingFood = Math.max(0, GOBLIN_MAIL_FOOD_TARGET - carriedFood);
    const makeSupplySpace = foodAcquisitionSpace(snap, missingFood + Math.max(1, need) + (heldCoins > 0 ? 0 : 1));
    if (makeSupplySpace) {
        return makeSupplySpace;
    }
    for (const food of combatFoodNames()) {
        const banked = snap.bank?.get(food.toLowerCase()) ?? 0;
        if (banked > 0) {
            return {
                kind: 'withdraw',
                items: [{ name: food, qty: Math.min(missingFood, banked) }],
                bank: goblindiplomacy.bank
            };
        }
    }
    if (heldCoins < GOBLIN_DIPLOMACY_COIN_TARGET && snap.bankCoins > 0) {
        return {
            kind: 'withdraw',
            items: [
                {
                    name: 'Coins',
                    qty: Math.min(GOBLIN_DIPLOMACY_COIN_TARGET - heldCoins, snap.bankCoins)
                }
            ],
            bank: goblindiplomacy.bank
        };
    }
    return {
        kind: 'custom',
        name: heldCoins < GOBLIN_DIPLOMACY_COIN_TARGET ? `earn ${GOBLIN_DIPLOMACY_COIN_TARGET} gp and buy combat food` : `buy ${missingFood} combat Kebabs`,
        run: buyGoblinMailFood
    };
}

async function farmGoblinMail(log: (m: string) => void): Promise<boolean> {
    const owner = Game.myName();
    if (goblinMailOwner !== owner || !inGoblinMailField(Game.tile())) {
        resetGoblinMailCombat();
        goblinMailOwner = owner;
    }
    const drop = GroundItems.query().name('Goblin mail').within(15).nearest();
    if (drop) {
        resetGoblinMailCombat();
        const before = Inventory.count('Goblin mail');
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count('Goblin mail') > before, 6000);
    }
    const rejectGoblin = (goblin: Npc): void => {
        goblinMailRejectedTargetIndex = goblin.index;
        goblinMailRejectedUntil = performance.now() + GOBLIN_REJECT_MS;
        releaseGoblinMailTarget();
    };
    const trackedGoblin = (): Npc | null => goblinMailTargetIndex === null
        ? null
        : (Npcs.all().find(npc => npc.index === goblinMailTargetIndex
            && npc.name === 'Goblin'
            && npc.actions().some(action => /^attack$/i.test(action))
            && npc.distance() <= 15
            && npc.tile().distanceTo(GOBLIN_FARM) <= 18) ?? null);
    const hadEngagedTarget = goblinMailTargetIndex !== null && goblinMailTargetEngaged;
    let goblin = trackedGoblin();
    if (!goblin && hadEngagedTarget) {
        await Sustain.run();
        await Execution.delayTicks(2);
        releaseGoblinMailTarget();
        return false;
    }
    const attacker = Npcs.query().name('Goblin').action('Attack').within(15)
        .where(npc => npc.targetsMe() && npc.tile().distanceTo(GOBLIN_FARM) <= 18).nearest();
    if (attacker && (attacker.index !== goblinMailTargetIndex || goblin === null)) {
        goblinMailTargetIndex = attacker.index;
        goblinMailTargetEngaged = false;
        goblinMailLastAttackAt = 0;
        goblinMailDisengagedAt = 0;
        goblin = attacker;
        log(`Goblin ${attacker.index} attacked first — switching the lock to it`);
    }
    if (goblin && (!goblin.valid() || (goblin.health === 0 && goblin.snap.totalHealth > 0))) {
        await Sustain.run();
        await Execution.delayTicks(2);
        releaseGoblinMailTarget();
        return false;
    }
    if (goblin && (goblin.targetsAnotherPlayer()
        || (goblin.inCombat && !goblinMailTargetEngaged && !goblin.targetsMe() && !Game.inCombat()))) {
        log(`Goblin ${goblin.index} belongs to another player — releasing it`);
        rejectGoblin(goblin);
        goblin = null;
    }
    if (goblin && goblinMailTargetEngaged && !Game.inCombat() && !goblin.targetsMe()) {
        if (goblinMailDisengagedAt === 0) {
            goblinMailDisengagedAt = performance.now();
        }
        if (performance.now() - goblinMailDisengagedAt < GOBLIN_DISENGAGE_GRACE_MS) {
            await Sustain.run();
            await Execution.delayTicks(1);
            return false;
        }
        log(`combat with live Goblin ${goblin.index} made no progress for ${GOBLIN_DISENGAGE_GRACE_MS / 1000}s — choosing another target`);
        rejectGoblin(goblin);
        goblin = null;
    }
    if (!goblin) {
        const rejectedIndex = performance.now() < goblinMailRejectedUntil ? goblinMailRejectedTargetIndex : null;
        goblin = Npcs.query().name('Goblin').action('Attack').within(15)
            .where(n => !n.inCombat && !n.targetsAnotherPlayer() && n.index !== rejectedIndex).nearest();
        if (goblin) {
            goblinMailTargetIndex = goblin.index;
            goblinMailTargetEngaged = false;
            goblinMailLastAttackAt = 0;
            goblinMailDisengagedAt = 0;
            log(`holding Goblin ${goblin.index} until it dies`);
        }
    }
    if (goblin) {
        if (Game.inCombat() || goblin.targetsMe()) {
            goblinMailTargetEngaged = true;
            goblinMailDisengagedAt = 0;
            await Sustain.run();
            await Execution.delayTicks(1);
            return false;
        }
        if (performance.now() - goblinMailLastAttackAt < GOBLIN_REATTACK_MS) {
            await Sustain.run();
            await Execution.delayTicks(2);
            return false;
        }
        if (!(await goblin.interact('Attack'))) {
            log(`Attack on Goblin ${goblin.index} was rejected — choosing another target`);
            rejectGoblin(goblin);
            await Execution.delayTicks(2);
            return false;
        }
        goblinMailLastAttackAt = performance.now();
        const attackDeadline = performance.now() + 8000;
        let attackObserved = false;
        while (performance.now() < attackDeadline) {
            await Sustain.run();
            const live = trackedGoblin();
            if (live === null || Game.inCombat() || live.targetsMe() || live.targetsAnotherPlayer()) {
                attackObserved = true;
                break;
            }
            await Execution.delayTicks(1);
        }
        if (!attackObserved) {
            log(`Attack on Goblin ${goblin.index} produced no combat within 8s — choosing another target`);
            rejectGoblin(goblin);
            return false;
        }
        const live = trackedGoblin();
        if (live?.targetsAnotherPlayer()) {
            log(`Goblin ${live.index} engaged another player after our attack — releasing it`);
            rejectGoblin(live);
            return false;
        }
        if (live === null) {
            releaseGoblinMailTarget();
            return false;
        }
        goblinMailTargetEngaged ||= Game.inCombat() || live.targetsMe();
        if (goblinMailTargetEngaged) {
            goblinMailDisengagedAt = 0;
        }
        return false;
    }
    releaseGoblinMailTarget();
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
    if (snap.journal === 'complete') {
        resetGoblinMailCombat();
        goblinMailOwner = null;
        return { kind: 'done' };
    }
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
    sustain: { foods: [FALLBACK_FOOD], eatBelowHp: 0.6 },
    get tools() {
        return ['goblin mail', 'dye', 'woad', 'redberries', 'onion', 'coins', ...combatFoodNames().map(name => name.toLowerCase())];
    },
    grind: ['Goblin'],
    gather: {
        'goblin mail': goblinMailGatherStep,
        'orange dye': () => ({ kind: 'custom', name: 'make orange dye', run: makeOrangeDye }),
        'blue dye': () => ({ kind: 'custom', name: 'make blue dye', run: makeBlueDye })
    },
    decide
};
