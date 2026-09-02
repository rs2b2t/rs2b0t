import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import {
    COMBAT_STYLE_OPTIONS,
    RANGE_STYLE_OPTIONS,
    describeCombatStyle,
    parseRangeStyle,
    resolveSplitCombatSettings,
    tryParseCombatStyle,
    type MeleeCombatStyle
} from '../../api/combat/CombatStyle.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { foodHealAmount } from '../../api/combat/food.js';
import { Special } from '../../api/combat/Special.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Skills } from '../../api/skills/Skills.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { matchesEntityName } from '../../api/query/Query.js';
import { SettingsStore, type SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic } from '../../api/inventory/packRules.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    shouldBankAfterMinutes,
    BURIAL_BONE_NAME,
    CUSTOM_COORDINATES,
    DEFAULT_CUSTOM_SPOT,
    DEFAULT_LOOT,
    isBurialBone,
    resolveKillingSpot,
    shouldBuryRegularBones,
    autoRetaliateShouldEnable,
    assertAutoRetaliateOn,
    shouldArmSpecial,
    specialAvailable,
    SPOT_OPTIONS,
    START_POSITION,
    wantsAutoFighterLoot
} from './AutoFighterData.js';
import { SolveClue } from '../../api/ai/clues/SolveClue.js';
import { paintClueProgress } from '../../api/ai/clues/cluePaint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { Reach } from '../../api/walking/Reach.js';
import { RANDOM_EVENT_CASKET_ID } from '../../api/bank/Banking.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';
import { HERBS, HERB_OPTIONS } from '../HerbCleaner/HerbCleanerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const KIT = ['spade', 'sextant', 'watch', 'chart'];
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'];

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const SHOW_MAGE_RANGE = { key: 'combatStyle', anyOf: ['mage', 'range'] };
const SHOW_MELEE_RANGE = { key: 'combatStyle', anyOf: ['melee', 'range'] };

