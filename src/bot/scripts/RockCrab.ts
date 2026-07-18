import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, parseBankStrategy } from '../api/Banking.js';
import { ClueExecutor } from '../clues/ClueExecutor.js';
import { SolveClue } from '../clues/SolveClue.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle } from '../api/CombatStyle.js';
import { Autocast } from '../api/combat/Autocast.js';
import { castsAvailable, runeWithdrawList, spellButtonCom } from '../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../api/combat/data/spelldb.js';
import { sweepPlan } from '../api/combat/AmmoLogic.js';
import type { GroundItem } from '../api/queries/GroundItems.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import { Sustain } from '../api/Sustain.js';
import { DEFAULT_SPOTS } from './RockCrabSpots.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// The rock crab field east of Rellekka, on the northern shoreline (verified
// live: dormant "Rocks" NPCs at x 2694-2719, z 3714-3729; walking adjacent
// wakes them into attacking "Rock Crab" lvl 13). Two clusters share one
// scene, so the whole spot is reachable with scene-local walking. The stand
// spots the bot rotates between (loc1-5, defaults in RockCrabSpots.ts) are
// tiles whose 3x3 square touches 2-3 dormant spawns.
// Inland reset tile, ~21 tiles south of the field — far enough that the crabs
// de-aggro and revert, so walking back in wakes them again (the "run out and
// back" reset).
const DEFAULT_RESET = new Tile(2712, 3699, 0);
// Seers' Village bank — the nearest bank to the Rellekka shoreline (the game
// says so: quest_viking/viking_peer.rs2). Coords are the verified Seers bank
// zone (firemaking bank_zones: mapsquare 42,54 -> x 2721-2730, z 3487-3497).
// The exact walkable stand tile next to a booth may need a nudge on the first
// live run.
const DEFAULT_BANK = new Tile(2725, 3491, 0);
const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';
const MAX_FAILED_WAKES = 3; // consecutive dud wakes => area is de-aggro'd
// How close to the field centre counts as "regrouped" for the run-back step.
const CENTRE_RADIUS = 2;
// The local player's render-alias slot in reader.players() — filtered out of
// "other players" checks in case the scene list ever carries it.
const LOCAL_PLAYER_SLOT = 2047;

// Valuables to grab off the ground. Both crystal-key halves share the item
// name "Half of a key"; the rest are the notable rock-crab drops.
const DEFAULT_LOOT = 'half of a key, casket, clue scroll, small oyster pearls, oyster pearls, uncut sapphire, uncut emerald, uncut ruby, uncut diamond';

/** Every edible the era banks stock (single-item foods + the multi-bite
 *  bakes the FOOD_FORMS table below knows how to eat down). */
const FOOD_OPTIONS = [
    'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout', 'Pike', 'Bass', 'Herring', 'Sardine', 'Anchovies', 'Shrimps',
    'Cooked meat', 'Cooked chicken', 'Bread', 'Stew',
    'Cake', 'Chocolate cake', 'Plain pizza', 'Meat pizza', 'Anchovy pizza', 'Pineapple pizza', 'Redberry pie', 'Meat pie', 'Apple pie'
];

// XP/hr tracks every stat this bot can train, whatever the style.
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'];

/** minutes → h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const s = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const AMMO_OPTIONS = ['Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow', 'Ogre arrow', 'Bolts', 'Barbed bolts'];

const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_ARMED = { key: 'combatStyle', anyOf: ['mage', 'range'] };

/** Tunable parameters (panel + `?RockCrab.<key>=...`). The field/reset tiles
 *  let you point it at a different rock-crab spot entirely. Grouped for the
 *  panel; style-specific rows show only under their combatStyle. */
export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage', 'range'], label: 'Combat style' },

    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE, help: 'rapid trains Ranged fastest; longrange splits xp with Defence' },
    weapon: { type: 'string', default: '', label: 'Weapon', group: 'Combat', showIf: SHOW_ARMED, help: 'wielded item, withdrawn from bank when missing — e.g. Staff of fire, Shortbow' },
    spell: { type: 'string', default: 'Wind Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    ammo: { type: 'string', default: 'Bronze arrow', options: AMMO_OPTIONS, label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 200, min: 1, max: 1000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },
    minStack: { type: 'number', default: 1, min: 1, max: 50, label: 'Ignore arrow stacks smaller than', group: 'Combat', showIf: SHOW_RANGE, help: 'every kill sweeps your arrows off the ground; stacks below this size are not worth the walk' },
    collectRange: { type: 'number', default: 12, min: 2, max: 30, label: 'Arrow sweep range (tiles)', group: 'Combat', showIf: SHOW_RANGE },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    eatAtHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    fightHpGate: { type: 'number', default: 40, min: 0, max: 100, label: 'Retreat below HP%', group: 'Food & healing' },
    restUntilHp: { type: 'number', default: 75, min: 0, max: 100, label: 'Rest until HP% (no-food fallback)', group: 'Food & healing' },

    loc1: { type: 'tile', default: DEFAULT_SPOTS[0], label: 'Spot 1 (x,z)', group: 'Field', help: 'stand tiles whose 3x3 square touches 2-3 Rocks spawns; switch the active spot live from the paint. Set a slot to 0,0 to disable it.' },
    loc2: { type: 'tile', default: DEFAULT_SPOTS[1], label: 'Spot 2 (x,z)', group: 'Field' },
    loc3: { type: 'tile', default: DEFAULT_SPOTS[2], label: 'Spot 3 (x,z)', group: 'Field' },
    loc4: { type: 'tile', default: DEFAULT_SPOTS[3], label: 'Spot 4 (x,z)', group: 'Field' },
    loc5: { type: 'tile', default: DEFAULT_SPOTS[4], label: 'Spot 5 (x,z)', group: 'Field' },
    resetTile: { type: 'tile', default: DEFAULT_RESET, label: 'Run-out reset tile (x,z)', group: 'Field' },
    fieldRadius: { type: 'number', default: 15, min: 5, max: 30, label: 'Field radius (tiles)', group: 'Field' },
    stack: { type: 'number', default: 3, min: 1, max: 8, label: 'Crabs to stack before clearing', group: 'Field' },

    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Seers)', group: 'Banking & loot' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot item names', group: 'Banking & loot' },
    ...Object.fromEntries(Object.entries(PERIODIC_BANK_SETTINGS).map(([key, def]) => [key, { ...def, group: 'Banking & loot' }])),

    solveClues: { type: 'boolean', default: true, label: 'Solve easy clues', group: 'Clues' },
    spade: { type: 'string', default: 'Spade', label: 'Spade item (dig clues)', group: 'Clues' }
};

