import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Npcs, talkOp, type Npc } from '../../api/npcs/Npcs.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { talkThrough } from '../../api/ai/quests/exec/primitives.js';
import {
    AIR_RUNE,
    BRONZE_AXE,
    CAST_TICKS,
    CAVE_MONK,
    CAVE_MONK_AGREE,
    DRAMEN_TREE_ID,
    DUNGEON_ARRIVAL,
    ENTRANA_LADDER_ID,
    ENTRANA_ZOMBIE_ID,
    LADDER_SURFACE,
    MIND_RUNE,
    SAFE_SPOT,
    SPELL,
    SPELL_LEVEL,
    SPIRIT_NAMES,
    TREE_NAMES,
    TREE_SPIRIT_ID,
    TREE_STAND,
    ZOMBIES,
    canCastWindStrike,
    chebyshev,
    chopOp,
    classifyArea,
    climbDownOp,
    decide,
    isDramenTreeName,
    isSpiritName,
    nextDescendAction,
    onSafeSpot,
    pickCaveMonkOption,
    runeShortage,
    type SpiritSnapshot
} from './EntranaDramenSpiritLogic.js';

const MAGIC_TAB = 6;
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

const SAFE_TILE = new Tile(SAFE_SPOT.x, SAFE_SPOT.z, SAFE_SPOT.level);
const TREE_TILE = new Tile(TREE_STAND.x, TREE_STAND.z, TREE_STAND.level);
const LADDER_TILE = new Tile(LADDER_SURFACE.x, LADDER_SURFACE.z, LADDER_SURFACE.level);
const ARRIVAL_TILE = new Tile(DUNGEON_ARRIVAL.x, DUNGEON_ARRIVAL.z, DUNGEON_ARRIVAL.level);
const ZOMBIE_TILE = new Tile(ZOMBIES.x, ZOMBIES.z, ZOMBIES.level);

