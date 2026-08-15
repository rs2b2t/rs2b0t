import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Execution } from '../../api/execution/Execution.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { fmtXpHr } from '../../paint/paintLogic.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Players, type Player } from '../../api/players/Players.js';
import { Duel } from './DuelInterface.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../runtime/BotHost.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import Tile from '../../geometry/Tile.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import {
    BUSY_MESSAGE,
    ChallengeCadence,
    DUEL_CHALLENGE_ANCHOR,
    DUEL_LOBBY_CENTER_RADIUS,
    DUEL_NEGOTIATION_TIMEOUT_MS,
    MAX_CENTER_SEEK_ATTEMPTS,
    MAX_FIGHT_ATTEMPTS,
    beginFightSignal,
    canAttemptDuelFight,
    canSeekFightCenter,
    challengeCandidate,
    challengeResult,
    duelInviter,
    duelRequesterAvailable,
    duelTargetsReached,
    exactTrainingMode,
    fightArenaCenter,
    fightArenaAt,
    hasExactMeleeStyles,
    inDuelChallengeArea,
    negotiationExpired,
    observeFightSignal,
    shouldCenterDuelLobby,
    targetMeleeStyle,
    type DuelTrainingStyle,
    type FightSignalState,
    type Rect
} from './DuelArenaLogic.js';

export const DUEL_ARENA_SETTINGS: SettingsSchema = {
    targetAttack: {
        type: 'number',
        default: 99,
        min: 1,
        max: 99,
        label: 'Target Attack level',
        help: 'the script trains whichever configured melee stat is further below its target'
    },
    targetStrength: {
        type: 'number',
        default: 99,
        min: 1,
        max: 99,
        label: 'Target Strength level',
        help: 'Attack wins a tie between equal remaining gaps'
    },
    targetDefence: {
        type: 'number',
        default: 1,
        min: 1,
        max: 99,
        label: 'Target Defence level',
        help: 'opt in above 1; the equipped weapon must offer exact Attack, Strength, and Defensive styles'
    }
};

const CHALLENGE_RESULT_WAIT_MS = 1500;
const DUEL_XP_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;