// Active run config — set from settings in onStart. Safe as module state
// because exactly one script runs at a time (ADR-0006).
// The configured stand spots (loc1-5, zero/duplicate slots filtered) and the
// index of the one currently worked. The spot is STATIC: nothing in the task
// loop ever changes it — only the paint's live spot selector (and the
// nearest-spot pick at start) sets locIdx.
let LOCS: Tile[] = [...DEFAULT_SPOTS];
let locIdx = 0;
let RESET_TILE = DEFAULT_RESET;
let BANK_TILE = DEFAULT_BANK;
let FIELD_RADIUS = 15;
let DESIRED_STACK = 3;
let FIGHT_HP_GATE = 0.4;
let REST_HP = 0.75;
let EAT_HP = 0.5;
let FOOD_NAME = 'Lobster';
let FOOD_WITHDRAW = 20;
let LOOT_NAMES = DEFAULT_LOOT.split(',').map(s => s.trim());
let BANK_COMMON = true;
let SOLVE_CLUES = true;
let SPADE_NAME = 'Spade';
let STYLE: 'melee' | 'mage' | 'range' = 'melee';
let MELEE_MODE = 1; // com_mode: 0 accurate/Attack, 1 aggressive/Strength, 2 defensive/Defence
let RANGE_MODE = 1; // com_mode: 0 accurate, 1 rapid, 2 longrange
let WEAPON = '';
let SPELL = 'Wind Strike';
let RUNES_WITHDRAW = 150;
let AMMO = 'Bronze arrow';
let AMMO_WITHDRAW = 200;
let MIN_STACK = 1;
let COLLECT_RANGE = 12;


/**
 * Rock crab trainer for the Rellekka shoreline. Walks among the dormant
 * "Rocks" to aggro them; once the stack is built it runs back to the field
 * centre so the crabs pile up there, then kills the pile. Eats food to sustain,
 * and when it runs out it web-walks to the Seers' Village bank, withdraws more,
 * and returns. Loots key halves and other valuables, and runs out-and-back to
 * reset aggression when the rocks stop waking. Start it anywhere — it web-walks
 * to the field first. Handles every random event via the shared handler.
 */