export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Guard', label: 'Target NPC name(s)', help: 'comma-separated exact in-game names to fight, e.g. Guard, Knight, Moss giant' },
    spot: { type: 'string', default: START_POSITION, options: SPOT_OPTIONS, label: 'Killing spot', help: 'use the tile where the script starts, or walk to custom coordinates' },
    coordinates: { type: 'tile', default: DEFAULT_CUSTOM_SPOT, label: 'Killing coordinates (x,z)', showIf: { key: 'spot', anyOf: [CUSTOM_COORDINATES] } },
    leashRadius: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius (tiles)' },
    combatStyle: {
        type: 'string',
        default: 'melee',
        options: ['melee', 'mage', 'range'],
        label: 'Combat style',
        help:
            'melee / mage / range. Older saves that stored attack/strength/controlled/defence under this key are migrated to Melee style.'
    },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    useSpecial: { type: 'boolean', default: true, label: 'Use special attacks', group: 'Combat', showIf: SHOW_MELEE_RANGE, help: 'arms the spec bar whenever energy covers the wielded weapon\'s special (dragon dagger, dragon longsword, magic shortbow, …); does nothing with a weapon that has no special' },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE, help: 'kept armed via autocast — a staff must be wielded' },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE, help: 'the bot tops runes up to this many casts of the selected spell; runes the wielded staff provides free are skipped' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Bronze arrow', label: 'Ammo (withdrawn from bank)', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },
    ammoRestockBelow: { type: 'number', default: 25, min: 0, max: 100, label: 'Bank for ammo below %', group: 'Combat', showIf: SHOW_MAGE_RANGE, help: 'when not banking for food, go bank once magic casts / ranged ammo drop below this percentage of a full trip' },
    loadout: LOADOUT_SETTING,
    food: { type: 'string', default: '', label: 'Food to eat', help: 'exact item name to eat (e.g. Shark, Monkfish, Trout). Leave blank to use the loadout’s food, falling back to Trout' },
    foodWithdraw: { type: 'number', default: 10, min: 0, max: 27, label: 'Food to carry' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, label: 'Loot item names (contains)', help: 'defaults to gem-table items + clue scrolls, nothing else', csvToggle: 'lootMode' },
    lootMode: {
        type: 'string',
        default: 'list',
        options: ['list', 'csv'],
        optionLabels: { list: 'List (chips)', csv: 'CSV (text + copy/paste)' },
        label: 'Loot entry mode',
        help: 'List = add items one at a time (current). CSV = paste a comma-separated list with copy/paste buttons.'
    },
    avoidHerbs: { type: 'string[]', default: [], options: HERB_OPTIONS, label: 'Herbs to avoid', group: 'Banking & loot', help: 'pick herbs to never pick up; matched by item id for grimy and cleaned forms, since every grimy herb reads as "Herb"' },
    buryBones: { type: 'boolean', default: false, label: 'Bury regular bones', group: 'Banking & loot', help: 'pick up and bury regular Bones for Prayer XP (always looted when on)' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    banking: { type: 'string', default: 'Auto', options: BANKING_OPTIONS, label: 'Banking', help: 'Auto = bank loot at the nearest bank and return; None = no loot-only bank trips' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots', showIf: { key: 'banking', anyOf: ['Auto'] } },
    bankEveryMinutes: {
        type: 'number',
        default: 0,
        min: 0,
        max: 120,
        label: 'Bank every N minutes',
        help: '0 = never. Same idea as CowKiller: walk loot to the bank after this many minutes so a death does not wipe a long session.',
        showIf: { key: 'banking', anyOf: ['Auto'] },
        group: 'Banking & loot'
    },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank common junk too' }
};

let TARGET = 'Guard';

function targetNames(): string[] {
    return TARGET.split(',').map(s => s.trim()).filter(Boolean);
}
let ANCHOR = DEFAULT_CUSTOM_SPOT;
let LEASH = 8;
let FOOD = 'Trout';
let FOOD_WITHDRAW = 10;
let PANIC_AT = 0.25;
let LOOT = DEFAULT_LOOT;
let BURY_BONES = false;
let SOLVE_CLUES = true;
let BANK_AT = 12;
let BANK_EVERY_MINUTES = 0;
let AUTO_BANK = true;
let BANK_COMMON = true;
let STYLE: 'melee' | 'mage' | 'range' = 'melee';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let USE_SPECIAL = true;
let RANGE_MODE = 1;
let SPELL = 'Fire Strike';
let RUNES_WITHDRAW = 150;
let AMMO = 'Bronze arrow';
let AMMO_WITHDRAW = 500;
let AMMO_RESTOCK_BELOW = 0.25;
let TRACKED_GEAR: string[] = [];
let AVOID_HERB_IDS = new Set<number>();

function isAvoidedHerb(id: number): boolean {
    return AVOID_HERB_IDS.has(id);
}

function foodCount(): number {
    return countMatching(Inventory.items(), [FOOD]);
}
function needEat(): boolean {
    return shouldEat(Skills.effective('hitpoints'), Skills.level('hitpoints'), foodHealAmount(FOOD), foodCount());
}
function isLoot(name: string | null): boolean {
    return wantsAutoFighterLoot(name, LOOT, BURY_BONES);
}
function lootCount(): number {
    return Inventory.items()
        .filter(item => isLoot(item.name))
        .reduce((sum, item) => sum + item.count, 0);
}
function lootSlots(): number {
    return Inventory.items().filter(item => isLoot(item.name)).length;
}
/** The wielded weapon when it carries a special this bot may arm, else ''. */
function specWeapon(): string {
    const weapon = Special.wielded();
    return specialAvailable(USE_SPECIAL, STYLE, Special.cost(weapon)) ? weapon : '';
}
function specialDue(): boolean {
    return shouldArmSpecial(USE_SPECIAL, STYLE, Special.cost(Special.wielded()), Special.energy(), Special.armed());
}
// Why: arming is one-shot, the next attack spends it and the engine clears the flag, so it is re-armed per special.
async function armSpecial(bot: AutoFighter): Promise<boolean> {
    const weapon = Special.wielded();
    if (!specialDue() || !(await Special.arm())) {
        return false;
    }
    bot.countSpecial();
    bot.log(`special armed with ${weapon} (bar at ${Math.round(Special.energy() / 10)}%, spent on the next hit)`);
    return true;
}
function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}
function castsLeft(): number {
    return castsAvailable(SPELL, wieldedNames(), rune => Inventory.count(rune));
}
function wieldedAmmo(): number {
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === AMMO.toLowerCase())?.count ?? 0;
}
function totalAmmo(): number {
    return Inventory.count(AMMO) + wieldedAmmo();
}
function restockThreshold(): number {
    return Math.max(1, Math.floor(AMMO_RESTOCK_BELOW * (STYLE === 'mage' ? RUNES_WITHDRAW : AMMO_WITHDRAW)));
}
function supplyMetric(): number {
    return STYLE === 'mage' ? castsLeft() : totalAmmo();
}
function needStyleSupplies(): boolean {
    return STYLE !== 'melee' && supplyMetric() < restockThreshold();
}
function fullyOutOfSupplies(): boolean {
    if (STYLE === 'melee') {
        return false;
    }
    return supplyMetric() === 0;
}

