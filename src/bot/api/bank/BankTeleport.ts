import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { resolveDangerZones } from '../../event/webwalk/data/dangerZones.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { snapshotWorldStateData } from '../../event/webwalk/worldStateLive.js';
import { virtualizeWithItems } from '../../event/webwalk/virtualState.js';
import { Banking } from './Banking.js';
import { SPELL_TELEPORTS, teleportAllowedFromOrigin } from '../../event/webwalk/teleportCatalog.js';
import { executeTeleportHop } from '../../event/webwalk/teleportExecute.js';
import { Game } from '../game/Game.js';
import { Inventory } from '../inventory/Inventory.js';
import { Skills } from '../skills/Skills.js';
import { Quests } from '../ui/questlog/Quests.js';
import { Bank } from './Bank.js';
import { Traversal, NAV_PURE_WALK, type WalkResilientOptions } from '../walking/Traversal.js';
import Tile from '../../geometry/Tile.js';

export const BANK_TELEPORT_OPTIONS = ['Off', 'Varrock', 'Falador', 'Camelot', 'Ardougne'];
export const bankTeleportSpec = (name: string) => SPELL_TELEPORTS.find(spell => spell.teleportId === name.toLowerCase());
export const bankTeleportSupplies = (name: string) => (bankTeleportSpec(name)?.requires?.items ?? []).map(item => ({ item: item.name, count: item.count }));

export const BankTeleport = {
    unlocked(name: string): boolean {
        const spell = bankTeleportSpec(name);
        return !!spell && (spell.requires?.skills ?? []).every(skill => Skills.effective(skill.name) >= skill.level)
            && (spell.requires?.quests ?? []).every(quest => Quests.status(quest.quest) === 'complete');
    },

    async depart(to: WorldTile, keep: readonly { item: string; count: number }[], zones: WalkResilientOptions['avoidZones'], log: (message: string) => void): Promise<boolean> {
        const here = Game.tile();
        if (!here || Skills.effective('magic') < 25 || !Bank.count('Law rune') || Tile.from(here).distanceTo(to) <= 12) return Bank.close();
        const available: Record<string, number> = {};
        for (const item of ['Law rune', 'Air rune', 'Earth rune', 'Water rune', 'Fire rune']) {
            const required = Math.max(0, ...keep.filter(need => need.item.toLowerCase() === item.toLowerCase()).map(need => need.count));
            available[item] = Bank.count(item) - Math.max(0, required - Inventory.count(item));
        }
        const allowTeleportIds = SPELL_TELEPORTS.filter(spell => {
            const needs = bankTeleportSupplies(spell.teleportId);
            return this.unlocked(spell.teleportId) && teleportAllowedFromOrigin(spell, here).ok
                && needs.every(need => available[need.item] >= need.count)
                && needs.filter(need => !Inventory.count(need.item)).length <= Inventory.free();
        }).map(spell => spell.teleportId);
        if (!allowTeleportIds.length) return Bank.close();
        const route = await Navigator.findPath(here, to, {
            state: virtualizeWithItems(snapshotWorldStateData(), available), policy: { useTeleports: true, allowTeleportIds },
            avoidZones: resolveDangerZones(zones, { includeAutomatic: true, combatLevel: reader.combatLevel(), start: here, destination: to })
        });
        const hop = route.ok && route.waypoints.find(point => point.transport?.teleportId)?.transport;
        if (!hop || !hop.teleportId || !allowTeleportIds.includes(hop.teleportId)) return Bank.close();
        const needs = bankTeleportSupplies(hop.teleportId).map(need => ({ ...need, before: Inventory.count(need.item) }));
        for (const need of needs) {
            if (!(await Bank.withdrawX(need.item, need.count))) break;
        }
        if (needs.every(need => Inventory.count(need.item) >= need.before + need.count)) {
            if (!(await Bank.close())) return false;
            if (await executeTeleportHop(hop, log)) return true;
            if (!(await Banking.open({ preferNearby: true, avoidZones: zones, log }))) return false;
        }
        for (const need of needs) {
            const extra = Inventory.count(need.item) - need.before;
            const stack = extra > 0 && Inventory.first(need.item);
            if (stack && !(await Bank.depositXById(stack.id, extra))) return false;
        }
        return Bank.close();
    },

    async stock(name: string): Promise<void> {
        if (!this.unlocked(name)) return;
        const needs = bankTeleportSupplies(name);
        if (needs.some(need => Inventory.count(need.item) + Bank.count(need.item) < need.count)) return;
        if (needs.filter(need => Inventory.count(need.item) === 0).length > Inventory.free()) return;
        for (const need of needs) {
            const missing = need.count - Inventory.count(need.item);
            if (missing > 0) await Bank.withdrawX(need.item, missing);
        }
    },

    async cast(name: string, log: (message: string) => void, leaveDeepWilderness = false): Promise<boolean> {
        const spell = bankTeleportSpec(name);
        let here = Game.tile();
        if (!spell || !here || !this.unlocked(name)) return false;
        if (here.level === spell.to.level && Math.max(Math.abs(here.x - spell.to.x), Math.abs(here.z - spell.to.z)) < 40) return false;
        if (bankTeleportSupplies(name).some(need => Inventory.count(need.item) < need.count)) return false;
        if (!teleportAllowedFromOrigin(spell, here).ok && leaveDeepWilderness && here.level === 0 && here.z >= 3520 && here.z < 4000) {
            if (!(await Traversal.walkResilient(new Tile(here.x, 3660, 0), { ...NAV_PURE_WALK, radius: 3, attempts: 3, timeoutMs: 120000, log }))) return false;
            here = Game.tile();
        }
        if (!here || !teleportAllowedFromOrigin(spell, here).ok) return false;
        const landed = await executeTeleportHop({ kind: 'teleport', teleportId: spell.teleportId, action: 'Cast', locName: spell.label,
            locX: 0, locZ: 0, toTile: spell.to, toLevel: spell.to.level }, log);
        if (!landed) log(`${name} teleport unavailable; walking to the bank`);
        return landed;
    }
};