export default class RockCrab extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private deaths = 0;
    private resets = 0;
    private bankTrips = 0;
    private failedWakes = 0;
    private bankKnownEmpty = false;
    private weaponMissing = false;
    private styleSupplyEmpty = false;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private cluesSolved = 0;
    private lootCounts = new Map<string, number>();
    private solveClue: SolveClue | undefined;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        // loc1-5 → the spot list: zero-coord slots are disabled, duplicates
        // collapse, and an all-disabled config falls back to the presets. Start
        // at the spot nearest the player so a mid-field relaunch stays put;
        // after that only the paint's spot selector changes it.
        const slots = [1, 2, 3, 4, 5].map(i => this.settings.tile(`loc${i}`, DEFAULT_SPOTS[i - 1]));
        const seen = new Set<string>();
        LOCS = slots.filter(t => {
            const key = `${t.x},${t.z}`;
            if (t.x <= 0 || t.z <= 0 || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
        if (LOCS.length === 0) {
            LOCS = [...DEFAULT_SPOTS];
        }
        const here = Game.tile();
        locIdx = here === null ? 0 : LOCS.reduce((best, t, i) => (t.distanceTo(here) < LOCS[best].distanceTo(here) ? i : best), 0);
        RESET_TILE = this.settings.tile('resetTile', DEFAULT_RESET);
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);
        FIELD_RADIUS = this.settings.num('fieldRadius', 15);
        DESIRED_STACK = this.settings.num('stack', 3);
        FIGHT_HP_GATE = this.settings.num('fightHpGate', 40) / 100;
        REST_HP = this.settings.num('restUntilHp', 75) / 100;
        EAT_HP = this.settings.num('eatAtHp', 50) / 100;
        FOOD_NAME = this.settings.str('food', 'Lobster');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_NAMES = this.settings.list('loot', LOOT_NAMES).map(s => s.toLowerCase());
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        SPADE_NAME = this.settings.str('spade', 'Spade');
        STYLE = this.settings.str('combatStyle', 'melee').toLowerCase() as typeof STYLE;
        MELEE_MODE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        WEAPON = this.settings.str('weapon', '');
        SPELL = this.settings.str('spell', 'Wind Strike');
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        AMMO = this.settings.str('ammo', 'Bronze arrow');
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 200);
        MIN_STACK = this.settings.num('minStack', 1);
        COLLECT_RANGE = this.settings.num('collectRange', 12);
        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                }
                this.setStatus(s);
            },
            isFood: isFoodItem,
            foodName: () => FOOD_NAME,
            foodWithdraw: () => FOOD_WITHDRAW,
            spadeName: () => SPADE_NAME,
            enabled: () => SOLVE_CLUES
        });

        const styleNote = STYLE === 'mage' ? `, mage '${SPELL}' w/ '${WEAPON || '(no weapon set)'}'` : STYLE === 'range' ? `, range '${AMMO}' w/ '${WEAPON || '(no weapon set)'}' (${this.settings.str('rangeStyle', 'rapid')}, sweep>=${MIN_STACK})` : ` (${this.settings.str('meleeStyle', 'strength')})`;
        this.log(`RockCrab starting — spots [${LOCS.map(t => `${t.x},${t.z}`).join(' | ')}] starting at ${currentSpot()} r${FIELD_RADIUS}, stack ${DESIRED_STACK}, food '${FOOD_NAME}' (eat<${Math.round(EAT_HP * 100)}%), bank ${BANK_TILE}, style ${STYLE}${styleNote}`);
        if (STYLE === 'mage' && spellButtonCom(SPELL) === -1) {
            this.log(`WARNING: '${SPELL}' is not an autocastable spell (Wind/Water/Earth/Fire Strike, Bolt, Blast or Wave) — autocast will not arm`);
        }
        if (STYLE !== 'melee' && WEAPON === '') {
            this.log(`WARNING: no weapon configured for style '${STYLE}' — fighting with whatever is wielded`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        // eat mid-walk/mid-clue-solve: hostiles chip HP on long walks and the
        // Eat task can't run while a walk or solve holds the task loop
        Sustain.set(async () => {
            if (Skills.hpFraction() < EAT_HP && hasFood()) {
                await eatOnce(this);
            }
        });

        this.add(
            new DeathRecovery(this, {
                // static anchor: recovery always returns to spot 1 (locIdx is
                // reset to match in onRecovered)
                anchor: LOCS[0],
                radius: 4,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.countDeath();
                    this.solveClue?.noteDeath(); // died mid-solve: force a food re-bank before resuming a retained clue
                    this.log('died! waiting for respawn, then web-walking back to the field');
                },
                onRecovered: () => {
                    // locIdx is untouched: the player's paint-selected spot
                    // survives a death; the loop re-converges on it from here.
                    this.died = false;
                }
            }),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new CollectAmmo(this), // before SolveClue/BankRun: sweep arrows before anything walks us out
            this.solveClue!,
            new BankRun(this),
            new PeriodicBank({
                strategy: () => parseBankStrategy(this.settings.str('bankStrategy', 'Off')),
                itemsThreshold: () => this.settings.num('bankEveryItems', 15),
                minutesThreshold: () => this.settings.num('bankEveryMinutes', 10),
                countLoot: () => Inventory.items().filter(i => LOOT_NAMES.includes((i.name ?? '').toLowerCase())).length,
                deposit: (name) => LOOT_NAMES.includes(name.toLowerCase()),
                commonJunk: () => BANK_COMMON,
                returnTo: () => currentSpot(),
                setStatus: (s) => this.setStatus(s),
                log: (m) => this.log(m)
            }),
            new GoToField(this),
            new LootValuables(this),
            new RegroupAtField(this),
            new Fight(this),
            new Aggro(this),
            new ResetAggro(this)
        );
    }

    override grindTargets(): string[] {
        return ['rock crab', 'rocks'];
    }

    override recoveryAnchor(): Tile | null {
        return currentSpot();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ad0ff' });
        p.title(`RockCrab — ${this.status}`);

        const tab = p.tabs('rc', ['Overview', 'Loot', 'Clues']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            const xpGained = COMBAT_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
            const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
            const styleCol = STYLE === 'mage' ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}` : STYLE === 'range' ? `Quiver: ${quiverCount()}  ground ${ammoStacksOnGround().reduce((n, g) => n + g.count, 0)}` : `Resets: ${this.resets}`;
            p.row(`Food: ${foodCount()}`, styleCol, this.deaths ? `Deaths: ${this.deaths}` : `Banks: ${this.bankTrips}`);
            p.bar('HP', Skills.hpFraction());
        } else if (tab === 'Loot') {
            p.row(`Looted: ${this.looted}`, `Bank trips: ${this.bankTrips}`);
            const top = [...this.lootCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
            if (top.length === 0) {
                p.text('nothing yet', '#8a919a');
            }
            for (let i = 0; i < top.length; i += 2) {
                p.row(...top.slice(i, i + 2).map(([name, n]) => `${name} × ${n}`));
            }
        } else {
            const cur = ClueExecutor.current;
            p.row(`Solved: ${this.solveClue?.clueStatus() === 'idle' ? '' : ''}${this.cluesSolved}`, `Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            if (cur) {
                p.text(`${cur.name} — leg ${cur.leg}${cur.attempt > 1 ? ` (try ${cur.attempt})` : ''}`);
                p.text(cur.step, '#8a919a');
            } else {
                p.text(SOLVE_CLUES ? 'watching the pack for clues' : 'clue solving disabled', '#8a919a');
            }
        }

        p.gap();
        // live controls — style switch converges via the gear/banking tasks
        const styleNow = this.settings.str('combatStyle', STYLE);
        const picked = p.select('style', 'style', ['melee', 'mage', 'range'], styleNow);
        if (picked && picked !== STYLE) {
            this.switchStyle(picked as typeof STYLE);
        }
        // spot selector — the ONLY thing that changes the active spot; the
        // loop re-anchors on it (regroup/walk-backs) without any forced walk
        if (LOCS.length > 1) {
            const spotNow = `${locIdx + 1} @ ${currentSpot().x},${currentSpot().z}`;
            const spotPick = p.select('spot', 'spot', LOCS.map((t, i) => `${i + 1} @ ${t.x},${t.z}`), spotNow);
            const pickedIdx = spotPick ? LOCS.findIndex((t, i) => `${i + 1} @ ${t.x},${t.z}` === spotPick) : -1;
            if (pickedIdx >= 0 && pickedIdx !== locIdx) {
                locIdx = pickedIdx;
                this.log(`spot switched to ${locIdx + 1}/${LOCS.length} (${currentSpot().x},${currentSpot().z})`);
            }
        }
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    /** Live style switch from the paint: update the run config + persist; the
     *  gear/banking/autocast tasks converge on the new style by themselves. */
    private switchStyle(style: typeof STYLE): void {
        STYLE = style;
        SettingsStore.save('RockCrab', 'combatStyle', style);
        this.log(`combat style switched to ${style} (from the paint)`);
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    killsTotal(): number {
        return this.kills;
    }
    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
    }
    countDeath(): void {
        this.deaths++;
    }
    countReset(): void {
        this.resets++;
    }
    countBankTrip(): void {
        this.bankTrips++;
    }
    noteBankEmpty(empty: boolean): void {
        this.bankKnownEmpty = empty;
    }
    bankIsKnownEmpty(): boolean {
        return this.bankKnownEmpty;
    }
    noteWeaponMissing(): void {
        this.weaponMissing = true;
    }
    weaponKnownMissing(): boolean {
        return this.weaponMissing;
    }
    noteStyleSupplyEmpty(empty: boolean): void {
        this.styleSupplyEmpty = empty;
    }
    styleSupplyKnownEmpty(): boolean {
        return this.styleSupplyEmpty;
    }
    noteWake(success: boolean): void {
        this.failedWakes = success ? 0 : this.failedWakes + 1;
    }
    deAggroed(): boolean {
        return this.failedWakes >= MAX_FAILED_WAKES;
    }
    clearWakes(): void {
        this.failedWakes = 0;
    }
}