export function shouldKeepBankItem(name: string, id: number, food: string, bankCommon: boolean, ammo: string[] = [], gear: string[] = [], buryBones = false): boolean {
    const n = name.toLowerCase();
    const genericCasket = id === RANDOM_EVENT_CASKET_ID;
    const ammoMatch = ammo.some(a => a.toLowerCase() === n);
    const gearMatch = gear.some(g => g.toLowerCase() === n);
    return matchesAny(name, [food]) || n === 'coins' || KIT.includes(n) || n.includes('clue')
        || (n.includes('casket') && !genericCasket) || (genericCasket && !bankCommon)
        || ammoMatch || gearMatch || (buryBones && isBurialBone(name));
}

export default class AutoFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private buried = 0;
    private specials = 0;
    private eats = 0;
    private trips = 0;
    private deaths = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    bankAfterSolve = false;
    bankFoodEmpty = false;
    private supplyEmpty = false;
    private status = 'starting';
    private startedAt = Date.now();
    private lastBankAt = Date.now();
    private xpAtStart = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('target', 'Guard').trim() || 'Guard';
        const spotMode = this.settings.str('spot', START_POSITION);
        ANCHOR = resolveKillingSpot(spotMode, Tile.from(Game.tile()!), this.settings.tile('coordinates', DEFAULT_CUSTOM_SPOT));
        LEASH = this.settings.num('leashRadius', 8);
        FOOD = this.settings.str('food', '').trim() || scriptFood(this.settings, 'Trout');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 10);
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        LOOT = this.settings.list('loot', DEFAULT_LOOT).map(s => s.trim().toLowerCase());
        AVOID_HERB_IDS = new Set(
            HERBS
                .filter(h => this.settings.list('avoidHerbs', []).includes(h.name))
                .flatMap(h => [h.id, h.unidId])
        );
        BURY_BONES = this.settings.bool('buryBones', false);
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        BANK_EVERY_MINUTES = this.settings.num('bankEveryMinutes', 0);
        AUTO_BANK = autoBankEnabled(this.settings.str('banking', 'Auto'));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        // Why: pre-#195 saves stored attack/strength/controlled/defence in combatStyle.
        // Why: settings option validation coerces those to the default "melee" and leaves meleeStyle at strength, so Defence and the rest are ignored (#461).
        const rawCombatStyle = SettingsStore.displayString('AutoFighter', 'combatStyle', SETTINGS.combatStyle!);
        const rawMeleeStyle = SettingsStore.saved('AutoFighter', 'meleeStyle');
        const split = resolveSplitCombatSettings(rawCombatStyle, rawMeleeStyle);
        STYLE = split.kind;
        MELEE_STYLE = split.meleeStyle;
        if (split.legacyMigrated !== null) {
            SettingsStore.save('AutoFighter', 'combatStyle', 'melee');
            SettingsStore.save('AutoFighter', 'meleeStyle', split.legacyMigrated);
            this.log(`migrated legacy combatStyle='${rawCombatStyle.trim()}' → meleeStyle='${split.legacyMigrated}'`);
        } else if (tryParseCombatStyle(rawCombatStyle) !== null) {
            // storage still has a training-style value but meleeStyle already set, rewrite combatStyle only
            SettingsStore.save('AutoFighter', 'combatStyle', 'melee');
        }
        USE_SPECIAL = this.settings.bool('useSpecial', true);
        SPELL = this.settings.str('spell', 'Fire Strike');
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        AMMO = this.settings.str('ammo', 'Bronze arrow');
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        AMMO_RESTOCK_BELOW = this.settings.num('ammoRestockBelow', 25) / 100;
        TRACKED_GEAR = Equipment.items().map(i => i.name ?? '').filter(n => n.length > 0);

        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                    this.bankAfterSolve = true;
                }
                this.setStatus(s);
            },
            isFood: n => matchesAny(n, [FOOD]),
            foodName: () => FOOD,
            foodWithdraw: () => FOOD_WITHDRAW,
            enabled: () => SOLVE_CLUES
        });

        Sustain.set(async () => {
            // Why: while the bank is open Inventory exposes the bank-side items (Deposit ops),
            // so 'Eat' fails and the sustain loop spins instead of healing. Eat after banking.
            if (Bank.isOpen()) {
                return;
            }
            if (needEat()) {
                const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
                if (food) {
                    const before = Skills.effective('hitpoints');
                    if (await food.interact('Eat')) {
                        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
                    }
                }
            }
        });

        this.startedAt = Date.now();
        this.lastBankAt = this.startedAt;
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
        this.log(`AutoFighter starting — '${targetNames().join(', ')}' at ${spotMode} ${ANCHOR} r${LEASH}, style ${STYLE}${STYLE === 'mage' ? ` (${SPELL}, ${RUNES_WITHDRAW} casts)` : STYLE === 'range' ? ` (${RANGE_MODE === 0 ? 'accurate' : RANGE_MODE === 1 ? 'rapid' : 'longrange'}, ${AMMO}x${AMMO_WITHDRAW})` : ` (${MELEE_STYLE})`}, banking ${AUTO_BANK ? 'auto' : 'none'}${BANK_EVERY_MINUTES > 0 ? ` every ${BANK_EVERY_MINUTES}m` : ''}, food '${FOOD}'x${FOOD_WITHDRAW}, loot [${LOOT.join(', ')}]${BURY_BONES ? `, burying ${BURIAL_BONE_NAME}` : ''}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.deaths++;
                    this.solveClue?.noteDeath();
                    this.log('died! waiting for respawn, then walking back to the spot');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new EnableAutoRetaliate(this),
            new EatFood(this),
            new PanicRetreat(this),
            new BuryBones(this),
            new LootDrops(this),
            new ReequipGear(this),
            this.solveClue!,
            new BankRun(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new ArmSpecial(this),
            new Fight(this),
            new ReturnToAnchor(this)
        );
    }

    override grindTargets(): string[] {
        return targetNames().map(s => s.toLowerCase());
    }
    override recoveryAnchor(): Tile | null {
        return ANCHOR;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fd07f' });
        p.title(`AutoFighter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';
        if (p.tabs('afg', ['Overview', 'Clue']) === 'Clue') {
            p.row(`Solved: ${this.cluesSolved}`, `Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            paintClueProgress(p, 'watching the pack for clues');
        } else {
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
            p.row(STYLE === 'mage' ? `Casts: ${castsLeft()}` : STYLE === 'range' ? `Ammo: ${totalAmmo()}` : `Style: ${MELEE_STYLE}`, `Food: ${foodCount()}`, this.deaths ? `Deaths: ${this.deaths}` : `Trips: ${this.trips}`);
            p.row(`Clues: ${this.cluesSolved}`, `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}`, `Bones: ${this.buried}`);
            if (specWeapon() !== '') {
                p.row(`Spec: ${Math.round(Special.energy() / 10)}%`, `Specials: ${this.specials}`);
            }
            p.bar('HP', Skills.hpFraction());
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    countKill(): void { this.kills++; }
    countLoot(): void { this.looted++; }
    countBurial(): void { this.buried++; }
    countSpecial(): void { this.specials++; }
    countEat(): void { this.eats++; }
    countTrip(): void {
        this.trips++;
        this.lastBankAt = Date.now();
    }
    minutesSinceBank(): number {
        return (Date.now() - this.lastBankAt) / 60_000;
    }
    dueForTimedBank(): boolean {
        return shouldBankAfterMinutes(AUTO_BANK, BANK_EVERY_MINUTES, this.minutesSinceBank(), lootCount());
    }
    noteSupplyEmpty(v: boolean): void { this.supplyEmpty = v; }
    supplyKnownEmpty(): boolean { return this.supplyEmpty; }
}

class EnableAutoRetaliate implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return autoRetaliateShouldEnable(Game.autoRetaliateOn());
    }
    async execute(): Promise<void> {
        this.bot.setStatus('enabling auto retaliate');
        await Game.openSideTab(0);
        for (let i = 0; i < 5 && !Game.autoRetaliateOn(); i++) {
            Game.setAutoRetaliate(true);
            if (await Execution.delayUntil(() => Game.autoRetaliateOn(), 1500)) {
                break;
            }
        }
        assertAutoRetaliateOn(Game.autoRetaliateOn());
        this.bot.log('Auto Retaliate on');
    }
}

class LootDrops implements Task {
    constructor(private bot: AutoFighter) {}
    private find() {
        return GroundItems.query()
            .where(g => isLoot(g.name) && !isAvoidedHerb(g.id))
            .within(LEASH + 4)
            .nearest();
    }
    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && this.find() !== null;
    }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
        const id = drop.id;
        const tile = drop.tile();
        const find = () => GroundItems.query()
            .where(item => item.id === id && item.tile().equals(tile))
            .nearest();
        const before = lootCount();
        const status = await Reach.entityOp({
            find,
            op: 'Take',
            expect: () => lootCount() > before,
            expectMs: 5000,
            what: drop.name ?? 'loot',
            log: message => this.bot.log(message)
        });
        if (status === 'done' && lootCount() > before) {
            this.bot.countLoot();
        }
    }
}

class EatFood implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        // Why: the bank side shows Deposit ops rather than Eat, so eating with the bank open spins forever and blocks BankRun. Wait for the bank to close.
        return needEat() && !Bank.isOpen();
    }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return;
            }
            if (!needEat()) {
                return;
            }
            const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
            if (!food) {
                return;
            }
            this.bot.setStatus(`eating ${food.name} (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) {
                return;
            }
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || foodCount() === 0, 3000);
            if (Skills.effective('hitpoints') > before) {
                this.bot.countEat();
            }
        }
    }
}