function sameName(a: string | null, b: string): boolean {
    return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function playerIn(area: Rect, player: Player): boolean {
    const tile = player.tile();
    return tile.level === 0 && tile.x >= area.minX && tile.x <= area.maxX && tile.z >= area.minZ && tile.z <= area.maxZ;
}

export default class DuelArena extends TaskBot {
    override loopDelay = 600;

    private targetAttack = 99;
    private targetStrength = 99;
    private targetDefence = 1;
    private status = 'starting';
    private opponent: string | null = null;
    private inviteQueue: string[] = [];
    private challengeCursor = 0;
    private readonly cadence = new ChallengeCadence();
    private duels = 0;
    private fightPen: Rect | null = null;
    private fightSignal: FightSignalState = beginFightSignal(null);
    private stopFightObserver: (() => void) | null = null;
    private fightAttempts = 0;
    private fightExhaustionLogged = false;
    private centerSeekAttempts = 0;
    private centerSeekExhaustionLogged = false;
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        this.targetAttack = this.settings.num('targetAttack', 99);
        this.targetStrength = this.settings.num('targetStrength', 99);
        this.targetDefence = this.settings.num('targetDefence', 1);
        this.startedAt = Date.now();
        this.xpAtStart = this.trainingXp();

        this.on('chat.message', line => {
            const inviter = duelInviter(line);
            if (inviter !== null && !this.inviteQueue.some(name => sameName(name, inviter))) {
                this.inviteQueue.push(inviter);
                this.log(`duel request received from ${inviter}`);
            }
        });

        this.log(`Duel Arena trainer starting — melee only; targets Attack ${this.targetAttack}, Strength ${this.targetStrength}, Defence ${this.targetDefence}; challenges every 5s`);

        this.stopFightObserver = BotHost.addTickListener(() => this.observeFightState());
        this.observeFightState();
        this.add(new ContinueDialog(), new CloseWin(this), new CompleteTargets(this), new Negotiate(this), new TravelToArena(this), new SetTrainingStyle(this), new FightOpponent(this), new AcceptInvitation(this), new CenterLobby(this), new SendChallenge(this));
    }

    override onStop(): void {
        this.stopFightObserver?.();
        this.stopFightObserver = null;
        this.resetFightRound();
    }

    override recoveryAnchor(): Tile {
        return Tile.from(DUEL_CHALLENGE_ANCHOR);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const paint = Paint.begin(ctx, { dock: 'chatbox', accent: '#e6c368' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Math.max(0, this.trainingXp() - this.xpAtStart);
        paint.title(`Duel Arena — ${this.status}`);
        paint.row(`Attack ${Skills.level('attack')}/${this.targetAttack}`, `Strength ${Skills.level('strength')}/${this.targetStrength}`, `Defence ${Skills.level('defence')}/${this.targetDefence}`);
        paint.row(`Style ${this.desiredStyle()}`, `Opponent ${this.opponent ?? '—'}`, `Duels ${this.duels}`);
        paint.row(`Runtime ${Math.floor(mins)}m`, `XP/hr: ${fmtXpHr(xpGained, mins)}`);
        paint.end();
    }

    private trainingXp(): number {
        return DUEL_XP_SKILLS.reduce((total, skill) => total + Skills.xp(skill), 0);
    }

    setStatus(status: string): void {
        this.status = status;
    }

    desiredStyle(): DuelTrainingStyle {
        return targetMeleeStyle(
            Skills.level('attack'),
            Skills.level('strength'),
            Skills.level('defence'),
            this.targetAttack,
            this.targetStrength,
            this.targetDefence
        );
    }

    /** A style is valid only when the combat interface trains that stat. */
    exactStyleMode(): number | null {
        const style = this.desiredStyle();
        return exactTrainingMode(style, Game.combatStyleResolution(style));
    }

    exactStyleSelected(): boolean {
        const mode = this.exactStyleMode();
        return mode !== null && Game.combatMode() === mode;
    }

    hasMeleeTrainingStyles(): boolean {
        // Exact Attack + Strength remain the ranged-interface guard. Defence is
        // an additional requirement only while its opt-in goal is outstanding.
        return hasExactMeleeStyles(
            Game.combatStyleResolution('attack'),
            Game.combatStyleResolution('strength'),
            Game.combatStyleResolution('defence'),
            Skills.level('defence') < this.targetDefence
        );
    }

    targetsReached(): boolean {
        return duelTargetsReached(
            Skills.level('attack'),
            Skills.level('strength'),
            Skills.level('defence'),
            this.targetAttack,
            this.targetStrength,
            this.targetDefence
        );
    }

    readyToComplete(): boolean {
        return this.targetsReached() && this.fightPen === null && this.opponent === null && !Duel.active();
    }

    completeTargets(): void {
        this.setStatus('targets reached');
        this.log(`targets reached — Attack ${Skills.level('attack')}/${this.targetAttack}, Strength ${Skills.level('strength')}/${this.targetStrength}, Defence ${Skills.level('defence')}/${this.targetDefence}; stopping`);
        ScriptRunner.stop('Duel Arena targets reached');
    }

    attackTarget(): number {
        return this.targetAttack;
    }

    strengthTarget(): number {
        return this.targetStrength;
    }

    defenceTarget(): number {
        return this.targetDefence;
    }

    notePartner(): void {
        const partner = Duel.partner();
        if (partner === null) {
            return;
        }
        this.consumeInviter(partner);
        if (!sameName(this.opponent, partner)) {
            this.opponent = partner;
            this.log(`negotiating a duel with ${partner}`);
        }
    }

    pendingInviter(): Player | null {
        while (this.inviteQueue.length > 0) {
            const name = this.inviteQueue[0]!;
            const player = Players.query().name(name).nearest();
            if (player !== null && duelRequesterAvailable(player.tile(), player.inCombat)) {
                return player;
            }
            this.inviteQueue.shift();
            this.log(`duel requester ${name} is no longer free in the challenge area — dropping stale request`);
        }
        return null;
    }

    consumeInviter(name: string | null): void {
        if (name === null) {
            return;
        }
        const index = this.inviteQueue.findIndex(value => sameName(value, name));
        if (index !== -1) {
            this.inviteQueue.splice(index, 1);
        }
    }

    challengeReady(): boolean {
        return this.cadence.ready(performance.now());
    }

    challengeTargets(): Player[] {
        return Players.query()
            .where(player => player.name !== null && !player.inCombat && inDuelChallengeArea(player.tile()))
            .results()
            .sort((a, b) => a.index - b.index);
    }

    nextChallengeTarget(): Player | null {
        const choice = challengeCandidate(this.challengeTargets(), this.challengeCursor);
        if (choice === null) {
            return null;
        }
        this.challengeCursor = choice.nextCursor;
        return choice.candidate;
    }

    recordChallenge(result: 'sent' | 'busy' | 'interface' | 'failed', sentAt: number): void {
        this.cadence.record(result, sentAt);
    }

    rememberOpponent(name: string | null): void {
        if (name !== null) {
            this.opponent = name;
        }
    }

    abandonOpponent(name: string | null): void {
        if (name === null || sameName(this.opponent, name)) {
            this.opponent = null;
        }
    }

    cancelNegotiation(name: string | null, cancelledAt: number): void {
        this.consumeInviter(name);
        this.abandonOpponent(name);
        this.cadence.record('sent', cancelledAt);
    }

    opponentIn(area: Rect): Player | null {
        if (this.opponent === null) {
            return null;
        }
        const players = Players.query()
            .where(player => playerIn(area, player))
            .results();
        return players.find(player => sameName(player.name, this.opponent!)) ?? null;
    }

    canAttemptFight(opponent: Player): boolean {
        return canAttemptDuelFight({
            selfTile: Game.tile(),
            opponentTile: opponent.tile(),
            fightStarted: this.fightSignal.phase === 'ready',
            inCombat: Game.inCombat(),
            attempts: this.fightAttempts
        });
    }

    async seekOpponent(area: Rect): Promise<void> {
        this.setStatus('moving to find opponent');
        this.centerSeekAttempts++;
        await DirectNavigator.walkTo(fightArenaCenter(area), 2, 12_000);
    }

    canSeekOpponent(): boolean {
        return canSeekFightCenter(this.centerSeekAttempts);
    }

    reportCenterSeekExhausted(): void {
        this.setStatus('waiting for opponent in arena');
        if (!this.centerSeekExhaustionLogged) {
            this.centerSeekExhaustionLogged = true;
            this.log(`opponent is still outside the visible scene after ${MAX_CENTER_SEEK_ATTEMPTS} center seeks — waiting without injecting more walks`);
        }
    }

    beginFightAttempt(): number {
        return ++this.fightAttempts;
    }

    fightAttemptsExhausted(): boolean {
        return this.fightAttempts >= MAX_FIGHT_ATTEMPTS;
    }

    reportFightAttemptsExhausted(opponent: Player): void {
        this.setStatus(`Fight unavailable for ${opponent.name ?? 'opponent'}`);
        if (!this.fightExhaustionLogged) {
            this.fightExhaustionLogged = true;
            this.log(`Fight did not start after ${MAX_FIGHT_ATTEMPTS} attempts against ${opponent.name ?? `player ${opponent.index}`} — refusing to spam player operations`);
        }
    }

    private observeFightState(): void {
        if (!Game.sceneReady() || Game.tile() === null) {
            return;
        }

        const nextPen = fightArenaAt(Game.tile());
        if (nextPen !== this.fightPen) {
            const previousPen = this.fightPen;
            this.fightPen = nextPen;
            this.fightSignal = beginFightSignal(reader.selfChat());
            this.fightAttempts = 0;
            this.fightExhaustionLogged = false;
            this.centerSeekAttempts = 0;
            this.centerSeekExhaustionLogged = false;

            if (previousPen !== null && nextPen === null) {
                this.duels++;
                this.opponent = null;
                this.cadence.reset();
                this.log(`duel complete #${this.duels} — Attack ${Skills.level('attack')}, Strength ${Skills.level('strength')}, Defence ${Skills.level('defence')}`);
            }
        } else if (nextPen !== null) {
            this.fightSignal = observeFightSignal(this.fightSignal, reader.selfChat());
        }
    }

    private resetFightRound(): void {
        this.fightPen = null;
        this.fightSignal = beginFightSignal(null);
        this.fightAttempts = 0;
        this.fightExhaustionLogged = false;
        this.centerSeekAttempts = 0;
        this.centerSeekExhaustionLogged = false;
    }
}

class CloseWin implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return Duel.winOpen();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('collecting victory');
        if (!(await Duel.closeWin())) {
            this.bot.log('could not close the Duel Arena victory screen — retrying');
        }
    }
}

