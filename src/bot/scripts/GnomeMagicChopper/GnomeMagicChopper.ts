import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { AXES, bestAxe, canWieldTool } from '../../api/acquisition/Tools.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Loc } from '../../api/model/Loc.js';
import { Npc } from '../../api/model/Npc.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Players } from '../../api/players/Players.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

/** Chops every Magic tree in Tree Gnome Stronghold; optional fletch to short/longbows; death recovery via Lumbridge and boats. */

export const GNOME_MAGIC_CHOPPER_SETTINGS: SettingsSchema = {
    fletchLogs: {
        type: 'boolean',
        default: true,
        label: 'Fletch logs into bows',
        group: 'Fletching',
        help: 'When on: fletch magic shortbows at 80 / longbows at 85 (needs a Knife), then bank those. When off: bank the logs. Missing Knife at the gnome bank stops the script.'
    }
};

type MaybeTile = WorldTile | Tile | null | undefined;

interface FletchPlan {
    id: string;
    menuMatch: string;
    label: string;
    bank: boolean;
    fletch: boolean;
}

/** West terrorbird pen, south-bank, and east agility Magic trees. */
const TREE_PINS = [
    { id: 'west', name: 'west magics (terrorbirds)', tile: new Tile(2372, 3425, 0) },
    { id: 'bank', name: 'south-bank magics', tile: new Tile(2433, 3410, 0) },
    { id: 'east', name: 'east magics (agility)', tile: new Tile(2491, 3413, 0) }
];

/** Walk here first if we spawn south of the stronghold gates. */
const GNOME_ENTRANCE = new Tile(2461, 3381, 0);

const TREE_NAME = 'Magic tree';
const SHORTBOW_LEVEL = 80;
const LONGBOW_LEVEL = 85;
const CHOP_REACH = 8;
const TREE_SEARCH_REACH = 80;

const BANK_STAND = new Tile(2445, 3425, 1);
const BANK_STAIR_SOUTH = new Tile(2444, 3416, 0);
const BANK_STAIR_NORTH = new Tile(2445, 3443, 0);
const BANK_STAIR_PINS = [BANK_STAIR_SOUTH, BANK_STAIR_NORTH];
const BANK_STAIR_RADIUS = 5;
const BANK_BOOTH_REACH = 6;

const GEAR_BOB_STAND = new Tile(3231, 3203, 0);
const GEAR_KNIFE_SPAWN = new Tile(3224, 3202, 0);
const GEAR_STEEL_AXE = 'Steel axe';
const GEAR_STEEL_COST = 250;
const GEAR_BROKEN_AXE = 'Broken axe';

const DEATH_RE = /oh dear.*you are dead/i;
const DEATH_GP = 500;

const PICKPOCKET_OP = 'Pickpocket';
const TALK_OP = 'Talk-to';
const STUN_RE = /been stunned|fail to pick/i;
const STUN_TICKS = 9;
const GP_TARGET = 60;
const MIN_HP = 5;

const LUMBY_MEN = new Tile(3222, 3218, 0);
const LUMBY_LEASH = 16;
const PORT_SARIM_DOCK = new Tile(3029, 3217, 0);
const BRIMHAVEN_DOCK = new Tile(2772, 3227, 0);

const SARIM_SAILORS = ['Captain Tobias', 'Seaman Lorris', 'Seaman Thresnor'];
const BRIM_SAILORS = ['Customs officer', 'Customs Officer', 'Captain Barnaby'];

const KARAMJA_DIALOG_PREFER = ['musa point', 'karamja', 'yes please', 'yes'];
const ARDOUGNE_DIALOG_PREFER = [
    'search away',
    'nothing to hide',
    'can i journey',
    'journey on this ship',
    'ardougne',
    "i'd like to go to ardougne",
    'ok',
    'okay',
    'yes please',
    'yes'
];
const FEMI_DIALOG_PREFER = ['yes', 'ok', 'okay', 'help', 'please'];
const DIALOG_AVOID = [
    'no, thank',
    'no thank',
    "i'm good",
    'nowhere',
    'rimmington',
    'pandemonium',
    'actually, i don',
    'pay you nothing',
    'not bother',
    'unusual customs',
    'personal use',
    "you're not putting",
    'why?'
];

const PHASE = {
    THIEVE: 'thieve',
    WALK_SARIM: 'walk_sarim',
    BOAT_KARAMJA: 'boat_karamja',
    WALK_BRIMHAVEN: 'walk_brimhaven',
    BOAT_ARDOUGNE: 'boat_ardougne',
    DONE: 'done'
} as const;

type Phase = (typeof PHASE)[keyof typeof PHASE];

const RECOVER = {
    NONE: 'none',
    KNIFE: 'knife',
    BANK_GP: 'bank_gp',
    BUY_AXE: 'buy_axe',
    BANK_TOOLS: 'bank_tools',
    TRAVEL: 'travel',
    RESTOCK: 'restock'
} as const;

type Recover = (typeof RECOVER)[keyof typeof RECOVER];

const KEEP_KNIFE = 'knife';
const KEEP_BROKEN_AXE = 'broken axe';

function inBox(tile: MaybeTile, x0: number, z0: number, x1: number, z1: number) {
    if (!tile) {
        return false;
    }
    const x = tile.x;
    const z = tile.z;
    return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= Math.min(z0, z1) && z <= Math.max(z0, z1);
}

function cheb(a: WorldTile, b: WorldTile) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function playerFloor(tile: MaybeTile = Game.tile()) {
    return tile ? (tile.level ?? 0) : 0;
}

function isUpstairs(tile: MaybeTile = Game.tile()) {
    return playerFloor(tile) >= 1;
}

/** Tree Gnome Stronghold, including the south gate. */
function inGnomeArea(tile: MaybeTile) {
    return !!tile && inBox(tile, 2360, 3375, 2520, 3520);
}

/** The band that holds the three Magic trees. */
function inTreeBand(tile: MaybeTile) {
    return !!tile && playerFloor(tile) === 0 && inBox(tile, 2360, 3395, 2515, 3455);
}

function regionOf(tile: MaybeTile) {
    if (!tile) {
        return 'unknown';
    }
    if (inGnomeArea(tile)) {
        return 'gnome';
    }
    if (inBox(tile, 2650, 3360, 2760, 3520)) {
        return 'seers';
    }
    if (inBox(tile, 2600, 3260, 2730, 3360)) {
        return 'ardougne';
    }
    if (inBox(tile, 2740, 3140, 2820, 3290)) {
        return 'brimhaven';
    }
    if (inBox(tile, 2880, 3100, 2985, 3200)) {
        return 'musa';
    }
    if (inBox(tile, 3005, 3175, 3060, 3260)) {
        return 'sarim';
    }
    if (inBox(tile, 3185, 3185, 3265, 3265)) {
        return 'lumbridge';
    }
    if (inBox(tile, 2820, 3100, 2985, 3290)) {
        return 'karamja';
    }
    return 'unknown';
}

function sameStairPin(a: MaybeTile, b: MaybeTile) {
    return !!a && !!b && a.x === b.x && a.z === b.z;
}

function nearestBankStairPin(tile: MaybeTile, skipPin: MaybeTile = null) {
    const t = tile ? Tile.from(tile) : null;
    if (!t) {
        return skipPin && sameStairPin(BANK_STAIR_NORTH, skipPin) ? BANK_STAIR_SOUTH : BANK_STAIR_NORTH;
    }
    let best: Tile | null = null;
    let bestD = 999;
    for (const pin of BANK_STAIR_PINS) {
        if (skipPin && sameStairPin(pin, skipPin)) {
            continue;
        }
        const d = cheb(t, pin);
        if (d < bestD) {
            best = pin;
            bestD = d;
        }
    }
    return best ?? BANK_STAIR_NORTH;
}

function distToBooths(tile: MaybeTile) {
    if (!tile) {
        return 999;
    }
    return cheb(Tile.from(tile), BANK_STAND);
}

function distToNearestBankStair(tile: MaybeTile) {
    if (!tile) {
        return 999;
    }
    return cheb(Tile.from(tile), nearestBankStairPin(tile));
}

function isAllowedBankStairTile(tile: MaybeTile) {
    return !!tile && distToNearestBankStair(tile) <= BANK_STAIR_RADIUS;
}

function bankStairStand(tile: MaybeTile = Game.tile()) {
    const pin = nearestBankStairPin(tile);
    return new Tile(pin.x, pin.z, playerFloor(tile));
}

function atGnomeBankFloor(tile: MaybeTile = Game.tile()) {
    return isUpstairs(tile) && (distToBooths(tile) <= 8 || distToNearestBankStair(tile) <= 12);
}

function locActions(loc: Loc | null | undefined) {
    if (!loc) {
        return [];
    }
    try {
        if (typeof loc.actions === 'function') {
            return loc.actions() ?? [];
        }
    } catch {
        /* ignore */
    }
    return [];
}

function locName(loc: Loc | null | undefined) {
    return (loc?.name ?? '').toLowerCase();
}

function isBankBoothLoc(loc: Loc) {
    const n = locName(loc);
    return n.includes('bank booth') || n.includes('bank chest');
}