class PanicRetreat implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount());
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            return;
        }
        this.bot.setStatus('panic: no food — retreating to the bank');
        this.bot.log(`panic retreat at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
        if (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))) {
            for (let i = 0; i < FOOD_WITHDRAW && !Inventory.isFull(); i++) {
                const before = foodCount();
                if (!(await Bank.withdraw(FOOD, 'Withdraw-1'))) {
                    break;
                }
                if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                    break;
                }
            }
        }
        if (foodCount() === 0) {
            this.bot.setStatus('panic: bank empty — waiting for regen');
            await Execution.delayUntil(() => Skills.hpFraction() >= 0.9 || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }
        await Bank.close();
    }
}

class BuryBones implements Task {
    constructor(private bot: AutoFighter) {}

    validate(): boolean {
        return (
            !EventSignal.pending() &&
            shouldBuryRegularBones({
                enabled: BURY_BONES,
                inCombat: Game.inCombat(),
                bankOpen: Bank.isOpen(),
                boneCount: Inventory.count(BURIAL_BONE_NAME),
                inventoryFull: Inventory.isFull()
            })
        );
    }

    async execute(): Promise<void> {
        const bones = Inventory.first(BURIAL_BONE_NAME);
        if (!bones) {
            return;
        }
        this.bot.setStatus(`burying ${BURIAL_BONE_NAME.toLowerCase()}`);
        const before = Inventory.count(BURIAL_BONE_NAME);
        if (!(await bones.interact('Bury'))) {
            this.bot.log(`no Bury op on ${BURIAL_BONE_NAME}? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.count(BURIAL_BONE_NAME) < before, 3000)) {
            this.bot.countBurial();
            this.bot.log(`buried ${BURIAL_BONE_NAME}`);
        }
    }
}