class CompleteTargets implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return this.bot.readyToComplete();
    }

    execute(): void {
        this.bot.completeTargets();
    }
}

class Negotiate implements Task {
    private openedAt = 0;

    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        if (!Duel.active()) {
            this.openedAt = 0;
            return false;
        }
        if (this.openedAt === 0) {
            this.openedAt = performance.now();
        }
        return true;
    }

    async execute(): Promise<void> {
        this.bot.notePartner();
        if (negotiationExpired(this.openedAt, performance.now())) {
            const partner = Duel.partner();
            this.bot.setStatus('cancelling stalled duel');
            this.bot.log(`duel handshake with ${partner ?? 'the other player'} exceeded ${DUEL_NEGOTIATION_TIMEOUT_MS / 1000}s — cancelling instead of waiting forever`);
            if (!(await Duel.cancel())) {
                this.bot.log('could not close the stalled duel screen — retrying after a fresh deadline');
            }
            this.bot.cancelNegotiation(partner, performance.now());
            this.openedAt = 0;
            return;
        }
        if (Duel.waitingForOther()) {
            this.bot.setStatus('waiting for opponent to accept');
            await Execution.delayTicks(1);
            return;
        }

        this.bot.setStatus(Duel.offerOpen() ? 'accepting duel options' : 'confirming duel');
        const before = reader.modals().main;
        if (!Duel.accept()) {
            this.bot.log(`could not click accept on Duel Arena modal ${before} — retrying`);
            await Execution.delayTicks(1);
            return;
        }

        await Execution.delayUntil(() => reader.modals().main !== before || Duel.waitingForOther(), 3000);
    }
}

