import { actions } from '../adapter/ClientAdapter.js';
import { BANK_LOCATIONS, bankUnlocked, type BankLocation } from '../api/BankLocations.js';
import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import type Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { WalkExecutor } from '../nav/WalkExecutor.js';
import {
    JUNGLE_HERBS,
    JUNGLE_POTION_QUEST,
    POTHOLE_ENTRANCE,
    enterPothole,
    inCaves,
    readJungleProgress
} from '../quests/defs/junglepotion.js';
import { settleScene } from '../quests/exec/prompts.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import {
    COINS,
    DROP_OP,
    FARE,
    FARE_FLOAT,
    IDENTIFY_OP,
    IDENTIFY_XP,
    checkGates,
    isLevelRefusal,
    isStageRefusal,
    planCycle,
    rankBanksByDetour
} from './RoguesPurseLogic.js';

const PURSE = JUNGLE_HERBS.find(h => h.key === 'rogues purse')!;
const WALL = { name: PURSE.loc, op: PURSE.op, at: PURSE.at, stand: PURSE.stand };

/** Off the stand by more than this and the wall click would walk us, so re-anchor. */
const ANCHOR_SLACK = 3;
/** Consecutive searches that yielded no unid before we accept the wall is dead to us. */
const DEAD_SEARCHES = 30;

/**
 * How many banks to try before giving up on the fare. Candidates are ranked by detour cost and
 * then probed, because ranking alone is affordability-blind: dying on Karamja would rank
 * Ardougne cheapest, across a 30gp ferry the empty pack cannot pay for.
 */
