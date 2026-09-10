import { actions, reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Npcs, talkOp as npcTalkOp } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    BOOT_COST,
    BOOTS,
    COINS,
    DEATH_PLATEAU_QUEST,
    FALADOR_TELE_LEVEL,
    MILKMAN_PREFER,
    PACK_SIZE,
    SCRIPT_NAME,
    TENZING,
    canFinishTrip,
    carriedTeleRunes,
    pickShopOption,
    providedRunes,
    runeWithdraw,
    shopPrefer,
    stillBuying,
    tripComplete,
    tripGp,
    tripQty
} from './ClimbingBootsLogic.js';
import {
    drawSherpaPass,
    readPrefBool,
    setActivePaintBot,
    uninstallPaintClicks
} from './ClimbingBootsSherpaPaint.js';

const BANK_STAND = new Tile(2946, 3369, 0);
const TENZING_INSIDE = new Tile(2820, 3556, 0);
const TENZING_DOOR = new Tile(2823, 3555, 0);
const FALADOR_LANDING = new Tile(2965, 3378, 0);
const WALK = { radius: 2, attempts: 4, timeoutMs: 300_000 };

export const CLIMBING_BOOTS_SETTINGS: SettingsSchema = {
    useTeleport: {
        type: 'boolean',
        default: true,
        label: 'Falador teleport back to bank',
        help: 'carry Falador tele runes and cast after a full pack; off walks back to Falador West instead'
    },
    runeStock: {
        type: 'number',
        default: 50,
        min: 1,
        max: 1000,
        label: 'Falador teles of runes to carry',
        help: 'Law and Water x this, Air x 3x this. They stay in the pack; the last boot buy spends the coin stack into that slot',
        showIf: { key: 'useTeleport', anyOf: ['true'] }
    }
};

function hutDoorOp(loc: Loc): string | null {
    const acts = loc.actions();
    return acts.find(a => /^open/i.test(a)) ?? acts.find(a => /^knock/i.test(a)) ?? null;
}

function inTenzingHut(tile: { x: number; z: number; level: number } | null): boolean {
    return !!tile && tile.level === TENZING_INSIDE.level && TENZING_INSIDE.distanceTo(tile) <= 1;
}

export default class ClimbingBoots extends LoopingBot {
    override loopDelay = 600;

    useTeleport = true;
    runeStock = 50;
    status = 'starting';
    startedAt = Date.now();
    trips = 0;
    bought = 0;
    stopped = false;
    paintCollapsed = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.useTeleport = this.settings.bool('useTeleport', true);
        this.runeStock = this.settings.num('runeStock', 50);
        this.startedAt = Date.now();
        this.paintCollapsed = readPrefBool('paintCollapsed', false);
        setActivePaintBot(this);

        await Execution.delayUntil(() => Quests.status(DEATH_PLATEAU_QUEST) !== 'unknown', 5000);
        const quest = Quests.status(DEATH_PLATEAU_QUEST);
        if (quest !== 'complete') {
            this.log(`${SCRIPT_NAME} will not run because Death Plateau is not finished (status: ${quest})`);
            this.stopped = true;
            ScriptRunner.stop(`${SCRIPT_NAME}: Death Plateau is not finished`);
            return;
        }

