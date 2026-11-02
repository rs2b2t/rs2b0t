import { reader } from '../../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import type { QuestSnapshot } from '../../engine/types.js';

export const GOBLIN_FARM = new Tile(2958, 3507, 0);
const REATTACK_MS = 5000;
const STALL_MS = 30_000;
const ENCOUNTER_MS = 60_000;
const REJECT_MS = 15_000;
const EAT_ANIM = 829;
let targetIndex: number | null = null;
let rejectedIndex: number | null = null;
let rejectedUntil = 0;
let owner: string | null = null;

export function resetGoblinMailCombat(): void {
    targetIndex = null;
    rejectedIndex = null;
    rejectedUntil = 0;
    owner = null;
}

export function inGoblinMailField(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.level === GOBLIN_FARM.level
        && Math.max(Math.abs(tile.x - GOBLIN_FARM.x), Math.abs(tile.z - GOBLIN_FARM.z)) <= 18;
}

function dead(npc: Npc): boolean {
    return npc.health === 0 && npc.snap.totalHealth > 0;
}

function nearby(): Npc[] {
    return Npcs.all().filter(npc => npc.name === 'Goblin' && npc.actions().some(action => /^attack$/i.test(action))
        && npc.distance() <= 15 && inGoblinMailField(npc.tile()));
}

function combatXp(): number {
    return ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints'].reduce((sum, skill) => sum + Skills.xp(skill), 0);
}

async function takeMail(): Promise<boolean | null> {
    const drop = GroundItems.query().name('Goblin mail').within(15).nearest();
    if (!drop) return null;
    targetIndex = null;
    const before = Inventory.count('Goblin mail');
    if (!(await drop.interact('Take'))) return false;
    return Execution.delayUntil(() => Inventory.count('Goblin mail') > before, 6000);
}

function reject(index: number): void {
    rejectedIndex = index;
    rejectedUntil = performance.now() + REJECT_MS;
    targetIndex = null;
}

export async function farmGoblinMail(log: (message: string) => void): Promise<boolean> {
    if (owner !== Game.myName() || !inGoblinMailField(Game.tile())) {
        resetGoblinMailCombat();
        owner = Game.myName();
    }
    if (EventSignal.pending()) return false;
    const taken = await takeMail();
    if (taken !== null) return taken;
    const available = nearby().filter(npc => !dead(npc) && !npc.targetsAnotherPlayer()
        && !(npc.index === rejectedIndex && performance.now() < rejectedUntil));
    const candidates = available.filter(npc => Reachability.probeable(npc.tile())
        && Reachability.canReach(npc.tile(), { adjacentOk: true, maxSteps: 4096 }));
    const nearest = (npcs: Npc[]): Npc | undefined => npcs.sort((a, b) => a.distance() - b.distance())[0];
    const goblin = nearest(candidates.filter(npc => npc.targetsMe()))
        ?? candidates.find(npc => npc.index === targetIndex)
        ?? nearest(candidates.filter(npc => !npc.inCombat));
    if (!goblin) {
        targetIndex = null;
        const unknown = nearest(available.filter(npc => !Reachability.probeable(npc.tile())
            && (!npc.inCombat || npc.targetsMe())));
        await Traversal.walkResilient(unknown?.tile() ?? GOBLIN_FARM, { radius: unknown ? 1 : 4, attempts: 2, timeoutMs: 90_000, log });
        await Execution.delayTicks(1);
        return false;
    }
    targetIndex = goblin.index;
    log(`holding Goblin ${goblin.index} until it dies`);
    const deadline = performance.now() + ENCOUNTER_MS;
    let lastOffenseAt = performance.now();
    let lastAttackAt: number | null = null;
    let selfAnim = reader.selfAnim();
    let npcAnim = goblin.snap.anim;
    let health = goblin.health;
    let hp = Skills.effective('hitpoints');
    let xp = combatXp();
    while (performance.now() < deadline && !EventSignal.pending()) {
        await Sustain.run();
        if (EventSignal.pending()) return false;
        const live = Npcs.all().find(npc => npc.index === targetIndex && npc.id === goblin.id && npc.name === 'Goblin');
        if (!live || dead(live)) {
            const killed = live !== undefined && dead(live);
            targetIndex = null;
            if (killed) Execution.noteProgress();
            await Execution.delayTicks(2);
            if (EventSignal.pending()) return false;
            const looted = await takeMail();
            return killed || looted === true;
        }
        if (live.distance() > 15 || !inGoblinMailField(live.tile())) {
            reject(live.index);
            return false;
        }
        if (live.targetsAnotherPlayer()) {
            log(`Goblin ${live.index} belongs to another player — releasing it`);
            reject(live.index);
            return false;
        }
        const now = performance.now();
        const nextSelfAnim = reader.selfAnim();
        const nextNpcAnim = live.snap.anim;
        const nextXp = combatXp();
        const nextHp = Skills.effective('hitpoints');
        const swinging = reader.selfFaceEntity() === live.index && nextSelfAnim !== -1
            && nextSelfAnim !== EAT_ANIM && nextSelfAnim !== selfAnim;
        const offense = swinging || nextXp > xp || live.health < health;
        if (offense) lastOffenseAt = now;
        if (offense || nextHp < hp || (live.targetsMe() && nextNpcAnim !== -1 && nextNpcAnim !== npcAnim)) {
            Execution.noteProgress();
        }
        selfAnim = nextSelfAnim;
        npcAnim = nextNpcAnim;
        health = live.health;
        hp = nextHp;
        xp = nextXp;
        if (now - lastOffenseAt >= STALL_MS) {
            log(`no attacks, damage, or XP against Goblin ${live.index} for ${STALL_MS / 1000}s — choosing another target`);
            reject(live.index);
            return false;
        }
        if (lastAttackAt === null || (now - lastAttackAt >= REATTACK_MS && now - lastOffenseAt >= REATTACK_MS)) {
            if (!(await live.interact('Attack'))) {
                reject(live.index);
                return false;
            }
            lastAttackAt = now;
        }
        await Execution.delayTicks(1);
    }
    return false;
}
