import { CLUE_DB, CASKET_IDS } from '../../api/ai/clues/data/cluedb.js';
import { bodyOrigin } from '../../api/combat/hunting/logic.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { damageMode } from './equipment.js';
import { meleeEdges, selectTarget } from './huntLogic.js';
import { compareLoot, lootPolicy } from './loot.js';
import { inSite } from './sites.js';
import type { Survival } from './survival.js';
import type { Counters, JiveSettings, JiveSite, Point } from './types.js';

export type HuntResult = 'hunting' | 'clue' | 'bank' | 'contention';
const clue = (id: number): boolean => CLUE_DB[id] !== undefined || CASKET_IDS[id] !== undefined;

export function meleeTile(npc: Npc, site: JiveSite): Tile | null {
    const o = bodyOrigin(npc.networkTile(), npc.size);
    const candidates = meleeEdges(o, npc.size, site.region.level).filter(edge => Reachability.canStep(edge.stand, edge.body)).map(edge => Tile.from(edge.stand));
    const here = Game.tile();
    return candidates.filter(t => inSite(site, t) && Reachability.canReach(t, { maxSteps: 256 }))
        .sort((a, b) => here ? a.distanceTo(here) - b.distanceTo(here) : 0)[0] ?? null;
}

export class Hunting {
    private target: { index: number; id: number; started: number; lastHp: number; progressed: number } | null = null;
    private idleSince = Date.now();
    private lastAttack = 0;
    species = '';

    constructor(readonly site: JiveSite, private readonly settings: JiveSettings, private readonly survival: Survival,
        private readonly counters: Counters, private readonly weapon: string, private readonly log: (message: string) => void) {}

    reset(): void { this.target = null; this.species = ''; this.idleSince = Date.now(); this.lastAttack = 0; }

    get fighting(): boolean { return this.target !== null; }

    async tick(): Promise<HuntResult> {
        if (Inventory.items().some(i => clue(i.id))) return 'clue';
        await this.survival.run({ phase: 'hunt', dragonfire: this.site.requirements.antifire, antipoison: this.site.requirements.antipoison });
        if (!inSite(this.site, Game.tile())) return 'bank';
        const current = this.target && Npcs.all().find(n => n.index === this.target!.index && n.id === this.target!.id);
        if (this.target && current?.health === 0 && current.snap.totalHealth > 0) {
            this.counters.kills++;
            this.target = null;
            this.idleSince = Date.now();
            await Execution.delayTicks(3);
        } else if (this.target && !current) {
            this.target = null;
        } else if (this.target && current) {
            if (current.health !== this.target.lastHp) { this.target.lastHp = current.health; this.target.progressed = Date.now(); }
            if (Date.now() - this.target.progressed > 90_000 || Date.now() - this.target.started > 180_000) return 'contention';
        }
        const ground = GroundItems.query().where(i => inSite(this.site, i.tile()) && i.distance() <= 14 && Reachability.canReach(i.tile())).results();
        const scroll = ground.find(i => clue(i.id));
        if (scroll) {
            if (Inventory.free() < 1) return 'bank';
            const before = Inventory.countById(scroll.id);
            if (await scroll.interact('Take') && await Execution.delayUntilTicks(() => Inventory.countById(scroll.id) > before, 4)) return 'clue';
            return Date.now() - this.idleSince >= 120_000 ? 'contention' : 'hunting';
        }
        if (!this.target && Date.now() - this.idleSince >= 120_000) return 'contention';
        if (!this.target) {
            const drops = ground.filter(i => lootPolicy(i.id, this.settings) !== 'leave')
                .sort((a, b) => compareLoot(a.id, b.id, this.settings));
            const item = drops[0];
            if (item) {
                if (Inventory.free() <= 1) return 'bank';
                const before = Inventory.countById(item.id);
                if (!(await item.interact('Take')) || !(await Execution.delayUntilTicks(() => Inventory.countById(item.id) > before, 4))) return 'hunting';
                this.idleSince = Date.now();
                if (lootPolicy(item.id, this.settings) === 'bury') {
                    const bone = Inventory.items().find(i => i.id === item.id && !i.noted);
                    const xp = Skills.xp('prayer');
                    const count = Inventory.countById(item.id);
                    if (bone && !(await bone.interact('Bury') && await Execution.delayUntilTicks(() => Inventory.countById(item.id) < count && Skills.xp('prayer') > xp, 4))) return 'bank';
                }
                return 'hunting';
            }
        }
        if (!this.target && (!this.survival.canStartFight() || Inventory.free() <= 1)) return 'bank';
        const targets = Npcs.all().flatMap(npc => {
            const species = this.site.targets.find(t => t.ids.includes(npc.id));
            if (!species || !inSite(this.site, npc.tile()) || !species.spawnTiles.some(t => distance(t, npc.networkTile()) <= 8)) return [];
            const tile = meleeTile(npc, this.site);
            return [{ npc, tile, species, index: npc.index, id: npc.id, distance: npc.distance(), chance: species.clueChance,
                killSeconds: /dragon/i.test(species.name) ? 45 : 25, reachable: tile !== null,
                engaged: npc.targetsAnotherPlayer() || (npc.inCombat && !npc.targetsMe()), valid: npc.health !== 0 || npc.snap.totalHealth <= 0 }];
        });
        const target = selectTarget(targets, this.target?.index ?? null);
        if (!target) return Date.now() - this.idleSince >= 120_000 ? 'contention' : 'hunting';
        if (this.target && target.index !== this.target.index) this.target = null;
        if (Date.now() - this.lastAttack < 6000 || (this.target && Date.now() - this.target.progressed < 6000)) return 'hunting';
        if (target.tile && Game.tile() && target.tile.distanceTo(Game.tile()!) > 0) {
            if (!(await Traversal.walkResilient(target.tile, { radius: 0, attempts: 1, timeoutMs: 8000 }))) return 'hunting';
        }
        await this.survival.run({ phase: 'hunt', dragonfire: this.site.requirements.antifire, antipoison: this.site.requirements.antipoison });
        const live = Npcs.all().find(n => n.index === target.index && n.id === target.id && !n.targetsAnotherPlayer());
        const here = Game.tile();
        if (!live || !here || !inSite(this.site, here) || !inSite(this.site, live.networkTile())
            || !meleeEdges(bodyOrigin(live.networkTile(), live.size), live.size, here.level).some(edge => Tile.from(edge.stand).equals(here) && Reachability.canStep(edge.stand, edge.body))) return 'hunting';
        const mode = damageMode(this.weapon, target.species.defences);
        if (Game.combatMode() !== mode && !(Game.setCombatMode(mode) && await Execution.delayUntilTicks(() => Game.combatMode() === mode, 3))) return 'bank';
        this.lastAttack = Date.now();
        if (await live.interact('Attack')) {
            this.idleSince = Date.now();
            this.target ??= { index: live.index, id: live.id, started: Date.now(), lastHp: live.health, progressed: Date.now() };
            this.species = live.name ?? String(live.id);
            this.log(`Fighting ${this.species}`);
        }
        return 'hunting';
    }
}

function distance(a: Point, b: Point): number { return a.level === b.level ? Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) : Infinity; }