/** The stand spot currently worked — the anchor every field query/walk uses. */
function currentSpot(): Tile {
    return LOCS[locIdx % LOCS.length];
}

function inField(tile: Tile): boolean {
    return currentSpot().distanceTo(tile) <= FIELD_RADIUS;
}

/** True once we've stacked enough crabs (or there are no more rocks to gather). */
function stackReady(): boolean {
    const crabs = activeCrabs().length;
    return crabs >= DESIRED_STACK || (crabs >= 1 && dormantRocks().length === 0);
}

/** True when we're standing at (within CENTRE_RADIUS of) the current spot. */
function atCentre(): boolean {
    const here = Game.tile();
    return here !== null && currentSpot().distanceTo(Tile.from(here)) <= CENTRE_RADIUS;
}

// Multi-bite foods eat DOWN through intermediate items (a cake is 3 items:
// Cake -> 2/3 cake -> Slice of cake), so an exact name match would stop seeing
// it as food after the first bite. List every edible form, keyed by the full
// item you'd bank/withdraw. Anything not listed is treated as a single-item food.
const FOOD_FORMS: Record<string, string[]> = {
    'cake': ['cake', '2/3 cake', 'slice of cake'],
    'chocolate cake': ['chocolate cake', '2/3 chocolate cake', 'chocolate slice'],
    'plain pizza': ['plain pizza', '1/2 plain pizza'],
    'meat pizza': ['meat pizza', '1/2 meat pizza'],
    'anchovy pizza': ['anchovy pizza', '1/2 anchovy pizza'],
    'pineapple pizza': ['pineapple pizza', '1/2 pineapple pizza'],
    'redberry pie': ['redberry pie', 'half a redberry pie'],
    'meat pie': ['meat pie', 'half a meat pie'],
    'apple pie': ['apple pie', 'half an apple pie']
};

/** Every edible form of the configured food (all 3 slices of a cake, etc.). */
function foodForms(): string[] {
    const key = FOOD_NAME.toLowerCase();
    return FOOD_FORMS[key] ?? [key];
}

/** True if an item is one of the edible forms of the configured food. */
function isFoodItem(name: string | null | undefined): boolean {
    return foodForms().includes((name ?? '').toLowerCase());
}

/** Edible food items in the pack, counting part-eaten cakes/pizzas/pies too. */
function foodCount(): number {
    return Inventory.items().filter(i => isFoodItem(i.name)).length;
}

function hasFood(): boolean {
    return foodCount() > 0;
}

// ---- combat-style helpers (mage/range) ----

function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}

/** Ammo count in the worn quiver slot. */
function quiverCount(): number {
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === AMMO.toLowerCase())?.count ?? 0;
}

/** Full casts of the configured spell affordable with the held runes. */
function castsLeft(): number {
    return castsAvailable(SPELL, wieldedNames(), rune => Inventory.count(rune));
}

/** Our fired-ammo stacks on the ground in the field. */
function ammoStacksOnGround(): GroundItem[] {
    return GroundItems.query()
        .where(g => (g.name ?? '').toLowerCase() === AMMO.toLowerCase() && inField(g.tile()))
        .results();
}