class TravelToArena implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        const tile = Game.tile();
        return reader.modals().main === -1 && tile !== null && fightArenaAt(tile) === null && !inDuelChallengeArea(tile);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('walking to Al Kharid Duel Arena');
        this.bot.log('walking to the Duel Arena challenge area');
        const arrived = await Traversal.walkResilient(DUEL_CHALLENGE_ANCHOR, {
            radius: 8,
            attempts: 5,
            timeoutMs: 300_000,
            log: message => this.bot.log(`  ${message}`)
        });
        if (!arrived) {
            this.bot.log('Duel Arena walk did not arrive — the walker will retry');
        }
    }
}

class SetTrainingStyle implements Task {
    private lastFailLogAt = 0;

    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        const tile = Game.tile();
        return reader.modals().main === -1 && tile !== null && (inDuelChallengeArea(tile) || fightArenaAt(tile) !== null) && (!this.bot.hasMeleeTrainingStyles() || !this.bot.exactStyleSelected());
    }

    async execute(): Promise<void> {
        if (!this.bot.hasMeleeTrainingStyles()) {
            this.bot.setStatus('equip a melee weapon');
            if (performance.now() >= this.lastFailLogAt) {
                this.lastFailLogAt = performance.now() + 30_000;
                this.bot.log('the current combat interface must offer exact Attack and Strength styles, plus Defence while that goal is outstanding — equip a suitable melee weapon before dueling');
            }
            await Execution.delayTicks(1);
            return;
        }

        const style = this.bot.desiredStyle();
        this.bot.setStatus(`setting ${style} style`);
        if (this.bot.exactStyleMode() === null) {
            this.bot.setStatus(`equip a weapon with ${style} style`);
            if (performance.now() >= this.lastFailLogAt) {
                this.lastFailLogAt = performance.now() + 30_000;
                this.bot.log(`${style} is unavailable on the current combat interface — refusing to train the wrong stat; equip a melee weapon that offers ${style}`);
            }
            await Execution.delayTicks(1);
            return;
        }
        Game.setCombatStyle(style);
        if (await Execution.delayUntil(() => this.bot.exactStyleSelected(), 3000)) {
            this.bot.log(`combat style set to ${style} (Attack ${Skills.level('attack')}/${this.bot.attackTarget()}, Strength ${Skills.level('strength')}/${this.bot.strengthTarget()}, Defence ${Skills.level('defence')}/${this.bot.defenceTarget()})`);
        } else if (performance.now() >= this.lastFailLogAt) {
            this.lastFailLogAt = performance.now() + 30_000;
            this.bot.log(`could not set ${style} style (combat tab not ready?) — retrying`);
        }
    }
}

