import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { EventSignal } from './EventSignal.js';
import { Execution } from './Execution.js';
import { fleeCandidates } from './eventEvade.js';
import { Game } from './Game.js';
import { Reachability } from './Reachability.js';
import { Traversal } from './Traversal.js';
import { ChatDialog } from './hud/ChatDialog.js';
import { Inventory } from './hud/Inventory.js';
import { Npcs } from './queries/Npcs.js';
import { GroundItems } from './queries/GroundItems.js';
import { Locs } from './queries/Locs.js';
import { MIME_EMOTE_BY_SEQ, MIME_IF, mimeAnswer } from './solvers/Mime.js';
import { CUBE_IF, LAMP_IF, solveCube } from './solvers/StrangeBox.js';

/**
 * Comprehensive random-event ("macro event") handling, shared by every bot
 * (PLAN.md / user request: "handle all current events"). Verified against the
 * 21 implemented events in content/scripts/macro events/.
 *
 * The runtime Supervisor (ScriptRunner) consults detect()/handle() before
 * every loop() iteration — scripts install nothing; combat scripts declare
 * grindTargets() so their quarry is never mistaken for a hostile event.
 *
 * Coverage by class (every class is actively resolved — nothing is merely
 * waited out):
 *  - DIALOG  (Genie, Drunken Dwarf, Mysterious Old Man, Sandwich lady, Frog):
 *    walk up, Talk-to, click through, take the gift — fully auto.
 *  - PICK    (Strange plant / triffid): Pick the fruit before it turns hostile.
 *  - EVADE   (Swarm, Zombie, Shade, Rock Golem, River troll, Tree spirit,
 *    Watchman): walk away — server truth is EVERY hostile event NPC despawns
 *    once you get clear (macro_event_lost_hostile), so never fight them.
 *  - LOST TOOL (lost axe / pickaxe): pick up the broken head, use it on the
 *    handle to reattach.
 *  - LOST GEAR (big-fish knock-off): our fishing gear lands on a nearby tile —
 *    pick it back up.
 *  - HAZARD  (poison gas, whirlpool): step away and let it expire.
 *  - STRANGE BOX: Open it, read the cube puzzle, click the matching answer.
 *    It REPLICATES on this server if left unsolved, so an unhandled box keeps
 *    duplicating and fills the inventory — always solve it.
 *  - LAMP    (genie lamp): Rub it and pick the configured skill (lampSkill).
 *  - MIME / MAZE: teleport-to-minigame stages, detected by mapsquare. MIME
 *    mirrors the performance via the emote interface; MAZE walks to the Strange
 *    shrine and touches it to teleport out.
 *
 * A per-signature attempt cap + cooldown (MAX_ATTEMPTS / GIVE_UP_COOLDOWN_MS)
 * is a generic backstop: any event a handler can't finish on a given pass never
 * wedges the bot — it resumes working and re-detects the event after the
 * cooldown.
 */

// Unique event NPC names (lowercase) — safe to treat as events on sight.
const DIALOG_EVENT_NPCS = ['genie', 'drunken dwarf', 'mysterious old man', 'sandwich lady', 'frog'];
const PICK_EVENT_NPCS = ['strange plant'];
// Hostile event monsters. Server truth (macro_events.rs2
// [proc,macro_event_lost_hostile]): EVERY one despawns once the player gets
// away (mode=wander & range>3) — the universal handler is EVADE, never
// fight. Ent events masquerade as normal tree names (Oak/Willow/...) and
// cannot be name-detected — excluded. Names can collide with ordinary
// monsters (zombie), so one is an event only when attacking us and not a
// declared grind target.
const HOSTILE_EVENT_NPCS = ['swarm', 'zombie', 'shade', 'rock golem', 'river troll', 'tree spirit', 'watchman'];

// Hazards (fishing/thieving): step away / recover gear. antimacro configs:
// chest_macro_gas loc 2141; whirlpool npcs 403/404/405; big fish npc 390.
const GAS_CHEST_LOC_ID = 2141;
const WHIRLPOOL_NPC_IDS = [403, 404, 405];
const FISHING_GEAR = ['small fishing net', 'big fishing net', 'fishing rod', 'fly fishing rod', 'harpoon', 'lobster pot'];

