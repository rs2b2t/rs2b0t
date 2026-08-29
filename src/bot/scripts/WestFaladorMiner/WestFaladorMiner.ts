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
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    ANCHOR,
    FALADOR_WEST_BANK,
    HANDLE_BANK,
    HANDLE_OPTIONS,
    HANDLE_POWERMINE,
    MINE_RADIUS,
    ORES,
    PICKAXE_UNLOCKS,
    ROCK_EMPTY,
    WALL_AGILITY_NEED,
    WALL_PIN,
    WALL_WEST,
    bestUsablePickDef,
    canUsePick,
    canUseWallShortcut,
    canWieldPick,
    eastOfWall,
    fmtElapsed,
    fmtXph,
    inMineRadius,
    isBankLoot,
    isBestPickName,
    isCrumblingWall,
    isDropJunk,
    isHandling,
    isKeepTool,
    isOreItemName,
    isPickaxeName,
    isShutDoor,
    locDist,
    locIdOf,
    locMatchesOre,
    locMineOp,
    locTile,
    normName,
    openDoorOp,
    oreLine,
    parseRockChat,
    pickDefByName,
    pickFrom,
    pickRank,
    prospectOp,
    shouldDropWhenPowermining,
    wallClimbOp,
    wallShortcutStatus,
    wantedOres,
    westOfWall,
    type Handling,
    type OreDef,
    type PickaxeDef
} from './WestFaladorMinerLogic.js';

const SCRIPT_VERSION = '1.5';

export const SETTINGS: SettingsSchema = {
    brokenWall: {
        type: 'string',
        default: 'Agility 5 required',
        options: ['Agility 5 required'],
        label: 'Broken wall (mine to bank)',
        group: 'Requirements',
        help: 'REQUIRED: Agility 5 to Climb-over the crumbling / broken wall west of Falador (2935,3355) when banking from the mine. The wall is one-way into the city. Walking back to the mine always uses the south/west gate. Below Agility 5 the bot takes the long walk to the closest bank. This field is a reminder; the bot reads your Agility level in-game.'
    },
    mineCoal: {
        type: 'boolean',
        default: true,
        label: 'Coal',
        group: 'Ore',
        help: 'Mine coal rocks (Mining 30+) within 30 tiles of 2907,3359. Preferred over Iron when both are ticked.'
    },
    mineIron: {
        type: 'boolean',
        default: true,
        label: 'Iron',
        group: 'Ore',
        help: 'Mine iron rocks (Mining 15+) within 30 tiles of 2907,3359.'
    },
    mineCopper: {
        type: 'boolean',
        default: false,
        label: 'Copper',
        group: 'Ore',
        help: 'Mine copper rocks (Mining 1+) within 30 tiles of 2907,3359.'
    },
    mineTin: {
        type: 'boolean',
        default: false,
        label: 'Tin',
        group: 'Ore',
        help: 'Mine tin rocks (Mining 1+) within 30 tiles of 2907,3359.'
    },
    handling: {
        type: 'string',
        default: HANDLE_BANK,
        options: [...HANDLE_OPTIONS],
        label: 'When inventory is full',
        group: 'Handling',
        help: `Powermine drops ore (and beer/kebab) on the spot but keeps gems, caskets, and other random-event loot — it will bank if those fill the pack. Bank deposits ore plus gems/caskets/random loot and keeps the pickaxe; beer/kebab are always dropped, never deposited. At Agility ${WALL_AGILITY_NEED}+ Climb-over the west Falador crumbling / broken wall (${WALL_PIN.x},${WALL_PIN.z}) on the way back from the mine only. Return to the mine uses the gate. Below Agility ${WALL_AGILITY_NEED} it walks to the closest bank the long way.`
    }
};

function oreCount(): number {
    return Inventory.items()
        .filter(i => isOreItemName(i.name))
        .reduce((n, i) => n + Math.max(1, i.count || 1), 0);
}

