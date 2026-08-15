import { reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { fleeCandidates } from './eventEvade.js';
import { Game } from '../../api/game/Game.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { MIME_SQUARE, performMimeStage } from './solvers/Mime.js';
import { rubLamp, solveAllBoxes } from './solvers/StrangeBox.js';
import { MAZE_SQUARE, solveMaze } from './maze/solveMaze.js';
import { SettingsStore } from '../Settings.js';

const DIALOG_EVENT_NPCS = ['genie', 'drunken dwarf', 'mysterious old man', 'sandwich lady', 'frog'];
const PICK_EVENT_NPCS = ['strange plant'];
const idRange = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const HOSTILE_EVENT_NPC_IDS = new Set<number>([
    ...idRange(391, 396), // River troll  (macro_rivertrollguardian_1..6)
    411,                  // Swarm        (macro_swarm)
    ...idRange(413, 418), // Rock Golem   (macro_golemguardian_1..6)
    ...idRange(419, 424), // Zombie       (macro_zombie1..6)
    ...idRange(425, 430), // Shade        (macro_shade1..6)
    ...idRange(431, 436), // Watchman     (macro_watchman1..6)
    ...idRange(438, 443)  // Tree spirit  (macro_dryhadguardian_1..6)
]);

const GAS_CHEST_LOC_ID = 2141;
/** Whirlpool fishing-spot variants (macro). 406 is the fourth changetype id. */
const WHIRLPOOL_NPC_IDS = [403, 404, 405, 406];
const SMOKING_ROCK_ID_MIN = 2119;
const SMOKING_ROCK_ID_MAX = 2138;
const FISHING_GEAR = [
    'small fishing net',
    'big fishing net',
    'fishing rod',
    'oily fishing rod',
    'fly fishing rod',
    'harpoon',
    'lobster pot',
    'fishing bait',
    'feather'
];
const GEAR_LOSS_WINDOW_MS = 90_000;
/** Hostile fishing/mining randoms (river troll, rock golem, …) often open from a few tiles out.
 *  Why: detecting by id within this range when they face or attack us, rather than only when adjacent, stops fishers dying before distance<=1 fires. */
const HOSTILE_ENGAGE_DISTANCE = 8;

export function isHostileEventNpc(
    npc: {
        id: number;
        inCombat: boolean;
        distance: number;
        faceEntity: number;
    },
    _selfSlot: number,
    _playerInCombat: boolean
): boolean {
    if (!HOSTILE_EVENT_NPC_IDS.has(npc.id)) {
        return false;
    }
    if (npc.distance > HOSTILE_ENGAGE_DISTANCE) {
        return false;
    }
    // Why: these antimacro ids only exist as your own random event — they are not world mobs you walk past.
    // Why: soft flags (combatCycle / faceEntity) often lag or never set for 0-damage Swarm (#422), which left walks repathing until timeout while Supervisor never intercepted, so presence within engage range is enough.
    return true;
}

export class GearLossTracker {
    private held = new Set<string>();
    private lost = new Map<string, number>();
    private wasSuppressed = false;

    constructor(private readonly windowMs = GEAR_LOSS_WINDOW_MS) {}

    update(heldNow: readonly string[], suppressedNow: boolean, nowMs: number): void {
        const now = new Set(heldNow.map(s => s.toLowerCase()));
        if (!suppressedNow && !this.wasSuppressed) {
            for (const gear of this.held) {
                if (!now.has(gear)) {
                    this.lost.set(gear, nowMs);
                }
            }
        }
        this.held = now;
        this.wasSuppressed = suppressedNow;
    }

    recentlyLost(gear: string, nowMs: number): boolean {
        const at = this.lost.get(gear.toLowerCase());
        return at !== undefined && nowMs - at <= this.windowMs;
    }
}

type EventKind = 'dialog' | 'pick' | 'evade' | 'lost-tool' | 'box' | 'lamp' | 'hazard' | 'lost-gear' | 'mime' | 'maze';

interface DetectedEvent {
    kind: EventKind;
    name: string;
}

const MAX_ATTEMPTS = 4; // give up on an event we can't clear after this many tries
const GIVE_UP_COOLDOWN_MS = 45000; // then ignore that event for this long so the bot resumes
const PICK_WAIT_MS = 80_000;

/**
 * Events that teleport the player into their own map square, retried until solved.
 * Why: the script cannot walk out, so resuming it makes the bot fight the solver for the same tiles.
 */
const TRAPPED_KINDS: ReadonlySet<EventKind> = new Set(['maze', 'mime']);

export function plantStrategy(ops: string[]): 'pick' | 'evade' {
    const canPick = ops.some(a => /pick|take/i.test(a));
    const canAttack = ops.some(a => /attack/i.test(a));
    return !canPick && canAttack ? 'evade' : 'pick';
}

const PROTECTED_FROM_DROP = /(handle|head$|axe|pick|hammer|chisel|knife|tinderbox|rod|net|harpoon)/i;

export function pickSacrificial(names: (string | null)[]): string | null {
    const counts = new Map<string, number>();
    for (const n of names) {
        if (n && !PROTECTED_FROM_DROP.test(n)) {
            counts.set(n, (counts.get(n) ?? 0) + 1);
        }
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [name, count] of counts) {
        if (count > bestCount) {
            best = name;
            bestCount = count;
        }
    }
    return best;
}

export function handleLocation(invNames: (string | null)[], wornNames: (string | null)[]): 'worn' | 'inventory' | null {
    const isHandle = (n: string | null): boolean => n !== null && /(axe|pickaxe) handle/i.test(n);
    if (wornNames.some(isHandle)) {
        return 'worn';
    }
    if (invNames.some(isHandle)) {
        return 'inventory';
    }
    return null;
}

class RandomEventsImpl {
    grindTargets: string[] = [];

    lampSkill = 'strength';

    private ignoredProvider: () => readonly string[] = () => [];

    private readonly gearLoss = new GearLossTracker();

    private attempts = new Map<string, number>();
    private cooldownUntil = new Map<string, number>();

    handling = false;

    private lastCheckTick = -1;
    private lastPending = false;

    /**
     * True when a random is active and not currently being solved.
     * Why: quiet while {@link handling} so the handler's own walks do not self-interrupt, while Supervisor / EventSignal still gate scripts between loops via detect + handling.
     */
    pending(): boolean {
        if (this.handling) {
            return false;
        }
        const t = BotHost.tickCount;
        if (t !== this.lastCheckTick) {
            this.lastCheckTick = t;
            try {
                this.lastPending = this.detect() !== null;
            } catch {
                // Scene rebuild / deltime-0 during teleports must not poison the tick.
                this.lastPending = false;
            }
        }
        return this.lastPending;
    }

    setGrindTargets(names: string[]): void {
        this.grindTargets = names.map(n => n.toLowerCase());
    }

    setIgnoredRandoms(names: readonly string[] | (() => readonly string[])): void {
        this.ignoredProvider = typeof names === 'function' ? names : () => names;
    }

    isIgnored(name: string): boolean {
        const want = name.toLowerCase();
        return this.ignoredProvider().some(n => n.toLowerCase() === want);
    }

    setLampSkill(skill: string): void {
        this.lampSkill = skill;
    }

    /** Live Global setting, with setLampSkill / default as fallback for tests. */
    private resolveLampSkill(): string {
        return SettingsStore.globalBag().str('lampSkill', this.lampSkill);
    }

    private cooledDown(sig: string): boolean {
        const until = this.cooldownUntil.get(sig);
        return until !== undefined && performance.now() < until;
    }

    detect(): DetectedEvent | null {
        try {
            const event = this.detectRaw();
            if (!event) {
                return null;
            }
            // Why: Brimhaven platforms are 5x5, so evading Swarm never despawns it (#597).
            if (this.isIgnored(event.name)) {
                return null;
            }
            if (this.cooledDown(`${event.kind}:${event.name}`)) {
                return null;
            }
            return event;
        } catch {
            return null;
        }
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

        // Scene may be empty mid-teleport; npcs() can still walk combatCycle stamps.
        let npcs: ReturnType<typeof reader.npcs>;
        try {
            npcs = reader.npcs();
        } catch {
            return null;
        }

        for (const npc of npcs) {
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

        const selfSlot = reader.selfSlot();
        let playerInCombat = false;
        try {
            playerInCombat = Game.inCombat();
        } catch {
            playerInCombat = false;
        }
        for (const npc of npcs) {
            if (isHostileEventNpc(npc, selfSlot, playerInCombat)) {
                return { kind: 'evade', name: npc.name?.toLowerCase() ?? 'event monster' };
            }
        }

        for (const loc of reader.locs()) {
            if (loc.id === GAS_CHEST_LOC_ID && loc.distance <= 1) {
                return { kind: 'hazard', name: 'poisonous gas' };
            }
            if (loc.id >= SMOKING_ROCK_ID_MIN && loc.id <= SMOKING_ROCK_ID_MAX && loc.distance <= 2) {
                return { kind: 'hazard', name: 'smoking rock' };
            }
        }
        for (const npc of npcs) {
            if (WHIRLPOOL_NPC_IDS.includes(npc.id) && npc.distance <= 3) {
                return { kind: 'hazard', name: 'whirlpool' };
            }
        }

        this.gearLoss.update(
            FISHING_GEAR.filter(g => Inventory.contains(g)),
            Bank.isOpen() || Shop.isOpen(),
            Date.now()
        );
        for (const gear of FISHING_GEAR) {
            if (!this.gearLoss.recentlyLost(gear, Date.now()) || Inventory.contains(gear)) {
                continue;
            }
            const onGround = GroundItems.query()
                .where(g => (g.name?.toLowerCase() ?? '') === gear)
                .within(10)
                .nearest();
            if (onGround) {
                return { kind: 'lost-gear', name: gear };
            }
        }

        if (handleLocation(Inventory.items().map(i => i.name), Equipment.items().map(i => i.name)) !== null) {
            return { kind: 'lost-tool', name: 'lost tool' };
        }

        if (Inventory.contains('Strange box')) {
            return { kind: 'box', name: 'strange box' };
        }

        if (Inventory.contains('Lamp')) {
            return { kind: 'lamp', name: 'lamp' };
        }

        return null;
    }

    async handle(log: (msg: string) => void): Promise<boolean> {
        // Single-flight: frame guardian + Supervisor must not nest.
        if (this.handling) {
            return false;
        }
        this.handling = true;
        try {
            // detect/handle must never throw into ScriptRunner — a thrown error
            // marks the script crashed even when the maze/dialog later succeeds.
            return await this.handleInner(log);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`random event: handler error (continuing): ${msg}`);
            return false;
        } finally {
            this.handling = false;
        }
    }

    private async handleInner(log: (msg: string) => void): Promise<boolean> {
        const event = this.detect();
        if (!event) {
            return false;
        }

        const sig = `${event.kind}:${event.name}`;
        const n = (this.attempts.get(sig) ?? 0) + 1;
        this.attempts.set(sig, n);
        if (n > MAX_ATTEMPTS) {
            if (TRAPPED_KINDS.has(event.kind)) {
                log(`random event: ${event.name} — attempt ${n}; still inside the event map, so retrying instead of handing back to the script`);
            } else {
                this.attempts.delete(sig);
                this.cooldownUntil.set(sig, performance.now() + GIVE_UP_COOLDOWN_MS);
                log(
                    `random event: gave up on ${event.name} after ${MAX_ATTEMPTS} attempts — ignoring it for ${GIVE_UP_COOLDOWN_MS / 1000}s`
                );
                return false;
            }
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
                acted = await performMimeStage(log);
                break;
            case 'maze':
                acted = await solveMaze(log);
                break;
            case 'lost-tool':
                acted = await this.handleLostTool(log);
                break;
            case 'lost-gear':
                acted = await this.handleLostGear(event.name, log);
                break;
            case 'box':
                acted = await solveAllBoxes(log);
                break;
            case 'lamp':
                // Read Global.lampSkill each time so mid-run changes apply without restart.
                acted = await rubLamp(this.resolveLampSkill(), log);
                break;
            default:
                break;
        }

        let after: DetectedEvent | null = null;
        try {
            after = this.detectRaw();
        } catch {
            after = null;
        }
        if (!after || `${after.kind}:${after.name}` !== sig) {
            this.attempts.delete(sig);
        }
        return acted;
    }

    private async handleDialog(name: string, log: (msg: string) => void): Promise<boolean> {
        log(`random event: ${name} — talking through it`);
        const npc = Npcs.query()
            .where(n => (n.name?.toLowerCase() ?? '') === name)
            .nearest();
        if (!npc) {
            return false;
        }

        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 5000);

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
            const stillThere = reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name);
            if (!stillThere && !ChatDialog.isOpen()) {
                break;
            }
        }

        log(`random event: ${name} cleared`);
        return true;
    }

    private plantNotOurs(sinceText: string): boolean {
        for (const line of reader.chat(5)) {
            if (line.text === sinceText) {
                break;
            }
            if (/not here for you/i.test(line.text)) {
                return true;
            }
        }
        return false;
    }

    private async handlePick(name: string, log: (msg: string) => void): Promise<boolean> {
        const deadline = performance.now() + PICK_WAIT_MS;
        let announced = false;
        while (performance.now() < deadline) {
            const plant = Npcs.query()
                .where(n => (n.name?.toLowerCase() ?? '') === name)
                .nearest();
            if (!plant) {
                return true;
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
                const sinceText = reader.chat(1)[0]?.text ?? '';
                await plant.interact(op);
                await Execution.delayUntil(
                    () => Inventory.count('Strange fruit') > before
                        || !reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name)
                        || this.plantNotOurs(sinceText),
                    6000
                );
                if (this.plantNotOurs(sinceText)) {
                    this.cooldownUntil.set(`pick:${name}`, performance.now() + GIVE_UP_COOLDOWN_MS);
                    log(`random event: ${name} isn't ours ("it's not here for you") — ignoring it for ${GIVE_UP_COOLDOWN_MS / 1000}s`);
                    return true;
                }
                if (Inventory.count('Strange fruit') > before || !reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name)) {
                    log(`random event: ${name} — fruit picked`);
                    return true;
                }
            }
            await Execution.delayTicks(4);
        }
        log(`random event: ${name} — fruit never ripened in this pass; will retry`);
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
        await Execution.delayTicks(60);
        return true;
    }

    private async freeSlot(log: (msg: string) => void): Promise<void> {
        if (!Inventory.isFull()) {
            return;
        }
        const drop = pickSacrificial(Inventory.items().map(i => i.name));
        if (!drop) {
            log('random event: pack full and nothing sacrificial to drop — attempting recovery anyway');
            return;
        }
        const item = Inventory.first(drop);
        if (item) {
            log(`random event: dropping one ${drop} to free a slot`);
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 4000);
        }
    }

    private async handleLostTool(log: (msg: string) => void): Promise<boolean> {
        log('random event: lost tool — recovering the head');
        const where = handleLocation(Inventory.items().map(i => i.name), Equipment.items().map(i => i.name));
        if (where === null) {
            return false;
        }

        const wasWorn = where === 'worn';
        if (wasWorn) {
            const worn = Equipment.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
            await this.freeSlot(log);
            if (worn?.name != null && !(await Equipment.unequip(worn.name))) {
                log('random event: could not unequip the handle — will retry next pass');
                return false;
            }
        }

        const head = GroundItems.query()
            .where(g => /(axe|pickaxe) head/i.test(g.snap.name ?? ''))
            .within(12)
            .nearest();
        if (head) {
            await this.freeSlot(log);
            const before = Inventory.used();
            await head.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 6000);
        }

        const headItem = Inventory.items().find(i => /(axe|pickaxe) head/i.test(i.name ?? ''));
        const handleItem = Inventory.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
        if (!headItem || !handleItem) {
            log('random event: head or handle still missing — cannot reattach yet');
            return true;
        }
        const before = Inventory.used();
        await headItem.useOn(handleItem);
        if (!(await Execution.delayUntil(() => Inventory.used() < before, 5000))) {
            log('random event: reattach did not resolve');
            return true;
        }

        if (wasWorn) {
            const tool = Inventory.items().find(i => /(pickaxe|axe)$/i.test(i.name ?? '') && i.actions().some(o => /wield|wear/i.test(o)));
            if (tool?.name != null) {
                const rewielded = await Equipment.equip(tool.name);
                log(rewielded ? `random event: ${tool.name} reattached and re-wielded` : `random event: ${tool.name} reattached (re-wield failed — it stays in the pack)`);
                return true;
            }
        }
        log('random event: tool reattached');
        return true;
    }

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

}

/**
 * Detects and resolves random events.
 * Why: events are matched by NPC id rather than name, because names collide with ordinary monsters.
 * @see docs/reference/api-events.md
 */
export const RandomEvents = new RandomEventsImpl();

EventSignal.setProvider(() => RandomEvents.pending());