// Teleport-minigame stages, detected by mapsquare (survives relogs into the
// stage). macro_event_mime.rs2 / macro_event_maze.rs2.
const MIME_SQUARE = { mx: 31, mz: 74 };
const MAZE_SQUARE = { mx: 45, mz: 71 };

export type EventKind = 'dialog' | 'pick' | 'evade' | 'lost-tool' | 'box' | 'lamp' | 'hazard' | 'lost-gear' | 'mime' | 'maze';

export interface DetectedEvent {
    kind: EventKind;
    name: string;
}

const MAX_ATTEMPTS = 4; // give up on an event we can't clear after this many tries
const GIVE_UP_COOLDOWN_MS = 45000; // then ignore that event for this long so the bot resumes
// Strange plant (triffid): it "grows" for ~54s (Pick just says "the fruit isn't
// ready yet"), is pickable for the next ~54s, then turns hostile and poisons. So
// keep trying Pick across the whole grow window in a single handling pass rather
// than spending the 4-attempt budget before the fruit is ever ripe.
const PICK_WAIT_MS = 80_000;

/**
 * Strange-plant (triffid) handling from its right-click ops. While growing/ready
 * the plant carries a 'Pick' op; once it turns hostile the server changes it to
 * macro_triffidseed_angry — an 'Attack' op, NO 'Pick', and it poisons — so it
 * must be fled then, never picked. Unknown/empty ops default to 'pick' (keep
 * trying) rather than fleeing a plant that isn't actually attacking. Pure.
 */
export function plantStrategy(ops: string[]): 'pick' | 'evade' {
    const canPick = ops.some(a => /pick|take/i.test(a));
    const canAttack = ops.some(a => /attack/i.test(a));
    return !canPick && canAttack ? 'evade' : 'pick';
}

class RandomEventsImpl {
    /** Names the host bot legitimately fights, so they're never mistaken for a combat event. */
    grindTargets: string[] = [];

    /** Which skill genie lamps train (fleet default: strength). */
    lampSkill = 'strength';

    // Per-event-signature bookkeeping so an unclearable event (a context the
    // handler can't fully resolve — e.g. mime/maze, or a plant that won't
    // despawn) never wedges the bot in an infinite handling loop.
    private attempts = new Map<string, number>();
    private cooldownUntil = new Map<string, number>();

    /** True while a guard handler is running — pending() goes quiet so the
     *  handler's own walks (evade, maze) don't interrupt themselves. */
    handling = false;

    private lastCheckTick = -1;
    private lastPending = false;

    /** Cheap per-tick cached "is an event live?" — polled by the walker and
     *  long script loops as their safe-point yield signal. */
    pending(): boolean {
        if (this.handling) {
            return false;
        }
        const t = BotHost.tickCount;
        if (t !== this.lastCheckTick) {
            this.lastCheckTick = t;
            this.lastPending = this.detect() !== null;
        }
        return this.lastPending;
    }

    setGrindTargets(names: string[]): void {
        this.grindTargets = names.map(n => n.toLowerCase());
    }

    private cooledDown(sig: string): boolean {
        const until = this.cooldownUntil.get(sig);
        return until !== undefined && performance.now() < until;
    }

    /** Cheap check used by the task's validate(); returns the event to handle, or null. */
    detect(): DetectedEvent | null {
        const event = this.detectRaw();
        if (event && this.cooledDown(`${event.kind}:${event.name}`)) {
            return null; // gave up on this one recently; let the bot work
        }
        return event;
    }