class FightOpponent implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return fightArenaAt(Game.tile()) !== null && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const arena = fightArenaAt(Game.tile());
        if (arena === null) {
            return;
        }
        const opponent = this.bot.opponentIn(arena);
        if (opponent === null) {
            if (this.bot.canSeekOpponent()) {
                await this.bot.seekOpponent(arena);
            } else {
                this.bot.reportCenterSeekExhausted();
                await Execution.delayTicks(1);
            }
            return;
        }

        if (!this.bot.canAttemptFight(opponent)) {
            if (this.bot.fightAttemptsExhausted()) {
                this.bot.reportFightAttemptsExhausted(opponent);
            } else {
                this.bot.setStatus('waiting for duel countdown');
            }
            await Execution.delayTicks(1);
            return;
        }

        this.bot.rememberOpponent(opponent.name);
        const attempt = this.bot.beginFightAttempt();
        this.bot.setStatus(`fighting ${opponent.name ?? 'opponent'}`);
        if (!(await Duel.fight(opponent))) {
            this.bot.log(`could not send Fight to ${opponent.name ?? `player ${opponent.index}`} (attempt ${attempt}/${MAX_FIGHT_ATTEMPTS})`);
            await Execution.delayTicks(1);
            return;
        }

        await Execution.delayUntilTicks(() => Game.inCombat() || fightArenaAt(Game.tile()) === null || Duel.winOpen(), 4);
    }
}

class AcceptInvitation implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return reader.modals().main === -1 && inDuelChallengeArea(Game.tile()) && this.bot.hasMeleeTrainingStyles() && this.bot.pendingInviter() !== null;
    }

    async execute(): Promise<void> {
        const inviter = this.bot.pendingInviter();
        if (inviter === null) {
            return;
        }
        this.bot.rememberOpponent(inviter.name);
        this.bot.setStatus(`accepting ${inviter.name ?? 'duel request'}`);
        this.bot.log(`accepting duel request from ${inviter.name ?? `player ${inviter.index}`}`);
        const sentAt = performance.now();
        const mark = GameMessages.mark();
        const dispatched = await Duel.challenge(inviter);
        const interfaceOpened = dispatched && await Execution.delayUntil(
            () => Duel.active() || GameMessages.sawSince(mark, BUSY_MESSAGE),
            CHALLENGE_RESULT_WAIT_MS
        );
        const result = challengeResult(dispatched, interfaceOpened && Duel.active(), GameMessages.sawSince(mark, BUSY_MESSAGE));
        this.bot.consumeInviter(inviter.name);
        this.bot.recordChallenge(result, sentAt);

        if (result !== 'interface') {
            this.bot.abandonOpponent(inviter.name);
            if (result === 'sent') {
                this.bot.log('duel-request interface did not open — treating the reciprocal Challenge as a fresh request and moving on');
            } else if (result === 'busy') {
                this.bot.log(`${inviter.name ?? 'duel requester'} became busy — trying another bot immediately`);
            } else {
                this.bot.log('duel-request acceptance did not dispatch — dropping the stale request so later bots are not starved');
            }
            return;
        }
        this.bot.notePartner();
    }
}

class CenterLobby implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return reader.modals().main === -1 && this.bot.hasMeleeTrainingStyles() && shouldCenterDuelLobby(Game.tile(), this.bot.challengeTargets().length);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('moving to find duelists');
        await DirectNavigator.walkTo(DUEL_CHALLENGE_ANCHOR, DUEL_LOBBY_CENTER_RADIUS, 12_000);
    }
}

class SendChallenge implements Task {
    constructor(private readonly bot: DuelArena) {}

    validate(): boolean {
        return reader.modals().main === -1 && inDuelChallengeArea(Game.tile()) && this.bot.hasMeleeTrainingStyles() && this.bot.challengeReady() && this.bot.challengeTargets().length > 0;
    }

    async execute(): Promise<void> {
        const target = this.bot.nextChallengeTarget();
        if (target === null) {
            this.bot.setStatus('waiting for another duelist');
            return;
        }

        const sentAt = performance.now();
        const mark = GameMessages.mark();
        this.bot.rememberOpponent(target.name);
        this.bot.setStatus(`challenging ${target.name ?? 'player'}`);
        if (!(await Duel.challenge(target))) {
            this.bot.recordChallenge('failed', sentAt);
            return;
        }

        await Execution.delayUntil(() => Duel.active() || GameMessages.sawSince(mark, BUSY_MESSAGE), CHALLENGE_RESULT_WAIT_MS);

        if (Duel.active()) {
            this.bot.recordChallenge('interface', sentAt);
            this.bot.notePartner();
            return;
        }
        if (GameMessages.sawSince(mark, BUSY_MESSAGE)) {
            this.bot.recordChallenge('busy', sentAt);
            this.bot.log(`${target.name ?? 'target'} is busy — trying another bot immediately`);
            return;
        }

        this.bot.recordChallenge('sent', sentAt);
        this.bot.log(`duel request sent to ${target.name ?? `player ${target.index}`}; next invite in 5s`);
    }
}