export default class EntranaDramenSpirit extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private magicXpAtStart = 0;
    private casts = 0;
    private sawSpirit = false;
    private done = false;
    private runesProvisioned = false;
    private monkWarned = false;
    private bankAccess = BOOTH;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();
        Game.setAutoRetaliate(false);
        this.startedAt = Date.now();
        this.magicXpAtStart = Skills.xp('magic');
        this.casts = 0;
        this.sawSpirit = false;
        this.done = false;
        this.runesProvisioned = false;
        this.monkWarned = false;

        const area = classifyArea(Game.tile());
        if (area === 'dungeon' || area === 'entrana' || area === 'entranaShip') {
            this.runesProvisioned = true;
        }

        this.log(
            `EntranaDramenSpirit: Wind Strike from ${SAFE_SPOT.x},${SAFE_SPOT.z} ` +
                `(Magic ${Skills.level('magic')}, mind ${Inventory.count(MIND_RUNE)}, air ${Inventory.count(AIR_RUNE)})`
        );
        if (Skills.level('magic') < SPELL_LEVEL) {
            this.log(`WARNING: ${SPELL} needs Magic ${SPELL_LEVEL}`);
        }
    }

    override grindTargets(): string[] {
        return ['Zombie', 'Tree spirit', 'Dramen Tree Spirit'];
    }

    override recoveryAnchor(): Tile {
        return SAFE_TILE;
    }

    override onStop(): void {
        this.log(`stopped: casts ${this.casts}, spirit ${this.sawSpirit ? 'seen' : 'not seen'} (${this.status})`);
    }

    override async loop(): Promise<void> {
        if (!Game.sceneReady()) {
            return;
        }
        const action = decide(this.snapshot());
        switch (action.kind) {
            case 'wait':
                await Execution.delayTicks(1);
                return;
            case 'continue-dialog':
                this.status = 'continue dialog';
                await ChatDialog.continue();
                return;
            case 'pick-monk':
                await this.pickMonkOption();
                return;
            case 'stop':
                this.finish(action.reason);
                return;
            case 'bank-runes':
                await this.bankRunes();
                return;
            case 'enter-dungeon':
                await this.enterDungeon();
                return;
            case 'get-axe':
                await this.getBronzeAxe();
                return;
            case 'run-to-safespot':
                this.sawSpirit = true;
                await this.runToSafeSpot();
                return;
            case 'cast': {
                const spirit = this.findSpirit();
                if (!spirit) {
                    return;
                }
                this.sawSpirit = true;
                await this.windStrike(spirit);
                return;
            }
            case 'walk-to-tree':
                this.status = 'walking to Dramen tree';
                this.log(`walking to Dramen tree ${TREE_STAND.x},${TREE_STAND.z}`);
                await Traversal.walkResilient(TREE_TILE, { radius: 2, log: m => this.log(`  ${m}`) });
                return;
            case 'chop-tree':
                await this.chopTreeToSpawn();
                return;
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7eb8da' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const here = Game.tile();
        p.title(`EntranaDramenSpirit: ${this.status}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Magic: ${Skills.level('magic')}`, `Casts: ${this.casts}`);
        p.row(`Safe: ${SAFE_SPOT.x},${SAFE_SPOT.z}`, onSafeSpot(here) ? 'on spot' : `at ${here?.x ?? '?'},${here?.z ?? '?'}`);
        p.row(`Mind: ${Inventory.count(MIND_RUNE)}`, `Air: ${Inventory.count(AIR_RUNE)}`, `Axe: ${this.hasBronzeAxe() ? 'yes' : 'no'}`);
        p.row(`Spirit: ${this.sawSpirit ? 'seen' : 'not yet'}`, `XP/hr: ${this.xpPerHour()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private snapshot(): SpiritSnapshot {
        const here = Game.tile();
        const tree = this.findDramenTree();
        const treeDist = here ? (tree ? tree.tile().distanceTo(here) : chebyshev(here, TREE_STAND)) : 999;
        return {
            ingame: Game.ingame(),
            done: this.done,
            canContinue: ChatDialog.canContinue(),
            monkOptions: ChatDialog.options(),
            magicLevel: Skills.level('magic'),
            canCast: this.liveCanCast(),
            area: classifyArea(here),
            runesProvisioned: this.runesProvisioned,
            hasBronzeAxe: this.hasBronzeAxe(),
            spiritPresent: this.findSpirit() !== null,
            sawSpirit: this.sawSpirit,
            onSafeSpot: onSafeSpot(here),
            distanceToTree: treeDist
        };
    }

    private liveCanCast(): boolean {
        const wielded = Equipment.items().map(i => i.name ?? '');
        return canCastWindStrike(Skills.level('magic'), wielded, name => Inventory.count(name));
    }

    private hasBronzeAxe(): boolean {
        return Inventory.contains(BRONZE_AXE) || Equipment.contains(BRONZE_AXE);
    }

    private finish(reason: string): void {
        this.done = true;
        this.status = reason;
        this.log(reason);
        ScriptRunner.stop(reason);
    }

    private async pickMonkOption(): Promise<void> {
        const pick = pickCaveMonkOption(ChatDialog.options());
        if (!pick) {
            return;
        }
        this.status = 'cave monk';
        this.log(`Cave monk: ${pick}`);
        if (await ChatDialog.chooseOption(pick)) {
            this.monkWarned = true;
        }
    }

    private async bankRunes(): Promise<void> {
        this.status = 'banking runes';
        const here = Game.tile();
        if (!here) {
            return;
        }
        const bank = nearestBank(here);
        if (!bank) {
            this.finish('no reachable bank');
            return;
        }
        this.bankAccess = bank.access ?? BOOTH;
        const near = bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4;
        if (!near) {
            this.log(`walking to ${bank.name} for ${AIR_RUNE}s and ${MIND_RUNE}s`);
            if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) }))) {
                this.log('walk to the bank failed: retrying');
                return;
            }
        }
        if (!(await this.openBank())) {
            return;
        }
        await this.unequipWorn();
        if (Inventory.used() > 0) {
            await Bank.depositInventory();
            await Execution.delayTicks(1);
        }
        if (!Bank.loaded() && !(await Execution.delayUntil(() => Bank.loaded(), 3500))) {
            this.log('bank item list not loaded yet: retrying');
            return;
        }
        const air = Bank.count(AIR_RUNE);
        const mind = Bank.count(MIND_RUNE);
        const short = runeShortage(air, mind);
        if (short) {
            this.finish(short);
            return;
        }
        this.log(`bank has ${air} ${AIR_RUNE}s and ${mind} ${MIND_RUNE}s: withdrawing all`);
        if (!(await Bank.withdrawLoad(AIR_RUNE))) {
            this.log(`could not withdraw all ${AIR_RUNE}s: retrying`);
            return;
        }
        if (!(await Bank.withdrawLoad(MIND_RUNE))) {
            this.log(`could not withdraw all ${MIND_RUNE}s: retrying`);
            return;
        }
        if (!(await Bank.close())) {
            this.log('bank would not close: retrying');
            return;
        }
        this.runesProvisioned = true;
        this.log(`packed ${Inventory.count(AIR_RUNE)} ${AIR_RUNE}s and ${Inventory.count(MIND_RUNE)} ${MIND_RUNE}s`);
    }

    private async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        this.status = 'opening bank';
        this.log(`opening ${this.bankAccess.name} (${this.bankAccess.op})`);
        if (!(await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`)))) {
            this.log('could not open the bank: retrying');
            return false;
        }
        return true;
    }

    private async unequipWorn(): Promise<void> {
        for (const item of Equipment.items()) {
            const name = item.name;
            if (!name) {
                continue;
            }
            await Equipment.unequip(name);
        }
    }

    private async enterDungeon(): Promise<void> {
        if (dungeonNow()) {
            return;
        }
        this.status = 'entering Entrana dungeon';
        Game.setAutoRetaliate(false);

        const here = Game.tile();
        if (here && LADDER_TILE.distanceTo(here) > 2) {
            this.log(`walking to Entrana dungeon ladder ${LADDER_SURFACE.x},${LADDER_SURFACE.z}`);
            await Traversal.walkResilient(LADDER_TILE, { radius: 2, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) });
            if (dungeonNow()) {
                return;
            }
        }

        const step = nextDescendAction({
            underground: dungeonNow(),
            dialogOpen: ChatDialog.isOpen() || ChatDialog.canContinue() || ChatDialog.options().length > 0,
            warned: this.monkWarned
        });

        if (step === 'done') {
            return;
        }
        if (step === 'drive-dialog') {
            await this.driveMonkDialog();
            return;
        }
        if (step === 'open-dialog') {
            await this.openMonkDialog();
            return;
        }
        await this.climbDungeonLadder();
    }

    private async openMonkDialog(): Promise<void> {
        if (ChatDialog.isOpen() || ChatDialog.canContinue() || ChatDialog.options().length > 0) {
            await this.driveMonkDialog();
            return;
        }
        const monk = Npcs.query().name(CAVE_MONK).where(n => talkOp(n.actions()) !== null).nearest();
        if (monk) {
            this.log(`Talk-to ${CAVE_MONK}`);
            if (await talkThrough(CAVE_MONK, [CAVE_MONK_AGREE], m => this.log(`  ${m}`))) {
                this.monkWarned = true;
            }
            return;
        }
        this.log('no Cave monk in scene: Climb-down on the ladder to start the warning');
        await this.climbDungeonLadder();
    }

    private async driveMonkDialog(): Promise<void> {
        this.status = 'cave monk';
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            return;
        }
        const pick = pickCaveMonkOption(ChatDialog.options());
        if (pick) {
            this.log(`Cave monk: ${pick}`);
            if (await ChatDialog.chooseOption(pick)) {
                this.monkWarned = true;
            }
            return;
        }
        if (ChatDialog.options().length > 0) {
            this.log(`Cave monk options unmatched: [${ChatDialog.options().join(' | ')}]`);
            await Execution.delayTicks(1);
            return;
        }
        if (ChatDialog.isOpen()) {
            await ChatDialog.continue();
        }
    }

    private async climbDungeonLadder(): Promise<void> {
        const ladder = this.findDungeonLadder();
        if (!ladder) {
            this.log('no dungeon ladder in scene');
            await Execution.delayTicks(3);
            return;
        }
        const op = climbDownOp(ladder.actions());
        if (!op) {
            this.log(`ladder has no climb-down op: [${ladder.actions().join(', ')}]`);
            await Execution.delayTicks(3);
            return;
        }
        this.log(`${op} ${ladder.name ?? 'Ladder'}`);
        if (!(await ladder.interact(op))) {
            this.log(`could not ${op} the ladder: retrying`);
            return;
        }
        await Execution.delayUntil(
            () => dungeonNow() || ChatDialog.isOpen() || ChatDialog.canContinue() || ChatDialog.options().length > 0,
            8000
        );
        if (ChatDialog.isOpen() || ChatDialog.canContinue() || ChatDialog.options().length > 0) {
            return;
        }
        if (!dungeonNow()) {
            await Execution.delayUntil(() => {
                const tile = Game.tile();
                return dungeonNow() || (tile !== null && ARRIVAL_TILE.distanceTo(tile) <= 8);
            }, 8000);
        }
    }

    private findDungeonLadder(): Loc | null {
        const byId = Locs.query()
            .where(l => l.id === ENTRANA_LADDER_ID)
            .nearest();
        if (byId && climbDownOp(byId.actions())) {
            return byId;
        }
        return (
            Locs.query()
                .name('Ladder')
                .where(l => climbDownOp(l.actions()) !== null && l.tile().distanceTo(LADDER_TILE) <= 8)
                .nearest() ??
            Locs.query()
                .name('Ladder')
                .where(l => climbDownOp(l.actions()) !== null)
                .nearest()
        );
    }

    private async getBronzeAxe(): Promise<void> {
        this.status = 'getting Bronze axe';
        Game.setAutoRetaliate(true);
        if (await this.takeBronzeAxe()) {
            await this.wieldAxe();
            return;
        }
        if (Game.inCombat()) {
            await Execution.delayUntil(() => !Game.inCombat() || EventSignal.pending() || this.axeOnGround(), 60_000);
            await this.takeBronzeAxe();
            return;
        }
        const here = Game.tile();
        if (here && ZOMBIE_TILE.distanceTo(here) > 12) {
            this.log(`walking to Entrana Zombies ${ZOMBIES.x},${ZOMBIES.z}`);
            await Traversal.walkResilient(ZOMBIE_TILE, { radius: 7, attempts: 3, timeoutMs: 90_000, log: m => this.log(`  ${m}`) });
            return;
        }
        if (await this.takeBronzeAxe()) {
            await this.wieldAxe();
            return;
        }
        const zombie = Npcs.query()
            .where(n => (n.id === ENTRANA_ZOMBIE_ID || (n.name ?? '').toLowerCase() === 'zombie') && !n.inCombat && !n.targetsAnotherPlayer())
            .action('Attack')
            .within(15)
            .nearest();
        if (!zombie) {
            this.log('waiting for an available Zombie');
            await Execution.delayTicks(2);
            return;
        }
        this.log(`Attack ${zombie.name ?? 'Zombie'}`);
        if (!(await zombie.interact('Attack'))) {
            return;
        }
        await Execution.delayUntil(() => Game.inCombat() || !zombie.valid() || this.axeOnGround(), 5000);
    }

    private axeOnGround(): boolean {
        return GroundItems.query().name(BRONZE_AXE).within(20).nearest() !== null;
    }

    private async takeBronzeAxe(): Promise<boolean> {
        if (this.hasBronzeAxe()) {
            return true;
        }
        const drop = GroundItems.query().name(BRONZE_AXE).within(20).nearest();
        if (!drop) {
            return false;
        }
        if (Inventory.isFull()) {
            const junk = Inventory.items().find(item => {
                const n = (item.name ?? '').toLowerCase();
                return n !== AIR_RUNE.toLowerCase() && n !== MIND_RUNE.toLowerCase() && n !== BRONZE_AXE.toLowerCase() && item.actions().some(op => op.toLowerCase() === 'drop');
            });
            if (junk) {
                await junk.interact('Drop');
                await Execution.delayUntil(() => !Inventory.isFull(), 3000);
            }
        }
        this.log(`Take ${BRONZE_AXE}`);
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => this.hasBronzeAxe(), 8000);
    }

    private async wieldAxe(): Promise<void> {
        if (Equipment.contains(BRONZE_AXE) || !Inventory.contains(BRONZE_AXE)) {
            return;
        }
        this.status = `wielding ${BRONZE_AXE}`;
        if (!(await Equipment.equip(BRONZE_AXE))) {
            this.log(`could not wield ${BRONZE_AXE}: retrying`);
        }
    }

    private async chopTreeToSpawn(): Promise<void> {
        Game.setAutoRetaliate(false);
        if (Inventory.contains(BRONZE_AXE) && !Equipment.contains(BRONZE_AXE)) {
            await this.wieldAxe();
            return;
        }
        const tree = this.findDramenTree();
        if (!tree) {
            this.status = 'looking for Dramen tree';
            this.log('no Dramen tree in scene, walking to tree pin');
            await Traversal.walkResilient(TREE_TILE, { radius: 2, log: m => this.log(`  ${m}`) });
            return;
        }
        const op = chopOp(tree.actions());
        if (!op) {
            this.log(`Dramen tree has no chop op: [${tree.actions().join(', ')}]`);
            await Execution.delayTicks(3);
            return;
        }
        this.status = `chop ${tree.name ?? 'Dramen tree'}`;
        this.log(`${op} ${tree.name ?? 'Dramen tree'} to spawn the spirit`);
        await tree.interact(op);
        await Execution.delayUntil(() => this.findSpirit() !== null || ChatDialog.canContinue(), 8000);
        if (this.findSpirit()) {
            this.sawSpirit = true;
            this.log('Dramen Tree Spirit spawned, running to safe spot');
            await this.runToSafeSpot();
        }
    }

    private async runToSafeSpot(): Promise<boolean> {
        if (onSafeSpot(Game.tile())) {
            return true;
        }
        this.status = 'running to safe spot';
        this.log(`running to safe spot ${SAFE_SPOT.x},${SAFE_SPOT.z}`);
        Game.setAutoRetaliate(false);
        await Traversal.walkResilient(SAFE_TILE, {
            radius: 0,
            timeoutMs: 10_000,
            log: m => this.log(`  ${m}`)
        });
        if (!onSafeSpot(Game.tile())) {
            this.log(`not on ${SAFE_SPOT.x},${SAFE_SPOT.z} yet @ ${Game.tile()?.x},${Game.tile()?.z}`);
            await Execution.delayTicks(1);
            return false;
        }
        this.log(`on safe spot ${SAFE_SPOT.x},${SAFE_SPOT.z}`);
        return true;
    }

    private async windStrike(npc: Npc): Promise<void> {
        Game.setAutoRetaliate(false);
        if (!onSafeSpot(Game.tile())) {
            await this.runToSafeSpot();
            return;
        }
        if (Game.animating()) {
            this.status = 'casting';
            await Execution.delayTicks(1);
            return;
        }
        if (!(await Game.openSideTab(MAGIC_TAB))) {
            this.log('could not open the magic tab: retrying');
            return;
        }
        const name = npc.name || 'Tree spirit';
        const beforeXp = Skills.xp('magic');
        const beforeMind = Inventory.count(MIND_RUNE);
        this.status = `${SPELL} ${name}`;
        this.log(`${SPELL} ${name}`);
        let ok = false;
        try {
            ok = !!(await Game.castOnNpc(SPELL, npc));
        } catch {
            ok = false;
        }
        if (!ok) {
            this.log(`${SPELL} did not fire`);
            await Execution.delayTicks(2);
            return;
        }
        this.casts++;
        await Execution.delayUntil(
            () => Game.animating() || Skills.xp('magic') > beforeXp || Inventory.count(MIND_RUNE) < beforeMind || this.findSpirit() === null || !onSafeSpot(Game.tile()),
            4000
        );
        if (!onSafeSpot(Game.tile())) {
            await this.runToSafeSpot();
            return;
        }
        await Execution.delayUntil(() => !Game.animating() || this.findSpirit() === null || !onSafeSpot(Game.tile()), CAST_TICKS * 700);
        if (!onSafeSpot(Game.tile())) {
            await this.runToSafeSpot();
        }
    }

    private findSpirit(): Npc | null {
        return (
            Npcs.query()
                .where(n => n.id === TREE_SPIRIT_ID && !n.targetsAnotherPlayer())
                .within(18)
                .nearest() ??
            Npcs.query()
                .name(...SPIRIT_NAMES)
                .where(n => !n.targetsAnotherPlayer())
                .nearest() ??
            Npcs.query()
                .where(n => isSpiritName(n.name) && !n.targetsAnotherPlayer())
                .nearest()
        );
    }

    private findDramenTree(): Loc | null {
        return (
            Locs.query().where(l => l.id === DRAMEN_TREE_ID).nearest() ??
            Locs.query().name(...TREE_NAMES).nearest() ??
            Locs.query().where(l => isDramenTreeName(l.name)).nearest()
        );
    }

    private xpPerHour(): string {
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (mins < 0.5) {
            return '-';
        }
        const xp = Skills.xp('magic') - this.magicXpAtStart;
        return `${((xp / mins) * 60 / 1000).toFixed(1)}k`;
    }
}

function dungeonNow(): boolean {
    return classifyArea(Game.tile()) === 'dungeon';
}