function stackKey(g: GroundItem): string {
    const t = g.tile();
    return `${t.x}|${t.z}|${t.level}`;
}

/** Out of the style's consumable with nothing recoverable in the field. */
function needStyleSupplies(): boolean {
    if (STYLE === 'mage') {
        return castsLeft() < 1;
    }
    if (STYLE === 'range') {
        return quiverCount() === 0 && Inventory.count(AMMO) === 0 && ammoStacksOnGround().length === 0;
    }
    return false;
}

/** A clue solve is about to walk us out of the field. */
function cluePending(): boolean {
    return SOLVE_CLUES && Inventory.items().some(i => (i.name ?? '').toLowerCase() === 'clue scroll');
}

/** Sweep our fired ammo off the ground: every stack within COLLECT_RANGE, at
 *  least MIN_STACK big (force takes the small ones too), nearest first. Runs
 *  after each kill and on the leave-field/empty-quiver forces. Returns the
 *  number of stacks collected. */
async function sweepAmmoOnce(bot: RockCrab, force: boolean): Promise<number> {
    const stacks = ammoStacksOnGround();
    const plan = new Set(
        sweepPlan(
            stacks.map(g => ({ key: stackKey(g), count: g.count, distance: g.distance() })),
            { minStack: MIN_STACK, range: COLLECT_RANGE, force }
        )
    );
    let collected = 0;
    for (const stack of stacks) {
        if (EventSignal.pending() || bot.died || !plan.has(stackKey(stack))) {
            continue;
        }
        const before = Inventory.count(AMMO);
        await stack.interact('Take');
        if (await Execution.delayUntil(() => Inventory.count(AMMO) > before, 5000)) {
            collected++;
            bot.log(`swept ${Inventory.count(AMMO) - before} ${AMMO} off the ground`);
        }
    }
    // straight into the quiver so the pack stays free for loot
    if (Inventory.count(AMMO) > 0) {
        await quiverPackAmmo();
    }
    return collected;
}

/** Wield pack ammo into the quiver — ALWAYS dispatches the Wield op (unlike
 *  Equipment.equip, which short-circuits when any ammo is already worn, so a
 *  top-up would never move). True once the pack count dropped / no ammo held. */
async function quiverPackAmmo(): Promise<boolean> {
    const item = Inventory.first(AMMO);
    if (!item) {
        return true;
    }
    const op = item.actions().find(o => /wield|wear|equip/i.test(o));
    if (!op) {
        return false;
    }
    const before = Inventory.count(AMMO);
    await item.interact(op);
    return Execution.delayUntil(() => Inventory.count(AMMO) < before, 3000);
}

/** Eat one piece of food if we have any (any form); resolves true if HP went up. */
async function eatOnce(bot: RockCrab): Promise<boolean> {
    const food = Inventory.items().find(i => isFoodItem(i.name));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    await food.interact('Eat');
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

/** Active, attackable crabs inside the field that are OURS to fight — free or
 *  engaging us. A crab locked onto ANOTHER player is their stack: skipping it
 *  here keeps Fight off it, keeps it out of the stack count, and keeps Aggro
 *  topping OUR pile up instead. If someone invades OUR spot the same rule
 *  still fights the crabs facing us and leaves theirs alone. */
function activeCrabs(): Npc[] {
    return Npcs.query()
        .name('Rock Crab')
        .where(n => inField(n.tile()) && !n.targetsAnotherPlayer())
        .results();
}

/** Dormant "Rocks" NPCs (not the mining loc of the same name) inside the
 *  field — minus any sitting in another player's lap (within 2 of them):
 *  waking those is barging into an occupied spot's respawn cycle. */
function dormantRocks(): Npc[] {
    const others = Players.query()
        .where(p => p.index !== LOCAL_PLAYER_SLOT && inField(p.tile()))
        .results();
    return Npcs.query()
        .name('Rocks')
        .where(n => inField(n.tile()) && !others.some(p => n.tile().distanceTo(p.tile()) <= 2))
        .results();
}

/** Eat food when HP dips below the eat gate (primary HP management). */
class Eat implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        return Skills.hpFraction() < EAT_HP && hasFood();
    }

    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

/** Wield the style weapon / stow loose arrows whenever they're in the pack
 *  (start, post-bank, post-death salvage). No walking — BankRun owns trips.
 *  Bounded fails so an un-wieldable item can't starve the loop below it. */
class GearEquip implements Task {
    private fails = 0;

    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (STYLE === 'melee' || this.fails >= 5) {
            return false;
        }
        if (WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) !== null) {
            return true;
        }
        // loose arrows in the pack (withdrawn or collected) belong in the quiver
        return STYLE === 'range' && Inventory.count(AMMO) > 0;
    }

    async execute(): Promise<void> {
        if (WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) !== null) {
            this.bot.setStatus(`wielding ${WEAPON}`);
            if (await Equipment.equip(WEAPON)) {
                this.bot.log(`wielded ${WEAPON}`);
                this.fails = 0;
            } else {
                this.fails++;
            }
            return;
        }
        if (await quiverPackAmmo()) {
            this.bot.log(`quivered ${AMMO} — ${quiverCount()} carried`);
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.bot.log(`WARNING: could not move '${AMMO}' from the pack to the quiver after 5 tries`);
        }
    }
}

/** Keep the attack style on the configured com_mode (ArdyFighter shape) —
 *  melee attack/strength/defence, ranged accurate/rapid/longrange (bow0/1/2
 *  share the same varp). Not persisted, so this re-asserts once per session
 *  and again if a weapon swap resets it. Mage owns its style via autocast. */