class BankRun implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        const outOfSupplies = fullyOutOfSupplies();
        if (Game.inCombat() && !outOfSupplies) {
            return false;
        }
        if (foodCount() > 0) {
            this.bot.bankFoodEmpty = false;
        }
        if (STYLE !== 'melee' && supplyMetric() >= restockThreshold()) {
            this.bot.noteSupplyEmpty(false);
        }
        return this.bot.bankAfterSolve || (AUTO_BANK && shouldBank(lootSlots(), BANK_AT, Inventory.isFull()))
            || this.bot.dueForTimedBank()
            || (foodCount() === 0 && FOOD_WITHDRAW > 0 && !this.bot.bankFoodEmpty)
            || (STYLE !== 'melee' && needStyleSupplies() && !this.bot.supplyKnownEmpty());
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.bot.bankAfterSolve = false;
            return;
        }
        const reason = this.bot.bankAfterSolve ? 'clue solved'
            : (AUTO_BANK && shouldBank(lootSlots(), BANK_AT, Inventory.isFull()))
                ? `loot ${lootSlots()}/${BANK_AT} slots or inventory full`
                : this.bot.dueForTimedBank()
                    ? `time ${this.bot.minutesSinceBank().toFixed(1)}m/${BANK_EVERY_MINUTES}m with loot`
                    : (foodCount() === 0 && FOOD_WITHDRAW > 0 && !this.bot.bankFoodEmpty)
                        ? 'out of food'
                        : STYLE !== 'melee' && needStyleSupplies()
                            ? `supplies below threshold (${supplyMetric()} < ${restockThreshold()})`
                            : 'unknown';
        this.bot.log(`BankRun triggered: ${reason}`);
        this.bot.setStatus(this.bot.bankAfterSolve ? 'clue done — banking the loot' : 'banking');
        this.bot.log(`banking at the ${bank.name} bank (${bank.tile})`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            return;
        }
        if (!(await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            return;
        }
        await Bank.depositAllMatching((name, id) => !shouldKeepBankItem(name, id, FOOD, BANK_COMMON, STYLE === 'range' ? [AMMO] : [], TRACKED_GEAR, BURY_BONES), m => this.bot.log(`  ${m}`));
        for (let guard = 0; guard < FOOD_WITHDRAW && foodCount() < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
            const before = foodCount();
            if (!(await Bank.withdraw(FOOD, 'Withdraw-1'))) {
                break;
            }
            if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                break;
            }
        }
        if (foodCount() === 0 && FOOD_WITHDRAW > 0) {
            this.bot.bankFoodEmpty = true;
            this.bot.log(`no '${FOOD}' in the bank — fighting on without food (foodless safety disarmed)`);
        }
        await this.restockStyleSupplies();
        this.bot.bankAfterSolve = false;
        this.bot.countTrip();
        this.bot.setStatus('heading back to the spot');
        // Why: an open bank left behind blocks eating and fighting at the anchor.
        await Bank.close();
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }

    private async restockStyleSupplies(): Promise<void> {
        if (STYLE === 'melee') {
            this.bot.noteSupplyEmpty(false);
            return;
        }
        if (STYLE === 'mage') {
            this.bot.setStatus('withdrawing runes');
            for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
                if (Inventory.count(rune) < count) {
                    const got = await withdrawTo(rune, count);
                    this.bot.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${count})`);
                }
            }
            const after = castsLeft();
            this.bot.log(`runes restocked: ${after} casts left (re-bank threshold ${restockThreshold()})`);
            if (after < restockThreshold()) {
                this.bot.noteSupplyEmpty(true);
                this.bot.log(`WARNING: bank can't top runes up to ${restockThreshold()} casts — pausing ammo bank runs (have ${after})`);
            } else {
                this.bot.noteSupplyEmpty(false);
            }
            return;
        }
        this.bot.setStatus(`restocking ${AMMO}`);
        const got = await withdrawTo(AMMO, AMMO_WITHDRAW);
        if (got > 0) {
            this.bot.log(`withdrew ${got} ${AMMO} (${totalAmmo()} total in quiver + inventory)`);
        }
        if (Inventory.count(AMMO) > 0 && wieldedAmmo() === 0) {
            if (await Equipment.equip(AMMO)) {
                this.bot.log(`equipped ${AMMO} (${wieldedAmmo()} in quiver)`);
            } else {
                this.bot.log(`WARNING: could not equip ${AMMO} — will retry from inventory`);
            }
        }
        const after = totalAmmo();
        if (after < restockThreshold()) {
            this.bot.noteSupplyEmpty(true);
            this.bot.log(`WARNING: bank can't supply ${AMMO} up to ${restockThreshold()} — pausing ammo bank runs (have ${after})`);
        } else {
            this.bot.noteSupplyEmpty(false);
            this.bot.log(`ammo ready: ${after} total (${wieldedAmmo()} quiver, ${Inventory.count(AMMO)} inventory)`);
        }
    }
}

