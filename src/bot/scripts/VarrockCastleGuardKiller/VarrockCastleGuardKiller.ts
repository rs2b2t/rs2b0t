import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npc } from '../../api/model/Npc.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    BANK_STAND,
    CAMP_RADIUS,
    CANT_REACH_RE,
    COMBAT_TRACK,
    DEATH_RE,
    FOOD_OPTIONS,
    FOOD_TYPES,
    GROUND_SCAN_RADIUS,
    GUARD_CAMP,
    LOOT_DEFS,
    OWN_LOOT_MS,
    OWN_LOOT_RADIUS,
    STYLE_OPTIONS,
    STYLE_RANDOM,
    buildWithdrawPlan,
    cheb,
    clampFoodAmount,
    clampLevels,
    clampPercent,
    describeFood,
    distToBank,
    fmtElapsed,
    fmtXph,
    hpPercent,
    inCamp,
    inCourtyard,
    isBoneName,
    isCastleGuardName,
    isFoodType,
    isKeepOnDeposit,
    isRandomStyleMode,
    isShutDoor,
    isStyleMode,
    locActions,
    needEat,
    needPanicExit,
    openDoorOp,
    pickLowestStyle,
    pickRandomStyle,
    shouldLootName,
    shouldRotateStyle,
    type FoodType,
    type StyleMode,
    type TrainableStyle
} from './VarrockCastleGuardKillerLogic.js';

const SCRIPT_VERSION = '1.1';

function lootSettings(): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const def of LOOT_DEFS) {
        schema[def.key] = {
            type: 'boolean',
            default: true,
            label: def.label,
            group: 'Loot',
            help: `Take ${def.label} from courtyard guards you killed (drop tile of your last kill).`
        };
    }
    return schema;
}

export const SETTINGS: SettingsSchema = {
    foodType: {
        type: 'string',
        default: 'Best',
        options: [...FOOD_OPTIONS],
        label: 'Food',
        group: 'Food',
        help: 'Eat and restock this food. Best uses the highest-healing cooked food you have (Swordfish, then Lobster, Tuna, Shrimp) in pack and bank. Named foods eat/withdraw that item only. Out of food goes to Varrock west bank. None in bank stops the script.'
    },
    foodWithdraw: {
        type: 'number',
        default: 20,
        min: 1,
        max: 28,
        label: 'Amount to bring',
        group: 'Food',
        help: 'How many of the selected food to withdraw each Varrock west bank trip (1–28). Best can mix types, highest healing first.'
    },
    eatAtPercent: {
        type: 'number',
        default: 50,
        min: 1,
        max: 100,
        label: 'Eat at HP %',
        group: 'Food',
        help: 'Eat when current Hitpoints are at or below this percent of max HP'
    },
    panicHpPercent: {
        type: 'number',
        default: 25,
        min: 1,
        max: 100,
        label: 'Panic exit HP %',
        group: 'Food',
        help: 'If you have no food and HP is at or below this percent, immediately bank and restock. Overrides combat, loot, and burying. Default 25%.'
    },
    styleMode: {
        type: 'string',
        default: STYLE_RANDOM,
        options: [...STYLE_OPTIONS],
        label: 'Combat style',
        group: 'Combat',
        help: 'Random swap: train one Attack / Strength / Defence style, then pick another at random after N levels. Lowest melee: always train whichever of Attack, Strength, or Defence is currently lowest (ties keep the current style).'
    },
    levelsBeforeSwap: {
        type: 'number',
        default: 5,
        min: 1,
        max: 99,
        label: 'Levels before random swap',
        group: 'Combat',
        showIf: { key: 'styleMode', anyOf: [STYLE_RANDOM] },
        help: 'Only used for Random swap. Levels to gain on the current style before randomly selecting another (Attack, Strength, or Defence).'
    },
    buryBones: {
        type: 'boolean',
        default: true,
        label: 'Bury bones',
        group: 'Bones',
        help: 'Loot Bones only from guards you killed and bury them for Prayer XP. On by default. Untick to leave bones (unless Bones is ticked under Loot, in which case they are banked).'
    },
    ...lootSettings()
};

function currentHp(): number {
    return Skills.effective('hitpoints');
}