function boothOp(loc: Loc) {
    const list = locActions(loc);
    return (
        list.find(a => /use-quickly/i.test(String(a))) ??
        list.find(a => /^bank$/i.test(String(a))) ??
        list.find(a => /bank/i.test(String(a))) ??
        null
    );
}

function isClimbLoc(loc: Loc) {
    const n = locName(loc);
    return n.includes('stair') || n.includes('ladder');
}

function climbDownOp(loc: Loc) {
    const list = locActions(loc);
    return (
        list.find(a => /climb.*down/i.test(String(a))) ??
        list.find(a => /^climb$/i.test(String(a))) ??
        null
    );
}

function climbUpOp(loc: Loc) {
    const list = locActions(loc);
    return (
        list.find(a => /climb.*up/i.test(String(a))) ??
        list.find(a => /^climb$/i.test(String(a))) ??
        null
    );
}

function openOp(loc: Loc) {
    return locActions(loc).find(a => /^open/i.test(String(a))) ?? null;
}

function isShutDoor(loc: Loc) {
    const name = locName(loc);
    if (!name.includes('door') && !name.includes('gate')) {
        return false;
    }
    return locActions(loc).some(a => /^open/i.test(String(a)));
}

function dialogAvoid(opt: string | null | undefined) {
    const low = (opt ?? '').toLowerCase();
    return DIALOG_AVOID.some(a => low.includes(a));
}

