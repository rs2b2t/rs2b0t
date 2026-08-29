import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Locs } from '../../api/locs/Locs.js';
import { Loc } from '../../api/model/Loc.js';
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
    BANNED_GEAR_RE,
    CANT_REACH_RE,
    CAMP_RADIUS,
    CHICKEN_CAMP,
    CHICKEN_NAME,
    COOP_GATE_RADIUS,
    COMBAT_TRACK,
    DEATH_RE,
    FEATHER_NAME,
    LOOT_RADIUS,
    MONK_NAME,
    OWN_LOOT_MS,
    OWN_LOOT_RADIUS,
    SARIM_MONK_DOCK,
    TRAINABLE,
    type TrainableStyle,
    canLootFeathers,
    cheb,
    clampLevels,
    fmtElapsed,
    fmtXph,
    inChickenCamp,
    isBoneName,
    isChickenNpcName,
    isCoopBarrier,
    isFeatherName,
    isInsideCoop,
    isJunkName,
    isKeepOnBank,
    isOnEntrana,
    isOnSarimSide,
    isTrainableStyle,
    locActions,
    locTile,
    monkBoatOp,
    needsBankForBoat,
    openDoorOp,
    pickMonkOption,
    pickRandomStyle,
    refuseSarimMonk,
    shouldRotateStyle,
    shouldStayOnIsland
} from './EntranaChickenKillerLogic.js';

const SCRIPT_VERSION = '1.1';

export const SETTINGS: SettingsSchema = {
    rotateStyles: {
        type: 'boolean',
        default: true,
        label: 'Swap attack styles',
        group: 'Combat',
        help: 'Train one Attack / Strength / Defence style, then randomly pick another after N levels'
    },
    levelsBeforeSwap: {
        type: 'number',
        default: 5,
        min: 1,
        max: 99,
        label: 'Levels before style swap',
        group: 'Combat',
        showIf: { key: 'rotateStyles', anyOf: ['true'] },
        help: 'Levels to gain on the current style before randomly selecting another (Attack, Strength, or Defence)'
    },
    meleeStyle: {
        type: 'string',
        default: 'attack',
        options: [...TRAINABLE],
        label: 'Melee style',
        group: 'Combat',
        showIf: { key: 'rotateStyles', anyOf: ['false'] },
        help: 'Fixed combat style when Swap attack styles is off'
    },
    buryBones: {
        type: 'boolean',
        default: true,
        label: 'Bury own-kill bones',
        group: 'Loot',
        help: "Loot Bones only from chickens you killed (drop tile of your last kill) and bury those for Prayer XP. Ignores other players' piles. Feathers are looted from the whole camp."
    }
};

function packUsed(): number {
    return Inventory.used();
}

function packFull(): boolean {
    return Inventory.isFull() || Inventory.free() <= 0 || packUsed() >= 28;
}

function featherCount(): number {
    return Inventory.items()
        .filter(i => isFeatherName(i.name))
        .reduce((sum, i) => sum + Math.max(1, i.count || 1), 0);
}

function nothingEquipped(): boolean {
    return Equipment.items().every(i => !i.name);
}

function dialogOpen(): boolean {
    if (ChatDialog.canContinue()) {
        return true;
    }
    return ChatDialog.isOpen() && ChatDialog.options().length > 0;
}