function maxHp(): number {
    return Math.max(1, Skills.level('hitpoints'));
}

function meleeLevels(): Record<string, number> {
    return {
        attack: Skills.level('attack'),
        strength: Skills.level('strength'),
        defence: Skills.level('defence')
    };
}

export default class VarrockCastleGuardKiller extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private recovering = false;
    private deaths = 0;
    private attacks = 0;
    private kills = 0;
    private eats = 0;
    private bankTrips = 0;
    private buried = 0;
    private startReady = false;
    private goingToBank = false;

    private foodType: FoodType = 'Best';
    private eatAtPercent = 50;
    private panicHpPercent = 25;
    private foodWithdraw = 20;
    private buryBones = true;
    private styleMode: StyleMode = STYLE_RANDOM;
    private levelsBeforeSwap = 5;
    private desiredStyle: TrainableStyle = 'attack';
    private styleLevelAnchor = 1;
    private lootTicks: Record<string, boolean> = Object.fromEntries(LOOT_DEFS.map(d => [d.key, true]));

    private startedAt = 0;
    private xpAtStart: Record<string, number> = {};
    private usedSkills = new Set<string>();
    private styleFails = 0;
    private styleRetryAt = 0;
    private cantReach = false;
    private fightNpcIndex = -1;
    private fightNpcTile: Tile | null = null;
    private ownLootTile: Tile | null = null;
    private ownLootUntil = 0;
    private ownBonesPending = 0;
    private lootPileLogged = false;

    override grindTargets(): string[] {
        return ['guard'];
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();

        this.syncPrefs(true);
        this.desiredStyle = isRandomStyleMode(this.styleMode) ? pickRandomStyle(null) : pickLowestStyle(meleeLevels(), null);
        this.styleLevelAnchor = Skills.level(this.desiredStyle);

        this.startedAt = Date.now();
        this.xpAtStart = {};
        this.usedSkills = new Set();
        this.deaths = 0;
        this.attacks = 0;
        this.kills = 0;
        this.eats = 0;
        this.bankTrips = 0;
        this.buried = 0;
        this.startReady = false;
        this.goingToBank = false;
        this.recovering = false;
        this.styleFails = 0;
        this.styleRetryAt = 0;
        this.cantReach = false;
        this.clearStaleFight();
        this.lootPileLogged = false;
        this.ownBonesPending = 0;
        for (const skill of COMBAT_TRACK) {
            this.xpAtStart[skill] = Skills.xp(skill);
        }

        this.on('chat.message', e => {
            if (CANT_REACH_RE.test(e.text)) {
                this.cantReach = true;
            }
            if (DEATH_RE.test(e.text) && !this.recovering) {
                this.recovering = true;
                this.deaths++;
                this.status = 'dead';
                this.log(`died (#${this.deaths}) — waiting for respawn`);
            }
        });

        this.on('skill.xp', e => {
            if ((COMBAT_TRACK as readonly string[]).includes(e.name)) {
                this.usedSkills.add(e.name);
            }
        });

        this.on('skill.level', e => {
            if ((['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as readonly string[]).includes(e.name)) {
                this.log(`${e.name} level ${e.previous} → ${e.level}`);
            }
        });

        const styleBit = isRandomStyleMode(this.styleMode)
            ? `random swap every ${this.levelsBeforeSwap} lv (now ${this.desiredStyle})`
            : `always lowest melee (now ${this.desiredStyle}; atk=${Skills.level('attack')} str=${Skills.level('strength')} def=${Skills.level('defence')})`;
        const lootOn = LOOT_DEFS.filter(d => this.lootTicks[d.key]).map(d => d.label);
        this.log(
            `started — Varrock west bank ${BANK_STAND.x},${BANK_STAND.z} → courtyard ${GUARD_CAMP.x},${GUARD_CAMP.z} r${CAMP_RADIUS}; ` +
                `eat ${this.foodType} at ≤${this.eatAtPercent}% HP; panic exit ≤${this.panicHpPercent}% with no food; bring ${this.foodWithdraw}; ${styleBit}`
        );
        this.log(`bury bones: ${this.buryBones ? 'on' : 'off'}`);
        this.log(`loot ticks: ${lootOn.length}/${LOOT_DEFS.length} on (${lootOn.length > 0 ? lootOn.slice(0, 8).join(', ') : 'none'}${lootOn.length > 8 ? '...' : ''})`);
        if (this.foodType === 'Best') {
            this.log('Best food: eat/withdraw Swordfish → Lobster → Tuna → Shrimp (whatever you have)');
        }
        this.status = 'start: Varrock west bank';
    }

    override onResume(): void {
        this.syncPrefs(false);
    }

    override onStop(): void {
        this.log(`stopped — ${this.attacks} attacks, ${this.kills} kills, ${this.eats} eats` + (this.buryBones ? `, ${this.buried} buried` : '') + `, ${this.bankTrips} bank trips, ${this.deaths} deaths (${this.status})`);
    }

    private clearStaleFight(): void {
        this.fightNpcIndex = -1;
        this.fightNpcTile = null;
        this.ownLootTile = null;
        this.ownLootUntil = 0;
        this.cantReach = false;
    }

    private pickStyleForMode(): TrainableStyle {
        return isRandomStyleMode(this.styleMode) ? pickRandomStyle(null) : pickLowestStyle(meleeLevels(), this.desiredStyle);
    }

    private syncPrefs(silent: boolean): void {
        const prevFood = this.foodType;
        const prevEat = this.eatAtPercent;
        const prevPanic = this.panicHpPercent;
        const prevBring = this.foodWithdraw;
        const prevBury = this.buryBones;
        const prevMode = this.styleMode;
        const prevLevels = this.levelsBeforeSwap;

        const foodRaw = this.settings.str('foodType', this.foodType);
        this.foodType = isFoodType(foodRaw) ? foodRaw : 'Best';
        this.eatAtPercent = clampPercent(this.settings.num('eatAtPercent', this.eatAtPercent));
        this.panicHpPercent = clampPercent(this.settings.num('panicHpPercent', this.panicHpPercent));
        this.foodWithdraw = clampFoodAmount(this.settings.num('foodWithdraw', this.foodWithdraw));
        this.buryBones = this.settings.bool('buryBones', this.buryBones);

        const modeRaw = this.settings.str('styleMode', this.styleMode);
        this.styleMode = isStyleMode(modeRaw) ? modeRaw : STYLE_RANDOM;
        this.levelsBeforeSwap = clampLevels(this.settings.num('levelsBeforeSwap', this.levelsBeforeSwap));

        for (const def of LOOT_DEFS) {
            this.lootTicks[def.key] = this.settings.bool(def.key, true);
        }

        if (!silent && prevFood !== this.foodType) {
            this.log(`prefs: food → ${this.foodType}`);
        }
        if (!silent && prevEat !== this.eatAtPercent) {
            this.log(`prefs: eat at ≤ ${this.eatAtPercent}% HP`);
        }
        if (!silent && prevPanic !== this.panicHpPercent) {
            this.log(`prefs: panic exit at ≤ ${this.panicHpPercent}% HP with no food`);
        }
        if (!silent && prevBring !== this.foodWithdraw) {
            this.log(`prefs: bring ${this.foodWithdraw}× ${this.foodType}`);
        }
        if (!silent && this.buryBones !== prevBury) {
            this.log(`prefs: bury bones → ${this.buryBones ? 'on' : 'off'}`);
        }

        if (this.styleMode !== prevMode) {
            this.desiredStyle = this.pickStyleForMode();
            this.styleLevelAnchor = Skills.level(this.desiredStyle);
            if (!silent) {
                this.log(isRandomStyleMode(this.styleMode) ? `prefs: combat style → random swap (now ${this.desiredStyle})` : `prefs: combat style → always lowest melee (now ${this.desiredStyle})`);
            }
            return;
        }

        if (!silent && isRandomStyleMode(this.styleMode) && prevLevels !== this.levelsBeforeSwap) {
            this.log(`prefs: levels before random swap → ${this.levelsBeforeSwap}`);
        }
    }

    private foodNames(): readonly string[] {
        return (FOOD_TYPES[this.foodType] ?? FOOD_TYPES.Best).eat;
    }

    private withdrawNames(): readonly string[] {
        return (FOOD_TYPES[this.foodType] ?? FOOD_TYPES.Best).withdraw;
    }

    private findBestFood() {
        const names = this.foodNames();
        for (const name of names) {
            const item = Inventory.items().find(i => (i.name ?? '').toLowerCase() === name.toLowerCase());
            if (item) {
                return item;
            }
        }
        return null;
    }

    private foodCount(): number {
        const allowed = new Set(this.foodNames().map(n => n.toLowerCase()));
        return Inventory.items()
            .filter(i => allowed.has((i.name ?? '').toLowerCase()))
            .reduce((n, i) => n + Math.max(1, i.count || 1), 0);
    }

    private pct(): number {
        return hpPercent(currentHp(), maxHp());
    }

    private stopNoFood(context: string): void {
        this.status = 'no food — stopped';
        this.log(`${context}: no ${describeFood(this.foodType)} in Varrock west bank — stopping (restock food, then restart)`);
        ScriptRunner.stop(`VarrockCastleGuardKiller: no ${describeFood(this.foodType)} in Varrock west bank`);
    }

    private noteFightTarget(npc: Npc | null): void {
        if (!npc) {
            return;
        }
        if (this.fightNpcIndex >= 0 && npc.index !== this.fightNpcIndex) {
            this.openOwnLootWindow(this.fightNpcTile);
        }
        this.fightNpcIndex = npc.index;
        this.fightNpcTile = Tile.from(npc.tile());
    }

    private npcIsOurFight(npc: Npc): boolean {
        if (npc.targetsMe()) {
            return true;
        }
        return Game.inCombat() && npc.inCombat && !npc.targetsAnotherPlayer();
    }

    private openOwnLootWindow(tile: WorldTile | null): void {
        this.kills++;
        if (tile) {
            this.ownLootTile = Tile.from(tile);
            this.ownLootUntil = Date.now() + OWN_LOOT_MS;
            this.lootPileLogged = false;
            this.log(`own kill @ ${this.ownLootTile.x},${this.ownLootTile.z} — loot window ${OWN_LOOT_MS / 1000}s`);
        }
        this.fightNpcIndex = -1;
        this.fightNpcTile = null;
    }

    private refreshOwnKillLoot(): void {
        if (this.fightNpcIndex < 0) {
            return;
        }
        const still = Npcs.query()
            .where(n => n.index === this.fightNpcIndex)
            .nearest();
        if (still && this.npcIsOurFight(still)) {
            const t = still.tile();
            if (this.fightNpcTile && cheb(t, this.fightNpcTile) > 10) {
                this.openOwnLootWindow(this.fightNpcTile);
                return;
            }
            this.fightNpcTile = Tile.from(t);
            return;
        }
        this.openOwnLootWindow(this.fightNpcTile);
    }

    private async handleBones(): Promise<boolean> {
        if (!this.buryBones) {
            return false;
        }
        const bones = Inventory.items().find(i => isBoneName(i.name)) ?? null;
        if (!bones) {
            return false;
        }
        this.status = 'burying bones';
        const before = Inventory.used();
        const op = locActions(bones).find(a => /^bury$/i.test(a ?? '')) ?? locActions(bones).find(a => /bury/i.test(a ?? '')) ?? 'Bury';
        await bones.interact(op);
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.ownBonesPending = Math.max(0, this.ownBonesPending - 1);
            this.buried++;
            this.log(`buried bones (#${this.buried})`);
        }
        return true;
    }

    private findOwnGroundLoot() {
        if (!this.ownLootTile || Date.now() > this.ownLootUntil || Inventory.isFull()) {
            return null;
        }
        const spot = this.ownLootTile;
        const nearby = [];
        const hits = [];
        for (const g of GroundItems.query().within(GROUND_SCAN_RADIUS).results()) {
            const t = g.tile();
            if (cheb(t, spot) > OWN_LOOT_RADIUS) {
                continue;
            }
            nearby.push(g);
            if (shouldLootName(g.name, this.buryBones, this.lootTicks)) {
                hits.push(g);
            }
        }
        if (nearby.length > 0 && hits.length === 0 && !this.lootPileLogged) {
            this.lootPileLogged = true;
            this.log(`own pile @ ${spot.x},${spot.z} has [${nearby.map(g => g.name).join(', ')}] — none match ticks`);
        }
        if (hits.length > 0) {
            return hits.find(g => isBoneName(g.name)) ?? hits[0]!;
        }
        return null;
    }

    private async handleLoot(): Promise<boolean> {
        if (await this.handleBones()) {
            return true;
        }

        const here = Game.tile();
        const windowOpen = this.ownLootTile && Date.now() <= this.ownLootUntil && !Inventory.isFull();
        if (windowOpen && here && this.ownLootTile && cheb(here, this.ownLootTile) > 2) {
            this.status = 'walking to loot pile';
            this.log(`walking to loot pile ${this.ownLootTile.x},${this.ownLootTile.z}`);
            await Traversal.walkTo(new Tile(this.ownLootTile.x, this.ownLootTile.z, here.level ?? 0), { radius: 1, timeoutMs: 6_000 });
            return true;
        }

        const ground = this.findOwnGroundLoot();
        if (!ground) {
            return false;
        }

        const pile = ground.tile();
        if (here && cheb(here, pile) > 1) {
            this.status = 'walking to loot';
            this.log(`walking to loot ${ground.name} @ ${pile.x},${pile.z}`);
            await Traversal.walkTo(new Tile(pile.x, pile.z, here.level ?? 0), { radius: 1, timeoutMs: 6_000 });
        }

        const name = ground.name;
        this.status = `looting ${name}`;
        const before = Inventory.used();
        const wasBones = isBoneName(name);
        const take = locActions(ground).find(a => /^take$/i.test(a ?? '')) ?? locActions(ground).find(a => /take/i.test(a ?? '')) ?? 'Take';
        await ground.interact(take);
        if (await Execution.delayUntil(() => Inventory.used() > before, 5000)) {
            if (wasBones && this.buryBones) {
                this.ownBonesPending++;
            }
            this.log(`looted ${name} @ ${this.ownLootTile?.x},${this.ownLootTile?.z}`);
        }
        return true;
    }

    async loop(): Promise<void> {
        this.syncPrefs(true);

        if (!Game.ingame() || Game.tile() === null) {
            await Execution.delayTicks(5);
            return;
        }

        if (this.recovering) {
            await this.recover();
            return;
        }

        if (needPanicExit(this.foodCount(), this.pct(), this.panicHpPercent)) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                return;
            }
            if (!this.goingToBank) {
                this.goingToBank = true;
                this.log(`PANIC ${Math.round(this.pct())}% HP ≤ ${this.panicHpPercent}% and no food — leaving now (skip loot / bury / combat)`);
            }
            this.status = 'panic exit — bank';
            await this.bankFoodRestock();
            return;
        }

        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            return;
        }
        if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
            this.status = 'dialog option';
            await ChatDialog.chooseOption();
            return;
        }

        if (needEat(this.findBestFood() !== null, this.pct(), this.eatAtPercent)) {
            await this.eatFood();
            return;
        }

        if (await this.handleBones()) {
            return;
        }

        if (!this.startReady) {
            const here = Game.tile();
            if (inCourtyard(here) && this.foodCount() > 0) {
                this.startReady = true;
                this.log(`already in courtyard with ${this.foodCount()}× ${describeFood(this.foodType)} — skip startup bank`);
            } else {
                await this.bankFoodRestock(true);
                return;
            }
        }

        if (this.foodCount() === 0 || this.goingToBank || (Inventory.isFull() && this.foodCount() > 0)) {
            if (!this.goingToBank) {
                this.goingToBank = true;
                this.log(this.foodCount() === 0 ? 'out of food — banking loot + food at Varrock west' : 'pack full — banking loot + food at Varrock west');
            }
            await this.bankFoodRestock();
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
            return;
        }

        if (await this.ensureCombatStyle()) {
            return;
        }

        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(2);
            return;
        }

        this.refreshOwnKillLoot();

        if (await this.handleLoot()) {
            return;
        }

        if (Game.inCombat()) {
            const onMe = this.findGuardFightingMe();
            if (onMe) {
                this.noteFightTarget(onMe);
                this.status = 'in combat';
                await Execution.delayTicks(2);
                return;
            }
        }

        if (!inCamp(here)) {
            if (await this.openNearbyDoor(6)) {
                return;
            }
            this.status = 'walking to courtyard';
            await this.walkToCourtyard();
            return;
        }

        const target = this.findAttackableGuard();
        if (!target) {
            this.status = 'waiting for guard';
            await Traversal.walkTo(GUARD_CAMP, { radius: 2, timeoutMs: 8_000 });
            await Execution.delayTicks(2);
            return;
        }

        await this.attackGuard(target);
    }

    private async walkToCourtyard(): Promise<boolean> {
        this.log(`walking to palace courtyard ${GUARD_CAMP.x},${GUARD_CAMP.z} (ground floor)`);
        const ok = await Traversal.walkResilient(GUARD_CAMP, {
            radius: 3,
            attempts: 2,
            timeoutMs: 20_000,
            log: msg => this.log(`  ${msg}`)
        });
        if (!ok) {
            this.log('path to courtyard failed — retrying');
            return false;
        }
        return inCamp(Game.tile());
    }

    private async openNearbyDoor(within = 5): Promise<boolean> {
        const door = Locs.query()
            .where(l => isShutDoor(l))
            .within(within)
            .nearest();
        if (!door) {
            return false;
        }
        const op = openDoorOp(door);
        if (!op) {
            return false;
        }
        const t = door.tile();
        this.status = `Open ${door.name}`;
        this.log(`Open ${door.name} @ ${t.x},${t.z}`);
        await door.interact(op);
        await Execution.delayTicks(2);
        return true;
    }

    private async attackGuard(npc: Npc): Promise<void> {
        const name = npc.name ?? 'Guard';
        const t = npc.tile();
        this.status = `attacking ${name}`;
        this.log(`attacking ${name} @ ${t.x},${t.z}`);
        this.cantReach = false;
        this.noteFightTarget(npc);
        await npc.interact('Attack');
        await Execution.delayUntil(() => Game.inCombat() || this.cantReach || this.findGuardFightingMe() !== null, 4000);

        if (Game.inCombat() || this.findGuardFightingMe()) {
            this.attacks++;
            const fighting = this.findGuardFightingMe();
            if (fighting) {
                this.noteFightTarget(fighting);
            }
            return;
        }

        if (this.cantReach) {
            this.log("can't reach that guard — skipping (won't leave the courtyard)");
            this.fightNpcIndex = -1;
            this.fightNpcTile = null;
        }
    }

    private isCourtyardGuard(n: Npc): boolean {
        return isCastleGuardName(n.name) && inCourtyard(n.tile());
    }

    private findGuardFightingMe(): Npc | null {
        return (
            Npcs.query()
                .within(CAMP_RADIUS + 4)
                .where(n => this.isCourtyardGuard(n))
                .where(n => n.targetsMe())
                .nearest() ??
            Npcs.query()
                .within(4)
                .where(n => this.isCourtyardGuard(n))
                .where(n => n.actions().some(a => /attack/i.test(a ?? '')))
                .where(n => n.inCombat && !n.targetsAnotherPlayer())
                .nearest() ??
            null
        );
    }

    private findAttackableGuard(): Npc | null {
        const onMe = this.findGuardFightingMe();
        if (onMe) {
            return onMe;
        }
        return (
            Npcs.query()
                .action('Attack')
                .within(CAMP_RADIUS)
                .where(n => this.isCourtyardGuard(n))
                .where(n => inCamp(n.tile()))
                .where(n => !n.targetsAnotherPlayer())
                .where(n => !n.inCombat)
                .nearest() ??
            Npcs.query()
                .within(CAMP_RADIUS)
                .where(n => this.isCourtyardGuard(n))
                .where(n => n.actions().some(a => /attack/i.test(a ?? '')))
                .where(n => inCamp(n.tile()))
                .where(n => !n.targetsAnotherPlayer())
                .where(n => !n.inCombat)
                .nearest() ??
            null
        );
    }

    private async eatFood(): Promise<void> {
        const food = this.findBestFood();
        if (!food) {
            return;
        }
        const before = currentHp();
        this.status = `eating ${food.name}`;
        this.log(`HP ${before}/${maxHp()} (${Math.round(this.pct())}%) ≤ ${this.eatAtPercent}% — Eat ${food.name}`);
        if (!(await food.interact('Eat'))) {
            await Execution.delayTicks(1);
            return;
        }
        if (await Execution.delayUntil(() => currentHp() > before, 3000)) {
            this.eats++;
        }
    }

    private async openVarrockWestBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            if (distToBank(Game.tile()) <= 12) {
                return true;
            }
            this.log('wrong bank open — closing');
            await Bank.close();
            await Execution.delayTicks(1);
        }

        const here = Game.tile();
        if (here && distToBank(here) > 8) {
            this.status = 'walking to Varrock west bank';
            this.log(`walking to Varrock west bank ${BANK_STAND.x},${BANK_STAND.z}`);
            const ok = await Traversal.walkResilient(BANK_STAND, {
                radius: 4,
                attempts: 2,
                timeoutMs: 20_000,
                log: m => this.log(`  ${m}`)
            });
            if (!ok) {
                this.log('path to Varrock west bank failed — retrying');
                return false;
            }
        }

        if (distToBank(Game.tile()) > 8) {
            return false;
        }

        this.status = 'opening Varrock west bank';
        this.log('opening Varrock west bank booth');
        const opened = await Bank.openBooth(BANK_STAND, 'Bank booth', 'Use-quickly', m => this.log(`  ${m}`));
        if (opened) {
            return true;
        }
        return Banking.open({
            stand: BANK_STAND,
            log: m => this.log(`  ${m}`)
        });
    }

    private async withdrawResolvedFood(amount: number): Promise<boolean> {
        const plan = buildWithdrawPlan(amount, Inventory.free(), this.withdrawNames(), name => Bank.count(name) || 0);
        if (plan.length === 0) {
            return false;
        }
        if (this.foodType === 'Best' && plan.length > 1) {
            this.log(`Best mix: withdrawing ${plan.map(p => `${p.take}× ${p.name}`).join(', ')}`);
        }
        for (const { name, take } of plan) {
            this.log(`withdrawing ${take}× ${name}`);
            if (!(await Bank.withdrawX(name, take))) {
                this.log(`withdraw failed for ${name}`);
                return false;
            }
            await Execution.delayTicks(1);
        }
        return true;
    }

    private async bankFoodRestock(startup = false): Promise<void> {
        this.status = 'banking food';

        if (!Bank.isOpen()) {
            this.log(`${startup ? 'startup: ' : ''}restocking ${this.foodWithdraw}× ${describeFood(this.foodType)} at Varrock west ${BANK_STAND.x},${BANK_STAND.z}`);
            if (!(await this.openVarrockWestBank())) {
                this.log('could not open Varrock west bank — retrying');
                await Execution.delayTicks(3);
                return;
            }
        }

        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 5000);
        await Execution.delayTicks(1);

        this.log('depositing inventory (keeping selected food)');
        await Bank.depositAllMatching(name => !isKeepOnDeposit(name, this.foodNames(), this.buryBones));
        await Execution.delayTicks(1);

        const need = Math.max(0, this.foodWithdraw - this.foodCount());
        if (need > 0) {
            if (!(await this.withdrawResolvedFood(need))) {
                await Bank.close();
                this.stopNoFood('restock');
                return;
            }
        }

        if (this.foodCount() <= 0) {
            await Bank.close();
            this.stopNoFood('withdraw');
            return;
        }

        await Bank.close();
        this.bankTrips++;
        this.startReady = true;
        this.goingToBank = false;
        this.status = 'heading to courtyard';
        this.log(`inventory ready — ${this.foodCount()}× ${describeFood(this.foodType)} — walking to palace courtyard`);
    }

    private async ensureCombatStyle(): Promise<boolean> {
        if (isRandomStyleMode(this.styleMode)) {
            const cur = Skills.level(this.desiredStyle);
            if (shouldRotateStyle(cur, this.styleLevelAnchor, this.levelsBeforeSwap)) {
                const next = pickRandomStyle(this.desiredStyle);
                this.log(`random swap ${this.desiredStyle} → ${next} ` + `(gained ${cur - this.styleLevelAnchor} lv; atk=${Skills.level('attack')} str=${Skills.level('strength')} def=${Skills.level('defence')})`);
                this.desiredStyle = next;
                this.styleLevelAnchor = Skills.level(this.desiredStyle);
            }
        } else {
            const next = pickLowestStyle(meleeLevels(), this.desiredStyle);
            if (next !== this.desiredStyle) {
                this.log(`lowest melee ${this.desiredStyle} → ${next} ` + `(atk=${Skills.level('attack')} str=${Skills.level('strength')} def=${Skills.level('defence')})`);
                this.desiredStyle = next;
                this.styleLevelAnchor = Skills.level(this.desiredStyle);
            }
        }

        if (Game.hasCombatStyle(this.desiredStyle) || Date.now() < this.styleRetryAt) {
            return false;
        }

        this.status = `setting style: ${this.desiredStyle}`;
        Game.setCombatStyle(this.desiredStyle);
        if (await Execution.delayUntil(() => Game.hasCombatStyle(this.desiredStyle), 3000)) {
            this.styleFails = 0;
            this.log(`combat style set to ${this.desiredStyle}`);
            return true;
        }

        if (++this.styleFails >= 5) {
            this.styleFails = 0;
            this.styleRetryAt = Date.now() + 60_000;
            this.log('could not set attack style (combat tab not ready?) — retrying in 60s');
        }
        return true;
    }

    private async recover(): Promise<void> {
        const ready = await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 20_000);
        if (!ready) {
            this.log('still waiting for respawn');
            return;
        }
        await Execution.delayTicks(3);
        this.recovering = false;
        this.clearStaleFight();
        this.lootPileLogged = false;
        this.ownBonesPending = 0;
        this.startReady = false;
        this.goingToBank = true;
        this.status = 'dead — restock food';
        this.log('respawned — Varrock west bank then back to the courtyard');
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const elapsed = Date.now() - this.startedAt;
        const hrs = elapsed / 3_600_000;
        const hp = currentHp();
        const max = maxHp();
        const pct = Math.round((hp / max) * 100);
        const lootOn = LOOT_DEFS.filter(d => this.lootTicks[d.key]).length;
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9dce6a' });
        p.title(`Varrock Castle Guard Killer v${SCRIPT_VERSION} — ${this.status}`);
        p.row(`Runtime: ${fmtElapsed(elapsed)}`, `HP ${hp}/${max} (${pct}%)`, `Eat ≤${this.eatAtPercent}%`, `Panic ≤${this.panicHpPercent}%`);
        p.row(`${this.foodType} ${this.foodCount()}/${this.foodWithdraw}`, `Courtyard ${GUARD_CAMP.x},${GUARD_CAMP.z} r${CAMP_RADIUS}`, 'Ground floor');
        if (isRandomStyleMode(this.styleMode)) {
            p.row(`Random swap: ${Skills.level(this.desiredStyle) - this.styleLevelAnchor}/${this.levelsBeforeSwap} on ${this.desiredStyle}`);
        } else {
            p.row(`Lowest melee · atk ${Skills.level('attack')} / str ${Skills.level('strength')} / def ${Skills.level('defence')}`, `Training ${this.desiredStyle}`);
        }
        if (this.buryBones) {
            p.row(`Buried: ${this.buried}`, this.ownBonesPending > 0 ? `Pending bones: ${this.ownBonesPending}` : 'Own-kill bones');
        }
        p.row(`Kills: ${this.kills}`, `Eats: ${this.eats}`, `Loot ticks: ${lootOn}/${LOOT_DEFS.length}`);
        p.row(`Banks: ${this.bankTrips}`, `Deaths: ${this.deaths}`);
        for (const skill of COMBAT_TRACK) {
            if (!this.usedSkills.has(skill)) {
                continue;
            }
            const gained = Math.max(0, Skills.xp(skill) - (this.xpAtStart[skill] ?? 0));
            if (gained <= 0) {
                continue;
            }
            const xph = hrs > 0.0005 ? gained / hrs : 0;
            p.row(`${skill}: ${fmtXph(xph)} xp/hr`, `+${Math.round(gained)} xp`);
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