async function withdrawTo(name: string, target: number): Promise<number> {
    const start = Inventory.count(name);
    for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
        const before = Inventory.count(name);
        const need = target - before;
        if (need > 10 && (await Bank.withdrawX(name, need))) {
            if (Inventory.count(name) > before) {
                continue;
            }
            break;
        }
        await Bank.withdraw(name, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
            break;
        }
    }
    return Inventory.count(name) - start;
}

class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    private announced = false;
    constructor(private bot: AutoFighter) {}
    private selected(): boolean {
        return STYLE === 'range' ? Game.combatMode() === RANGE_MODE : Game.hasCombatStyle(MELEE_STYLE);
    }
    validate(): boolean {
        // Why: com_mode is not persisted, so it is re-asserted whenever it disagrees.
        // Why: style clicks are legal mid-fight, so this does not gate on !inCombat, continuous combat starves an out-of-combat-only assert after DCs or failed first clicks.
        return STYLE !== 'mage' && !this.selected() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        if (STYLE === 'range') {
            Game.setCombatMode(RANGE_MODE);
        } else {
            Game.setCombatStyle(MELEE_STYLE);
        }
        if (await Execution.delayUntil(() => this.selected(), 3000)) {
            this.fails = 0;
            if (!this.announced) {
                this.announced = true;
                if (STYLE === 'range') {
                    this.bot.log(`ranged style set to ${RANGE_MODE === 0 ? 'accurate' : RANGE_MODE === 1 ? 'rapid' : 'longrange'}`);
                } else {
                    const resolution = Game.combatStyleResolution(MELEE_STYLE);
                    this.bot.log(`combat style: ${resolution ? describeCombatStyle(resolution) : MELEE_STYLE}`);
                }
            }
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`could not set the ${STYLE} attack style (combat tab not ready?) — retrying in 60s`);
        }
    }
}

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        if (STYLE !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        if (castsLeft() < 1) {
            return false;
        }
        return Autocast.staffTabAttached();
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`arming autocast: ${SPELL}`);
        await Execution.delayTicks(3);
        if (await Autocast.arm(SPELL, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}' — retrying in 60s (check spell/level, and that a staff is wielded).`);
        }
    }
}