// Failed style/autocast asserts retry in bounded batches with a cooldown
// between them — NEVER permanently. A DC used to burn the old hard cap in
// seconds against the still-loading post-relogin UI, leaving the style wrong
// for the rest of the session (live-hit: came back from a DC stuck off rapid).
const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;

    constructor(private bot: RockCrab) {}

    private target(): number {
        return STYLE === 'range' ? RANGE_MODE : MELEE_MODE;
    }

    validate(): boolean {
        // com_mode isn't persisted: this re-fires whenever the varp disagrees —
        // session start, after a DC/relogin, after a weapon swap. Deliberately
        // NOT gated on !inCombat: rock crabs keep you in combat near-constantly,
        // so an out-of-combat-only assert never gets a window at the pile (the
        // post-DC stuck-off-rapid failure). Style clicks are legal mid-fight.
        return STYLE !== 'mage' && Game.combatMode() !== this.target() && Date.now() >= this.retryAt;
    }

    async execute(): Promise<void> {
        const mode = this.target();
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(mode);
        const ok = await Execution.delayUntil(() => Game.combatMode() === mode, 3000);
        if (ok) {
            this.fails = 0;
            const label = STYLE === 'range' ? ['accurate', 'rapid', 'longrange'][mode] : `${['accurate', 'aggressive', 'defensive'][mode]} (training ${['Attack', 'Strength', 'Defence'][mode]})`;
            this.bot.log(`combat style: ${label ?? '?'}`);
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not set the ${STYLE} attack style (combat tab not ready?) — retrying in ${ASSERT_RETRY_MS / 1000}s`);
        }
    }
}

/** Arm the staff's autocast spell — the style varp resets on every login, so
 *  this re-fires after DCs too. Failed batches back off (ASSERT_RETRY_MS)
 *  rather than dying for the session. */
class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;

    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (STYLE !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        // Arming needs the spell's runes IN THE PACK: the engine's set_autocast_spell
        // runs check_spell_requirements (magic.rs2), which fails on missing runes, so
        // the select silently no-ops and arm() times out. Without this gate — and
        // because ArmAutocast outranks BankRun — a fresh mage with no runes spins a
        // futile arm batch every loop instead of letting BankRun stock runes first.
        // castsLeft() accounts for a rune-providing staff (matches staff_runes), so
        // >=1 means the select can actually take. Deferring here hands the loop to
        // BankRun, which restocks runes; we then arm cleanly on the next pass.
        if (castsLeft() < 1) {
            return false;
        }
        // staff tab attached, or the staff is at least worn (a stale combat
        // tab still deserves attempts so the failure gets LOGGED, not silent)
        return Autocast.staffTabAttached() || (WEAPON !== '' && Equipment.contains(WEAPON));
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`arming autocast: ${SPELL}`);
        await Execution.delayTicks(3); // give a fresh wield's tab swap a moment to land
        if (await Autocast.arm(SPELL, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}' — retrying in ${ASSERT_RETRY_MS / 1000}s. Check the spell name, magic level and staff; if the staff IS wielded but the combat tab stayed unarmed, this account's equip-time tab update is tutorial-gated — relog once with it wielded.`);
        }
    }
}

/**
 * Out-of-fight ammo sweeps. The primary sweep runs INSIDE Fight after each
 * kill (sweep-on-kill — see sweepAmmoOnce); this task covers the forces that
 * happen between fights: an empty quiver (grab everything now) and leaving
 * the field (bank/clue — abandon nothing). Also warns once about ground ammo
 * that doesn't match the Ammo setting (it would never be collected).
 */
class CollectAmmo implements Task {
    private warnedMismatch = false;

    constructor(private bot: RockCrab) {}

    private force(): boolean {
        const quiverDry = quiverCount() === 0 && Inventory.count(AMMO) === 0;
        return quiverDry || (!hasFood() && !this.bot.bankIsKnownEmpty()) || needStyleSupplies() || cluePending();
    }

    validate(): boolean {
        if (STYLE !== 'range') {
            return false;
        }
        if (!this.warnedMismatch && GroundItems.query().where(g => /arrow|bolt/i.test(g.name ?? '') && (g.name ?? '').toLowerCase() !== AMMO.toLowerCase() && inField(g.tile())).nearest() !== null) {
            this.warnedMismatch = true;
            this.bot.log(`WARNING: ground ammo in the field does not match the '${AMMO}' setting — those will never be collected. Fix the Ammo dropdown if they're yours.`);
        }
        const stacks = ammoStacksOnGround().map(g => ({ key: stackKey(g), count: g.count, distance: g.distance() }));
        return sweepPlan(stacks, { minStack: MIN_STACK, range: COLLECT_RANGE, force: this.force() }).length > 0;
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`sweeping ${AMMO}`);
        await sweepAmmoOnce(this.bot, this.force());
    }
}

/** Out of food or style supplies -> web-walk to the Seers bank, restock, and
 *  return to the field. Also withdraws + wields the style weapon when it's
 *  missing (start and after a death that lost it). */
