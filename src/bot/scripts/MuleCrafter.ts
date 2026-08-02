import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { Trade } from '../api/hud/Trade.js';
import { reader } from '../adapter/ClientAdapter.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Players } from '../api/queries/Players.js';
import type { Player } from '../api/entities/index.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { 
    RUNES, 
    RUNE_OPTIONS, 
    DEFAULT_RUNE, 
    essencePerTrade, 
    isConfiguredPartner, 
    classifyMuleState, 
    bankTile, 
    type RuneRoute, 
} from './MuleCrafterLogic.js';

/*
 * MuleCrafter Flow:
 * 
 * CRAFTER:
 * 1. Start at bank and ensure talisman and unnoted essence
 * 2. Get Essence (withdraw from bank if bankFill)
 * 3. Walk to ruins
 * 4. Enter ruins (use talisman on ruins to enter altar)
 * 5. Craft runes
 * 6. Exit altar (take portal back to ruins)
 * 7. If mules untraded, trade a mule: give all runes, receive 27 essence
 * 8. Go to 4 (enter altar again)
 * 9. After ALL mules traded, walk back to bank
 * 10. Go to 1
 * 
 * MULE:
 * 1. Start at bank and ensure 27 unnoted essence
 * 2. Get essence (withdraw from bank)
 * 3. Walk to ruins
 * 4. Trade with crafter: give 27 essence, receive runes
 * 5. Walk to bank
 * 6. Go to 1
 */

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TEMPLE_Z = 4000;

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: DEFAULT_RUNE, options: RUNE_OPTIONS, label: 'Rune', help: 'which rune the pair crafts. Air = Falador East bank; Mind = Edgeville bank.' },
    mode: { type: 'string', default: 'Crafter', options: ['Crafter', 'Mule'], label: 'Mode', help: 'Crafter has the talisman, crafts at the altar, trades runes at ruins. Mule carries essence to the ruins and runes back to the bank.' },
    partner: { type: 'string', default: '', label: 'Partner name(s) (Optional for Crafter)', help: 'Crafter: optional mule name(s) to trade with, comma-separated (blank = solo mode). Mule: required crafter to trade with.' },
    bankFill: { type: 'boolean', default: true, label: 'Fill essence at bank', help: 'When enabled, crafter withdraws essence from bank. When disabled, mules bring all essence (blank rune mode). Only applies to Crafter mode.' }
};

function inTemple(): boolean {
    const t = Game.tile();
    return t !== null && t.z > TEMPLE_Z;
}

function essCount(): number {
    return reader
        .inventory()
        .filter(i => i.id === ESSENCE_ID)
        .reduce((sum, i) => sum + i.count, 0);
}

function isAtTile(tile: Tile, radius = 3): boolean {
    const t = Game.tile();
    return t !== null && tile.distanceTo(t) <= radius;
}

export default class MuleCrafter extends TaskBot {
    override loopDelay = 600;

    private mode = 'Crafter';
    private rune = DEFAULT_RUNE;
    private conf: RuneRoute = RUNES[DEFAULT_RUNE];
    private bankTile: Tile = new Tile(3013, 3355, 0);
    private partners: string[] = [];
    private bankFill = true;
    private crafted = 0;
    private trades = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private tradedMules = new Set<string>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.mode = this.settings.str('mode', 'Crafter');
        this.rune = this.settings.str('rune', DEFAULT_RUNE);
        this.conf = RUNES[this.rune] ?? RUNES[DEFAULT_RUNE];
        this.bankTile = bankTile(this.conf.bank);
        this.partners = this.settings.str('partner', '').split(',').map(s => s.trim()).filter(Boolean);
        this.bankFill = this.settings.bool('bankFill', true);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');
        this.tradedMules = new Set<string>();

        if (this.mode === 'Mule') {
            if (this.partners.length === 0) {
                this.log('MuleCrafter: no partner names set for Mule mode. The mule needs the crafter name. Stopping.');
                throw new Error('MuleCrafter: no partner configured for mule mode');
            }
            this.log(`MuleCrafter mule starting — ferrying essence for ${this.rune} to [${this.partners.join(', ')}]`);
            await this.cleanMuleInventory();
            this.add(
                new ContinueDialog(),
                new MuleWalkToRuins(this),
                new MuleTradeWithCrafter(this),
                new MuleTradeExecute(this),
                new MuleGoBank(this)
            );
            return;
        }