function pickBoatOption(options: string[], prefer: string | readonly string[]) {
    const prefs = Array.isArray(prefer) ? prefer : [prefer];
    const usable = options.filter(o => !dialogAvoid(o));
    const pool = usable.length > 0 ? usable : options;
    for (const p of prefs) {
        const hit = pool.find(o => (o ?? '').toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    const yes = pool.find(o => /^yes/i.test(o ?? ''));
    if (yes) {
        return yes;
    }
    return pool.length > 0 ? pool[0] : null;
}

function dialogOpen() {
    if (ChatDialog.canContinue()) {
        return true;
    }
    return (
        typeof ChatDialog.isOpen === 'function' &&
        ChatDialog.isOpen() &&
        typeof ChatDialog.options === 'function' &&
        ChatDialog.options().length > 0
    );
}

function talkOp(npc: Npc) {
    const acts = typeof npc.actions === 'function' ? npc.actions() : [];
    return acts.find(a => /^talk/i.test(a ?? '')) ?? TALK_OP;
}

function fmtXph(n: number) {
    if (n >= 100_000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    if (n >= 10_000) {
        return `${(n / 1000).toFixed(1)}k`;
    }
    return String(Math.round(n));
}

function gearHasKnife() {
    return (
        Inventory.count('Knife') > 0 ||
        Inventory.items().some(i => (i.name ?? '').toLowerCase() === 'knife')
    );
}

function gearInvCoins() {
    return Inventory.items()
        .filter(i => (i.name ?? '').toLowerCase() === 'coins')
        .reduce((n, i) => n + Math.max(0, i.count), 0);
}

function gearBankCoins() {
    return Bank.count('Coins') || 0;
}

function gearAxeCount(name: string) {
    return (Inventory.count(name) || 0) + (Equipment.contains(name) ? 1 : 0);
}

function gearBestHeldAxe() {
    return bestAxe(Skills.level('woodcutting'), n => gearAxeCount(n) > 0);
}

function gearHasSteelOrBetter() {
    const steelRank = AXES.findIndex(t => t.name.toLowerCase() === GEAR_STEEL_AXE.toLowerCase());
    for (const t of AXES) {
        const rank = AXES.findIndex(x => x.name.toLowerCase() === t.name.toLowerCase());
        if (rank > steelRank) {
            continue;
        }
        if (gearAxeCount(t.name) > 0) {
            return true;
        }
        if (Bank.isOpen() && (Bank.count(t.name) || 0) > 0) {
            return true;
        }
    }
    return false;
}

function gearHasBrokenAxe() {
    return (
        Equipment.contains(GEAR_BROKEN_AXE) ||
        (Inventory.count(GEAR_BROKEN_AXE) || 0) > 0 ||
        Inventory.items().some(i => (i.name ?? '').toLowerCase() === 'broken axe')
    );
}

async function gearWaitBankLoaded() {
    if (typeof Bank.loaded === 'function') {
        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 3000);
    }
    await Execution.delayTicks(1);
}

function chopOp(actions: string[]) {
    return actions.find(a => /chop/i.test(a)) ?? null;
}

function isMagicTreeLoc(loc: Loc) {
    const n = locName(loc);
    if (!n.includes('magic') || !n.includes('tree')) {
        return false;
    }
    if (n.includes('stump') || n.includes('seed') || n.includes('patch')) {
        return false;
    }
    return chopOp(locActions(loc)) !== null;
}

function otherPlayersNear(tile: MaybeTile, dist = 2) {
    if (!tile || typeof Players?.query !== 'function') {
        return 0;
    }
    const t = Tile.from(tile);
    return Players.query()
        .where(p => {
            const pt = p.tile?.() ?? null;
            return pt != null && Tile.from(pt).distanceTo(t) <= dist;
        })
        .count();
}

function isKeepTool(name: string | null | undefined) {
    if (!name) {
        return false;
    }
    const n = name.toLowerCase();
    if (n === KEEP_KNIFE) {
        return true;
    }
    if (n === KEEP_BROKEN_AXE) {
        return true;
    }
    const active = gearBestHeldAxe();
    if (active && n === active.toLowerCase()) {
        return true;
    }
    return false;
}

function hasEssentialsAfterBank(needKnife = true) {
    if (needKnife && !gearHasKnife()) {
        return false;
    }
    return gearHasBrokenAxe() || !!gearBestHeldAxe();
}

function nearestTreePin(tile: MaybeTile) {
    const here = tile ? Tile.from(tile) : null;
    if (!here) {
        return TREE_PINS[1];
    }
    let best = TREE_PINS[1];
    let bestD = 9999;
    for (const pin of TREE_PINS) {
        const d = here.distanceTo(pin.tile);
        if (d < bestD) {
            best = pin;
            bestD = d;
        }
    }
    return best;
}

function nextTreePin(currentId: string) {
    const i = TREE_PINS.findIndex(p => p.id === currentId);
    return TREE_PINS[(i < 0 ? 0 : i + 1) % TREE_PINS.length];
}

function pinById(id: string) {
    return TREE_PINS.find(p => p.id === id) ?? TREE_PINS[1];
}

function normName(name: string | null | undefined) {
    return (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isFletchedShortbow(name: string | null | undefined) {
    const n = normName(name);
    if (!n.includes('magic')) {
        return false;
    }
    return n.includes('short') && n.includes('bow');
}

function isFletchedLongbow(name: string | null | undefined) {
    const n = normName(name);
    if (!n.includes('magic')) {
        return false;
    }
    return n.includes('long') && n.includes('bow');
}

function isBankableBow(name: string | null | undefined) {
    return isFletchedShortbow(name) || isFletchedLongbow(name);
}

function isMagicLog(name: string | null | undefined) {
    const n = normName(name);
    return n === 'magic logs' || n === 'magic log';
}

function fletchPlan(level: number, fletchOn = true): FletchPlan {
    if (!fletchOn || level < SHORTBOW_LEVEL) {
        return {
            id: 'logs',
            menuMatch: '',
            label: 'Magic logs (bank)',
            bank: true,
            fletch: false
        };
    }
    if (level < LONGBOW_LEVEL) {
        return {
            id: 'magic-shortbow',
            menuMatch: 'short',
            label: 'Magic shortbow',
            bank: true,
            fletch: true
        };
    }
    return {
        id: 'magic-longbow',
        menuMatch: 'long',
        label: 'Magic longbow',
        bank: true,
        fletch: true
    };
}

function matchMakeProduct(products: string[], menuMatch: string) {
    const want = menuMatch.toLowerCase();
    const magicish = products.filter(p => (p ?? '').toLowerCase().includes('magic'));
    const pool = magicish.length > 0 ? magicish : products;
    return pool.find(p => (p ?? '').toLowerCase().includes(want)) ?? null;
}

function logCount() {
    return Inventory.items()
        .filter(i => isMagicLog(i.name))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

function knifeItem() {
    return Inventory.items().find(i => (i.name ?? '').toLowerCase().includes('knife')) ?? null;
}

function lastLog() {
    const items = Inventory.items();
    for (let i = items.length - 1; i >= 0; i--) {
        if (isMagicLog(items[i].name)) {
            return items[i];
        }
    }
    return null;
}

function bowCount() {
    return Inventory.items()
        .filter(i => isBankableBow(i.name))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

function shortbowCount() {
    return Inventory.items()
        .filter(i => isFletchedShortbow(i.name))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

function needsBankTrip(plan: FletchPlan) {
    if (logCount() > 0 && plan.fletch) {
        return false;
    }
    if (plan.bank && bowCount() > 0) {
        return true;
    }
    if (!plan.fletch && logCount() > 0 && Inventory.isFull()) {
        return true;
    }
    if (plan.fletch && logCount() === 0 && bowCount() > 0) {
        return true;
    }
    return !plan.fletch && logCount() > 0 && Inventory.isFull();
}

export default class GnomeMagicChopper extends LoopingBot {
    status = 'starting';
    startedAt = 0;
    wcXpAtStart = 0;
    fletchXpAtStart = 0;
    chopped = 0;
    fletched = 0;
    bankTrips = 0;
    hops = 0;
    treesUp = 0;
    planId = 'logs';
    gearReady = false;
    treePinId = 'bank';
    deaths = 0;
    died = false;
    recoverPhase: Recover = RECOVER.NONE;
    travelPhase: Phase | null = PHASE.DONE;
    stunnedUntilTick = 0;
    blockedStairPin: Tile | null = null;

    fletchEnabled() {
        return this.settings?.bool('fletchLogs', true) ?? true;
    }

    planAt(level: number) {
        return fletchPlan(level, this.fletchEnabled());
    }

    currentPlan() {
        return this.planAt(Skills.level('fletching'));
    }

    currentPin() {
        return pinById(this.treePinId);
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();

        this.startedAt = Date.now();
        this.wcXpAtStart = Skills.xp('woodcutting');
        this.fletchXpAtStart = Skills.xp('fletching');
        this.planId = this.currentPlan().id;
        this.gearReady = false;
        this.treePinId = nearestTreePin(Game.tile()).id;
        this.deaths = 0;
        this.died = false;
        this.recoverPhase = RECOVER.NONE;
        this.travelPhase = PHASE.DONE;
        this.stunnedUntilTick = 0;
        this.blockedStairPin = null;

        this.on('chat.message', e => {
            if (DEATH_RE.test(e.text) && !this.died) {
                this.died = true;
                this.deaths++;
                this.recoverPhase = RECOVER.KNIFE;
                this.travelPhase = null;
                this.gearReady = false;
                this.status = 'dead';
                this.log(
                    `died (#${this.deaths}), knife spawn → 500gp → Bob → SneakyArdougne → gnome magics`
                );
            }
            if (STUN_RE.test(e.text)) {
                this.stunnedUntilTick = Game.tick() + STUN_TICKS;
            }
        });

        this.on('skill.level', e => {
            if (e.name === 'fletching') {
                const plan = this.planAt(e.level);
                this.log(`fletching ${e.previous} → ${e.level}, now making ${plan.label}`);
                this.planId = plan.id;
            }
            if (e.name === 'woodcutting') {
                this.log(`woodcutting ${e.previous} → ${e.level}`);
            }
        });

        const plan = this.currentPlan();
        const pins = TREE_PINS.map(p => `${p.tile.x},${p.tile.z}`).join(' / ');
        this.log(
            `GnomeMagicChopper, magics at ${pins}, ` +
                (this.fletchEnabled()
                    ? `fletching ${Skills.level('fletching')} → ${plan.label}`
                    : 'banking logs (fletch off)')
        );
        if (Skills.level('woodcutting') < 75) {
            this.log(`WARNING: Woodcutting ${Skills.level('woodcutting')} < 75, Magic trees may refuse chops`);
        }
        this.status = 'ready';
    }

    override async loop(): Promise<void> {
        if (!Game.ingame()) {
            await Execution.delayTicks(5);
            return;
        }
        if (this.died) {
            await this.waitForRespawn();
            return;
        }

        if (this.recoverPhase !== RECOVER.NONE) {
            await this.recoverFromDeath();
            return;
        }

        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            return;
        }

        if (await this.handleFemiDialog()) {
            return;
        }

        if (isUpstairs() && !needsBankTrip(this.currentPlan()) && this.gearReady) {
            this.status = 'leaving bank stairs';
            await this.leaveBankStairs();
            return;
        }

        if (await this.prepWcGear()) {
            return;
        }

        if (Shop.isOpen()) {
            await Shop.close();
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
            return;
        }

        const plan = this.currentPlan();
        this.planId = plan.id;

        if (ChatDialog.isMakeMenu()) {
            if (plan.fletch) {
                await this.chooseMakeProduct(plan);
            }
            return;
        }

        if (plan.fletch && logCount() > 0 && Inventory.isFull()) {
            await this.fletchLogs(plan);
            return;
        }

        if (
            plan.fletch &&
            logCount() > 0 &&
            Game.animating() &&
            bowCount() === 0 &&
            !this.findTreeWithin(2)
        ) {
            this.status = `fletching ${plan.label}`;
            await Execution.delayTicks(1);
            return;
        }

        if (needsBankTrip(plan)) {
            await this.bankProductsAndReturn();
            return;
        }

        if (!plan.fletch && Inventory.isFull() && logCount() > 0) {
            await this.bankProductsAndReturn();
            return;
        }

        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(2);
            return;
        }

        if (isUpstairs(here)) {
            await this.leaveBankStairs();
            return;
        }

        if (!inGnomeArea(here)) {
            this.status = 'walking to Gnome Stronghold';
            this.log(`outside gnome, walking to gate ${GNOME_ENTRANCE.x},${GNOME_ENTRANCE.z}`);
            await Traversal.walkResilient(GNOME_ENTRANCE, {
                radius: 3,
                log: m => this.log(`  ${m}`)
            });
            await this.openNearbyDoor(6);
            return;
        }

        if (Game.animating()) {
            this.status = 'chopping';
            await Execution.delayTicks(1);
            return;
        }

        const tree = this.findTree();
        if (!tree) {
            await this.hopTreePin();
            return;
        }

        const t = tree.tile();
        this.treePinId = nearestTreePin(t).id;

        if (tree.distance() > CHOP_REACH) {
            this.status = `running to magic (${tree.distance()}t)`;
            this.log(`running to Magic tree @ ${t.x},${t.z}`);
            await Traversal.walkResilient(Tile.from(t), {
                radius: 2,
                log: m => this.log(`  ${m}`)
            });
            await this.openNearbyDoor(5);
            return;
        }

        const op = chopOp(tree.actions());
        if (!op) {
            this.log(`Magic tree has no chop action: [${tree.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        const before = logCount();
        const contested = otherPlayersNear(t, 2);
        this.status = contested
            ? `chopping contested (${tree.distance()}t)`
            : `chopping (${tree.distance()}t)`;
        this.log(
            `chopping Magic tree @ ${t.x},${t.z}` +
                (contested ? ` (${contested} other player(s) on it, joining)` : '')
        );
        await tree.interact(op);
        const gotLog = await Execution.delayUntil(
            () => logCount() > before || Game.animating() || ChatDialog.canContinue(),
            8000
        );
        if (logCount() > before) {
            this.chopped += logCount() - before;
        } else if (gotLog && Game.animating()) {
            await Execution.delayUntil(
                () => logCount() > before || !Game.animating() || ChatDialog.canContinue(),
                20_000
            );
            if (logCount() > before) {
                this.chopped += logCount() - before;
            }
        }
    }

    recovering() {
        return this.died || this.recoverPhase !== RECOVER.NONE;
    }

    stunned() {
        return Game.tick() <= this.stunnedUntilTick;
    }

    stopNoKnife(context: string): void {
        this.status = 'no knife, stopped';
        this.log(
            `${context}: no Knife in inventory or gnome bank, stopping ` +
                '(withdraw a Knife, then restart)'
        );
        ScriptRunner.stop(`${context}: no Knife in inventory or gnome bank`);
    }

    stopNoAxe(context: string): void {
        this.status = 'no axe, stopped';
        this.log(
            `${context}: no usable axe in pack or gnome bank, stopping ` +
                '(withdraw an axe your Woodcutting can use, then restart)'
        );
        ScriptRunner.stop(`${context}: no usable axe in pack or gnome bank`);
    }

    /** @returns {Promise<boolean>} true if this loop spent time on gear prep */
    async prepWcGear() {
        if (ChatDialog.isMakeMenu()) {
            return false;
        }

        if (this.gearReady && this.fletchEnabled() && !gearHasKnife()) {
            this.log('gear: Knife missing, checking gnome bank');
            this.gearReady = false;
        }

        if (this.gearReady && !gearBestHeldAxe() && !gearHasBrokenAxe()) {
            this.log('gear: axe missing, checking gnome bank');
            this.gearReady = false;
        }

        if (this.gearReady) {
            return false;
        }

        if (Shop.isOpen()) {
            await Shop.close();
            return true;
        }

        return await this.bootstrapWcGear();
    }

    async bootstrapWcGear() {
        this.status = 'gear: bank';

        if (!inGnomeArea(Game.tile()) && !isUpstairs()) {
            this.log('gear: walking to gnome bank');
            await Traversal.walkResilient(GNOME_ENTRANCE, {
                radius: 3,
                log: m => this.log(`  ${m}`)
            });
            return true;
        }

        if (!Bank.isOpen()) {
            this.log('gear: opening gnome bank for best axe / knife');
            if (!(await this.openGnomeBank())) {
                this.log('gear: could not open gnome bank, retrying');
                await Execution.delayTicks(3);
                return true;
            }
        }

        await gearWaitBankLoaded();

        this.log('gear: depositing all except Knife');
        await Bank.depositAllMatching(name => {
            const n = (name ?? '').toLowerCase();
            return !!n && n !== 'knife';
        });
        await Execution.delayTicks(1);

        const wc = Skills.level('woodcutting');
        const best = bestAxe(wc, n => gearAxeCount(n) > 0 || (Bank.count(n) || 0) > 0);

        if (!best) {
            await Bank.close();
            this.stopNoAxe('gear');
            return true;
        }

        if (gearAxeCount(best) === 0 && (Bank.count(best) || 0) > 0) {
            this.log(`gear: withdrawing ${best}`);
            if (!(await Bank.withdrawX(best, 1))) {
                this.log(`gear: withdraw failed for ${best}`);
                await Execution.delayTicks(2);
                return true;
            }
            await Execution.delayTicks(1);
        }

        if (this.fletchEnabled() && !gearHasKnife()) {
            if ((Bank.count('Knife') || 0) > 0) {
                this.log('gear: withdrawing Knife');
                await Bank.withdrawX('Knife', 1);
                await Execution.delayTicks(1);
            } else {
                await Bank.close();
                this.stopNoKnife('gear');
                return true;
            }
        }

        await Bank.close();
        await Execution.delayTicks(1);

        const held = gearBestHeldAxe();
        if (held && !Equipment.contains(held) && canWieldTool(held, Skills.level('attack'))) {
            this.status = `gear: wield ${held}`;
            this.log(`gear: wielding ${held}`);
            await Equipment.equip(held);
            await Execution.delayTicks(1);
        } else if (held && !canWieldTool(held, Skills.level('attack'))) {
            this.log(`gear: keeping ${held} in pack (Attack too low to wield)`);
        }

        if (this.fletchEnabled() && !gearHasKnife()) {
            this.stopNoKnife('gear');
            return true;
        }

        if (!gearBestHeldAxe()) {
            this.log('gear: still missing axe after bank');
            await Execution.delayTicks(5);
            return true;
        }

        this.gearReady = true;
        this.log(`gear: ready, ${gearBestHeldAxe()}`);
        await this.leaveBankStairs();
        return true;
    }

    queryClimbLocs(): Loc[] {
        let list: Loc[] = [];
        try {
            list = Locs.query()
                .where(l => isClimbLoc(l))
                .results() ?? [];
        } catch {
            list = [];
        }
        if (list.length === 0) {
            const one = Locs.query()
                .where(l => isClimbLoc(l))
                .nearest();
            list = one ? [one] : [];
        }
        return list;
    }

    findClimbLoc(nearTile: MaybeTile, maxDist = 12, dir: 'up' | 'down' | null = null): Loc | null {
        const pin = nearTile ? Tile.from(nearTile) : Game.tile();
        const wantFloor = pin ? (pin.level ?? playerFloor()) : playerFloor();
        const pool = this.queryClimbLocs();
        if (pool.length === 0) {
            return null;
        }
        let best: Loc | null = null;
        let bestD = 99;
        for (const loc of pool) {
            const t = loc.tile?.() ?? null;
            if (!t) {
                continue;
            }
            if (!isAllowedBankStairTile(t)) {
                continue;
            }
            if ((t.level ?? 0) !== wantFloor) {
                continue;
            }
            if (dir === 'up' && !climbUpOp(loc)) {
                continue;
            }
            if (dir === 'down' && !climbDownOp(loc)) {
                continue;
            }
            const d = pin ? cheb(t, pin) : typeof loc.distance === 'function' ? loc.distance() : 99;
            if (d < bestD) {
                best = loc;
                bestD = d;
            }
        }
        return best && bestD <= maxDist ? best : null;
    }

    async openNearbyDoor(within = 4): Promise<boolean> {
        const door =
            Locs.query()
                .where(l => isShutDoor(l))
                .where(l => l.distance() <= within)
                .nearest();
        if (!door) {
            return false;
        }
        const op = openOp(door);
        if (!op) {
            return false;
        }
        this.status = `opening ${door.name}`;
        this.log(`opening ${door.name}`);
        await door.interact(op);
        await Execution.delayTicks(2);
        return true;
    }

    async handleFemiDialog() {
        const here = Game.tile();
        const nearGate = here && Tile.from(here).distanceTo(GNOME_ENTRANCE) <= 12;
        if (!nearGate) {
            return false;
        }
        if (ChatDialog.canContinue()) {
            this.status = 'Femi / gate dialog';
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return true;
        }
        if (
            typeof ChatDialog.isOpen === 'function' &&
            ChatDialog.isOpen() &&
            typeof ChatDialog.options === 'function' &&
            ChatDialog.options().length > 0
        ) {
            const opts = ChatDialog.options();
            const pick = pickBoatOption(opts, FEMI_DIALOG_PREFER);
            this.status = `dialog: ${pick ?? '?'}`;
            this.log(`gate dialog → ${pick}  [${opts.join(' | ')}]`);
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else {
                await ChatDialog.chooseOption();
            }
            await Execution.delayTicks(2);
            return true;
        }
        return false;
    }

    async climbBankStairs(dir: 'up' | 'down'): Promise<boolean> {
        const beforeFloor = playerFloor();
        if (dir === 'up' && beforeFloor >= 1) {
            return true;
        }
        if (dir === 'down' && beforeFloor <= 0) {
            return true;
        }

        const pin = bankStairStand();
        let loc = this.findClimbLoc(Game.tile(), 8, dir) ?? this.findClimbLoc(pin, 8, dir);
        if (!loc) {
            await this.openNearbyDoor();
            loc = this.findClimbLoc(Game.tile(), 8, dir) ?? this.findClimbLoc(pin, 8, dir);
        }
        if (!loc) {
            this.log(
                `no allowed bank staircase to climb-${dir} ` +
                    `(only ${BANK_STAIR_SOUTH.x},${BANK_STAIR_SOUTH.z} or ${BANK_STAIR_NORTH.x},${BANK_STAIR_NORTH.z})`
            );
            await Execution.delayTicks(2);
            return false;
        }

        const op = dir === 'up' ? climbUpOp(loc) : climbDownOp(loc);
        if (!op) {
            this.log(`${loc.name} has no Climb-${dir}: [${locActions(loc).join(', ')}]`);
            await Execution.delayTicks(2);
            return false;
        }

        this.status = `${op} ${loc.name}`;
        this.log(`${op} ${loc.name} @ ${loc.tile().x},${loc.tile().z} (bank stairs only)`);
        await loc.interact(op);
        const moved = await Execution.delayUntil(() => {
            const floor = playerFloor();
            return dir === 'up' ? floor > beforeFloor : floor < beforeFloor;
        }, 8000);
        if (!moved) {
            this.log(`climb ${dir} did not finish, retrying`);
            await this.openNearbyDoor();
            return false;
        }
        await Execution.delayTicks(1);
        return dir === 'up' ? isUpstairs() : !isUpstairs();
    }

    async walkToBankStairs(opts: { skipBlocked?: boolean } = {}): Promise<boolean> {
        const skip = opts.skipBlocked === true ? this.blockedStairPin : null;
        const here = Game.tile();
        const pin = nearestBankStairPin(here, skip);
        const stand = new Tile(pin.x, pin.z, playerFloor(here));
        if (here && cheb(Tile.from(here), pin) <= 2) {
            return true;
        }
        this.status = 'walking to bank stairs';
        this.log(
            `walking to bank stairs ${pin.x},${pin.z} (only ${BANK_STAIR_SOUTH.x},${BANK_STAIR_SOUTH.z} or ${BANK_STAIR_NORTH.x},${BANK_STAIR_NORTH.z})`
        );
        const ok = await Traversal.walkResilient(stand, {
            radius: 1,
            log: m => this.log(`  ${m}`)
        });
        if (!ok) {
            this.log('path to bank stairs failed, retrying');
            return false;
        }
        const now = Game.tile();
        return !!now && cheb(Tile.from(now), pin) <= 3;
    }

    async walkToGnomeBooths() {
        if (!isUpstairs()) {
            return false;
        }
        const here = Game.tile();
        if (here && distToBooths(here) <= 3) {
            return true;
        }
        this.status = 'walking to gnome booths';
        this.log(`walking to central bank booths ${BANK_STAND.x},${BANK_STAND.z},${BANK_STAND.level}`);
        const ok = await Traversal.walkResilient(BANK_STAND, {
            radius: 2,
            log: m => this.log(`  ${m}`)
        });
        if (!ok) {
            this.log('path to central booths failed, will try the other staircase');
            return false;
        }
        return isUpstairs() && distToBooths(Game.tile()) <= 4;
    }

    async enterBankStairs() {
        if (isUpstairs()) {
            return true;
        }
        if (!(await this.walkToBankStairs({ skipBlocked: true }))) {
            return false;
        }
        await this.openNearbyDoor();
        const up = await this.climbBankStairs('up');
        if (!up) {
            return false;
        }
        this.log('upstairs, walking to central booths 2445,3425');
        return true;
    }

    async leaveBankStairs() {
        if (!isUpstairs()) {
            return true;
        }
        if (distToNearestBankStair(Game.tile()) > 2) {
            if (!(await this.walkToBankStairs())) {
                return false;
            }
        }
        this.status = 'climbing down bank stairs';
        this.log('climbing down allowed bank staircase');
        const down = await this.climbBankStairs('down');
        if (!down) {
            return false;
        }
        this.log('back on the ground, heading to magics');
        return true;
    }

    async openGnomeBank() {
        if (Bank.isOpen()) {
            if (atGnomeBankFloor()) {
                return true;
            }
            this.log('wrong bank open, closing');
            await Bank.close();
            await Execution.delayTicks(1);
        }

        if (!(await this.enterBankStairs())) {
            return false;
        }
        if (!isUpstairs()) {
            return false;
        }
        if (!(await this.walkToGnomeBooths())) {
            const failed = nearestBankStairPin(Game.tile());
            this.blockedStairPin = failed;
            this.log(
                `could not reach booths ${BANK_STAND.x},${BANK_STAND.z},1 from this staircase, ` +
                    'will use the other allowed stairs next'
            );
            await this.leaveBankStairs();
            return false;
        }

        if (await this.openUpstairsBooth()) {
            return true;
        }

        const failed = nearestBankStairPin(Game.tile());
        this.blockedStairPin = failed;
        this.log('booths did not open, climbing down to try the other allowed staircase');
        await this.leaveBankStairs();
        return false;
    }

    findGnomeBooth() {
        const floor = playerFloor();
        const pool =
            Locs.query()
                .where(l => isBankBoothLoc(l))
                .where(l => (l.tile()?.level ?? 0) === floor)
                .results() ?? [];
        let best = null;
        let bestD = 99;
        for (const loc of pool) {
            const t = loc.tile?.() ?? null;
            if (!t || !boothOp(loc)) {
                continue;
            }
            const d = cheb(t, BANK_STAND);
            if (d < bestD && d <= BANK_BOOTH_REACH) {
                best = loc;
                bestD = d;
            }
        }
        if (best) {
            return best;
        }
        return (
            Locs.query()
                .name('Bank booth', 'Bank chest')
                .where(l => (l.tile()?.level ?? 0) === floor)
                .where(l => cheb(l.tile(), BANK_STAND) <= BANK_BOOTH_REACH)
                .nearest() ?? null
        );
    }

    async openUpstairsBooth() {
        const booth = this.findGnomeBooth();
        if (booth) {
            const op = boothOp(booth);
            if (!op) {
                this.log(`${booth.name} has no bank op: [${locActions(booth).join(', ')}]`);
            } else {
                const t = booth.tile();
                this.status = `opening ${booth.name}`;
                this.log(`${op} ${booth.name} @ ${t.x},${t.z},${t.level ?? 1}`);
                await booth.interact(op);
                if (await Execution.delayUntil(() => Bank.isOpen(), 8000)) {
                    return true;
                }
            }
        }

        this.status = 'opening gnome bank';
        this.log(`opening bank booth at ${BANK_STAND.x},${BANK_STAND.z},${BANK_STAND.level}`);
        if (typeof Bank.openBooth === 'function') {
            return !!(await Bank.openBooth(BANK_STAND, 'Bank booth', 'Use-quickly', m =>
                this.log(`  ${m}`)
            ));
        }
        if (typeof Banking.open === 'function') {
            return !!(await Banking.open({
                stand: BANK_STAND,
                log: m => this.log(`  ${m}`)
            }));
        }
        this.log('no Bank booth at the central stand');
        return false;
    }

    visibleMagicTrees() {
        let trees: Loc[] = [];
        try {
            trees =
                Locs.query()
                    .name(TREE_NAME)
                    .where(l => isMagicTreeLoc(l))
                    .where(l => {
                        const t = l.tile?.() ?? null;
                        return t && inTreeBand(t) && (t.level ?? 0) === 0;
                    })
                    .results() ?? [];
        } catch {
            trees = [];
        }
        if (trees.length === 0) {
            try {
                trees =
                    Locs.query()
                        .where(l => isMagicTreeLoc(l))
                        .where(l => {
                            const t = l.tile?.() ?? null;
                            return t && inTreeBand(t) && (t.level ?? 0) === 0;
                        })
                        .results() ?? [];
            } catch {
                trees = [];
            }
        }
        if (trees.length === 0) {
            const one = Locs.query()
                .where(l => isMagicTreeLoc(l))
                .within(TREE_SEARCH_REACH)
                .nearest();
            if (one && inTreeBand(one.tile())) {
                trees = [one];
            }
        }
        this.treesUp = trees.length;
        return trees;
    }

    pickTree(trees: Loc[]): Loc | null {
        if (!trees.length) {
            return null;
        }
        const contested = trees.filter(t => otherPlayersNear(t.tile(), 2) > 0);
        const pool = contested.length > 0 ? contested : trees;
        pool.sort((a, b) => a.distance() - b.distance());
        return pool[0] ?? null;
    }

    findTree() {
        return this.pickTree(this.visibleMagicTrees());
    }

    findTreeWithin(maxDistFromPlayer: number) {
        return this.pickTree(this.visibleMagicTrees().filter(t => t.distance() <= maxDistFromPlayer));
    }

    /** No magics in view: run to the next of the three pins. */
    async hopTreePin() {
        const next = nextTreePin(this.treePinId);
        this.treePinId = next.id;
        this.hops++;
        this.status = `no magics, ${next.name}`;
        this.log(`no Magic trees in view, running to ${next.name} ${next.tile.x},${next.tile.z}`);
        await Traversal.walkResilient(next.tile, {
            radius: 3,
            log: m => this.log(`  ${m}`)
        });
        await this.openNearbyDoor(5);
    }

    async fletchLogs(plan: FletchPlan): Promise<void> {
        if (!plan.fletch || logCount() === 0) {
            return;
        }

        if (ChatDialog.isMakeMenu()) {
            await this.chooseMakeProduct(plan);
            return;
        }

        const knife = knifeItem();
        const log = lastLog();
        if (!knife) {
            this.gearReady = false;
            this.log('WARNING: no Knife in inventory, will check gnome bank');
            await Execution.delayTicks(2);
            return;
        }
        if (!log) {
            return;
        }

        this.status = `fletching ${plan.label}`;
        this.log(`knife → magic logs (${logCount()} left) for ${plan.label}`);
        const before = logCount();
        if (!(await knife.useOn(log))) {
            await Execution.delayTicks(2);
            return;
        }

        const opened = await Execution.delayUntil(
            () =>
                ChatDialog.isMakeMenu() ||
                logCount() < before ||
                ChatDialog.canContinue() ||
                Game.animating(),
            8000
        );

        if (ChatDialog.isMakeMenu()) {
            await this.chooseMakeProduct(plan);
            return;
        }

        if (!opened && logCount() >= before) {
            this.log('fletch useOn did not start, retrying');
        }
    }

    async chooseMakeProduct(plan: FletchPlan): Promise<void> {
        if (!plan.fletch) {
            return;
        }

        const products = ChatDialog.makeProducts();
        const match = matchMakeProduct(products, plan.menuMatch);
        if (!match) {
            this.log(`make menu missing '${plan.label}' (have: [${products.join(', ')}]), closing`);
            await Execution.delayTicks(2);
            return;
        }

        const start = logCount();
        this.status = `make ${plan.label}`;
        this.log(`selecting '${match}' x${start}`);

        let picked = false;
        if (typeof ChatDialog.makeX === 'function') {
            const count = Math.max(1, Math.min(start, 30));
            picked = await ChatDialog.makeX(match, count);
        }
        if (!picked) {
            picked = await ChatDialog.make(match);
        }
        if (!picked) {
            this.log(`could not pick '${match}' from make menu`);
            await Execution.delayTicks(1);
            return;
        }

        await Execution.delayUntil(
            () =>
                !ChatDialog.isMakeMenu() &&
                (Game.animating() || logCount() < start || ChatDialog.canContinue()),
            5000
        );

        let mark = logCount();
        let idle = 0;
        for (let guard = 0; guard < 400 && logCount() > 0; guard++) {
            if (ChatDialog.canContinue()) {
                return;
            }
            if (ChatDialog.isMakeMenu()) {
                return;
            }
            await Execution.delayTicks(1);
            const now = logCount();
            if (now < mark) {
                this.fletched += mark - now;
                mark = now;
                idle = 0;
            } else if (!Game.animating() && ++idle >= 12) {
                return;
            } else if (Game.animating()) {
                idle = 0;
            }
        }
    }

    async bankProductsAndReturn() {
        const flvl = Skills.level('fletching');
        const bows = bowCount();
        const shorts = shortbowCount();
        const logs = logCount();
        this.status = 'banking';
        this.log(
            'banking' +
                (shorts ? ` ${shorts} Magic shortbow` : '') +
                (bows - shorts > 0 ? ` ${bows - shorts} Magic longbow` : '') +
                (logs ? ` ${logs} Magic logs` : '') +
                ` (fletching ${flvl})`
        );

        if (!Bank.isOpen()) {
            if (!(await this.openGnomeBank())) {
                this.log('could not open gnome bank, retrying');
                await Execution.delayTicks(3);
                return;
            }
        }

        await gearWaitBankLoaded();
        await Bank.depositAllMatching(name => !isKeepTool(name));
        await Execution.delayTicks(1);
        await this.restockEssentialsFromOpenBank();
        await Bank.close();
        await Execution.delayTicks(1);

        this.bankTrips++;
        this.status = 'returning to magics';
        await this.leaveBankStairs();
    }

    async restockEssentialsFromOpenBank() {
        const needKnife = this.fletchEnabled();
        if (!Bank.isOpen()) {
            return hasEssentialsAfterBank(needKnife);
        }
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
        if (!Bank.isOpen()) {
            return hasEssentialsAfterBank(needKnife);
        }

        if (this.fletchEnabled() && !gearHasKnife()) {
            if ((Bank.count('Knife') || 0) > 0) {
                this.log('gear: withdrawing Knife');
                await Bank.withdrawX('Knife', 1);
                await Execution.delayTicks(1);
            } else {
                if (this.recovering()) {
                    this.log('death: Knife not in this bank, will retry restock');
                    return false;
                }
                this.stopNoKnife('banking');
                return false;
            }
        }

        if (!gearHasBrokenAxe() && !gearBestHeldAxe()) {
            const wc = Skills.level('woodcutting');
            const best = bestAxe(wc, n => (Bank.count(n) || 0) > 0);
            if (best) {
                this.log(`gear: withdrawing ${best}`);
                await Bank.withdrawX(best, 1);
                await Execution.delayTicks(1);
            } else {
                this.log(`gear: WARNING, no usable axe in bank for WC ${wc}`);
            }
        }

        return hasEssentialsAfterBank(needKnife);
    }

    async waitForRespawn() {
        this.status = 'waiting for respawn';
        const ready = await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 20_000);
        if (!ready) {
            this.log('still waiting for respawn...');
            return;
        }
        await Execution.delayTicks(3);
        this.died = false;
        this.recoverPhase = RECOVER.KNIFE;
        const here = Game.tile();
        this.log(
            `respawned at ${here?.x},${here?.z} (${regionOf(here)}), ` +
                'grab Knife, 500gp, Steel axe, then SneakyArdougne back to gnome magics'
        );
        this.status = 'death: knife spawn';
    }

    async recoverFromDeath() {
        if (Shop.isOpen() && this.recoverPhase !== RECOVER.BUY_AXE) {
            await Shop.close();
            return;
        }

        switch (this.recoverPhase) {
            case RECOVER.KNIFE:
                await this.recoverPickupKnife();
                break;
            case RECOVER.BANK_GP:
                await this.recoverWithdrawGp();
                break;
            case RECOVER.BUY_AXE:
                await this.recoverBuySteel();
                break;
            case RECOVER.BANK_TOOLS:
                await this.recoverBankTools();
                break;
            case RECOVER.TRAVEL:
                await this.returnViaSneaky();
                break;
            case RECOVER.RESTOCK:
                await this.recoverRestock();
                break;
            default:
                this.recoverPhase = RECOVER.KNIFE;
                await Execution.delayTicks(1);
                break;
        }
    }

    async recoverPickupKnife() {
        if (gearHasKnife()) {
            this.log('death: already have Knife, nearest bank for 500gp');
            this.recoverPhase = RECOVER.BANK_GP;
            return;
        }

        this.status = 'death: knife spawn';
        this.log('death: walking to Lumbridge knife spawn (beside castle / behind Bob)');
        await Traversal.walkResilient(GEAR_KNIFE_SPAWN, {
            radius: 1,
            log: m => this.log(`  ${m}`)
        });

        let ground = GroundItems.query().name('Knife').within(6).nearest();
        if (!ground) {
            await Execution.delayTicks(3);
            ground = GroundItems.query().name('Knife').within(6).nearest();
        }
        if (!ground) {
            this.log('death: Knife not on ground yet, waiting');
            await Execution.delayTicks(5);
            return;
        }

        if (Inventory.isFull()) {
            this.log('death: inventory full, banking first');
            this.recoverPhase = RECOVER.BANK_GP;
            return;
        }

        this.log('death: taking Knife');
        await ground.interact('Take');
        await Execution.delayUntil(() => gearHasKnife(), 8000);
        if (gearHasKnife()) {
            this.log('death: Knife acquired, nearest bank for 500gp');
            this.recoverPhase = RECOVER.BANK_GP;
        }
    }

    async recoverWithdrawGp() {
        this.status = 'death: 500gp';

        if (!Bank.isOpen()) {
            this.log('death: opening nearest bank for 500gp');
            if (!(await Banking.open({ log: m => this.log(`  ${m}`) }))) {
                this.log('death: could not open bank, retrying');
                await Execution.delayTicks(3);
                return;
            }
        }

        await gearWaitBankLoaded();
        await Bank.depositAllMatching(name => {
            const n = (name ?? '').toLowerCase();
            return !!n && n !== 'knife' && n !== 'coins';
        });
        await Execution.delayTicks(1);

        const have = gearInvCoins();
        if (have < DEATH_GP) {
            const need = DEATH_GP - have;
            const banked = gearBankCoins();
            if (banked <= 0) {
                this.log(`death: only ${have}gp on us and none in bank, taking what we have`);
            } else {
                const take = Math.min(need, banked);
                this.log(`death: withdrawing ${take}gp (${have} held, need ${DEATH_GP})`);
                await Bank.withdrawX('Coins', take);
                await Execution.delayTicks(1);
            }
        } else {
            this.log(`death: already holding ${have}gp`);
        }

        const coins = gearInvCoins();
        const ownSteel = gearHasSteelOrBetter();
        await Bank.close();
        await Execution.delayTicks(1);

        if (ownSteel) {
            this.log('death: already own steel+ axe, banking Knife then boats');
            this.recoverPhase = RECOVER.BANK_TOOLS;
            return;
        }

        if (coins < GEAR_STEEL_COST) {
            this.log(`death: only ${coins}gp (need ${GEAR_STEEL_COST} for Steel axe), will retry bank`);
            await Execution.delayTicks(5);
            return;
        }

        this.log(`death: ${coins}gp in pack, buying Steel axe from Bob`);
        this.recoverPhase = RECOVER.BUY_AXE;
    }

    async recoverBuySteel() {
        if (gearHasSteelOrBetter()) {
            this.recoverPhase = RECOVER.BANK_TOOLS;
            return;
        }

        if (Shop.isOpen()) {
            await this.buySteelAtOpenShop();
            if (gearHasSteelOrBetter()) {
                this.recoverPhase = RECOVER.BANK_TOOLS;
            }
            return;
        }

        this.status = 'death: Bob';
        this.log('death: walking to Bob for Steel axe');
        await Traversal.walkResilient(GEAR_BOB_STAND, {
            radius: 2,
            log: m => this.log(`  ${m}`)
        });

        if (!(await Shop.open('Bob'))) {
            this.log("death: could not open Bob's shop");
            await Execution.delayTicks(3);
            return;
        }
        await this.buySteelAtOpenShop();
        if (gearHasSteelOrBetter()) {
            this.recoverPhase = RECOVER.BANK_TOOLS;
        }
    }

    async buySteelAtOpenShop() {
        if (gearHasSteelOrBetter()) {
            this.log('gear: already own steel+ axe, closing Bob');
            await Shop.close();
            return true;
        }

        this.status = 'gear: buy steel';
        const before = gearAxeCount(GEAR_STEEL_AXE);
        const bought = await Shop.buy(GEAR_STEEL_AXE, 1);
        const got = bought > 0 ? bought : Math.max(0, gearAxeCount(GEAR_STEEL_AXE) - before);

        if (got <= 0) {
            this.log('gear: Steel axe buy failed (stock/coins?)');
            await Shop.close();
            await Execution.delayTicks(5);
            return true;
        }

        this.log('gear: bought Steel axe from Bob');
        await Shop.close();
        await Execution.delayTicks(1);

        if (!Equipment.contains(GEAR_STEEL_AXE) && canWieldTool(GEAR_STEEL_AXE, Skills.level('attack'))) {
            await Equipment.equip(GEAR_STEEL_AXE);
        }
        return true;
    }

    async recoverBankTools() {
        this.status = 'death: bank tools';

        const held = gearBestHeldAxe();
        if (held && Equipment.contains(held) && !Inventory.isFull()) {
            this.log(`death: unequipping ${held} to bank it`);
            await Equipment.unequip(held);
            await Execution.delayTicks(1);
        }

        if (!Bank.isOpen()) {
            this.log('death: banking Steel axe + Knife (keep coins for boats)');
            if (!(await Banking.open({ log: m => this.log(`  ${m}`) }))) {
                await Execution.delayTicks(3);
                return;
            }
        }

        await gearWaitBankLoaded();
        await Bank.depositAllMatching(name => {
            const n = (name ?? '').toLowerCase();
            return !!n && n !== 'coins';
        });
        await Execution.delayTicks(1);

        const knifeBanked = (Bank.count('Knife') || 0) > 0;
        const axeBanked = gearHasSteelOrBetter();
        const coins = gearInvCoins();
        await Bank.close();
        await Execution.delayTicks(1);

        if (!knifeBanked) {
            if (gearHasKnife()) {
                this.log('death: Knife still in pack, retrying deposit');
                return;
            }
            this.log('death: Knife not in bank, grabbing another from the spawn');
            this.recoverPhase = RECOVER.KNIFE;
            return;
        }
        if (!axeBanked) {
            this.log('death: no steel+ axe in bank, buying from Bob');
            this.recoverPhase = RECOVER.BUY_AXE;
            return;
        }
        if (coins < GP_TARGET) {
            this.log(`death: only ${coins}gp for boats, withdrawing more`);
            this.recoverPhase = RECOVER.BANK_GP;
            return;
        }

        this.log(`death: tools banked, ${coins}gp for boats, SneakyArdougne to gnome`);
        this.travelPhase = this.inferTravelPhase();
        this.recoverPhase = RECOVER.TRAVEL;
    }

    inferTravelPhase() {
        const here = Game.tile();
        const region = regionOf(here);
        const coins = gearInvCoins();
        if (region === 'gnome' || region === 'ardougne' || region === 'seers') {
            return PHASE.DONE;
        }
        if (region === 'brimhaven') {
            return PHASE.BOAT_ARDOUGNE;
        }
        if (region === 'musa' || region === 'karamja') {
            return PHASE.WALK_BRIMHAVEN;
        }
        if (region === 'sarim') {
            return coins >= 30 ? PHASE.BOAT_KARAMJA : PHASE.WALK_SARIM;
        }
        if (coins >= GP_TARGET) {
            return PHASE.WALK_SARIM;
        }
        return PHASE.THIEVE;
    }

    async returnViaSneaky() {
        if (this.travelPhase == null || this.travelPhase === PHASE.DONE) {
            this.travelPhase = this.inferTravelPhase();
            this.log(`death: SneakyArdougne, phase ${this.travelPhase} · ${gearInvCoins()}gp`);
        }

        if (await this.handleBoatDialog()) {
            return;
        }

        if (this.travelPhase !== PHASE.THIEVE) {
            const inferred = this.inferTravelPhase();
            if (
                inferred === PHASE.DONE ||
                (inferred === PHASE.WALK_BRIMHAVEN && this.travelPhase === PHASE.BOAT_KARAMJA) ||
                (inferred === PHASE.BOAT_ARDOUGNE && this.travelPhase === PHASE.WALK_BRIMHAVEN)
            ) {
                this.travelPhase = inferred;
            }
        }

        const region = regionOf(Game.tile());
        if (this.travelPhase === PHASE.DONE || region === 'ardougne' || region === 'seers' || region === 'gnome') {
            this.travelPhase = PHASE.DONE;
            this.recoverPhase = RECOVER.RESTOCK;
            this.status = 'death: arrived Kandarin';
            this.log('death: arrived via boats, walk to gnome, withdraw Steel axe + Knife');
            return;
        }

        switch (this.travelPhase) {
            case PHASE.THIEVE:
                await this.doThieve();
                break;
            case PHASE.WALK_SARIM:
                await this.doWalkSarim();
                break;
            case PHASE.BOAT_KARAMJA:
                await this.doBoatKaramja();
                break;
            case PHASE.WALK_BRIMHAVEN:
                await this.doWalkBrimhaven();
                break;
            case PHASE.BOAT_ARDOUGNE:
                await this.doBoatArdougne();
                break;
            default:
                this.travelPhase = this.inferTravelPhase();
                await Execution.delayTicks(2);
                break;
        }
    }

    async handleBoatDialog() {
        const prefer =
            this.travelPhase === PHASE.BOAT_ARDOUGNE || regionOf(Game.tile()) === 'brimhaven'
                ? ARDOUGNE_DIALOG_PREFER
                : KARAMJA_DIALOG_PREFER;
        return this.stepSailorDialog(prefer);
    }

    async stepSailorDialog(prefer: readonly string[]): Promise<boolean> {
        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return true;
        }
        if (
            typeof ChatDialog.isOpen === 'function' &&
            ChatDialog.isOpen() &&
            typeof ChatDialog.options === 'function' &&
            ChatDialog.options().length > 0 &&
            typeof ChatDialog.chooseOption === 'function'
        ) {
            const opts = ChatDialog.options();
            const pick = pickBoatOption(opts, prefer);
            this.status = `dialog: ${pick ?? '?'}`;
            this.log(`dialog → ${pick}  [${opts.join(' | ')}]`);
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else {
                await ChatDialog.chooseOption();
            }
            await Execution.delayTicks(2);
            return true;
        }
        return false;
    }

    async talkSailorAndRide(npc: Npc, prefer: readonly string[], arrivedFn: () => boolean): Promise<boolean> {
        const before = Game.tile();
        const coinsBefore = gearInvCoins();
        const op = talkOp(npc);
        this.status = `Talk-to ${npc.name ?? 'sailor'}`;
        this.log(`Talk-to ${npc.name} @ dock (${coinsBefore}gp), navigating dialogue`);

        if (!(await npc.interact(op))) {
            await Execution.delayTicks(2);
            return false;
        }

        if (!(await Execution.delayUntil(() => dialogOpen() || arrivedFn() || this.movedFar(before, 15), 8000))) {
            this.log('sailor dialog did not open, retrying');
            return false;
        }

        for (let i = 0; i < 40; i++) {
            if (this.died) {
                return false;
            }
            if (arrivedFn()) {
                return true;
            }
            if (!dialogOpen()) {
                if (await Execution.delayUntil(() => arrivedFn() || this.movedFar(before, 15) || dialogOpen(), 6000)) {
                    if (arrivedFn()) {
                        return true;
                    }
                    if (dialogOpen()) {
                        continue;
                    }
                }
                break;
            }
            if (!(await this.stepSailorDialog(prefer))) {
                await Execution.delayTicks(1);
            }
        }

        if (arrivedFn()) {
            return true;
        }
        await this.crossGangplank();
        return arrivedFn();
    }

    async doThieve() {
        if (gearInvCoins() >= GP_TARGET) {
            this.log(`have ${gearInvCoins()}gp (≥ ${GP_TARGET}), heading to Port Sarim`);
            this.travelPhase = PHASE.WALK_SARIM;
            this.status = 'walk Port Sarim';
            return;
        }

        if (Skills.effective('hitpoints') < MIN_HP) {
            this.status = `HP ${Skills.effective('hitpoints')}, regen to ${MIN_HP}`;
            await Execution.delayTicks(2);
            return;
        }

        if (this.stunned()) {
            this.status = 'stunned';
            await Execution.delayTicks(1);
            return;
        }

        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(2);
            return;
        }

        if (Tile.from(here).distanceTo(LUMBY_MEN) > LUMBY_LEASH) {
            this.status = 'walking to Lumbridge Men';
            await Traversal.walkResilient(LUMBY_MEN, {
                radius: 4,
                log: m => this.log(`  ${m}`)
            });
            return;
        }

        if (Game.inCombat()) {
            this.status = 'in combat, waiting';
            await Execution.delayTicks(2);
            return;
        }

        const npc = this.findMan();
        if (!npc) {
            this.status = 'waiting for Man';
            await Traversal.walkTo(LUMBY_MEN, { radius: 3, timeoutMs: 8_000 });
            await this.openNearbyDoor();
            await Execution.delayTicks(2);
            return;
        }

        await this.pickpocket(npc);
    }

    findMan() {
        return Npcs.query()
            .name('Man')
            .action(PICKPOCKET_OP)
            .within(LUMBY_LEASH + 4)
            .where(n => !n.inCombat)
            .nearest();
    }

    async pickpocket(npc: Npc): Promise<void> {
        const beforeXp = Skills.xp('thieving');
        const coinsBefore = gearInvCoins();
        const t = npc.tile();
        this.status = `pickpocket Man (${npc.distance()}t) · ${coinsBefore}gp`;
        this.log(`Pickpocket Man @ ${t.x},${t.z} · ${coinsBefore}gp · HP ${Skills.effective('hitpoints')}`);

        if (!(await npc.interact(PICKPOCKET_OP))) {
            await this.openNearbyDoor();
            await Execution.delayTicks(1);
            return;
        }

        await Execution.delayUntil(
            () =>
                Skills.xp('thieving') > beforeXp ||
                this.stunned() ||
                Game.inCombat() ||
                ChatDialog.canContinue() ||
                gearInvCoins() > coinsBefore ||
                this.died,
            4000
        );
    }

    async doWalkSarim() {
        const here = Game.tile();
        if (here && PORT_SARIM_DOCK.distanceTo(here) <= 6) {
            this.travelPhase = PHASE.BOAT_KARAMJA;
            this.status = 'boat to Karamja';
            return;
        }
        this.status = 'walking to Port Sarim';
        this.log(`walking to Port Sarim dock @ ${PORT_SARIM_DOCK.x},${PORT_SARIM_DOCK.z}`);
        await Traversal.walkResilient(PORT_SARIM_DOCK, {
            radius: 4,
            log: m => this.log(`  ${m}`)
        });
        const after = Game.tile();
        if (after && PORT_SARIM_DOCK.distanceTo(after) <= 6) {
            this.travelPhase = PHASE.BOAT_KARAMJA;
        }
    }

    onKaramja() {
        const r = regionOf(Game.tile());
        return r === 'musa' || r === 'karamja';
    }

    async doBoatKaramja() {
        if (this.onKaramja()) {
            this.log('arrived Musa Point / Karamja, walking to Brimhaven');
            this.travelPhase = PHASE.WALK_BRIMHAVEN;
            return;
        }

        if (gearInvCoins() < 30) {
            this.status = 'need 30gp for Sarim boat';
            this.log(`WARNING: only ${gearInvCoins()}gp, need 30 for Port Sarim → Karamja`);
            this.travelPhase = PHASE.THIEVE;
            await Execution.delayTicks(5);
            return;
        }

        if (dialogOpen()) {
            for (let i = 0; i < 40 && dialogOpen() && !this.onKaramja() && !this.died; i++) {
                await this.stepSailorDialog(KARAMJA_DIALOG_PREFER);
            }
            if (this.onKaramja()) {
                this.travelPhase = PHASE.WALK_BRIMHAVEN;
                this.log('boat landed on Karamja');
            }
            return;
        }

        const sailor = this.findSarimSailor();
        if (!sailor) {
            this.status = 'looking for sailor';
            await Traversal.walkResilient(PORT_SARIM_DOCK, {
                radius: 3,
                timeoutMs: 10_000,
                log: m => this.log(`  ${m}`)
            });
            await Execution.delayTicks(2);
            return;
        }

        const ok = await this.talkSailorAndRide(sailor, KARAMJA_DIALOG_PREFER, () => this.onKaramja());
        if (ok || this.onKaramja()) {
            this.travelPhase = PHASE.WALK_BRIMHAVEN;
            this.log('boat landed on Karamja');
        }
    }

    findSarimSailor() {
        for (const name of SARIM_SAILORS) {
            const npc = Npcs.query().name(name).within(18).nearest();
            if (npc) {
                return npc;
            }
        }
        return (
            Npcs.query()
                .within(18)
                .where(n => {
                    const nm = (n.name ?? '').toLowerCase();
                    return nm.includes('captain') || nm.includes('seaman') || nm.includes('sailor');
                })
                .nearest() ?? null
        );
    }

    async doWalkBrimhaven() {
        const here = Game.tile();
        if (here && BRIMHAVEN_DOCK.distanceTo(here) <= 8) {
            this.travelPhase = PHASE.BOAT_ARDOUGNE;
            this.status = 'boat to Ardougne';
            return;
        }
        if (regionOf(here) === 'brimhaven') {
            this.travelPhase = PHASE.BOAT_ARDOUGNE;
            return;
        }

        this.status = 'walking to Brimhaven';
        this.log(`walking Musa/Karamja → Brimhaven dock @ ${BRIMHAVEN_DOCK.x},${BRIMHAVEN_DOCK.z}`);
        await Traversal.walkResilient(BRIMHAVEN_DOCK, {
            radius: 5,
            log: m => this.log(`  ${m}`)
        });
        await this.openNearbyDoor();

        const after = Game.tile();
        if (after && (BRIMHAVEN_DOCK.distanceTo(after) <= 8 || regionOf(after) === 'brimhaven')) {
            this.travelPhase = PHASE.BOAT_ARDOUGNE;
        }
    }

    inArdougne() {
        return regionOf(Game.tile()) === 'ardougne';
    }

    async doBoatArdougne() {
        if (this.inArdougne()) {
            this.log('arrived Ardougne');
            this.travelPhase = PHASE.DONE;
            this.recoverPhase = RECOVER.RESTOCK;
            return;
        }

        if (gearInvCoins() < 30) {
            this.status = 'need 30gp for Brimhaven boat';
            this.log(`WARNING: only ${gearInvCoins()}gp, need 30 for Brimhaven → Ardougne`);
            await Execution.delayTicks(8);
            return;
        }

        if (dialogOpen()) {
            for (let i = 0; i < 40 && dialogOpen() && !this.inArdougne() && !this.died; i++) {
                await this.stepSailorDialog(ARDOUGNE_DIALOG_PREFER);
            }
            if (this.inArdougne()) {
                this.travelPhase = PHASE.DONE;
                this.recoverPhase = RECOVER.RESTOCK;
                this.log('boat landed in Ardougne');
            }
            return;
        }

        const sailor = this.findBrimSailor();
        if (!sailor) {
            this.status = 'looking for dock sailor';
            await Traversal.walkResilient(BRIMHAVEN_DOCK, {
                radius: 3,
                timeoutMs: 10_000,
                log: m => this.log(`  ${m}`)
            });
            await Execution.delayTicks(2);
            return;
        }

        const ok = await this.talkSailorAndRide(sailor, ARDOUGNE_DIALOG_PREFER, () => this.inArdougne());
        if (ok || this.inArdougne()) {
            this.travelPhase = PHASE.DONE;
            this.recoverPhase = RECOVER.RESTOCK;
            this.log('boat landed in Ardougne');
        }
    }

    findBrimSailor() {
        for (const name of BRIM_SAILORS) {
            const npc = Npcs.query().name(name).within(18).nearest();
            if (npc) {
                return npc;
            }
        }
        const customs = Npcs.query()
            .within(18)
            .where(n => (n.name ?? '').toLowerCase().includes('customs'))
            .nearest();
        if (customs) {
            return customs;
        }
        return (
            Npcs.query()
                .within(18)
                .where(n => {
                    const nm = (n.name ?? '').toLowerCase();
                    return nm.includes('captain') || nm.includes('seaman') || nm.includes('sailor');
                })
                .nearest() ?? null
        );
    }

    movedFar(from: MaybeTile, tiles: number): boolean {
        const now = Game.tile();
        if (!from || !now) {
            return false;
        }
        return Tile.from(from).distanceTo(now) >= tiles;
    }

    async crossGangplank() {
        const plank = Locs.query()
            .within(10)
            .where(l => /gangplank/i.test(l.name ?? ''))
            .nearest();
        if (!plank) {
            return false;
        }
        const op =
            plank.actions().find(a => /cross|walk|climb/i.test(a ?? '')) ?? plank.actions()[0] ?? null;
        if (!op) {
            return false;
        }
        const before = Game.tile();
        this.status = `cross ${plank.name}`;
        this.log(`crossing ${plank.name} (${op})`);
        if (!(await plank.interact(op))) {
            return false;
        }
        await Execution.delayUntil(() => this.movedFar(before, 3), 6000);
        return true;
    }

    async recoverRestock() {
        const here = Game.tile();
        if (!inGnomeArea(here) && !isUpstairs(here)) {
            this.status = 'death: walk to gnome';
            this.log(`death: walking to Gnome Stronghold gate ${GNOME_ENTRANCE.x},${GNOME_ENTRANCE.z}`);
            await Traversal.walkResilient(GNOME_ENTRANCE, {
                radius: 3,
                log: m => this.log(`  ${m}`)
            });
            await this.openNearbyDoor(6);
            await this.handleFemiDialog();
            return;
        }

        this.status = 'death: withdraw axe + knife';
        this.log('death: gnome bank, withdraw Steel axe + Knife, then chop');

        if (!Bank.isOpen()) {
            if (!(await this.openGnomeBank())) {
                this.log('death: could not open gnome bank, retrying');
                await Execution.delayTicks(3);
                return;
            }
        }

        await gearWaitBankLoaded();
        await Bank.depositAllMatching(name => !isKeepTool(name));
        await Execution.delayTicks(1);
        await this.restockEssentialsFromOpenBank();
        await Bank.close();
        await Execution.delayTicks(1);

        const needKnife = this.fletchEnabled();
        if (hasEssentialsAfterBank(needKnife)) {
            const held = gearBestHeldAxe();
            if (held && !Equipment.contains(held) && canWieldTool(held, Skills.level('attack'))) {
                await Equipment.equip(held);
                await Execution.delayTicks(1);
            }
            this.gearReady = true;
            this.recoverPhase = RECOVER.NONE;
            this.travelPhase = PHASE.DONE;
            this.treePinId = 'bank';
            this.log('death: restocked axe + Knife, resuming gnome magics');
            this.status = 'returning to magics';
            await this.leaveBankStairs();
        } else {
            this.log('death: restock incomplete, will retry gnome bank');
            await Execution.delayTicks(5);
        }
    }

    override onStop(): void {
        this.log(
            `stopped, chopped ~${this.chopped}, fletched ~${this.fletched}, ` +
                `bank trips ${this.bankTrips}, hops ${this.hops}, deaths ${this.deaths} (${this.status})`
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const plan = this.currentPlan();
        const elapsed = Date.now() - this.startedAt;
        const hrs = elapsed / 3_600_000;
        const wcXp = Skills.xp('woodcutting') - this.wcXpAtStart;
        const flXp = Skills.xp('fletching') - this.fletchXpAtStart;
        const wcXph = hrs > 0.008 ? wcXp / hrs : 0;
        const flXph = hrs > 0.008 ? flXp / hrs : 0;
        const pin = this.currentPin();

        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ec8a3' });
        p.title(`GnomeMagicChopper, ${this.status}`);
        p.row(`WC ${Skills.level('woodcutting')}`, `Fletch ${Skills.level('fletching')}`, `${fmtDuration(elapsed / 60_000)}`);
        p.row(plan.label, `pin ${pin.name}`, `trees ${this.treesUp}`);
        p.row(`logs ${logCount()}`, `bows ${bowCount()}`, `trips ${this.bankTrips}`);
        p.row(`WC ${fmtXph(wcXph)}/hr`, `Fletch ${fmtXph(flXph)}/hr`, this.deaths ? `deaths ${this.deaths}` : `hops ${this.hops}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
