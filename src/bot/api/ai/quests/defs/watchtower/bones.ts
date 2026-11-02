import { Fight, Retreat, type CombatHost } from '../../../../combat/hunting/combat.js';
import { TAVERLEY_BLUE } from '../../../../combat/hunting/sites.js';
import { acquireKey, bankRoutine, inCell, leaveCell, enterLair, leaveLair, SHIELD } from '../../../../combat/hunting/supply.js';
import { Banking } from '../../../../bank/Banking.js';
import { Bank } from '../../../../bank/Bank.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { questDone, wieldable } from '../../weapons.js';
import { WT_ITEM } from './areas.js';

const FOOD = 12;
const bonesHeld = (): boolean => Inventory.countById(WT_ITEM.DRAGON_BONES.id) > 0;
let bankPending = false;

export function dragonBankPending(): boolean {
    return bankPending;
}

export async function refreshDragonBank(log: (message: string) => void): Promise<boolean> {
    if (EventSignal.pending() || Skills.effective('hitpoints') <= 0) return false;
    if (!(await Banking.open({ stand: TAVERLEY_BLUE.bank, log }))) return false;
    await Bank.depositAllMatching((_name, id) => id !== WT_ITEM.DRAGON_BONES.id, log);
    if (Inventory.items().some(item => item.id !== WT_ITEM.DRAGON_BONES.id)) return false;
    bankPending = false;
    return true;
}

export function inDragonLair(tile: QuestSnapshot['tile']): boolean {
    return TAVERLEY_BLUE.inArea(tile ?? null)
        || !!tile && tile.level === 0 && tile.x >= 2928 && tile.x <= 2934 && tile.z >= 9683 && tile.z <= 9689;
}

function dragonHost(food: string, log: (message: string) => void): CombatHost {
    let weapon = '';
    let spot = 0;
    const hp = (): number => Skills.effective('hitpoints') / Math.max(1, Skills.level('hitpoints'));
    return {
        log, setStatus: () => {}, parkFor: log, countBankTrip: () => {},
        style: () => 'melee', foodName: () => food, foodWithdraw: () => FOOD,
        weaponName: () => weapon, ammoName: () => '', spellName: () => '',
        keepExtra: () => [WT_ITEM.DRAGON_BONES.name], leaveByWalk: () => true,
        pickWeapon: available => {
            const names = new Set(available.map(name => name.toLowerCase()));
            weapon = wieldable(Skills.level('attack'), questDone).find(item => names.has(item.name.toLowerCase()))?.name ?? '';
        },
        get died() { return Skills.effective('hitpoints') <= 0; },
        targetIdx: null, countKill: () => Execution.noteProgress(), countBurial: () => {},
        hpFraction: hp, panicHp: () => 0.35, retreatHp: () => 0.5,
        hasFood: () => Inventory.count(food) > 0,
        needEat: () => hp() < 0.65 && Inventory.count(food) > 0,
        eatOnce: async () => {
            const item = Inventory.first(food);
            const before = Inventory.count(food);
            return !!item && await item.interact('Eat')
                && await Execution.delayUntil(() => Inventory.count(food) < before, 3000);
        },
        shieldReady: () => Equipment.contains(SHIELD),
        buryBones: () => false, boneName: () => WT_ITEM.DRAGON_BONES.name,
        safespotIndex: () => spot, setSafespotIndex: index => { spot = index; }
    };
}

export async function leaveDragonLair(log: (message: string) => void): Promise<boolean> {
    const host = dragonHost(QuestFood.name || 'Lobster', log);
    if (EventSignal.pending() || host.died) return false;
    if (inCell() && !(await leaveCell(host))) return false;
    return leaveLair(host, TAVERLEY_BLUE);
}

export async function huntDragonBones(food: string, log: (message: string) => void): Promise<boolean> {
    const host = dragonHost(food, log);
    if (EventSignal.pending() || host.died) return false;
    if (bonesHeld()) return leaveDragonLair(log);
    if (inCell() && !(await leaveCell(host))) return false;
    bankPending = true;
    try {
        await bankRoutine(host, TAVERLEY_BLUE, { withdrawFood: true, depositInventory: true, healTo: 0.9 });
        if (EventSignal.pending() || host.died) return false;
        if (!host.shieldReady?.() || !host.weaponName() || !Equipment.contains(host.weaponName())) {
            log('need a Dragonfire shield and a usable one-handed weapon for the dragon-bone hunt');
            return false;
        }
        if (Inventory.count(food) < FOOD) {
            log(`need ${FOOD} ${food} for the dragon-bone hunt`);
            return false;
        }
        if (await acquireKey(host, TAVERLEY_BLUE) !== 'held' || EventSignal.pending() || host.died) return false;
        if (!host.shieldReady?.() || !host.hasFood()) return false;
        Game.setAutoRetaliate(false);
        if (!Game.setCombatStyle('strength')) return false;
        if (!(await enterLair(host, TAVERLEY_BLUE))) return false;
        const fight = new Fight(host, TAVERLEY_BLUE);
        const retreat = new Retreat(host, TAVERLEY_BLUE);
        const deadline = performance.now() + 300_000;
        for (let pass = 0; pass < 500 && performance.now() < deadline && !bonesHeld(); pass++) {
            if (EventSignal.pending() || host.died) return false;
            await Sustain.run();
            if (EventSignal.pending() || host.died) return false;
            if (retreat.validate()) await retreat.execute();
            if (host.needEat() && !(await host.eatOnce())) break;
            if (!host.shieldReady?.() || Inventory.count(food) < 3 || host.hpFraction() < host.panicHp()) break;
            if (!fight.blocksLoot()) {
                const drop = GroundItems.query().where(item => item.id === WT_ITEM.DRAGON_BONES.id).within(12).nearest();
                if (drop) {
                    if (Inventory.isFull() && !(await host.eatOnce())) break;
                    if (!(await drop.interact('Take')) || !(await Execution.delayUntil(bonesHeld, 6000))) break;
                    continue;
                }
            }
            if (fight.validate()) await fight.execute();
            else if (!(await Traversal.walkResilient(TAVERLEY_BLUE.meleeAnchor, { radius: 2, attempts: 2, timeoutMs: 30_000, log }))) break;
            await Execution.delayTicks(1);
        }
    } finally {
        if (!EventSignal.pending() && !host.died && await leaveDragonLair(log)) {
            await refreshDragonBank(log);
        }
    }
    return bonesHeld() && !bankPending && !TAVERLEY_BLUE.inArea(Game.tile());
}