    private detectRaw(): DetectedEvent | null {
        const me = reader.worldTile();
        if (me && me.level === 0) {
            if (me.x >> 6 === MIME_SQUARE.mx && me.z >> 6 === MIME_SQUARE.mz) {
                return { kind: 'mime', name: 'mime' };
            }
            if (me.x >> 6 === MAZE_SQUARE.mx && me.z >> 6 === MAZE_SQUARE.mz) {
                return { kind: 'maze', name: 'maze' };
            }
        }

        // dialog + pick events: a uniquely-named event NPC near us (they
        // playerfollow their target, so OURS stays close — distance-gate so
        // another player's event NPC isn't chased)
        for (const npc of reader.npcs()) {
            const name = npc.name?.toLowerCase();
            if (!name) {
                continue;
            }
            if (DIALOG_EVENT_NPCS.includes(name) && npc.distance <= 6) {
                return { kind: 'dialog', name };
            }
            if (PICK_EVENT_NPCS.includes(name) && npc.distance <= 8) {
                return { kind: 'pick', name };
            }
        }

        // hostile event: an event monster attacking us — or right on top of us —
        // that we don't grind. NOT gated on OUR combat flag: the Swarm event is a
        // 0-damage interrupter (antimacro.npc: max_dealt=0) that may never flip
        // the player's combat state, yet it wedges non-combat scripts (agility,
        // woodcutting) until we walk off. Keying on the event NPC attacking
        // (npc.inCombat) or being adjacent is the reliable signal.
        for (const npc of reader.npcs()) {
            const name = npc.name?.toLowerCase();
            if (name && HOSTILE_EVENT_NPCS.includes(name) && !this.grindTargets.includes(name) && (npc.inCombat || npc.distance <= 1)) {
                return { kind: 'evade', name };
            }
        }

        // hazards: gas chest adjacent; whirlpool where our fishing spot was
        for (const loc of reader.locs()) {
            if (loc.id === GAS_CHEST_LOC_ID && loc.distance <= 1) {
                return { kind: 'hazard', name: 'poisonous gas' };
            }
        }
        for (const npc of reader.npcs()) {
            if (WHIRLPOOL_NPC_IDS.includes(npc.id) && npc.distance <= 3) {
                return { kind: 'hazard', name: 'whirlpool' };
            }
        }

        // big fish aftermath: our fishing gear got knocked onto the ground
        for (const gear of FISHING_GEAR) {
            const onGround = GroundItems.query()
                .where(g => (g.name?.toLowerCase() ?? '') === gear)
                .within(10)
                .nearest();
            if (onGround && !Inventory.contains(gear)) {
                return { kind: 'lost-gear', name: gear };
            }
        }

        // lost tool: a broken axe/pickaxe handle in the inventory
        if (Inventory.items().some(i => /(axe|pickaxe) handle/i.test(i.name ?? ''))) {
            return { kind: 'lost-tool', name: 'lost tool' };
        }

        // strange box: REPLICATES on this server if left unsolved — solve it
        if (Inventory.contains('Strange box')) {
            return { kind: 'box', name: 'strange box' };
        }

        // genie lamp: rub it (it otherwise sits in the inventory forever)
        if (Inventory.contains('Lamp')) {
            return { kind: 'lamp', name: 'lamp' };
        }

        return null;
    }

    /** Handle the currently-detected event. Returns true if it acted. */
    async handle(log: (msg: string) => void): Promise<boolean> {
        this.handling = true;
        try {
            const event = this.detect();
            if (!event) {
                return false;
            }

            const sig = `${event.kind}:${event.name}`;
            const n = (this.attempts.get(sig) ?? 0) + 1;
            this.attempts.set(sig, n);
            if (n > MAX_ATTEMPTS) {
                // Generic backstop: this handler couldn't clear the event in
                // MAX_ATTEMPTS passes, so stop trying for a while and let the bot
                // work — it re-detects the event after the cooldown. Every event
                // is actively solved (mime/maze are WALKED out, not waited out);
                // this only fires when a handler can't finish a given pass — e.g.
                // an interface it can't read, or an NPC that won't despawn.
                this.attempts.delete(sig);
                this.cooldownUntil.set(sig, performance.now() + GIVE_UP_COOLDOWN_MS);
                log(`random event: gave up on ${event.name} after ${MAX_ATTEMPTS} attempts — ignoring it for ${GIVE_UP_COOLDOWN_MS / 1000}s`);
                return false;
            }

            let acted = false;
            switch (event.kind) {
                case 'dialog':
                    acted = await this.handleDialog(event.name, log);
                    break;
                case 'pick':
                    acted = await this.handlePick(event.name, log);
                    break;
                case 'evade':
                    acted = await this.handleEvade(event.name, log);
                    break;
                case 'hazard':
                    acted = await this.handleHazard(event.name, log);
                    break;
                case 'mime':
                    acted = await this.handleMime(log);
                    break;
                case 'maze':
                    acted = await this.handleMaze(log);
                    break;
                case 'lost-tool':
                    acted = await this.handleLostTool(log);
                    break;
                case 'lost-gear':
                    acted = await this.handleLostGear(event.name, log);
                    break;
                case 'box':
                    acted = await this.handleBox(log);
                    break;
                case 'lamp':
                    acted = await this.handleLamp(log);
                    break;
                default:
                    break;
            }

            // cleared? reset the attempt counter for this signature
            const after = this.detectRaw();
            if (!after || `${after.kind}:${after.name}` !== sig) {
                this.attempts.delete(sig);
            }
            return acted;
        } finally {
            this.handling = false;
        }
    }