export default class EntranaChickenKiller extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private recovering = false;
    private deaths = 0;
    private kills = 0;
    private buried = 0;
    private feathersLooted = 0;
    private bankTrips = 0;
    private boatTrips = 0;
    private bannedGear = false;

    private rotateStyles = true;
    private levelsBeforeSwap = 5;
    private buryBones = true;
    private desiredStyle: TrainableStyle = 'attack';
    private fixedStyle: TrainableStyle = 'attack';
    private styleLevelAnchor = 1;

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
    private lastFeatherSeen = 0;
    private wasIngame = true;

    override grindTargets(): string[] {
        return [CHICKEN_NAME.toLowerCase()];
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();

        this.syncPrefs(true);
        this.desiredStyle = this.rotateStyles ? pickRandomStyle(null) : this.fixedStyle;
        this.styleLevelAnchor = Skills.level(this.desiredStyle);

        this.startedAt = Date.now();
        this.xpAtStart = {};
        this.usedSkills = new Set();
        this.deaths = 0;
        this.kills = 0;
        this.buried = 0;
        this.feathersLooted = 0;
        this.bankTrips = 0;
        this.boatTrips = 0;
        this.bannedGear = false;
        this.recovering = false;
        this.styleFails = 0;
        this.styleRetryAt = 0;
        this.clearStaleFight();
        this.lastFeatherSeen = featherCount();
        this.wasIngame = true;
        for (const skill of COMBAT_TRACK) {
            this.xpAtStart[skill] = Skills.xp(skill);
        }

        this.on('chat.message', e => {
            if (CANT_REACH_RE.test(e.text)) {
                this.cantReach = true;
            }
            if (BANNED_GEAR_RE.test(e.text)) {
                this.bannedGear = true;
                this.log('monks refused weapons/armour — banking at Draynor then retrying the boat');
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
            if ((TRAINABLE as readonly string[]).includes(e.name)) {
                this.log(`${e.name} level ${e.previous} → ${e.level}`);
            }
        });

        const styleBit = this.rotateStyles ? `rotate styles every ${this.levelsBeforeSwap} lv (now ${this.desiredStyle})` : `fixed style ${this.desiredStyle}`;
        this.log(`started — chicken coop @ ${CHICKEN_CAMP.x},${CHICKEN_CAMP.z},0 on Entrana; open the coop gate, then kill. Walk dest is the coop (boat hops OK). ${styleBit}`);
        this.log('loot: feathers (camp) + own-kill bones (bury). Drops raw chicken / eggs.');
        this.status = 'ready';
    }

    override onResume(): void {
        this.syncPrefs(false);
    }

    override onStop(): void {
        this.log(`stopped — ${this.kills} kills, ${this.feathersLooted} feathers` + (this.buryBones ? `, ${this.buried} buried` : '') + `, ${this.boatTrips} boats, ${this.deaths} deaths (${this.status})`);
    }

    private syncPrefs(silent: boolean): void {
        const prevRotate = this.rotateStyles;
        const prevLevels = this.levelsBeforeSwap;
        const prevFixed = this.fixedStyle;
        const prevBury = this.buryBones;

        this.rotateStyles = this.settings.bool('rotateStyles', this.rotateStyles);
        this.buryBones = this.settings.bool('buryBones', this.buryBones);
        this.levelsBeforeSwap = clampLevels(this.settings.num('levelsBeforeSwap', this.levelsBeforeSwap));
        const fixedRaw = this.settings.str('meleeStyle', this.fixedStyle).toLowerCase();
        this.fixedStyle = isTrainableStyle(fixedRaw) ? fixedRaw : 'attack';

        if (!silent && this.buryBones !== prevBury) {
            this.log(`prefs: bury bones → ${this.buryBones ? 'on' : 'off'}`);
        }

        if (this.rotateStyles !== prevRotate) {
            if (this.rotateStyles) {
                this.desiredStyle = pickRandomStyle(null);
                this.styleLevelAnchor = Skills.level(this.desiredStyle);
                if (!silent) {
                    this.log(`prefs: rotate styles ON → training ${this.desiredStyle}`);
                }
            } else {
                this.desiredStyle = this.fixedStyle;
                this.styleLevelAnchor = Skills.level(this.desiredStyle);
                if (!silent) {
                    this.log(`prefs: rotate styles OFF → fixed ${this.desiredStyle}`);
                }
            }
            return;
        }

        if (!this.rotateStyles && this.fixedStyle !== prevFixed) {
            this.desiredStyle = this.fixedStyle;
            this.styleLevelAnchor = Skills.level(this.desiredStyle);
            if (!silent) {
                this.log(`prefs: melee style → ${this.desiredStyle}`);
            }
            return;
        }

        if (!silent && prevLevels !== this.levelsBeforeSwap) {
            this.log(`prefs: levels before random swap → ${this.levelsBeforeSwap}`);
        }
    }

    private clearStaleFight(): void {
        this.fightNpcIndex = -1;
        this.fightNpcTile = null;
        this.cantReach = false;
        this.ownLootTile = null;
        this.ownLootUntil = 0;
    }

    private noteFightTarget(npc: Npc | null): void {
        if (!npc) {
            return;
        }
        this.fightNpcIndex = npc.index;
        const t = npc.tile();
        if (t) {
            this.fightNpcTile = Tile.from(t);
        }
    }

    private noteFeathers(): void {
        const now = featherCount();
        if (now > this.lastFeatherSeen) {
            this.feathersLooted += now - this.lastFeatherSeen;
        }
        this.lastFeatherSeen = now;
    }

    private refreshOwnKillLoot(): void {
        if (this.fightNpcIndex < 0) {
            return;
        }
        const still = Npcs.query()
            .where(n => n.index === this.fightNpcIndex)
            .nearest();
        if (still) {
            const t = still.tile();
            if (t) {
                this.fightNpcTile = Tile.from(t);
            }
            return;
        }
        this.kills++;
        if (this.fightNpcTile) {
            this.ownLootTile = this.fightNpcTile;
            this.ownLootUntil = Date.now() + OWN_LOOT_MS;
            this.log(`own kill @ ${this.ownLootTile.x},${this.ownLootTile.z} — loot window open`);
        }
        this.fightNpcIndex = -1;
        this.fightNpcTile = null;
    }

    private movedFar(from: WorldTile | null | undefined, tiles: number): boolean {
        const now = Game.tile();
        if (!from || !now) {
            return false;
        }
        return Tile.from(from).distanceTo(now) >= tiles;
    }

    async loop(): Promise<void> {
        this.syncPrefs(true);
        this.noteFeathers();

        if (!Game.ingame() || Game.tile() === null) {
            if (this.wasIngame) {
                this.log('logged out / disconnected — waiting to get back ingame');
                this.wasIngame = false;
                this.clearStaleFight();
            }
            await Execution.delayTicks(5);
            return;
        }
        if (!this.wasIngame) {
            this.wasIngame = true;
            this.clearStaleFight();
            this.log('back ingame — resuming (cleared stale combat)');
            return;
        }

        if (this.recovering) {
            await this.recover();
            return;
        }

        if (await this.handleDialog()) {
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
            return;
        }

        if (this.bannedGear || !isOnEntrana(Game.tile())) {
            await this.travelToEntrana();
            if (this.bannedGear || !isOnEntrana(Game.tile())) {
                return;
            }
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

        if (!inChickenCamp(here, CAMP_RADIUS + 6)) {
            this.status = 'walking to chicken coop';
            this.log(`on Entrana @ ${here.x},${here.z} — walking to coop ${CHICKEN_CAMP.x},${CHICKEN_CAMP.z}`);
            await Traversal.walkResilient(CHICKEN_CAMP, {
                radius: 4,
                timeoutMs: 40_000,
                log: m => this.log(`  ${m}`)
            });
            return;
        }

        if (await this.ensureCoopAccess()) {
            return;
        }

        if (await this.dropJunk()) {
            return;
        }

        if (await this.handleLoot()) {
            return;
        }

        if (Game.inCombat()) {
            const onMe = this.findChickenFightingMe();
            if (onMe) {
                this.noteFightTarget(onMe);
                this.status = 'in combat';
                await Execution.delayTicks(2);
                return;
            }
            this.status = 're-engaging';
            this.log('combat flag but no chicken on us — attacking again');
        }

        const target = this.findAttackableChicken();
        if (target) {
            await this.attackChicken(target);
            return;
        }

        if (!inChickenCamp(here)) {
            await this.ensureCoopAccess(true);
            return;
        }

        this.status = 'waiting for chicken';
        await this.ensureCoopAccess();
        await Traversal.walkTo(CHICKEN_CAMP, { radius: 2, timeoutMs: 8_000 });
        await Execution.delayTicks(2);
    }

    private async handleDialog(): Promise<boolean> {
        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return true;
        }
        if (ChatDialog.isOpen() && ChatDialog.options().length > 0) {
            const here = Game.tile();
            const stay = shouldStayOnIsland(here);
            const opts = ChatDialog.options();
            const pick = pickMonkOption(opts, stay);
            this.status = `dialog: ${pick ?? '?'}`;
            this.log(`dialog → ${pick}  [${opts.join(' | ')}]` + (stay ? ' (stay on Entrana)' : ' (boat to Entrana)'));
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

    /**
     * Strip at Draynor if needed, then walk to the chicken coop.
     * Why: walking to the Port Sarim monk tile from Entrana is the return boat.
     */
    private async travelToEntrana(): Promise<void> {
        const here = Game.tile();
        if (shouldStayOnIsland(here)) {
            this.bannedGear = false;
            this.log(`on Entrana @ ${here?.x},${here?.z} — not walking to Port Sarim`);
            return;
        }

        if (
            this.bannedGear ||
            needsBankForBoat(
                nothingEquipped(),
                Inventory.items().map(i => i.name)
            )
        ) {
            await this.bankForBoat();
            return;
        }

        if (!here) {
            await Execution.delayTicks(2);
            return;
        }

        if (dialogOpen()) {
            await this.handleDialog();
            await Execution.delayUntil(() => isOnEntrana(Game.tile()) || !dialogOpen(), 8000);
            return;
        }

        this.status = 'walk to chicken coop';
        this.log(`walking to Entrana chicken coop ${CHICKEN_CAMP.x},${CHICKEN_CAMP.z} (from ${here.x},${here.z} — boat hops OK, dest is the coop not Sarim)`);
        const ok = await Traversal.walkResilient(CHICKEN_CAMP, {
            radius: 3,
            timeoutMs: 120_000,
            log: m => this.log(`  ${m}`)
        });

        const now = Game.tile();
        if (now && isOnEntrana(now)) {
            this.boatTrips++;
            this.bannedGear = false;
            this.log(`landed on Entrana @ ${now.x},${now.z} — next: open coop gate`);
            return;
        }

        if (this.bannedGear) {
            return;
        }

        if (!ok && isOnSarimSide(now)) {
            this.log('nav did not boat — talking to Monk of Entrana');
            await this.tryMonkBoat();
            return;
        }

        this.log(`still not on Entrana @ ${now?.x},${now?.z} — retrying walk to coop`);
        await Execution.delayTicks(3);
    }

    private async tryMonkBoat(): Promise<void> {
        const here = Game.tile();
        if (refuseSarimMonk(here)) {
            this.log(`@ ${here?.x},${here?.z} — refusing Port Sarim monk (would boat off Entrana)`);
            return;
        }
        if (here && Tile.from(here).distanceTo(SARIM_MONK_DOCK) > 10) {
            await Traversal.walkResilient(SARIM_MONK_DOCK, {
                radius: 4,
                log: m => this.log(`  ${m}`)
            });
            return;
        }

        const monk = this.findSarimMonk();
        if (!monk) {
            this.status = 'looking for monk';
            await Traversal.walkTo(SARIM_MONK_DOCK, { radius: 3, timeoutMs: 8_000 });
            await Execution.delayTicks(2);
            return;
        }

        const landed = await this.talkMonkAndRide(monk);
        if (landed || isOnEntrana(Game.tile())) {
            this.boatTrips++;
            this.bannedGear = false;
            this.log('arrived on Entrana via monk — walking to the coop next');
            this.status = 'on Entrana';
            return;
        }

        if (this.bannedGear) {
            return;
        }

        // Only Cross on the Port Sarim side. Crossing on Entrana boards the return ship.
        if (isOnSarimSide(Game.tile())) {
            await this.crossGangplank();
            if (isOnEntrana(Game.tile())) {
                this.boatTrips++;
                this.log('crossed gangplank onto Entrana');
            }
        }
    }

    private findSarimMonk(): Npc | null {
        return (
            Npcs.query().name(MONK_NAME).within(16).nearest() ??
            Npcs.query()
                .within(16)
                .where(n => {
                    const nme = (n.name ?? '').toLowerCase();
                    return nme.includes('monk') && nme.includes('entrana');
                })
                .nearest() ??
            null
        );
    }

    private async talkMonkAndRide(npc: Npc): Promise<boolean> {
        const before = Game.tile();
        const op = monkBoatOp(npc.actions());
        this.status = `${op} ${npc.name ?? 'monk'}`;
        this.log(`${op} ${npc.name} @ dock — navigating dialogue`);

        if (!(await npc.interact(op))) {
            await Execution.delayTicks(2);
            return false;
        }

        if (!(await Execution.delayUntil(() => dialogOpen() || isOnEntrana(Game.tile()) || this.movedFar(before, 15) || this.bannedGear, 8000))) {
            this.log('monk dialog did not open — retrying');
            return false;
        }

        for (let i = 0; i < 40; i++) {
            if (isOnEntrana(Game.tile())) {
                return true;
            }
            if (this.bannedGear) {
                return false;
            }
            if (!dialogOpen()) {
                if (await Execution.delayUntil(() => isOnEntrana(Game.tile()) || this.movedFar(before, 15) || dialogOpen() || this.bannedGear, 6000)) {
                    if (isOnEntrana(Game.tile())) {
                        return true;
                    }
                    if (dialogOpen()) {
                        continue;
                    }
                }
                break;
            }
            if (!(await this.handleDialog())) {
                await Execution.delayTicks(1);
            }
        }

        return isOnEntrana(Game.tile());
    }

    private async crossGangplank(): Promise<boolean> {
        const plank = Locs.query()
            .within(10)
            .where(l => /gangplank/i.test(l.name ?? ''))
            .nearest();
        if (!plank) {
            return false;
        }
        const op = locActions(plank).find(a => /cross|walk|climb/i.test(a ?? '')) ?? locActions(plank)[0] ?? null;
        if (!op) {
            return false;
        }
        const before = Game.tile();
        this.status = `cross ${plank.name}`;
        this.log(`crossing ${plank.name} (${op})`);
        if (!(await plank.interact(op))) {
            return false;
        }
        await Execution.delayUntil(() => this.movedFar(before, 3) || isOnEntrana(Game.tile()), 6000);
        return isOnEntrana(Game.tile());
    }

    private async bankForBoat(): Promise<void> {
        this.status = 'bank for Entrana';
        this.log('Draynor bank — unequip and deposit everything except feathers/coins');

        if (!Bank.isOpen()) {
            const here = Game.tile();
            if (here && cheb(Tile.from(here), BANK_STAND) > 8) {
                this.status = 'walk Draynor bank';
                const ok = await Traversal.walkResilient(BANK_STAND, {
                    radius: 4,
                    log: m => this.log(`  ${m}`)
                });
                if (!ok) {
                    this.log('path to Draynor bank failed — retrying');
                    await Execution.delayTicks(3);
                    return;
                }
            }

            this.status = 'opening Draynor bank';
            let opened = await Bank.openBooth(BANK_STAND, 'Bank booth', 'Use-quickly', m => this.log(`  ${m}`));
            if (!opened) {
                opened = await Banking.open({
                    stand: BANK_STAND,
                    log: m => this.log(`  ${m}`)
                });
            }
            if (!opened) {
                this.log('could not open Draynor bank — retrying');
                await Execution.delayTicks(3);
                return;
            }
        }

        await Execution.delayUntil(() => Bank.items().length > 0, 3000);
        await Execution.delayTicks(1);

        await this.depositKeepFeathers();
        if (!(await this.unequipAll())) {
            await this.depositKeepFeathers();
            await Execution.delayTicks(1);
            return;
        }
        await this.depositKeepFeathers();

        if (
            needsBankForBoat(
                nothingEquipped(),
                Inventory.items().map(i => i.name)
            )
        ) {
            this.log('still holding / wearing banned items — retrying deposit');
            await Execution.delayTicks(2);
            return;
        }

        this.bannedGear = false;
        this.bankTrips++;
        this.lastFeatherSeen = featherCount();
        await Bank.close();
        this.status = 'walk to coop';
        this.log('stripped for Entrana — walking to the chicken coop');
    }

    private async depositKeepFeathers(): Promise<void> {
        await Bank.depositAllMatching(name => !isKeepOnBank(name));
        await Execution.delayTicks(1);
    }

    private async unequipAll(): Promise<boolean> {
        for (let guard = 0; guard < 16; guard++) {
            const worn = Equipment.items().filter(i => i.name);
            if (worn.length === 0) {
                return true;
            }
            if (packFull()) {
                return false;
            }
            const name = worn[0]!.name!;
            this.log(`unequipping ${name}`);
            if (!(await Equipment.unequip(name))) {
                this.log(`could not unequip ${name}`);
                await Execution.delayTicks(1);
                return false;
            }
            await Execution.delayTicks(1);
        }
        return nothingEquipped();
    }

    private async dropJunk(): Promise<boolean> {
        if (Game.inCombat()) {
            return false;
        }
        const junk = Inventory.items().find(i => isJunkName(i.name)) ?? null;
        if (!junk) {
            return false;
        }
        this.status = `drop ${junk.name}`;
        this.log(`dropping ${junk.name} (not looting raw chicken / eggs)`);
        const before = packUsed();
        await junk.interact('Drop');
        await Execution.delayUntil(() => packUsed() < before, 4000);
        return true;
    }

    private async handleBones(): Promise<boolean> {
        if (!this.buryBones || Game.inCombat()) {
            return false;
        }

        const bones = Inventory.items().find(i => isBoneName(i.name)) ?? null;
        if (bones) {
            if (this.ownBonesPending <= 0) {
                this.status = 'drop foreign bones';
                this.log('dropping bones not from our kill');
                const before = packUsed();
                await bones.interact('Drop');
                await Execution.delayUntil(() => packUsed() < before, 4000);
                return true;
            }
            this.status = 'burying own bones';
            const before = packUsed();
            await bones.interact('Bury');
            if (await Execution.delayUntil(() => packUsed() < before, 3000)) {
                this.ownBonesPending = Math.max(0, this.ownBonesPending - 1);
                this.buried++;
                this.log(`buried own bones (#${this.buried})`);
            }
            return true;
        }
        return false;
    }

    private shouldLootGround(name: string | null): boolean {
        if (isFeatherName(name)) {
            return canLootFeathers(packFull(), featherCount());
        }
        if (isBoneName(name)) {
            return this.buryBones && !packFull();
        }
        return false;
    }

    private findOwnGroundLoot() {
        if (!this.ownLootTile || Date.now() > this.ownLootUntil) {
            return null;
        }
        const spot = this.ownLootTile;
        return (
            GroundItems.query()
                .within(OWN_LOOT_RADIUS + 4)
                .where(g => {
                    const t = g.tile();
                    if (!t || Tile.from(t).distanceTo(spot) > OWN_LOOT_RADIUS) {
                        return false;
                    }
                    return this.shouldLootGround(g.name);
                })
                .nearest() ?? null
        );
    }

    private findCampFeathers() {
        if (!canLootFeathers(packFull(), featherCount())) {
            return null;
        }
        const here = Game.tile();
        return (
            GroundItems.query()
                .name(FEATHER_NAME)
                .within(LOOT_RADIUS)
                .where(g => inChickenCamp(g.tile() ?? here, LOOT_RADIUS))
                .nearest() ??
            GroundItems.query()
                .within(LOOT_RADIUS)
                .where(g => isFeatherName(g.name))
                .where(g => inChickenCamp(g.tile() ?? here, LOOT_RADIUS))
                .nearest() ??
            null
        );
    }

    private async handleLoot(): Promise<boolean> {
        if (Game.inCombat()) {
            return false;
        }
        if (await this.handleBones()) {
            return true;
        }

        const ground = this.findOwnGroundLoot() ?? this.findCampFeathers();
        if (!ground) {
            return false;
        }

        this.status = `looting ${ground.name}`;
        const beforeUsed = packUsed();
        const feathersBefore = featherCount();
        const wasBones = isBoneName(ground.name);
        const wasFeather = isFeatherName(ground.name);
        const name = ground.name;
        this.cantReach = false;
        await ground.interact('Take');
        if (await Execution.delayUntil(() => packUsed() > beforeUsed || featherCount() > feathersBefore || this.cantReach, 5000)) {
            if (this.cantReach) {
                this.cantReach = false;
                this.log(`can't reach ${name} — opening the coop gate`);
                await this.ensureCoopAccess(true);
                return true;
            }
            if (wasBones && this.buryBones) {
                this.ownBonesPending++;
            }
            this.noteFeathers();
            this.log(`looted ${name}`);
            return true;
        }
        if (wasFeather) {
            this.noteFeathers();
        }
        this.log(`could not take ${name} — moving on`);
        return false;
    }

    private async attackChicken(npc: Npc): Promise<void> {
        const name = npc.name ?? CHICKEN_NAME;
        const t = npc.tile();
        this.status = `attacking ${name}`;
        this.cantReach = false;
        this.noteFightTarget(npc);

        this.log(`attacking ${name} @ ${t.x},${t.z}`);
        await npc.interact('Attack');
        await Execution.delayUntil(() => Game.inCombat() || this.cantReach || this.findChickenFightingMe() !== null, 4000);

        if (Game.inCombat() || this.findChickenFightingMe()) {
            const fighting = this.findChickenFightingMe();
            if (fighting) {
                this.noteFightTarget(fighting);
            }
            return;
        }

        if (this.cantReach) {
            this.log("can't reach chicken — opening coop gate and retrying");
            await this.ensureCoopAccess(true);
            this.cantReach = false;
            const again =
                Npcs.query()
                    .where(n => n.index === npc.index)
                    .nearest() ?? this.findAttackableChicken();
            if (again) {
                this.log(`retrying Attack on ${again.name ?? name}`);
                await again.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || this.cantReach || this.findChickenFightingMe() !== null, 3000);
                if (Game.inCombat() || this.findChickenFightingMe()) {
                    this.noteFightTarget(this.findChickenFightingMe() ?? again);
                    return;
                }
            }
            this.fightNpcIndex = -1;
        }
    }

    private findChickenFightingMe(): Npc | null {
        return (
            Npcs.query()
                .within(CAMP_RADIUS + 16)
                .where(n => isChickenNpcName(n.name))
                .where(n => n.targetsMe())
                .nearest() ??
            Npcs.query()
                .within(6)
                .where(n => isChickenNpcName(n.name))
                .where(n => n.actions().some(a => /attack/i.test(a ?? '')))
                .where(n => n.inCombat && !n.targetsAnotherPlayer())
                .nearest() ??
            null
        );
    }

    private findAttackableChicken(): Npc | null {
        const onMe = this.findChickenFightingMe();
        if (onMe) {
            return onMe;
        }

        const inCamp = (n: Npc): boolean => inChickenCamp(n.tile(), CAMP_RADIUS + 2);

        return (
            Npcs.query()
                .action('Attack')
                .within(CAMP_RADIUS + 16)
                .where(n => isChickenNpcName(n.name))
                .where(n => inCamp(n))
                .where(n => !n.targetsAnotherPlayer())
                .where(n => !n.inCombat)
                .nearest() ??
            Npcs.query()
                .within(CAMP_RADIUS + 16)
                .where(n => isChickenNpcName(n.name))
                .where(n => n.actions().some(a => /attack/i.test(a ?? '')))
                .where(n => inCamp(n))
                .where(n => !n.targetsAnotherPlayer())
                .where(n => !n.inCombat)
                .nearest() ??
            null
        );
    }

    private findShutCoopGate(): Loc | null {
        return (
            Locs.query()
                .within(COOP_GATE_RADIUS + 6)
                .where(l => isCoopBarrier(l))
                .nearest() ?? null
        );
    }

    private async ensureCoopAccess(force = false): Promise<boolean> {
        const here = Game.tile();
        if (!here || !isOnEntrana(here)) {
            return false;
        }

        const dist = Tile.from(here).distanceTo(CHICKEN_CAMP);
        if (dist > CAMP_RADIUS + 10 && !force) {
            return false;
        }

        const shut = this.findShutCoopGate();

        if (isInsideCoop(here) && !shut && !force) {
            return false;
        }

        if (!shut && !force && dist <= CAMP_RADIUS) {
            return false;
        }

        if (shut) {
            const gt = locTile(shut);
            this.status = 'opening coop gate';
            this.log(`coop gate shut @ ${gt ? `${gt.x},${gt.z}` : '?'} — opening and entering`);
            const opened = await this.openCoopGate(shut);
            if (!opened) {
                this.log('failed to open coop gate');
                return true;
            }
        } else if (force) {
            this.log('no shut coop gate found — walking into the coop anyway');
        }

        this.status = 'entering chicken coop';
        this.log(`walking into chicken coop ${CHICKEN_CAMP.x},${CHICKEN_CAMP.z}`);
        await Traversal.walkResilient(CHICKEN_CAMP, {
            radius: 2,
            timeoutMs: 20_000,
            log: m => this.log(`  ${m}`)
        });
        return true;
    }

    private async openCoopGate(knownGate: Loc | null = null): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }

        const gate = knownGate ?? this.findShutCoopGate();
        if (!gate) {
            return false;
        }

        const t = locTile(gate);
        if (!t || Tile.from(t).distanceTo(CHICKEN_CAMP) > COOP_GATE_RADIUS) {
            return false;
        }

        if (cheb(here, t) > 1) {
            this.log(`walking to ${gate.name} at ${t.x},${t.z}`);
            await Traversal.walkTo(t, { radius: 1, timeoutMs: 12_000 });
        }

        const shut =
            Locs.query()
                .where(l => {
                    const lt = locTile(l);
                    return lt !== null && lt.x === t.x && lt.z === t.z && isCoopBarrier(l);
                })
                .nearest() ?? null;
        if (!shut) {
            return true;
        }

        const op = openDoorOp(shut);
        if (!op) {
            return false;
        }

        this.log(`opening ${shut.name} at ${t.x},${t.z}`);
        if (!(await shut.interact(op))) {
            return false;
        }

        return Execution.delayUntil(() => {
            const still = Locs.query()
                .where(l => {
                    const lt = locTile(l);
                    return lt !== null && lt.x === t.x && lt.z === t.z && isCoopBarrier(l);
                })
                .nearest();
            return still === null;
        }, 5000);
    }

    private async ensureCombatStyle(): Promise<boolean> {
        if (this.rotateStyles) {
            const cur = Skills.level(this.desiredStyle);
            if (shouldRotateStyle(cur, this.styleLevelAnchor, this.levelsBeforeSwap)) {
                const next = pickRandomStyle(this.desiredStyle);
                this.log(`random swap ${this.desiredStyle} → ${next} (gained ${cur - this.styleLevelAnchor} lv; atk=${Skills.level('attack')} str=${Skills.level('strength')} def=${Skills.level('defence')})`);
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
        this.ownBonesPending = 0;
        this.bannedGear = false;
        this.status = 'dead — boat back';
        this.log('respawned — strip at Draynor then walk to the Entrana chicken coop');
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const elapsed = Date.now() - this.startedAt;
        const hrs = elapsed / 3_600_000;
        const featherPh = hrs > 0.008 ? this.feathersLooted / hrs : 0;
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8d48b' });
        p.title(`Entrana Chicken Killer v${SCRIPT_VERSION} — ${this.status}`);
        p.row(`Runtime: ${fmtElapsed(elapsed)}`, `Kills: ${this.kills}`, `Feathers: ${this.feathersLooted} (${fmtXph(featherPh)}/hr)`);
        p.row(`Pack feathers: ${featherCount()}`, this.rotateStyles ? `Rotate: ${Skills.level(this.desiredStyle) - this.styleLevelAnchor}/${this.levelsBeforeSwap} on ${this.desiredStyle}` : `Fixed: ${this.desiredStyle}`, 'Unarmed');
        if (this.buryBones) {
            p.row(`Buried: ${this.buried}`, this.ownBonesPending > 0 ? `Pending bones: ${this.ownBonesPending}` : 'Own-kill bones');
        }
        p.row(`Boats: ${this.boatTrips}`, `Banks: ${this.bankTrips}`, `Deaths: ${this.deaths}`);
        for (const skill of COMBAT_TRACK) {
            if (!this.usedSkills.has(skill)) {
                continue;
            }
            const gained = Math.max(0, Skills.xp(skill) - (this.xpAtStart[skill] ?? 0));
            const xph = hrs > 0.0005 ? gained / hrs : 0;
            p.row(`${skill}: ${fmtXph(xph)} xp/hr`, `+${Math.round(gained)} xp`);
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