        // --- Crafter Mode ---
        if (this.partners.length === 0) {
            this.bankFill = true; // Ensure crafter fills essence at bank when running solo
            this.log('MuleCrafter: No partners configured. Running in Solo Crafter mode.');
        } else {
            this.log(`MuleCrafter crafter starting — ${this.rune}, accepting essence from [${this.partners.join(', ')}]${this.bankFill ? ', banking for essence' : ', mules bring all essence'}`);
        }

        await this.cleanCrafterInventory();

        this.add(
            new ContinueDialog(),
            new CrafterAtBank(this),
            new CrafterWalkToRuins(this),
            new EnterAltar(this),
            new CraftRunes(this),
            new ExitAltar(this),
            new CrafterRequestTrade(this),
            new CrafterWaitAtRuins(this),
            new CrafterTradeAtRuins(this),
            new CrafterGoBank(this)
        );
    }

    private async cleanCrafterInventory(): Promise<void> {
        const hasExtraItems = Inventory.items().some(i => i.name && i.id !== ESSENCE_ID && i.name.toLowerCase() !== this.conf.talisman.toLowerCase());
        const hasTalisman = Inventory.contains(this.conf.talisman);

        if (hasExtraItems || !hasTalisman) {
            this.log('Crafter inventory contains unauthorized items or missing talisman. Opening bank to clean inventory...');
            await this.walkTo(this.bankTile, 3);
            const opened = await Bank.openBooth(this.bankTile, BOOTH.name, BOOTH.op, m => this.log(`  ${m}`))
                || await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.log(`  ${m}`));
            if (!opened) {
                throw new Error('MuleCrafter: Failed to open bank for initial inventory cleanup.');
            }

            const talismanId = Bank.items().find(i => i.name?.toLowerCase() === this.conf.talisman.toLowerCase())?.id ?? -1;
            const runeId = Inventory.items().find(i => i.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
                ?? Bank.items().find(i => i.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
                ?? -1;
            const crafterKeep = new Set([talismanId, ESSENCE_ID, runeId].filter(id => id !== -1));
            await Bank.depositAllMatching((name: string, id: number) => name.length > 0 && !crafterKeep.has(id), m => this.log(`  ${m}`));
            await Execution.delayTicks(1);

            if (!Inventory.contains(this.conf.talisman)) {
                const tal = Bank.items().find(i => i.name?.toLowerCase() === this.conf.talisman.toLowerCase());
                if (tal && tal.name) {
                    await Bank.withdraw(this.conf.talisman, 'Withdraw-1');
                    await Execution.delayUntil(() => Inventory.contains(this.conf.talisman), 3000);
                    this.log(`withdrew ${this.conf.talisman} from bank`);
                } else {
                    this.log(`MuleCrafter: no ${this.conf.talisman} in inventory or bank. Stopping.`);
                    throw new Error(`MuleCrafter: ${this.conf.talisman} not found`);
                }
            }
        }
    }

    private async cleanMuleInventory(): Promise<void> {
        const hasExtraItems = Inventory.items().some(i => i.name && i.id !== ESSENCE_ID);

        if (hasExtraItems) {
            this.log('Mule inventory contains unauthorized items. Opening bank to clean inventory...');
            await this.walkTo(this.bankTile, 3);
            const opened = await Bank.openBooth(this.bankTile, BOOTH.name, BOOTH.op, m => this.log(`  ${m}`))
                || await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.log(`  ${m}`));
            if (!opened) {
                throw new Error('MuleCrafter: Failed to open bank for initial inventory cleanup.');
            }

            const runeId = Inventory.items().find(i => i.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
                ?? Bank.items().find(i => i.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
                ?? -1;
            const muleKeep = new Set([ESSENCE_ID, runeId].filter(id => id !== -1));
            await Bank.depositAllMatching((name: string, id: number) => name.length > 0 && !muleKeep.has(id), m => this.log(`  ${m}`));
            await Execution.delayTicks(1);
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        const partnerInfo = this.partners.length > 0 ? `Partners: ${this.partners.length}` : 'Solo Mode';
        p.title(`MuleCrafter — ${this.rune} — ${this.mode} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Skills.xp('runecraft') - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, this.mode === 'Crafter' ? `RC lvl: ${Skills.level('runecraft')}` : `To: ${this.partners[0] ?? '?'}`);
        if (this.mode === 'Crafter') {
            p.row(`Crafted: ${this.crafted}`, `Trades: ${this.trades}`);
            p.row(`RC xp: ${xpGained}`, `XP/h: ${xph}`, partnerInfo);
            p.row(`Pack ess: ${essCount()}`, `Pack runes: ${Inventory.count(this.conf.rune)}`, '');
        } else {
            p.row(`Trades: ${this.trades}`, `Ess carried: ${this.crafted}`, '');
            p.row(`Pack ess: ${essCount()}`, `Pack runes: ${Inventory.count(this.conf.rune)}`, '');
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    cfg(): RuneRoute { return this.conf; }
    getMode(): string { return this.mode; }
    getBankTile(): Tile {return this.bankTile;}
    fillBank(): boolean { return this.bankFill; }
    setStatus(s: string): void { this.status = s; }
    countCraft(n: number): void { this.crafted += n; }
    countTrade(): void { this.trades++; }
    hasPartners(): boolean { return this.partners.length > 0; }
    isPartner(name: string | null): boolean {
        return isConfiguredPartner(name, this.partners);
    }
    partnerNames(): string[] { return this.partners; }
    nearestPartner(): Player | null {
        if (!this.hasPartners()) return null;
        return Players.query().name(...this.partners).nearest();
    }
    markMuleTraded(name: string): void { this.tradedMules.add(name.toLowerCase()); }
    hasAllMulesTraded(): boolean { return this.partners.every(p => this.tradedMules.has(p.toLowerCase())); }
    resetTradedMules(): void { this.tradedMules.clear(); }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        if (!Game.ingame()) {
            this.log('walkTo: not ingame, waiting...');
            await Execution.delayUntil(() => Game.ingame(), 30_000);
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

// ── Crafter: at bank - ensure talisman + essence ────────────────────────────────
class CrafterAtBank implements Task {
    private emptyReads = 0;
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && !inTemple() && !Trade.active()
            && isAtTile(this.bot.getBankTile(), 6)
            && (!Inventory.contains(this.bot.cfg().talisman) || essCount() === 0);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('at bank - preparing');

        const opened = (await Bank.openBooth(this.bot.getBankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        if (!Inventory.contains(this.bot.cfg().talisman)) {
            const tal = Bank.items().find(i => i.name?.toLowerCase() === this.bot.cfg().talisman.toLowerCase());
            if (tal && tal.name) {
                await Bank.withdraw(this.bot.cfg().talisman, 'Withdraw-1');
                await Execution.delayUntil(() => Inventory.contains(this.bot.cfg().talisman), 3000);
                this.bot.log(`withdrew ${this.bot.cfg().talisman}`);
            }
        }

        const hasEss = essCount() > 0;
        if (!hasEss) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const banked = Bank.count(ESSENCE);
            if (banked === 0) {
                if (++this.emptyReads >= 3) {
                    this.bot.log('MuleCrafter: no essence left in the bank (three reads). Stopping.');
                    ScriptRunner.stop();
                }
                return;
            }
            this.emptyReads = 0;
            const maxTake = Math.min(Inventory.free(), essencePerTrade(28, true), banked);
            await Bank.withdrawX(ESSENCE, maxTake);
            await Execution.delayUntil(() => essCount() > 0, 4000);
            this.bot.log(`withdrew ${essCount()} essence from the bank`);
        }
    }
}

// ── Crafter: walk to ruins ─────────────────────────────────────────────────────
class CrafterWalkToRuins implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && !inTemple() && !Trade.active() && !isAtTile(this.bot.cfg().ruins, 3);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the ruins');
        await this.bot.walkTo(this.bot.cfg().ruins, 2);
    }
}

// ── Crafter: enter altar ───────────────────────────────────────────────────────
class EnterAltar implements Task {
    private fails = 0;
    constructor(private bot: MuleCrafter) {}
    validate(): boolean { return this.bot.getMode() === 'Crafter' && !inTemple() && essCount() > 0 && !Trade.active(); }
    async execute(): Promise<void> {
        this.bot.setStatus('entering the altar');
        await this.bot.walkTo(this.bot.cfg().ruins, 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(this.bot.cfg().talisman);
        if (!ruins || !talisman) { await Execution.delayTicks(2); return; }
        this.bot.log(`using the ${this.bot.cfg().talisman} on the mysterious ruins`);
        if (!(await talisman.useOn(ruins))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => inTemple(), 10_000)) {
            this.bot.log('entered the altar');
            this.fails = 0;
            return;
        }
        if (++this.fails >= 3) {
            this.bot.log('MuleCrafter: the talisman didn\'t teleport into the altar. Stopping.');
            ScriptRunner.stop();
        }
    }
}

// ── Crafter: craft runes ────────────────────────────────────────────────────────
class CraftRunes implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean { return this.bot.getMode() === 'Crafter' && inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        const altar = Locs.query().name(ALTAR.name).action(ALTAR.op).nearest();
        if (!altar) { this.bot.log('CraftRunes: no altar found'); await Execution.delayTicks(2); return; }
        this.bot.setStatus('crafting runes');
        const before = essCount();
        this.bot.log(`crafting ${before} essence at the altar`);
        if (!(await altar.interact(ALTAR.op))) { this.bot.log('CraftRunes: altar interact failed'); await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => essCount() === 0, 8000);
        const made = before - essCount();
        this.bot.countCraft(made);
        this.bot.log(`crafted ${made} ${this.bot.cfg().rune}s - exiting temple`);
    }
}

// ── Crafter: exit altar (take portal back to ruins) ──────────────────────────────
class ExitAltar implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean { return this.bot.getMode() === 'Crafter' && inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('taking the portal out');
        this.bot.log('taking the portal back to the ruins');
        for (let i = 0; i < 15 && inTemple(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); continue; }
            const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
            if (portal) { await portal.interact(PORTAL.op); }
            await Execution.delayTicks(1);
        }
        if (!inTemple()) { this.bot.log('back at the mysterious ruins'); }
    }
}

// ── Crafter: wait at ruins for mule to arrive and trade ─────────────────────────────
class CrafterWaitAtRuins implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && !inTemple() && !Trade.active() 
            && isAtTile(this.bot.cfg().ruins, 4)
            && Inventory.count(this.bot.cfg().rune) > 0
            && !this.bot.hasAllMulesTraded();
    }
    async execute(): Promise<void> {
        const remaining = this.bot.partnerNames().filter(p => !this.bot['tradedMules'].has(p));
        this.bot.setStatus(`waiting for mules: ${remaining.join(', ')}`);
        this.bot.log(`CrafterWaitAtRuins: waiting for ${remaining.join(', ')} — runes=${Inventory.count(this.bot.cfg().rune)}, traded=${Array.from(this.bot['tradedMules']).join(',')}`);
        await Execution.delayTicks(2);
    }
}

// ── Crafter: request trade with next mule at ruins ──────────────────────────────────
class CrafterRequestTrade implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && !inTemple() && !Trade.active() 
            && isAtTile(this.bot.cfg().ruins, 4)
            && Inventory.count(this.bot.cfg().rune) > 0
            && !this.bot.hasAllMulesTraded();
    }
    async execute(): Promise<void> {
        const remaining = this.bot.partnerNames().filter(p => !this.bot['tradedMules'].has(p));
        if (remaining.length === 0) return;
        
        const muleName = remaining[0];
        const mule = Players.query().name(muleName).nearest();
        if (!mule || !mule.name) {
            this.bot.setStatus(`waiting for ${muleName} at ruins`);
            await Execution.delayTicks(2);
            return;
        }
        
        this.bot.setStatus(`requesting trade with ${muleName}`);
        const requested = await Trade.request(muleName);
        this.bot.log(`CrafterRequestTrade: Trade.request(${muleName}) returned ${requested}`);
        if (await Execution.delayUntil(() => Trade.active(), 4000)) {
            this.bot.log(`CrafterRequestTrade: trade became active with ${muleName}`);
        } else {
            this.bot.log('CrafterRequestTrade: trade did not become active within 4s');
        }
    }
}

// ── Crafter: trade with ONE mule at ruins ───────────────────────────────────────
class CrafterTradeAtRuins implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && Trade.active() && this.bot.hasPartners();
    }
    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            const beforeEss = essCount();
            const accepted = await Trade.accept();
            this.bot.log(`CrafterTradeAtRuins: confirm-screen accept returned ${accepted}`);
            if (await Execution.delayUntil(() => !Trade.active(), 3000)) {
                const got = essCount() - beforeEss;
                this.bot.log(`CrafterTradeAtRuins: trade closed, essCount went ${beforeEss} -> ${essCount()} (delta ${got})`);
                if (got > 0) {
                    this.bot.countTrade();
                    this.bot.log(`received ${got} essence`);
                    const who = Trade.partner();
                    if (who) {
                        this.bot.markMuleTraded(who);
                        this.bot.log(`marked ${who} as traded (confirm complete)`);
                    }
                } else {
                    this.bot.log('CrafterTradeAtRuins: trade closed but got 0 essence — trade may have failed');
                }
            } else {
                this.bot.log('CrafterTradeAtRuins: trade still active after 3s wait on confirm');
            }
            return;
        }

        if (!Trade.onOfferScreen()) {
            this.bot.setStatus('waiting for trade screen');
            await Execution.delayTicks(1);
            return;
        }

        const who = Trade.partner();
        if (who === null) {
            this.bot.setStatus('reading trade partner');
            await Execution.delayTicks(1);
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            this.bot.log(`declining a trade from '${who}' — not a configured mule`);
            await Trade.decline();
            return;
        }

        const state = classifyMuleState(Trade.theirOffer());
        this.bot.log(`CrafterTradeAtRuins: offer screen with ${who}, their offer state=${state}, my runes=${Inventory.count(this.bot.cfg().rune)}, my ess=${essCount()}`);

        if (state === 'has-essence') {
            const talismanName = this.bot.cfg().talisman;
            const toOffer = Inventory.items()
                .filter(i => i.name && i.name.toLowerCase() !== talismanName.toLowerCase());
            const uniqueNames = [...new Set(toOffer.map(i => i.name!))];
            if (uniqueNames.length > 0) {
                this.bot.setStatus(`offering ${uniqueNames.length} item type(s) to ${who}`);
                for (const name of uniqueNames) {
                    const ok = await Trade.offerAll(name);
                    this.bot.log(`CrafterTradeAtRuins: offered ${name} returned ${ok}`);
                    await Execution.delayTicks(1);
                }
            } else {
                this.bot.setStatus(`accepting essence from ${who} (nothing to offer)`);
            }
            const accepted = await Trade.accept();
            this.bot.log(`CrafterTradeAtRuins: offer-screen accept returned ${accepted}`);
            return;
        }

        this.bot.setStatus(`waiting for ${who}'s offer`);
        this.bot.log(`CrafterTradeAtRuins: waiting for ${who} to offer essence (their offer: ${JSON.stringify(Trade.theirOffer())})`);
        await Execution.delayTicks(1);
    }
}

// ── Crafter: go to the bank ─────────────────────────────────────────────────────
class CrafterGoBank implements Task {
    private emptyReads = 0;
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Crafter' && !inTemple() && !Trade.active()
            && (
                isAtTile(this.bot.getBankTile(), 6)
                || (Inventory.count(this.bot.cfg().rune) > 0 && !isAtTile(this.bot.cfg().ruins, 4) && this.bot.hasPartners())
                || (essCount() === 0 && !this.bot.hasPartners()) // Solo mode: bank when out of essence
                || (this.bot.hasPartners() && this.bot.hasAllMulesTraded() && isAtTile(this.bot.cfg().ruins, 4))
            );
    }



    async execute(): Promise<void> {
        if(!this.bot.fillBank()){
            this.bot.resetTradedMules();
            this.bot.setStatus('resetting traded mules (bankFill=false)');
            return;
        }

        if (!isAtTile(this.bot.getBankTile(), 6)) {
            this.bot.setStatus('walking to the bank');
            await this.bot.walkTo(this.bot.getBankTile(), 3);
        }
        this.bot.setStatus('banking');

        const opened = (await Bank.openBooth(this.bot.getBankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        const runesHeld = Inventory.count(this.bot.cfg().rune);
        await Bank.depositAllMatching((name: string) => name === this.bot.cfg().rune, m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        if (runesHeld > 0) {
            this.bot.log(`deposited ${runesHeld} ${this.bot.cfg().rune}s`);
        }

        const crafterKeepIds = (() => {
            const tid = Bank.items().find(i => i.name?.toLowerCase() === this.bot.cfg().talisman.toLowerCase())?.id ?? -1;
            return new Set([tid, ESSENCE_ID].filter(id => id !== -1));
        })();
        const beforeClean = Inventory.used();
        await Bank.depositAllMatching(
            (name: string, id: number) => name.length > 0 && !crafterKeepIds.has(id),
            m => this.bot.log(`  ${m}`)
        );
        if (Inventory.used() < beforeClean) {
            this.bot.log(`cleared ${beforeClean - Inventory.used()} slot(s)`);
        }

        if (!Inventory.contains(this.bot.cfg().talisman)) {
            const tal = Bank.items().find(i => i.name?.toLowerCase() === this.bot.cfg().talisman.toLowerCase());
            if (tal && tal.name) {
                await Bank.withdraw(this.bot.cfg().talisman, 'Withdraw-1');
                await Execution.delayUntil(() => Inventory.contains(this.bot.cfg().talisman), 3000);
            }
        }

        if (this.bot.fillBank() && essCount() === 0) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const banked = Bank.count(ESSENCE);
            if (banked === 0) {
                if (essCount() === 0 && ++this.emptyReads >= 3) {
                    this.bot.log('MuleCrafter: no essence left in the bank (three reads). Stopping.');
                    ScriptRunner.stop();
                }
                return;
            }
            this.emptyReads = 0;
            const maxTake = Math.min(Inventory.free(), essencePerTrade(28, true), banked);
            await Bank.withdrawX(ESSENCE, maxTake);
            await Execution.delayUntil(() => essCount() > 0, 4000);
            this.bot.log(`withdrew ${essCount()} essence from the bank`);
        }

        this.bot.resetTradedMules();
    }
}

// ── Mule: go to the bank ────────────────────────────────────────────────────────
class MuleGoBank implements Task {
    private emptyReads = 0;
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Mule' && !Trade.active()
            && (Inventory.count(this.bot.cfg().rune) > 0
                || (essCount() === 0 && !isAtTile(this.bot.cfg().ruins, 5))
                || (isAtTile(this.bot.getBankTile(), 6) && (Inventory.count(this.bot.cfg().rune) > 0 || essCount() === 0)));
    }
    async execute(): Promise<void> {
        if (!isAtTile(this.bot.getBankTile(), 6)) {
            this.bot.setStatus('walking to the bank');
            await this.bot.walkTo(this.bot.getBankTile(), 3);
        }
        this.bot.setStatus('banking');

        const opened = (await Bank.openBooth(this.bot.getBankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        const runesHeld = Inventory.count(this.bot.cfg().rune);
        if (runesHeld > 0) {
            await Bank.deposit(this.bot.cfg().rune, 'Deposit-All');
            await Execution.delayTicks(1);
            this.bot.log(`deposited ${runesHeld} ${this.bot.cfg().rune}s`);
            this.bot.countTrade();
        }

        const muleKeep = new Set([ESSENCE_ID]);
        const before = Inventory.used();
        await Bank.depositAllMatching((name: string, id: number) => name.length > 0 && !muleKeep.has(id), m => this.bot.log(`  ${m}`));
        if (Inventory.used() < before) {
            this.bot.log(`cleared ${before - Inventory.used()} slot(s)`);
        }

        await Execution.delayUntil(() => Bank.loaded(), 3000);
        const banked = Bank.count(ESSENCE);
        if (banked === 0 && essCount() === 0) {
            if (++this.emptyReads >= 3) {
                this.bot.log('MuleCrafter: out of essence in the bank (three reads). Stopping.');
                ScriptRunner.stop();
            }
            return;
        }
        this.emptyReads = 0;

        if (essCount() > 0) {
            return;
        }

        const maxTake = Math.min(Inventory.free(), essencePerTrade(28, false), banked);
        await Bank.withdrawX(ESSENCE, maxTake);
        await Execution.delayUntil(() => essCount() > 0, 4000);
        this.bot.log(`withdrew ${essCount()} essence from the bank`);
    }
}

// ── Mule: walk to ruins ─────────────────────────────────────────────────────────
class MuleWalkToRuins implements Task {
    constructor(private bot: MuleCrafter) {}
    validate(): boolean {
        return this.bot.getMode() === 'Mule' && !Trade.active() && !isAtTile(this.bot.cfg().ruins, 3)
            && essCount() > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the ruins');
        await this.bot.walkTo(this.bot.cfg().ruins, 2);
    }
}

// ── Mule: initiate trade with Crafter at ruins ──────────────────────────────────
class MuleTradeWithCrafter implements Task {
    constructor(private bot: MuleCrafter) {}

    validate(): boolean {
        return this.bot.getMode() === 'Mule' && !Trade.active() 
            && isAtTile(this.bot.cfg().ruins, 4) 
            && essCount() > 0;
    }

    async execute(): Promise<void> {
        const crafter = this.bot.nearestPartner();
        if (!crafter || !crafter.name) {
            this.bot.setStatus('waiting for crafter at ruins');
            await Execution.delayTicks(2);
            return;
        }

        this.bot.setStatus(`requesting trade with ${crafter.name}`);
        const requested = await Trade.request(crafter.name);
        this.bot.log(`MuleTradeWithCrafter: Trade.request(${crafter.name}) returned ${requested}`);
        if (await Execution.delayUntil(() => Trade.active(), 4000)) {
            this.bot.log(`MuleTradeWithCrafter: trade became active with ${crafter.name}`);
        } else {
            this.bot.log('MuleTradeWithCrafter: trade did not become active within 4s');
        }
    }
}

// ── Mule: handle an active trade window (offer essence, accept, confirm) ─────────
class MuleTradeExecute implements Task {
    private beforeEss = 0;
    constructor(private bot: MuleCrafter) {}
    validate(): boolean { return this.bot.getMode() === 'Mule' && Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onOfferScreen()) {
            const who = Trade.partner();
            if (who === null) {
                this.bot.setStatus('reading trade partner');
                await Execution.delayTicks(1);
                return;
            }
            if (!this.bot.isPartner(who)) {
                this.bot.setStatus(`declining trade from ${who}`);
                this.bot.log(`declining a trade from '${who}' — not the crafter`);
                await Trade.decline();
                return;
            }
            this.bot.log(`MuleTradeExecute: offer screen with ${who}, myOffer.length=${Trade.myOffer().length}, ess=${essCount()}, runes=${Inventory.count(this.bot.cfg().rune)}`);
            if (Trade.myOffer().length === 0) {
                const held = essCount();
                if (held <= 0) {
                    this.bot.setStatus('no essence to offer');
                    this.bot.log('MuleTradeExecute: held 0 essence, waiting');
                    await Execution.delayTicks(1);
                    return;
                }
                this.beforeEss = held;
                this.bot.setStatus('offering essence');
                this.bot.log(`MuleTradeExecute: trade open — offering ${held} essence`);
                const offered = await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
                this.bot.log(`MuleTradeExecute: Trade.offerAll returned ${offered}`);
            } else {
                this.bot.setStatus('accepting the offer');
                const accepted = await Trade.accept();
                this.bot.log(`MuleTradeExecute: offer-screen accept returned ${accepted}`);
            }
            return;
        }
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the trade');
            this.bot.log(`MuleTradeExecute: confirm screen, beforeEss=${this.beforeEss}`);
            const accepted = await Trade.accept();
            this.bot.log(`MuleTradeExecute: confirm-screen accept returned ${accepted}`);
            if (await Execution.delayUntil(() => !Trade.active(), 2500) && this.beforeEss > 0) {
                const delivered = this.beforeEss - essCount();
                this.bot.log(`MuleTradeExecute: trade closed, delivered ${delivered} essence (beforeEss=${this.beforeEss}, ess now=${essCount()})`);
                if (delivered > 0) {
                    this.bot.countTrade();
                    this.bot.log(`delivered ${delivered} essence to the crafter`);
                }
                this.beforeEss = 0;
            } else {
                this.bot.log('MuleTradeExecute: trade still active or beforeEss was 0 after confirm accept');
            }
        }
    }
}