export default class WestFaladorMiner extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = 0;
    private mineXpAtStart = 0;
    private mined = 0;
    private bankTrips = 0;
    private lastOreSeen = 0;
    private gearReady = false;
    private loggedRockNames = false;
    private warnedAgility = false;
    private mineCoal = true;
    private mineIron = true;
    private mineCopper = false;
    private mineTin = false;
    private handling: Handling = HANDLE_BANK;
    private rockTypes = new Map<number, string>();
    private lastRockChat: string | null = null;
    private pendingRockId: number | null = null;
    private skipRockUntil = new Map<string, number>();

    override grindTargets(): string[] {
        return this.wantedOres().map(o => o.label.toLowerCase());
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();

        this.syncPrefs(true);
        this.startedAt = Date.now();
        this.mineXpAtStart = Skills.xp('mining');
        this.mined = 0;
        this.bankTrips = 0;
        this.lastOreSeen = oreCount();
        this.gearReady = false;
        this.loggedRockNames = false;
        this.warnedAgility = false;
        this.rockTypes.clear();
        this.lastRockChat = null;
        this.pendingRockId = null;
        this.skipRockUntil.clear();

        this.on('chat.message', e => {
            const kind = parseRockChat(e.text);
            if (kind) {
                this.lastRockChat = kind;
                const id = this.pendingRockId;
                if (id != null && !this.rockTypes.has(id)) {
                    this.rockTypes.set(id, kind);
                }
            }
        });

        this.on('skill.level', e => {
            if (e.name === 'mining') {
                this.log(`mining ${e.previous} → ${e.level}`);
                if (PICKAXE_UNLOCKS.has(e.level)) {
                    this.gearReady = false;
                    this.log('mining unlock — will recheck bank for a better pickaxe');
                }
            }
            if (e.name === 'attack') {
                this.log(`attack ${e.previous} → ${e.level}`);
                this.log('attack level-up — will wield the best pickaxe if Attack now allows');
            }
            if (e.name === 'agility') {
                this.log(`agility ${e.previous} → ${e.level} — ${wallShortcutStatus(e.level)}`);
            }
        });

        const agi = Skills.level('agility');
        this.log(`West Falador Miner ${SCRIPT_VERSION} — ${this.oreLine()} at ${ANCHOR.x},${ANCHOR.z} (${MINE_RADIUS}t) / ${this.handling} — Mining ${Skills.level('mining')} Attack ${Skills.level('attack')}`);
        this.log(`BROKEN WALL: Agility ${WALL_AGILITY_NEED} required to Climb-over the crumbling / broken wall at ${WALL_PIN.x},${WALL_PIN.z} (mine to Falador west bank only). Return to the mine uses the gate.`);
        this.log(wallShortcutStatus(agi));
        if (!canUseWallShortcut(agi)) {
            this.log(`WARNING: Agility ${agi} is below ${WALL_AGILITY_NEED}. Train Agility to ${WALL_AGILITY_NEED} to use the broken wall. Until then the bot walks the long gate route to bank.`);
        }
        for (const ore of this.tickedOres()) {
            if (Skills.level('mining') < ore.level) {
                this.log(`WARNING: ${ore.label} needs Mining ${ore.level}+ (you have ${Skills.level('mining')})`);
            }
        }
        this.status = 'ready';
    }

    override onResume(): void {
        this.syncPrefs(false);
    }

    override onStop(): void {
        this.log(`stopped — mined ~${this.mined}, bank trips ${this.bankTrips} (${this.status})`);
    }

    private oreFlags(): Record<(typeof ORES)[number]['prefKey'], boolean> {
        return { mineCoal: this.mineCoal, mineIron: this.mineIron, mineCopper: this.mineCopper, mineTin: this.mineTin };
    }

    private tickedOres(): OreDef[] {
        return ORES.filter(o => this[o.prefKey]);
    }

    private wantedOres(): OreDef[] {
        return wantedOres(this.tickedOres(), Skills.level('mining'));
    }

    private oreLine(): string {
        return oreLine(this.tickedOres());
    }

    private syncPrefs(silent: boolean): void {
        const prevFlags = this.oreFlags();
        const prevHandle = this.handling;
        this.mineCoal = this.settings.bool('mineCoal', this.mineCoal);
        this.mineIron = this.settings.bool('mineIron', this.mineIron);
        this.mineCopper = this.settings.bool('mineCopper', this.mineCopper);
        this.mineTin = this.settings.bool('mineTin', this.mineTin);
        const handleRaw = this.settings.str('handling', this.handling);
        this.handling = isHandling(handleRaw) ? handleRaw : (pickFrom(HANDLE_OPTIONS, handleRaw, HANDLE_BANK) as Handling);
        if (!silent) {
            const next = this.oreFlags();
            if (ORES.some(o => prevFlags[o.prefKey] !== next[o.prefKey])) {
                this.log(`prefs: ore → ${this.oreLine()}`);
                this.loggedRockNames = false;
            }
            if (prevHandle !== this.handling) {
                this.log(`prefs: handling → ${this.handling}`);
            }
        }
    }

    private noteOres(): void {
        const now = oreCount();
        if (now > this.lastOreSeen) {
            this.mined += now - this.lastOreSeen;
        }
        this.lastOreSeen = now;
    }

    private heldPickCount(name: string): number {
        const n = name.toLowerCase();
        let c = Inventory.items()
            .filter(i => normName(i.name) === n)
            .reduce((s, i) => s + Math.max(1, i.count || 1), 0);
        if (Equipment.contains(name)) {
            c += 1;
        } else {
            c += Equipment.items().filter(i => normName(i.name) === n).length;
        }
        return c;
    }

    private heldPickCountDef(def: PickaxeDef): number {
        return def.aliases.reduce((n, a) => n + this.heldPickCount(a), 0);
    }

    private bankPickHits(def: PickaxeDef) {
        if (!Bank.isOpen()) {
            return [];
        }
        const names = new Set(def.aliases.map(a => a.toLowerCase()));
        return Bank.items().filter(i => names.has(normName(i.name)));
    }

    private bankPickCountDef(def: PickaxeDef): number {
        if (!Bank.isOpen()) {
            return 0;
        }
        const hits = this.bankPickHits(def);
        if (hits.length > 0) {
            return hits.reduce((n, i) => n + Math.max(1, i.count || 0), 0);
        }
        return def.aliases.reduce((n, a) => n + (Bank.count(a) || 0), 0);
    }

    private bestHeldPickDef(): PickaxeDef | null {
        return bestUsablePickDef(Skills.level('mining'), d => this.heldPickCountDef(d) > 0);
    }

    private hasUsablePick(): boolean {
        return this.bestHeldPickDef() !== null;
    }

    private equippedPickName(): string | null {
        const hit = Equipment.items().find(i => isPickaxeName(i.name));
        return hit?.name ?? null;
    }

    async loop(): Promise<void> {
        if (!Game.ingame() || Game.tile() === null) {
            await Execution.delayTicks(5);
            return;
        }

        this.syncPrefs(true);
        this.noteOres();
        this.warnAgilityOnce();

        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            return;
        }

        if (await this.dropDwarfJunk()) {
            return;
        }

        if (await this.prepPickaxe()) {
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
            return;
        }

        if (!this.hasUsablePick()) {
            this.gearReady = false;
            if (await this.lootPickFromGround(true)) {
                this.log('looted pickaxe from ground — continuing');
                return;
            }
            this.status = 'need pickaxe';
            this.log('no usable pickaxe — banking for one');
            await this.prepPickaxe(true);
            return;
        }

        if (await this.ensureBestPick()) {
            return;
        }

        if (Inventory.isFull()) {
            await this.handleFullPack();
            return;
        }

        if (await this.lootPickFromGround(true)) {
            await this.ensureBestPick();
            return;
        }

        if (this.tickedOres().length === 0) {
            this.status = 'tick an ore';
            this.log('no ores ticked — tick Coal, Iron, Copper, and/or Tin');
            await Execution.delayTicks(8);
            return;
        }

        const wanted = this.wantedOres();
        if (wanted.length === 0) {
            const need = Math.min(...this.tickedOres().map(o => o.level));
            this.status = `need Mining ${need}+`;
            this.log(`${this.oreLine()} requires Mining ${need} (you have ${Skills.level('mining')}) — waiting`);
            await Execution.delayTicks(8);
            return;
        }

        if (!(await this.ensureAtMine())) {
            return;
        }

        if (Game.animating() && !Game.inCombat() && !Inventory.isFull()) {
            this.status = 'mining';
            await Execution.delayTicks(1);
            this.noteOres();
            return;
        }

        const found = this.findRock();
        if (found) {
            await this.mineRock(found);
            return;
        }

        const unknown = this.findUnknownRock();
        if (unknown) {
            await this.prospectRock(unknown);
            return;
        }

        this.status = 'waiting for rock';
        if (!this.loggedRockNames) {
            this.logNearbyMineLocs();
            this.loggedRockNames = true;
        }
        await Traversal.walkTo(ANCHOR, { radius: 2, timeoutMs: 8_000 });
        await this.openNearbyDoor();
        await Execution.delayTicks(2);
    }

    private warnAgilityOnce(): void {
        if (this.warnedAgility) {
            return;
        }
        const agi = Skills.level('agility');
        if (canUseWallShortcut(agi)) {
            return;
        }
        this.warnedAgility = true;
        this.log(`Agility ${agi} < ${WALL_AGILITY_NEED}: broken / crumbling wall cannot be used. Train Agility ${WALL_AGILITY_NEED} to shortcut mine → Falador west bank.`);
    }

    private async prepPickaxe(force = false): Promise<boolean> {
        if (this.gearReady && !force && this.hasUsablePick()) {
            return false;
        }

        this.status = 'gear: pickaxe';
        await this.lootPickFromGround(false);

        if (!(await this.findAndOpenBank())) {
            return true;
        }

        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 3000);
        await Execution.delayTicks(1);
        await this.dropDwarfJunk();

        this.log('gear: depositing all except pickaxes');
        await Bank.depositAllMatching(name => !isKeepTool(name) && !isDropJunk(name));
        await Execution.delayTicks(1);

        if (!(await this.syncBestPickFromOpenBank())) {
            return true;
        }

        await Bank.close();
        await Execution.delayTicks(1);
        await this.ensureBestPick();

        if (!this.hasUsablePick()) {
            this.log('gear: still missing pickaxe after bank');
            await Execution.delayTicks(5);
            return true;
        }

        this.gearReady = true;
        const held = this.bestHeldPickDef();
        const wieldOk = held != null && canWieldPick(held, Skills.level('attack'));
        this.log(`gear: ready — ${held?.name ?? 'pickaxe'}` + (wieldOk ? ' (wielded)' : ' (in pack — Mining uses it without wielding)'));
        return true;
    }

    private async findAndOpenBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }

        const useWall = canUseWallShortcut(Skills.level('agility'));
        if (useWall && westOfWall(Game.tile())) {
            this.status = 'wall shortcut to bank';
            this.log(`Agility ${Skills.level('agility')} ≥ ${WALL_AGILITY_NEED} — Climb-over broken wall back to west bank`);
            if (!(await this.climbWall())) {
                this.log('wall shortcut failed — banking the long way');
            }
        } else if (!useWall && westOfWall(Game.tile())) {
            this.log(`Agility ${Skills.level('agility')} < ${WALL_AGILITY_NEED}: skipping broken wall, walking the long gate route to bank`);
        }

        this.status = useWall ? 'opening west Falador bank' : 'opening closest bank';
        this.log(useWall ? 'opening west Falador bank' : 'opening closest bank');
        const opened = await Banking.open({
            ...(useWall ? { stand: FALADOR_WEST_BANK } : {}),
            log: m => this.log(`  ${m}`)
        });
        if (opened) {
            await this.openNearbyDoor();
            return true;
        }
        this.log('could not open bank — retrying');
        await Execution.delayTicks(3);
        return false;
    }

    private findCrumblingWall(): Loc | null {
        return (
            Locs.query()
                .where(l => isCrumblingWall(l))
                .nearest() ?? null
        );
    }

    private async climbWall(): Promise<boolean> {
        const here = Game.tile();
        if (here && eastOfWall(here)) {
            return true;
        }

        this.status = 'Climb-over broken wall';
        this.log(`walking to crumbling / broken wall ${WALL_WEST.x},${WALL_WEST.z} (Agility ${WALL_AGILITY_NEED}+)`);
        await Traversal.walkResilient(WALL_WEST, {
            radius: 2,
            log: m => this.log(`  ${m}`)
        });
        await this.openNearbyDoor();

        if (eastOfWall(Game.tile())) {
            return true;
        }

        const wall = this.findCrumblingWall();
        const op = wall ? wallClimbOp(wall) : null;
        if (!wall || !op) {
            this.log('crumbling / broken wall not in scene');
            return false;
        }

        this.log(`Climb-over ${wall.name ?? 'broken wall'} into Falador (Agility ${Skills.level('agility')} ≥ ${WALL_AGILITY_NEED})`);
        await wall.interact(op);
        const crossed = await Execution.delayUntil(() => eastOfWall(Game.tile()), 8_000);
        if (!crossed) {
            this.log('wall climb timed out');
            return false;
        }
        await Execution.delayTicks(1);
        return true;
    }

    private async syncBestPickFromOpenBank(): Promise<boolean> {
        const mining = Skills.level('mining');
        const best = bestUsablePickDef(mining, d => this.heldPickCountDef(d) > 0 || this.bankPickCountDef(d) > 0);

        if (!best) {
            this.log(`gear: no usable pickaxe in bank/pack for Mining ${mining} — waiting`);
            await Bank.close();
            await Execution.delayTicks(8);
            return false;
        }

        if (this.heldPickCountDef(best) === 0 && this.bankPickCountDef(best) > 0) {
            const alias = this.bankPickHits(best)[0]?.name ?? best.aliases.find(a => (Bank.count(a) || 0) > 0) ?? best.name;
            this.log(`gear: withdrawing ${alias} (best for Mining ${mining}; Attack ${Skills.level('attack')}` + (Skills.level('attack') >= best.attack ? ', will wield)' : ', stays in pack)'));
            if (!(await Bank.withdrawX(alias, 1))) {
                this.log(`gear: withdraw failed for ${alias}`);
                await Execution.delayTicks(2);
                return false;
            }
            await Execution.delayTicks(1);
        }

        const worn = this.equippedPickName();
        if (worn && !isBestPickName(worn, best)) {
            this.log(`gear: unequipping ${worn} (keeping ${best.name} for Mining ${best.mining}+)`);
            await Equipment.unequip(worn);
            await Execution.delayTicks(1);
        }

        const keepName = best.aliases.find(a => this.heldPickCount(a) > 0) ?? best.name;
        await Bank.depositAllMatching(name => {
            if (!isPickaxeName(name)) {
                return false;
            }
            return normName(name) !== normName(keepName);
        });
        await Execution.delayTicks(1);
        return true;
    }

    private async freeSlotForPickSwap(): Promise<boolean> {
        if (!Inventory.isFull()) {
            return true;
        }
        const item = Inventory.items().find(i => isDropJunk(i.name)) ?? Inventory.items().find(i => isOreItemName(i.name)) ?? null;
        if (!item) {
            return false;
        }
        this.log(`dropping ${item.name} to free a slot for the best pickaxe`);
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
        this.lastOreSeen = oreCount();
        return !Inventory.isFull();
    }

    private async ensureBestPick(): Promise<boolean> {
        const held = this.bestHeldPickDef();
        if (!held) {
            return false;
        }
        const mining = Skills.level('mining');
        const atk = Skills.level('attack');
        const worn = this.equippedPickName();
        if (isBestPickName(worn, held)) {
            return false;
        }

        if (worn) {
            if (Inventory.isFull() && !(await this.freeSlotForPickSwap())) {
                this.log('pack full — banking so we can swap to the best pickaxe');
                await this.bankOresAndReturn();
                return true;
            }
            this.status = `gear: unequip ${worn}`;
            this.log(`gear: unequipping ${worn} so Mining uses ${held.name}` + (canWieldPick(held, atk) ? ` (best for Mining ${mining})` : ` in pack (best for Mining ${mining}; Attack ${atk} < ${held.attack} to wield)`));
            await Equipment.unequip(worn);
            await Execution.delayTicks(1);
        }

        if (!canWieldPick(held, atk)) {
            return false;
        }

        const invName = held.aliases.find(a => Inventory.items().some(i => normName(i.name) === a.toLowerCase())) ?? held.name;
        this.status = `gear: wield ${invName}`;
        this.log(`gear: wielding ${invName} (Attack ${atk} ≥ ${held.attack})`);
        const ok = await Equipment.equip(invName);
        if (!ok) {
            this.log(`could not wield ${invName} — Mining will use it in the pack`);
        }
        await Execution.delayTicks(1);
        return true;
    }

    private async lootPickFromGround(wide: boolean): Promise<boolean> {
        const mining = Skills.level('mining');
        const current = this.bestHeldPickDef();
        const currentRank = pickRank(current);
        const within = wide ? 18 : 10;
        const ground = GroundItems.query()
            .within(within)
            .where(g => {
                const def = pickDefByName(g.name);
                return def ? canUsePick(def, mining) && pickRank(def) < currentRank : false;
            })
            .nearest();
        if (!ground) {
            return false;
        }
        const before = Inventory.used();
        this.log(`taking ${ground.name} from ground (better than ${current?.name ?? 'none'})`);
        await ground.interact('Take');
        return Execution.delayUntil(() => Inventory.used() > before || this.bestHeldPickDef() !== current, 6000);
    }

    private async dropDwarfJunk(): Promise<boolean> {
        let dropped = false;
        for (let guard = 0; guard < 8; guard++) {
            const item = Inventory.items().find(i => isDropJunk(i.name)) ?? null;
            if (!item) {
                break;
            }
            const name = item.name ?? 'junk';
            this.status = `dropping ${name}`;
            this.log(`dropping ${name}`);
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 4000);
            dropped = true;
        }
        return dropped;
    }

    private async handleFullPack(): Promise<void> {
        if (await this.dropDwarfJunk()) {
            if (!Inventory.isFull()) {
                return;
            }
        }
        if (this.handling === HANDLE_POWERMINE) {
            await this.dropOres();
            if (Inventory.isFull() && Inventory.items().some(i => isBankLoot(i.name))) {
                this.log('powermine pack still full of gems/caskets/random loot — banking');
                await this.bankOresAndReturn();
            }
            return;
        }
        await this.bankOresAndReturn();
    }

    private async dropOres(): Promise<void> {
        this.status = 'powermining — dropping';
        const n = oreCount();
        this.log(n > 0 ? `inventory full — dropping ${n} ore` : 'inventory full — dropping beer/kebab only (keeping gems/caskets)');
        for (let guard = 0; guard < 28; guard++) {
            const item = Inventory.items().find(i => shouldDropWhenPowermining(i.name));
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
            await Execution.delay(80 + Math.floor(Math.random() * 140));
        }
        this.lastOreSeen = oreCount();
    }

    private async bankOresAndReturn(): Promise<void> {
        const n = oreCount();
        this.status = 'banking';
        const loot = Inventory.items().filter(i => isBankLoot(i.name));
        const lootNames = loot
            .map(i => i.name)
            .slice(0, 4)
            .join(', ');
        const lootBit = loot.length > 0 ? ` + ${lootNames}${loot.length > 4 ? '...' : ''}` : '';
        const wallBit = canUseWallShortcut(Skills.level('agility')) ? ' via broken wall → west Falador' : ` long route (need Agility ${WALL_AGILITY_NEED} for the wall)`;
        this.log(`banking ${n} ore${lootBit}${wallBit}`);

        if (!(await this.findAndOpenBank())) {
            return;
        }

        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 3000);
        await Execution.delayTicks(1);
        await this.dropDwarfJunk();

        this.log('depositing pack (keep pickaxe; bank gems/caskets/random loot)');
        await Bank.depositAllMatching(name => !isKeepTool(name) && !isDropJunk(name));
        await Execution.delayTicks(1);
        await this.syncBestPickFromOpenBank();
        await Bank.close();
        await Execution.delayTicks(1);
        await this.ensureBestPick();

        this.bankTrips++;
        this.lastOreSeen = oreCount();
        this.status = 'returning to rocks';
    }

    private async ensureAtMine(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(2);
            return false;
        }
        if (Tile.from(here).distanceTo(ANCHOR) > MINE_RADIUS) {
            this.status = 'walking to West Falador mine (gate route)';
            this.log(`walking to West Falador mine ${ANCHOR.x},${ANCHOR.z} via the gate (broken wall is one-way into the city)`);
            await Traversal.walkResilient(ANCHOR, {
                radius: 3,
                log: m => this.log(`  ${m}`)
            });
            await this.openNearbyDoor();
        }
        const at = Game.tile();
        return !!at && Tile.from(at).distanceTo(ANCHOR) <= MINE_RADIUS;
    }

    private async openNearbyDoor(): Promise<boolean> {
        const door = Locs.query()
            .where(l => isShutDoor(l))
            .where(l => l.distance() <= 4)
            .nearest();
        if (!door) {
            return false;
        }
        const op = openDoorOp(door);
        if (!op) {
            return false;
        }
        this.log(`opening ${door.name}`);
        await door.interact(op);
        await Execution.delayTicks(2);
        return true;
    }

    private rockSkipKey(loc: Loc): string | null {
        const id = locIdOf(loc);
        if (id != null) {
            return `id:${id}`;
        }
        const t = locTile(loc);
        return t ? `tile:${t.x},${t.z}` : null;
    }

    private isSkippedRock(loc: Loc): boolean {
        const key = this.rockSkipKey(loc);
        if (!key) {
            return false;
        }
        return Date.now() < (this.skipRockUntil.get(key) ?? 0);
    }

    private skipRock(loc: Loc, ms: number): void {
        const key = this.rockSkipKey(loc);
        if (key) {
            this.skipRockUntil.set(key, Date.now() + ms);
        }
    }

    private mineLocs(): Loc[] {
        const list = Locs.query()
            .where(l => locMineOp(l) !== null)
            .where(l => inMineRadius(locTile(l)))
            .results();
        return list.slice().sort((a, b) => locDist(a) - locDist(b));
    }

    private rememberRockType(loc: Loc, kind: string): void {
        const id = locIdOf(loc);
        if (id == null || !kind) {
            return;
        }
        const prev = this.rockTypes.get(id);
        if (prev !== kind) {
            this.rockTypes.set(id, kind);
            this.log(`rock id ${id} → ${kind}`);
        }
    }

    private findRock(): { rock: Loc; ore: OreDef } | null {
        const wanted = this.wantedOres();
        if (wanted.length === 0) {
            return null;
        }
        for (const ore of wanted) {
            for (const loc of this.mineLocs()) {
                if (this.isSkippedRock(loc)) {
                    continue;
                }
                if (locMatchesOre(loc, ore)) {
                    return { rock: loc, ore };
                }
                const id = locIdOf(loc);
                if (id != null && this.rockTypes.get(id) === ore.id) {
                    return { rock: loc, ore };
                }
            }
        }
        return null;
    }

    private findUnknownRock(): Loc | null {
        for (const loc of this.mineLocs()) {
            if (this.isSkippedRock(loc)) {
                continue;
            }
            if (this.wantedOres().some(o => locMatchesOre(loc, o))) {
                continue;
            }
            const id = locIdOf(loc);
            if (id != null && this.rockTypes.has(id)) {
                continue;
            }
            if (prospectOp(loc) || locMineOp(loc)) {
                return loc;
            }
        }
        return null;
    }

    private async approachLoc(loc: Loc): Promise<boolean> {
        if (loc.distance() <= 1) {
            return true;
        }
        const t = locTile(loc);
        if (!t) {
            return false;
        }
        await Traversal.walkTo(t, { radius: 1, timeoutMs: 8_000 });
        await this.openNearbyDoor();
        return true;
    }

    private async prospectRock(loc: Loc): Promise<void> {
        const op = prospectOp(loc);
        if (!op) {
            this.log(`no Prospect on ${loc.name ?? 'Rocks'} id=${locIdOf(loc) ?? '?'} — skipping`);
            const id = locIdOf(loc);
            if (id != null) {
                this.rockTypes.set(id, 'other');
            }
            await Execution.delayTicks(1);
            return;
        }

        await this.approachLoc(loc);
        this.lastRockChat = null;
        this.pendingRockId = locIdOf(loc);
        const t = locTile(loc);
        this.status = `prospect ${t?.x ?? '?'},${t?.z ?? '?'}`;
        this.log(`Prospect ${loc.name ?? 'Rocks'} id=${this.pendingRockId ?? '?'} @ ${t?.x ?? '?'},${t?.z ?? '?'}`);
        await loc.interact(op);

        const got = await Execution.delayUntil(() => this.lastRockChat != null, 6_000);
        const id = this.pendingRockId;
        if (got && this.lastRockChat) {
            if (id != null) {
                this.rockTypes.set(id, this.lastRockChat);
            }
            this.log(`  ${id != null ? `id ${id}` : 'rock'} → ${this.lastRockChat}`);
        } else {
            this.log(`  prospect timed out${id != null ? ` for id ${id}` : ''}`);
            this.skipRock(loc, 12_000);
        }
        this.pendingRockId = null;
        await Execution.delayTicks(1);
    }

    private logNearbyMineLocs(): void {
        const locs = this.mineLocs();
        if (locs.length === 0) {
            this.log(`no ${this.oreLine()} rock at ${ANCHOR.x},${ANCHOR.z} — no Mine locs in scene`);
            return;
        }
        const bits = locs.slice(0, 12).map(l => {
            const t = locTile(l);
            const id = locIdOf(l);
            const kind = id != null ? this.rockTypes.get(id) : null;
            return `${l.name ?? 'Rocks'} id=${id ?? '?'}${kind ? `=${kind}` : ''} @ ${t?.x ?? '?'},${t?.z ?? '?'}`;
        });
        this.log(`Mine locs in ${MINE_RADIUS}t of ${ANCHOR.x},${ANCHOR.z}: ${bits.join(' | ')}`);
    }

    private async mineRock(found: { rock: Loc; ore: OreDef }): Promise<void> {
        const { rock, ore } = found;
        const op = locMineOp(rock);
        if (!op) {
            await Execution.delayTicks(1);
            return;
        }
        await this.approachLoc(rock);
        const before = oreCount();
        const beforeXp = Skills.xp('mining');
        const st = rock.tile();
        this.pendingRockId = locIdOf(rock);
        this.lastRockChat = null;
        this.status = `mining ${ore.label} (${st.x},${st.z})`;
        this.log(`Mine ${rock.name ?? ore.label} id=${this.pendingRockId ?? '?'} @ ${st.x},${st.z}`);
        await rock.interact(op);

        await Execution.delayUntil(() => oreCount() > before || Skills.xp('mining') > beforeXp || Game.animating() || this.lastRockChat === ROCK_EMPTY || ChatDialog.canContinue() || Inventory.isFull(), 8_000);
        this.noteOres();

        if (Game.animating() && !Game.inCombat()) {
            await Execution.delayUntil(() => oreCount() > before || Skills.xp('mining') > beforeXp || !Game.animating() || this.lastRockChat === ROCK_EMPTY || ChatDialog.canContinue() || Inventory.isFull(), 20_000);
            this.noteOres();
        }

        if (oreCount() > before || Skills.xp('mining') > beforeXp) {
            this.rememberRockType(rock, ore.id);
        } else if (this.lastRockChat === ROCK_EMPTY) {
            this.rememberRockType(rock, ROCK_EMPTY);
        }
        this.pendingRockId = null;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const elapsed = Date.now() - this.startedAt;
        const hrs = elapsed / 3_600_000;
        const xp = Skills.xp('mining') - this.mineXpAtStart;
        const xph = hrs > 0.008 ? xp / hrs : 0;
        const orePh = hrs > 0.008 ? this.mined / hrs : 0;
        const held = this.bestHeldPickDef();
        const pick = held?.name?.replace(/ pickaxe/i, '') ?? 'none';
        const agi = Skills.level('agility');
        const wallOn = canUseWallShortcut(agi);

        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c4a35a' });
        p.title(`West Falador Miner v${SCRIPT_VERSION} — ${this.status}`);
        p.row(`Agility ${agi}/${WALL_AGILITY_NEED}`, wallOn ? 'Broken wall shortcut ON' : `NEED AGILITY ${WALL_AGILITY_NEED} FOR BROKEN WALL`);
        p.row(`Runtime: ${fmtElapsed(elapsed)}`, `Mine ${Skills.level('mining')}`, `Atk ${Skills.level('attack')}`, pick);
        p.row(this.oreLine(), this.handling, `${ANCHOR.x},${ANCHOR.z} (${MINE_RADIUS}t)`, `Ore ${oreCount()}`);
        p.row(`Mined: ${this.mined} (${fmtXph(orePh)}/hr)`, `Trips: ${this.bankTrips}`, `XP: ${fmtXph(xph)}/hr`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