// Why: Fight.validate is false while already in combat, so a retaliation fight would never reach the inline arm.
class ArmSpecial implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return Date.now() >= this.retryAt && specialDue();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('arming the special attack');
        if (await armSpecial(this.bot)) {
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`WARNING: could not arm the ${Special.wielded()} special (combat tab not ready?) — retrying in 60s`);
        }
    }
}

class ReequipGear implements Task {
    private lastFailLogAt = 0;
    constructor(private bot: AutoFighter) {}
    private candidates(): string[] {
        const gear = [...TRACKED_GEAR];
        if (STYLE === 'range' && !gear.some(g => g.toLowerCase() === AMMO.toLowerCase())) {
            gear.push(AMMO);
        }
        return gear;
    }
    validate(): boolean {
        return this.candidates().some(g => !Equipment.contains(g) && Inventory.first(g) !== null);
    }
    async execute(): Promise<void> {
        for (const item of this.candidates()) {
            if (Equipment.contains(item)) {
                continue;
            }
            const inv = Inventory.first(item);
            if (!inv) {
                continue;
            }
            this.bot.setStatus(`re-equipping ${item}`);
            if (await Equipment.equip(item)) {
                this.bot.log(`equipped ${item}`);
            } else if (Date.now() > this.lastFailLogAt) {
                this.lastFailLogAt = Date.now() + 30_000;
                this.bot.log(`WARNING: could not equip ${item} (not wieldable / no weapon slot?) — retrying`);
            }
        }
    }
}