    private async handleDialog(name: string, log: (msg: string) => void): Promise<boolean> {
        log(`random event: ${name} — talking through it`);
        const npc = Npcs.query()
            .where(n => (n.name?.toLowerCase() ?? '') === name)
            .nearest();
        if (!npc) {
            return false;
        }

        // talk-to (the event NPC is adjacent; the client approaches as needed)
        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 5000);

        // click through; if an option list appears, take the first (the
        // affirmative/accept path that ends the event)
        for (let i = 0; i < 25; i++) {
            if (!ChatDialog.isOpen()) {
                break;
            }
            if (ChatDialog.options().length > 0) {
                await ChatDialog.chooseOption();
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
            // the event is gone once the NPC despawns
            const stillThere = reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name);
            if (!stillThere && !ChatDialog.isOpen()) {
                break;
            }
        }

        log(`random event: ${name} cleared`);
        return true;
    }

    private async handlePick(name: string, log: (msg: string) => void): Promise<boolean> {
        // The strange plant grows for ~54s — during which "Pick" only reports
        // "the fruit isn't ready yet" and does nothing — is then pickable for
        // ~54s, and finally turns hostile (a changetype'd plant that poisons). So
        // keep trying Pick across the grow window in this one pass until the fruit
        // lands in the pack; if it has ALREADY turned hostile (Attack op, no Pick)
        // flee it like any other hostile event — picking is impossible then and
        // standing next to it just eats poison damage.
        const deadline = performance.now() + PICK_WAIT_MS;
        let announced = false;
        while (performance.now() < deadline) {
            const plant = Npcs.query()
                .where(n => (n.name?.toLowerCase() ?? '') === name)
                .nearest();
            if (!plant) {
                return true; // picked, despawned, or we walked out of range
            }
            if (plantStrategy(plant.actions()) === 'evade') {
                log(`random event: ${name} turned hostile — fleeing (it poisons)`);
                return await this.handleEvade(name, log);
            }
            if (!announced) {
                log(`random event: ${name} — picking the fruit as soon as it ripens`);
                announced = true;
            }
            const op = plant.actions().find(a => /pick|take/i.test(a));
            if (op) {
                const before = Inventory.count('Strange fruit');
                await plant.interact(op);
                // success is the fruit landing in the pack immediately; the plant
                // itself only despawns ~13 ticks after a successful pick, so don't
                // gate solely on its disappearance
                const picked = await Execution.delayUntil(
                    () => Inventory.count('Strange fruit') > before || !reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name),
                    6000
                );
                if (picked) {
                    log(`random event: ${name} — fruit picked`);
                    return true;
                }
            }
            // not ripe yet ("the fruit isn't ready to be picked yet") — wait, retry
            await Execution.delayTicks(4);
        }
        log(`random event: ${name} — fruit never ripened in this pass; will retry`);
        return true;
    }

    /**
     * Mime stage: watch the mime's performance and mirror it. The mime plays
     * an answerable emote (phase 1); when the macro_mime_emotes chat interface
     * opens (phase 4) we click the matching emote button. 4 correct in a row
     * releases us and teleports us home — the loop repeats across cycles, and
     * a wrong answer just resets the server-side chain. Runs while
     * handling===true so its own waits don't self-interrupt.
     */
    private async handleMime(log: (msg: string) => void): Promise<boolean> {
        log('random event: mime stage — copying the performance');
        const onStage = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === 0 && me.x >> 6 === MIME_SQUARE.mx && me.z >> 6 === MIME_SQUARE.mz;
        };

        let lastSeen: number | null = null;
        const deadline = performance.now() + 180_000; // ~9 full cycles

        while (onStage() && performance.now() < deadline) {
            // remember the mime's most recent ANSWERABLE emote (phase 1);
            // bow/cheer/idle are filtered by the mapping
            const mime = reader.npcs().find(n => (n.name ?? '').toLowerCase() === 'mime');
            if (mime && MIME_EMOTE_BY_SEQ[mime.anim] !== undefined) {
                lastSeen = mime.anim;
            }

            if (reader.modals().chat === MIME_IF.root) {
                const answer = mimeAnswer(lastSeen);
                if (answer !== null) {
                    actions.ifButton(MIME_IF.buttons[answer]);
                    log(`mime: performed emote ${answer}`);
                    lastSeen = null;
                    await Execution.delayUntil(() => reader.modals().chat !== MIME_IF.root || !onStage(), 10_000);
                    continue;
                }
                // joined mid-cycle with nothing seen — let this round pass
            }
            await Execution.delayTicks(1);
        }

        log(onStage() ? 'mime: still on stage after 3min — will retry' : 'random event: mime solved — returned');
        return true;
    }

    /** Maze finish: loc macro_maze_complete id 3634 'Strange shrine' (3x3),
     *  region 0_45_71 — pack/loc.pack + macro_event_maze.rs2. Touching it
     *  returns us via ~macro_return_teleport. The maze is ordinary walkable
     *  geometry in the baked pack, so the normal walker can path to it. */
    private static readonly MAZE_SHRINE_LOC = 3634;

    private async handleMaze(log: (msg: string) => void): Promise<boolean> {
        const inMaze = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === 0 && me.x >> 6 === MAZE_SQUARE.mx && me.z >> 6 === MAZE_SQUARE.mz;
        };

        log('random event: maze — walking to the shrine');
        const shrine = Locs.query()
            .where(l => l.id === RandomEventsImpl.MAZE_SHRINE_LOC)
            .nearest();
        if (!shrine) {
            log('maze: shrine not in scene yet — waiting');
            await Execution.delayTicks(25);
            return false;
        }

        await Traversal.walkTo(shrine.tile(), { radius: 1, timeoutMs: 120_000, log });
        if (inMaze()) {
            shrine.interact(shrine.actions()[0] ?? 'Touch');
            await Execution.delayUntil(() => !inMaze(), 15_000);
        }
        log(inMaze() ? 'maze: still inside — will retry' : 'random event: maze solved — returned');
        return true;
    }

    private async handleEvade(name: string, log: (msg: string) => void): Promise<boolean> {
        const me = Game.tile();
        const threat = Npcs.query()
            .where(n => (n.name?.toLowerCase() ?? '') === name)
            .nearest();
        if (!me || !threat) {
            return false;
        }

        // server truth (macro_event_lost_hostile): hostile event NPCs despawn
        // once we get away — walk ~12 tiles to a reachable tile away from it
        log(`random event: ${name} attacking — evading (it despawns once we're away)`);
        const flee = fleeCandidates(me, threat.tile(), 12).find(t => Reachability.canReach(t, { maxSteps: 1500 }));
        if (!flee) {
            log('random event: nowhere reachable to evade to — waiting in place');
            await Execution.delayTicks(10);
            return false;
        }

        await Traversal.walkTo(flee, { radius: 2, timeoutMs: 20_000, log });
        const gone = await Execution.delayUntil(() => !reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name), 45_000);
        log(gone ? `random event: ${name} despawned` : `random event: ${name} still around after evade`);

        await Traversal.walkTo(me, { radius: 3, timeoutMs: 20_000, log });
        return true;
    }

    /** Gas chest / whirlpool: step a few tiles away and let it expire. */
    private async handleHazard(name: string, log: (msg: string) => void): Promise<boolean> {
        const me = Game.tile();
        if (!me) {
            return false;
        }
        log(`random event: ${name} — stepping away`);
        const flee = fleeCandidates(me, me, 4).find(t => Reachability.canReach(t, { maxSteps: 600 }));
        if (flee) {
            await Traversal.walkTo(flee, { radius: 1, timeoutMs: 15_000, log });
        }
        // gas timer clears >10 tiles / whirlpool reverts after 60 ticks (36s)
        await Execution.delayTicks(60);
        return true;
    }

    private async handleLostTool(log: (msg: string) => void): Promise<boolean> {
        log('random event: lost tool — recovering the head');
        const handle = Inventory.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
        if (!handle) {
            return false;
        }

        // the broken head lands on the ground nearby; pick it up
        const head = GroundItems.query()
            .where(g => /(axe|pickaxe) head/i.test(g.snap.name ?? ''))
            .within(12)
            .nearest();
        if (head) {
            const before = Inventory.used();
            await head.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 6000);
        }

        // reattach: use the head on the handle (InvItem.useOn — the same
        // use-X-on-Y primitive every processing skill uses)
        const headItem = Inventory.items().find(i => /(axe|pickaxe) head/i.test(i.name ?? ''));
        const handleItem = Inventory.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
        if (headItem && handleItem) {
            const before = Inventory.used();
            await headItem.useOn(handleItem);
            const fixed = await Execution.delayUntil(() => Inventory.used() < before, 5000);
            log(fixed ? 'random event: tool reattached' : 'random event: reattach did not resolve');
            return true;
        }
        log('random event: picked up the tool head but could not pair it with a handle');
        return true;
    }

    /** Big fish knocked our fishing gear onto a nearby tile — pick it up. */
    private async handleLostGear(name: string, log: (msg: string) => void): Promise<boolean> {
        const drop = GroundItems.query()
            .where(g => (g.name?.toLowerCase() ?? '') === name)
            .within(10)
            .nearest();
        if (!drop) {
            return false;
        }
        log(`random event: recovering our ${name} (big fish)`);
        const before = Inventory.used();
        await drop.interact('Take');
        const got = await Execution.delayUntil(() => Inventory.used() > before, 8000);
        log(got ? `random event: ${name} recovered` : `random event: could not pick the ${name} back up`);
        return true;
    }

    private async handleBox(log: (msg: string) => void): Promise<boolean> {
        const box = Inventory.first('Strange box');
        if (!box) {
            return false;
        }

        const countBefore = Inventory.items().filter(i => i.name === 'Strange box').length;
        await box.interact('Open');
        if (!(await Execution.delayUntil(() => reader.modals().main === CUBE_IF.root, 5000))) {
            log('random event: strange box interface did not open');
            return false;
        }

        const question = reader.ifText(CUBE_IF.question) ?? '';
        const models: [number | null, number | null, number | null] = [reader.ifModelObjId(CUBE_IF.models[0]), reader.ifModelObjId(CUBE_IF.models[1]), reader.ifModelObjId(CUBE_IF.models[2])];
        const answer = solveCube(question, models);
        if (answer === null) {
            log(`random event: could not solve strange box ('${question}' models=${models}) — closing`);
            actions.closeModal();
            return false; // attempts/cooldown machinery caps retries
        }

        actions.ifButton(CUBE_IF.buttons[answer]);
        const solved = await Execution.delayUntil(() => Inventory.items().filter(i => i.name === 'Strange box').length < countBefore, 4000);
        log(solved ? `random event: strange box solved ('${question}')` : 'random event: strange box answer did not consume a box');
        return true;
    }

    private async handleLamp(log: (msg: string) => void): Promise<boolean> {
        const lamp = Inventory.first('Lamp');
        if (!lamp) {
            return false;
        }

        await lamp.interact('Rub');
        if (!(await Execution.delayUntil(() => reader.modals().main === LAMP_IF.root, 5000))) {
            log('random event: lamp interface did not open');
            return false;
        }

        const skillCom = LAMP_IF.skills[this.lampSkill.toLowerCase()] ?? LAMP_IF.skills.strength;
        actions.ifButton(skillCom);
        await Execution.delayTicks(1);
        actions.ifButton(LAMP_IF.confirm);
        const used = await Execution.delayUntil(() => !Inventory.contains('Lamp'), 4000);
        log(used ? `random event: rubbed lamp (+xp ${this.lampSkill})` : 'random event: lamp did not consume');
        return true;
    }
}

export const RandomEvents = new RandomEventsImpl();

// The walker (and long script loops) poll EventSignal.pending() to yield at a
// safe point; register RandomEvents as the provider at module init (Task 6).
EventSignal.setProvider(() => RandomEvents.pending());