        if (!this.useTeleport) {
            this.log(`${SCRIPT_NAME}: Falador West bank, walking back, ${BOOT_COST}gp a pair from Tenzing`);
        } else if (Skills.level('magic') < FALADOR_TELE_LEVEL) {
            this.log(
                `${SCRIPT_NAME}: Magic ${Skills.level('magic')} is below ${FALADOR_TELE_LEVEL}; bank trips will walk until you can Falador teleport`
            );
        } else {
            this.log(
                `${SCRIPT_NAME}: Falador West bank, ${this.runeStock} Falador teles of runes, ${BOOT_COST}gp a pair from Tenzing`
            );
        }
    }

    override onStop(): void {
        uninstallPaintClicks();
        setActivePaintBot(null);
    }

    override async loop(): Promise<void> {
        if (!Game.ingame() || Game.tile() === null || !Game.sceneReady()) {
            await Execution.delayTicks(2);
            return;
        }
        if (this.stopped) {
            await Execution.delayTicks(8);
            return;
        }

        this.useTeleport = this.settings.bool('useTeleport', true);
        this.runeStock = this.settings.num('runeStock', 50);

        const qty = this.planQty();
        if (tripComplete(Inventory.count(BOOTS), qty) || !this.readyToBuy(qty)) {
            if (tripComplete(Inventory.count(BOOTS), qty) && !(await this.returnToBank())) {
                return;
            }
            if (!(await this.bankLeg(qty))) {
                return;
            }
        }
        if (tripComplete(Inventory.count(BOOTS), qty) || !this.readyToBuy(qty)) {
            return;
        }
        await this.buyLeg(qty);
    }

    wornNames(): string[] {
        return Equipment.items().flatMap(item => (item.name ? [item.name] : []));
    }

    carried(): { rune: string; perCast: number }[] {
        return this.useTeleport ? carriedTeleRunes(providedRunes(this.wornNames())) : [];
    }

    planQty(): number {
        return tripQty(PACK_SIZE, this.carried().length);
    }

    runeStacksHeld(): number {
        return this.carried().filter(row => Inventory.count(row.rune) > 0).length;
    }

    readyToBuy(qty: number): boolean {
        return canFinishTrip(
            Inventory.count(COINS),
            Inventory.count(BOOTS),
            Inventory.used(),
            qty,
            this.runeStacksHeld()
        );
    }

    async walkTo(dest: Tile, radius: number, what: string): Promise<boolean> {
        const here = Game.tile();
        if (here && here.level === dest.level && dest.distanceTo(here) <= radius) {
            return true;
        }
        this.status = `walking to ${what}`;
        return Traversal.walkResilient(dest, { ...WALK, radius, log: m => this.log(`  ${m}`) });
    }

    async openHutDoor(): Promise<boolean> {
        const door = Locs.query()
            .name('Door')
            .where(l => l.distance() <= 6 && hutDoorOp(l) !== null)
            .nearest();
        if (!door) {
            return false;
        }
        const op = hutDoorOp(door);
        if (!op) {
            return false;
        }
        this.log(`${op} ${door.name} into Tenzing's hut`);
        await door.interact(op);
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 2500)) {
            await this.driveMilkman();
        }
        await Execution.delayTicks(2);
        return true;
    }

    async driveMilkman(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            const opts = ChatDialog.options();
            if (opts.length > 0) {
                const pick = pickShopOption(opts, MILKMAN_PREFER) ?? opts[opts.length - 1];
                await ChatDialog.chooseOption(pick);
                await Execution.delayTicks(2);
                continue;
            }
            if (!ChatDialog.isOpen()) {
                return;
            }
            await Execution.delayTicks(1);
        }
    }

    async bankLeg(qty: number): Promise<boolean> {
        const gp = tripGp(qty);
        const here = Game.tile();
        if (!here || BANK_STAND.distanceTo(here) > 8) {
            if (!(await this.walkTo(BANK_STAND, 3, 'Falador West bank'))) {
                return false;
            }
        }
        this.status = 'banking';
        if (!(await Banking.open({ stand: BANK_STAND, log: m => this.log(`  ${m}`) }))) {
            this.log('could not open the bank, retrying');
            return false;
        }

        const keep = new Set(this.carried().map(row => row.rune.toLowerCase()));
        await Bank.depositAllMatching(name => !keep.has(name.toLowerCase()));

        for (const row of this.carried()) {
            const need = runeWithdraw(row.perCast, this.runeStock, Inventory.count(row.rune));
            if (need <= 0) {
                continue;
            }
            const take = Math.min(need, Bank.count(row.rune));
            if (take <= 0) {
                if (Inventory.count(row.rune) < row.perCast) {
                    this.log(`${SCRIPT_NAME}: bank has no ${row.rune} for Falador teleport`);
                    this.stopped = true;
                    ScriptRunner.stop(`${SCRIPT_NAME}: bank has no ${row.rune} for Falador teleport`);
                    return false;
                }
                continue;
            }
            if (!(await Bank.withdrawX(row.rune, take))) {
                this.log(`could not withdraw ${take} ${row.rune}, retrying`);
                return false;
            }
        }

        const have = Inventory.count(COINS);
        if (have !== gp) {
            if (have > 0) {
                await Bank.depositAllMatching(name => name.toLowerCase() === COINS.toLowerCase());
            }
            if (Bank.count(COINS) < gp) {
                this.log(`${SCRIPT_NAME}: need ${gp}gp for ${qty} pairs at ${BOOT_COST}gp, bank has ${Bank.count(COINS)}`);
                this.stopped = true;
                ScriptRunner.stop(`${SCRIPT_NAME}: need ${gp}gp, bank has ${Bank.count(COINS)}`);
                return false;
            }
            if (!(await Bank.withdrawX(COINS, gp))) {
                this.log(`could not withdraw ${gp}gp, retrying`);
                return false;
            }
        }

        await Bank.close();
        const runes = this.carried().map(row => row.rune).join(', ');
        this.log(runes ? `trip kit: ${gp}gp + ${runes} -> ${qty} ${BOOTS}` : `trip kit: ${gp}gp -> ${qty} ${BOOTS}`);
        return this.readyToBuy(qty);
    }

    async buyLeg(qty: number): Promise<boolean> {
        const before = Inventory.count(BOOTS);
        if (!(await this.reachTenzing())) {
            return false;
        }
        this.status = `buying ${qty} ${BOOTS}`;
        if (!(await this.driveShop(qty))) {
            return false;
        }
        const got = Inventory.count(BOOTS) - before;
        if (got > 0) {
            this.bought += got;
            this.log(`bought ${got} ${BOOTS} (${Inventory.count(BOOTS)}/${qty} this trip)`);
        }
        if (tripComplete(Inventory.count(BOOTS), qty)) {
            this.trips++;
        }
        return got > 0 || tripComplete(Inventory.count(BOOTS), qty);
    }

    async returnToBank(): Promise<boolean> {
        if (this.useTeleport && (await this.faladorTeleport())) {
            return true;
        }
        if (this.useTeleport) {
            this.log('Falador teleport did not fire, walking back to the bank');
        }
        return this.walkTo(BANK_STAND, 3, 'Falador West bank');
    }

    async faladorTeleport(): Promise<boolean> {
        if (!this.useTeleport || Skills.level('magic') < FALADOR_TELE_LEVEL) {
            return false;
        }
        for (const row of this.carried()) {
            if (Inventory.count(row.rune) < row.perCast) {
                return false;
            }
        }
        const here = Game.tile();
        if (here && FALADOR_LANDING.distanceTo(here) <= 20) {
            return true;
        }
        this.status = 'Falador teleport';
        if (!(await Game.teleport('Falador'))) {
            return false;
        }
        return Execution.delayUntil(() => {
            const tile = Game.tile();
            return tile !== null && FALADOR_LANDING.distanceTo(tile) <= 20;
        }, 8000);
    }

    async reachTenzing(): Promise<boolean> {
        if (inTenzingHut(Game.tile()) && Npcs.query().name(TENZING).within(3).nearest()) {
            return true;
        }
        this.status = "walking into Tenzing's hut";
        if (await this.walkTo(TENZING_INSIDE, 1, 'Tenzing')) {
            return inTenzingHut(Game.tile());
        }
        this.log('path into the hut failed, opening the front door');
        if (!(await this.walkTo(TENZING_DOOR, 2, "Tenzing's door"))) {
            return false;
        }
        await this.openHutDoor();
        return this.walkTo(TENZING_INSIDE, 1, 'Tenzing');
    }

    async talkToTenzing(): Promise<boolean> {
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            return true;
        }
        if (!inTenzingHut(Game.tile())) {
            this.log('Tenzing is inside the hut, walking in before talking');
            if (!(await this.reachTenzing())) {
                return false;
            }
        }
        const npc = Npcs.query().name(TENZING).nearest();
        if (!npc) {
            this.log(`no ${TENZING} nearby to talk to`);
            return false;
        }
        if (npc.distance() > 2) {
            this.log(`${TENZING} is ${npc.distance()}t away, stepping closer`);
            if (!(await this.walkTo(TENZING_INSIDE, 1, 'Tenzing'))) {
                return false;
            }
        }
        await npc.interact(npcTalkOp(npc.actions()) ?? 'Talk-to');
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000)) {
            return true;
        }
        this.log('talk did not open, opening the hut door and retrying');
        await this.openHutDoor();
        if (!(await this.walkTo(TENZING_INSIDE, 1, 'Tenzing'))) {
            return false;
        }
        const retry = Npcs.query().name(TENZING).nearest();
        if (!retry) {
            return false;
        }
        await retry.interact(npcTalkOp(retry.actions()) ?? 'Talk-to');
        return Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000);
    }

    async driveShop(qty: number): Promise<boolean> {
        const buying = (): boolean =>
            stillBuying(Inventory.count(COINS), Inventory.count(BOOTS), qty, Inventory.used(), PACK_SIZE);
        if (!buying() && tripComplete(Inventory.count(BOOTS), qty)) {
            return true;
        }
        if (!(await this.talkToTenzing())) {
            this.log(`could not talk to ${TENZING}, retrying`);
            return false;
        }

        for (let i = 0; i < 240; i++) {
            const wantBuy = buying();
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
                continue;
            }
            const opts = ChatDialog.options();
            if (opts.length > 0) {
                const pick = pickShopOption(opts, shopPrefer(wantBuy));
                if (!pick) {
                    this.log(`${TENZING} is not selling ${BOOTS}, Death Plateau must be complete`);
                    this.stopped = true;
                    ScriptRunner.stop(`${SCRIPT_NAME}: ${TENZING} did not offer Climbing boots`);
                    return false;
                }
                await ChatDialog.chooseOption(pick);
                await Execution.delayTicks(2);
                continue;
            }
            if (await this.clearBox()) {
                continue;
            }
            if (!ChatDialog.isOpen()) {
                if (tripComplete(Inventory.count(BOOTS), qty)) {
                    return true;
                }
                if (wantBuy) {
                    if (!(await this.talkToTenzing())) {
                        return false;
                    }
                    continue;
                }
                return tripComplete(Inventory.count(BOOTS), qty);
            }
            await Execution.delayTicks(1);
        }
        return tripComplete(Inventory.count(BOOTS), qty);
    }

    async clearBox(): Promise<boolean> {
        if (typeof reader.modals !== 'function' || reader.modals().main === -1) {
            return false;
        }
        const cont =
            typeof reader.mainModalButtonNearText === 'function'
                ? reader.mainModalButtonNearText('Click here to continue')
                : -1;
        if (cont > 0 && typeof actions.ifButton === 'function') {
            actions.ifButton(cont);
        } else if (typeof actions.closeModal === 'function') {
            actions.closeModal();
        }
        await Execution.delayTicks(1);
        return true;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        drawSherpaPass(ctx, this);

        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#d2b07a' });
        p.title(`${SCRIPT_NAME}, ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const qty = this.planQty();
        p.row(`Runtime: ${fmtDuration(mins)}`, `Trips: ${this.trips}`, `Bought: ${this.bought}`);
        p.row(`Pack: ${Inventory.count(BOOTS)}/${qty}`, `Coins: ${Inventory.count(COINS)}`, `Tele: ${this.useTeleport ? 'on' : 'off'}`);
        p.bar('Pack', qty > 0 ? Math.min(1, Inventory.count(BOOTS) / qty) : 0, '#d2b07a');
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