class BankRun implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // restock when we've run out — unless we've already learned the bank is
        // empty of what we need (then fall back to no-food combat + resting)
        if (this.needWeapon()) {
            return true;
        }
        if (needStyleSupplies() && !this.bot.styleSupplyKnownEmpty()) {
            return true;
        }
        return !hasFood() && !this.bot.bankIsKnownEmpty();
    }

    private needWeapon(): boolean {
        return STYLE !== 'melee' && WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) === null && !this.bot.weaponKnownMissing();
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        this.bot.setStatus('restocking — walking to the bank');
        this.bot.log(`banking at ${BANK_TILE} (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''}${STYLE === 'range' ? `, ammo ${quiverCount()}` : ''}${this.needWeapon() ? `, need ${WEAPON}` : ''})`);

        // long web-walk south; the crabs de-aggro as we leave the field
        if (!(await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('walk to the bank failed — will retry');
            return;
        }

        // interact the nearest booth directly; the engine walks us to its
        // accessible side and opens it (BANK_TILE just needs to land us near it)
        if (!(await Bank.openNearest(BANK_NAME, BANK_OP, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus(`withdrawing ${FOOD_NAME}`);
        for (let guard = 0; guard < 12 && Inventory.count(FOOD_NAME) < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
            const need = FOOD_WITHDRAW - Inventory.count(FOOD_NAME);
            const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
            const before = Inventory.count(FOOD_NAME);
            await Bank.withdraw(FOOD_NAME, op);
            if (!(await Execution.delayUntil(() => Inventory.count(FOOD_NAME) > before, 2500))) {
                break; // bank out of this food, or the button didn't fire
            }
        }

        const got = Inventory.count(FOOD_NAME);
        if (got === 0) {
            this.bot.noteBankEmpty(true);
            this.bot.log(`WARNING: no '${FOOD_NAME}' in the bank — falling back to no-food combat. Deposit food (or fix the food name) and it'll resume eating.`);
        } else {
            this.bot.countBankTrip();
            this.bot.log(`withdrew ${got} ${FOOD_NAME}`);
        }

        await this.withdrawStyleSupplies();

        this.bot.setStatus('restocked — walking back to the field');
        await Traversal.walkResilient(currentSpot(), { radius: 4, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
        this.bot.clearWakes();
    }

    /** Top an item up to `target` — one Withdraw-X for the exact shortfall
     *  (ammo/rune restocks are hundreds; button-batching was 20+ click-and-wait
     *  round trips per trip), falling back to the era's 1/5/10 buttons when the
     *  item offers no X op or the count dialog doesn't open. Returns the amount
     *  gained (0 = the bank has none). */
    private async withdrawTo(name: string, target: number): Promise<number> {
        const start = Inventory.count(name);
        for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
            const before = Inventory.count(name);
            const need = target - before;
            if (need > 10 && (await Bank.withdrawX(name, need))) {
                if (Inventory.count(name) > before) {
                    continue; // got some (maybe all the bank had) — loop re-checks target
                }
                break; // X flow completed but nothing arrived — bank is dry
            }
            const op = need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1';
            await Bank.withdraw(name, op);
            if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
                break; // bank ran out, or the button didn't fire
            }
        }
        return Inventory.count(name) - start;
    }

    /** Weapon + runes/ammo for the configured style (bank already open). */
    private async withdrawStyleSupplies(): Promise<void> {
        if (this.needWeapon()) {
            this.bot.setStatus(`withdrawing ${WEAPON}`);
            if ((await this.withdrawTo(WEAPON, 1)) > 0) {
                await Equipment.equip(WEAPON);
                this.bot.log(`withdrew and wielded ${WEAPON}`);
            } else {
                this.bot.noteWeaponMissing();
                this.bot.log(`WARNING: no '${WEAPON}' in the bank — carrying on with current gear. Deposit it (or fix the weapon name) and restart to retry.`);
            }
        }

        if (STYLE === 'mage') {
            this.bot.setStatus('withdrawing runes');
            let short = false;
            for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
                const have = Inventory.count(rune);
                if (have < count) {
                    const gained = await this.withdrawTo(rune, count);
                    this.bot.log(`withdrew ${gained} ${rune} (${Inventory.count(rune)}/${count})`);
                }
                short ||= Inventory.count(rune) === 0;
            }
            if (castsLeft() < 1) {
                this.bot.noteStyleSupplyEmpty(true);
                this.bot.log(`WARNING: bank can't supply a single '${SPELL}' cast${short ? ' (a rune is missing entirely)' : ''} — deposit runes to resume casting.`);
            } else {
                this.bot.noteStyleSupplyEmpty(false);
            }
        } else if (STYLE === 'range') {
            this.bot.setStatus(`withdrawing ${AMMO}`);
            const gained = await this.withdrawTo(AMMO, AMMO_WITHDRAW);
            if (gained > 0) {
                await Equipment.equip(AMMO);
                this.bot.log(`withdrew ${gained} ${AMMO} — quiver ${quiverCount()}`);
                this.bot.noteStyleSupplyEmpty(false);
            } else if (quiverCount() === 0 && Inventory.count(AMMO) === 0) {
                this.bot.noteStyleSupplyEmpty(true);
                this.bot.log(`WARNING: no '${AMMO}' in the bank and none carried — deposit ammo to resume. Collected arrows will re-enable shooting.`);
            }
        }
    }
}

/** Web-walk to the field when we're not in it (start, post-death, post-bank). */
class GoToField implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && !inField(Tile.from(here));
    }

    async execute(): Promise<void> {
        this.bot.setStatus('walking to the field');
        const ok = await Traversal.walkResilient(currentSpot(), { radius: 4, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        if (ok) {
            this.bot.clearWakes();
        }
    }
}

/** Nearest valuable drop in the field (a configured loot name), or null. */
function findLoot() {
    return GroundItems.query()
        .where(g => LOOT_NAMES.includes((g.name ?? '').toLowerCase()))
        .within(FIELD_RADIUS)
        .nearest();
}

/** Grab the nearest valuable drop; resolves true if the pack grew. */
async function lootOnce(bot: RockCrab): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 5000)) {
        bot.countLoot(drop.name);
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

class LootValuables implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        return !Inventory.isFull() && findLoot() !== null;
    }

    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