class Fight implements Task {
    constructor(private bot: AutoFighter) {}
    private findTarget() {
        const q = Npcs.query()
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(ANCHOR) <= LEASH);
        const names = targetNames();
        if (names.length > 0) {
            q.name(...names);
        }
        return q.nearest();
    }
    private track(engaged: Npc): Npc | null {
        const names = targetNames();
        return Npcs.all().find(n => n.index === engaged.index && names.some(name => matchesEntityName(n.name, name))) ?? null;
    }
    validate(): boolean {
        return !Game.inCombat() && !needEat() && this.findTarget() !== null;
    }
    async execute(): Promise<void> {
        const target = this.findTarget();
        if (!target) {
            return;
        }
        this.bot.setStatus(`attacking ${target.name} at ${target.tile()}`);
        const status = await Reach.entityOp({
            find: () => this.track(target),
            op: 'Attack',
            expect: () => Game.inCombat() || ChatDialog.canContinue(),
            // a wandering target postpones the server's can't-reach verdict forever,
            // so probe the scene and open the blocking door ourselves (#293)
            openWhenUnreachable: true,
            expectMs: 5000,
            what: target.name ?? undefined,
            log: message => this.bot.log(message)
        });
        if (status !== 'done' || ChatDialog.canContinue()) {
            return;
        }
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) {
                return;
            }
            if (needEat() || Skills.hpFraction() < PANIC_AT) {
                return;
            }
            if (STYLE === 'range' && wieldedAmmo() < restockThreshold() && Inventory.count(AMMO) > 0) {
                this.bot.log(`ammo in quiver below ${restockThreshold()} — reloading from inventory`);
                return;
            }
            if (fullyOutOfSupplies()) {
                this.bot.log(`out of ${STYLE === 'mage' ? 'runes' : 'ammo'} — breaking off to restock`);
                return;
            }
            const cur = this.track(target);
            if (!cur || (cur.health === 0 && cur.snap.totalHealth > 0)) {
                if (cur) {
                    await Execution.delayUntil(() => this.track(target) === null, 10_000);
                }
                this.bot.countKill();
                await Execution.delayTicks(2);
                return;
            }
            if (!Game.inCombat() && !cur.inCombat) {
                return;
            }
            // Why: inline, not left to the sibling task, this loop owns the bot until the target dies.
            await armSpecial(this.bot);
            await Execution.delayTicks(2);
        }
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6 && !Game.inCombat();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the spot');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }
}