const BANK_TRIES = 4;
const BANK_PROBE_EXPANSIONS = 300_000;
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export default class RoguesPurse extends LoopingBot {
    // The loop paces itself off the game tick; a loopDelay on top would halve throughput.
    override loopDelay = 0;

    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;
    private searches = 0;
    private deadSearches = 0;
    private deaths = 0;
    private refusal: string | null = null;
    private recovery: DeathRecovery | null = null;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.xpStart = Skills.xp('herblore');

        // The journal read opens a modal, so it happens once — before the walk to Karamja.
        const gate = checkGates({
            herbloreLevel: Skills.level('herblore'),
            stage: (await readJungleProgress())?.stage
        });
        if (!gate.ok) {
            this.log(`RoguesPurse: ${gate.reason}. Stopping.`);
            throw new Error(`RoguesPurse: ${gate.reason}`);
        }

        this.on('chat.message', line => {
            if (isStageRefusal(line.text)) {
                this.refusal = `the wall found nothing — ${JUNGLE_POTION_QUEST} is not far enough along`;
            } else if (isLevelRefusal(line.text)) {
                this.refusal = 'the herb refused to identify — Herblore level too low';
            }
        });

        // Death respawns at Lumbridge and keeps only 1 of each of the three priciest items
        // (`move_priciest_item_on_hero_to_death`), so a 100gp stack survives as a single coin —
        // the fare always has to be re-withdrawn before the walk back.
        this.recovery = new DeathRecovery(this, {
            anchor: WALL.stand,
            radius: ANCHOR_SLACK,
            onDeath: () => {
                this.deaths++;
                this.status = 'died — recovering';
                this.log(`died (${this.deaths} this run) — re-withdrawing the boat fare and walking back`);
            },
            onRecovered: () => this.log('back at the wall'),
            walkBack: async () => {
                await this.travel({ needFare: true });
                return this.atWall();
            }
        });

        this.log(`RoguesPurse — ${WALL.name} at ${WALL.at}, standing ${WALL.stand}; search/identify/drop on the tick`);
    }

    override recoveryAnchor(): Tile {
        return WALL.stand;
    }

    override async loop(): Promise<void> {
        if (this.refusal) {
            this.status = 'refused';
            this.log(`RoguesPurse: ${this.refusal}. Stopping.`);
            ScriptRunner.stop();
            return;
        }

        // Death takes precedence: the pack is empty and the fare has to come first, so this
        // must not fall through to the ordinary walk and burn the ladder proving it.
        if (this.recovery?.validate()) {
            await this.recovery.execute();
        } else if (!this.atWall()) {
            await this.travel();
        } else {
            const wall = this.wallLoc();
            if (wall) {
                await this.cycle(wall);
            } else {
                // Blank scene is not evidence the wall is gone (docs/NAV.md#level-change-loc-lag).
                this.status = 'waiting for the scene';
                await settleScene();
            }
        }
        // loopDelay is 0 — every path pays a tick here, so a fast-failing walk cannot spin.
        await Execution.delayTicks(1);
    }

    /**
     * One tick of packets. Both `opheld`s run inline as the server decodes them while the
     * search resolves in the movement phase, so this pipelines: identify and drop clear
     * what the last tick produced and the search stocks the next.
     */
    private async cycle(wall: Loc): Promise<void> {
        const unid = Inventory.items().find(item => item.id === PURSE.unidId) ?? null;
        const herb = Inventory.items().find(item => item.id === PURSE.id) ?? null;
        const plan = planCycle({
            continuePending: ChatDialog.canContinue(),
            unids: unid ? 1 : 0,
            identified: herb ? 1 : 0,
            freeSlots: Inventory.free()
        });

        // Either form in the pack proves the wall is still handing herbs over. Read the pack
        // rather than the inventory.changed stream — a slot that fills and empties inside one
        // tick can diff to no change at all.
        if (unid || herb) {
            this.deadSearches = 0;
        }
        this.status = `identifying (${this.identifiedCount()} done)`;
        for (const action of plan) {
            if (action === 'continue') {
                actions.continueDialog();
            } else if (action === 'identify' && unid) {
                await unid.interact(IDENTIFY_OP);
            } else if (action === 'drop' && herb) {
                await herb.interact(DROP_OP);
            } else if (action === 'search') {
                if (await wall.interact(WALL.op)) {
                    this.searches++;
                    if (++this.deadSearches >= DEAD_SEARCHES) {
                        this.refusal = `${DEAD_SEARCHES} searches in a row found no herb`;
                    }
                }
            }
        }
    }

    /**
     * Identifying is the only thing here that grants xp, so the xp counter is the honest
     * count — a sent `Identify` packet is not proof the engine accepted it. The client is
     * told xp/10 truncated, so this is off by at most one herb.
     */
    private identifiedCount(): number {
        return Math.round((Skills.xp('herblore') - this.xpStart) / IDENTIFY_XP);
    }

    private wallLoc(): Loc | null {
        return Locs.query()
            .name(WALL.name)
            .action(WALL.op)
            .where(loc => loc.tile().distanceTo(WALL.at) <= 2)
            .nearest();
    }

    private atWall(): boolean {
        const here = Game.tile();
        return here !== null && inCaves(here) && WALL.stand.distanceTo(here) <= ANCHOR_SLACK;
    }

    private async travel(opts: { needFare?: boolean } = {}): Promise<void> {
        const log = (m: string): void => this.log(`  ${m}`);
        if (!inCaves(Game.tile())) {
            // After a death we already know we are off the island and broke, so skip
            // straight to the bank instead of spending the walk ladder to learn it.
            if (opts.needFare && Inventory.count(COINS) < FARE && !(await this.fetchFare(log))) {
                return;
            }
            this.status = 'walking to the pothole';
            this.log(`heading for the ${POTHOLE_ENTRANCE.loc} at ${POTHOLE_ENTRANCE.stand}`);
            if (!(await Traversal.walkResilient(POTHOLE_ENTRANCE.stand, { radius: 2, attempts: 4, timeoutMs: 300_000, log }))) {
                // Take the navigator's word for it rather than guessing at geography: an
                // unreachable island with no fare in the pack is a banking problem.
                if (WalkExecutor.lastOutcome === 'unreachable' && Inventory.count(COINS) < FARE) {
                    await this.fetchFare(log);
                }
                return;
            }
            this.status = 'entering the caves';
            // The climb telejumps first and answers its prompt after, so a false return
            // with our feet already underground means it worked — check, don't trust.
            if (!(await enterPothole(log)) && !inCaves(Game.tile())) {
                this.log('could not climb into the caves — retrying');
                return;
            }
        }

        this.status = 'walking to the wall';
        this.log(`walking to the ${WALL.name}`);
        if (await Traversal.walkResilient(WALL.stand, { radius: 1, attempts: 4, timeoutMs: 180_000, log })) {
            await settleScene();
            this.log('at the wall');
        }
    }

    /**
     * Nearest bank the navigator can actually reach with what we are carrying. Probing applies
     * the same fare pruning as a real walk, so an unaffordable toll gate rules a bank out
     * before we spend minutes walking at it.
     */
    private async reachableBank(log: (m: string) => void): Promise<BankLocation | null> {
        const here = Game.tile();
        if (!here) {
            return null;
        }
        // Cheapest detour on the way to the pothole, not nearest to us — Draynor sits on the
        // Lumbridge->Port Sarim line, where Al Kharid is 50 tiles backwards plus a toll.
        const ranked = rankBanksByDetour(
            here,
            POTHOLE_ENTRANCE.stand,
            BANK_LOCATIONS.filter(b => b.tile.level === here.level && bankUnlocked(b))
        );
        for (const bank of ranked.slice(0, BANK_TRIES)) {
            if ((await WalkExecutor.probeDest(bank.tile, BANK_PROBE_EXPANSIONS)).ok) {
                return bank;
            }
            log(`bank: ${bank.name} not reachable with ${Inventory.count(COINS)}gp — trying the next`);
        }
        return null;
    }

    /** Withdraw the boat fare so the ship crossings stop being pruned from the graph. */
    private async fetchFare(log: (m: string) => void): Promise<boolean> {
        this.status = 'banking for the boat fare';
        this.log(`need the ${FARE}gp ship fare for Karamja — going to the bank`);

        const bank = await this.reachableBank(log);
        if (!bank) {
            this.log('no reachable bank for the fare — retrying');
            return false;
        }
        this.log(`banking at ${bank.name} ${bank.tile}`);
        await Traversal.walkResilient(bank.tile, { radius: 4, attempts: 4, timeoutMs: 300_000, log });
        if (!(await Bank.openNearestAccess(bank.access ?? BOOTH, log))) {
            this.log(`could not open the ${bank.name} bank — retrying`);
            return false;
        }
        // An open bank modal would block the walk that follows, on every exit from here.
        try {
            if (!(await Execution.delayUntil(() => Bank.loaded(), 4000))) {
                this.log('bank contents never loaded — retrying');
                return false;
            }
            const have = Bank.count(COINS);
            if (have < FARE) {
                this.refusal = `no boat fare — needs ${FARE}gp for the Karamja ship (${bank.name} has ${have})`;
                return false;
            }
            await Bank.withdrawX(COINS, Math.min(FARE_FLOAT, have));
            if (!(await Execution.delayUntil(() => Inventory.count(COINS) >= FARE, 4000))) {
                this.log('the coins never arrived in the pack — retrying');
                return false;
            }
            this.log(`withdrew ${Inventory.count(COINS)}gp for the crossing`);
            return true;
        } finally {
            await Bank.close();
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b7e88a' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('herblore') - this.xpStart;
        const identified = this.identifiedCount();
        const perHour = mins > 0.5 ? Math.round((identified / mins) * 60) : 0;
        const xpHour = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';

        p.title(`RoguesPurse — ${this.status}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Herblore: ${Skills.level('herblore')}`, `XP: +${xp}`);
        p.row(`Identified: ${identified}`, `Herbs/hr: ${perHour}`, `XP/hr: ${xpHour}`);
        p.row(`Searches: ${this.searches}`, `Deaths: ${this.deaths}`, `Pack: ${Inventory.used()}/28`);
        p.row(`Per herb: ${IDENTIFY_XP}xp`, `Fare: ${Inventory.count(COINS)}gp`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