/** After the stack is built, run back to the field centre so the crabs pile up there. */
class RegroupAtField implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // only once we've stacked enough and we're healthy; Eat/ResetAggro own low HP
        return Skills.hpFraction() >= FIGHT_HP_GATE && stackReady() && !atCentre();
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        this.bot.setStatus('regrouping — running back to the stand spot');
        // scene-local walk; the aggroed crabs chase us to the spot
        await DirectNavigator.walkTo(currentSpot(), CENTRE_RADIUS, 30000);
    }
}

/** Clear the stacked crabs at the centre; eats mid-fight when HP dips. */
class Fight implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (Skills.hpFraction() < FIGHT_HP_GATE) {
            return false; // too low to keep fighting — Eat or ResetAggro takes over
        }
        // Clear the pile only once it's stacked to size (or there are no more
        // rocks to gather). RegroupAtField runs first to drag the stack to the
        // centre; while still gathering, Aggro keeps priority.
        return stackReady();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('fighting the stack');

        const deadline = performance.now() + 120000;
        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return; // runtime event guard takes over next loop
            }
            if (this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            // eat mid-fight so we sustain without leaving the pile
            if (Skills.hpFraction() < EAT_HP && hasFood()) {
                await eatOnce(this.bot);
                continue;
            }
            if (Skills.hpFraction() < FIGHT_HP_GATE) {
                return; // out of food and low — Eat/ResetAggro handles it next loop
            }

            // grab valuable drops as they fall, without waiting for the whole
            // stack to clear (the crabs keep auto-retaliating while we step over)
            if (!Inventory.isFull() && findLoot() !== null) {
                await lootOnce(this.bot);
                continue;
            }

            const crab = activeCrabs().sort((a, b) => a.distance() - b.distance())[0];
            if (!crab) {
                return; // stack cleared
            }

            if (!Game.inCombat()) {
                await crab.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || activeCrabs().length === 0, 4000);
            } else {
                await Execution.delayTicks(2);
            }

            // count kills by watching the active-crab population fall
            const remaining = activeCrabs().length;
            if (remaining < this.lastCount) {
                for (let i = 0; i < this.lastCount - remaining; i++) {
                    this.bot.countKill();
                }
                this.bot.log(`rock crab down — ${this.bot.killsTotal()} kills total`);
                // sweep-on-kill: grab our arrows while we're standing in the pile
                if (STYLE === 'range') {
                    await sweepAmmoOnce(this.bot, false);
                }
            }
            this.lastCount = remaining;
        }
    }

    private lastCount = 0;
}

/** Walk adjacent to a dormant Rocks to wake it into an attacking Rock Crab. */
class Aggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        if (Skills.hpFraction() < FIGHT_HP_GATE || this.bot.deAggroed()) {
            return false;
        }
        return activeCrabs().length < DESIRED_STACK && dormantRocks().length > 0;
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const rocks = dormantRocks().sort((a, b) => a.distance() - b.distance())[0];
        if (!rocks) {
            return;
        }

        this.bot.setStatus(`waking rocks at ${rocks.tile()}`);
        const before = activeCrabs().length;
        const rockTile = rocks.tile();

        // walk adjacent (radius 1) — proximity fires the crab's approach AI
        await DirectNavigator.walkTo(rockTile, 1, 15000);
        // give the engine a couple ticks to flip it active
        const woke = await Execution.delayUntil(() => activeCrabs().length > before || !dormantRocks().some(r => r.tile().equals(rockTile)), 4000);

        this.bot.noteWake(woke);
        if (woke) {
            this.bot.log(`woke a rock crab — stack now ${activeCrabs().length}`);
        } else {
            this.bot.log(`rocks at ${rockTile} did not wake (${this.failsLabel()})`);
        }
    }

    private failsLabel(): string {
        return this.bot.deAggroed() ? 'area de-aggroed — will reset' : 'retrying';
    }
}

/** Run out of the field and back to reset aggression, or (with no food) to regen HP. */
class ResetAggro implements Task {
    constructor(private bot: RockCrab) {}

    validate(): boolean {
        // reset when the rocks stopped waking, or when we're low with no food to
        // eat (the no-food fallback: drop aggro at the reset tile and regen)
        return this.bot.deAggroed() || (Skills.hpFraction() < FIGHT_HP_GATE && !hasFood() && !Game.inCombat());
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return; // runtime event guard takes over next loop
        }
        const low = Skills.hpFraction() < FIGHT_HP_GATE;
        this.bot.setStatus(low ? 'low HP, no food — retreating to regen' : 'running out to reset aggression');
        this.bot.countReset();

        await DirectNavigator.walkTo(RESET_TILE, 1, 60000);

        if (low) {
            this.bot.log(`resting at the reset tile (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
            await Execution.delayUntil(() => Skills.hpFraction() >= REST_HP, 120000);
        } else {
            // brief pause so the crabs fully revert before we walk back in
            await Execution.delayTicks(3);
        }

        await DirectNavigator.walkTo(currentSpot(), 3, 60000);
        this.bot.clearWakes();
        this.bot.log('back in the field');
    }
}
