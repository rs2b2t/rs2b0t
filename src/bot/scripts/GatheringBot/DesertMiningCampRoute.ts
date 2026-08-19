import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import Tile from '../../geometry/Tile.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { desertCampFoodReserveDepleted } from './MinerLogic.js';

export const DESERT_CAMP_ITEMS = {
    coins: 'Coins',
    pass: 'Shantay pass',
    disclaimer: 'Shantay disclaimer',
    cellKey: 'Cell door key',
    metalKey: 'Metal key',
    wroughtKey: 'Wrought iron key',
    desert: ['Desert shirt', 'Desert robe', 'Desert boots'],
    slave: ["Slaves' shirt", 'Slave robe', 'Slave boots']
} as const;

type DesertOutfitItem = (typeof DESERT_CAMP_ITEMS.desert)[number];

export const DESERT_CAMP_UNDERGROUND_NAME = 'Desert Mining Camp';
export const DESERT_CAMP_SURFACE_NAME = 'Desert Mining Camp Surface';

export type DesertCampDestination = 'campSurface' | 'mineDeep';

export function isDesertCampLocation(name: string | null | undefined): boolean {
    return name === DESERT_CAMP_UNDERGROUND_NAME || name === DESERT_CAMP_SURFACE_NAME;
}

export function desertCampDestinationFor(name: string | null | undefined): DesertCampDestination {
    return name === DESERT_CAMP_SURFACE_NAME ? 'campSurface' : 'mineDeep';
}

export const DESERT_CAMP_KEEP_NAMES = [DESERT_CAMP_ITEMS.pass, DESERT_CAMP_ITEMS.disclaimer, DESERT_CAMP_ITEMS.cellKey, DESERT_CAMP_ITEMS.metalKey, DESERT_CAMP_ITEMS.wroughtKey, ...DESERT_CAMP_ITEMS.slave] as const;

export function desertCampKeepNames(destination: DesertCampDestination): readonly string[] {
    return destination === 'campSurface'
        ? [DESERT_CAMP_ITEMS.pass, DESERT_CAMP_ITEMS.disclaimer, DESERT_CAMP_ITEMS.metalKey, ...DESERT_CAMP_ITEMS.desert]
        : DESERT_CAMP_KEEP_NAMES;
}

const DESERT_SHOP_BUDGET: Record<DesertOutfitItem, number> = {
    'Desert shirt': 43,
    'Desert robe': 43,
    'Desert boots': 21
};
const FIXED_PASS_COST = 5;

const SHANTAY_SHOP = new Tile(3304, 3123, 0);
const SHANTAY_BANK = new Tile(3308, 3120, 0);
const SHANTAY_NORTH = new Tile(3304, 3118, 0);
const SHANTAY_SOUTH = new Tile(3304, 3114, 0);
const CAPTAIN = new Tile(3270, 3029, 0);
const CAMP_OUTSIDE = new Tile(3273, 3029, 0);
const CAMP_INSIDE = new Tile(3274, 3029, 0);
const MALE_SLAVE = new Tile(3302, 3016, 0);
const SIAD_DESK = new Tile(3290, 3033, 1);
export const DESERT_CAMP_MINE_ANCHOR = new Tile(3323, 9458, 0);

const NPC = { maleSlave: 825, escapedSlave: 826, mercenaryCaptain: 830 } as const;
const LOC = { siadDesk: 2679 } as const;
const CAPTAIN_KEY_DUEL = [
    'Wow! A real captain!',
    "I'd love to work for a tough guy like you!",
    "Can't I do something for a strong Captain like you?",
    "Sorry Sir, I don't think I can do that.",
    "It's a funny captain who can't fight his own battles!"
] as const;

export type DesertCampRouteArea = 'mainland' | 'shantayNorth' | 'desert' | 'campSurface' | 'mineEntrance' | 'mineLower' | 'mineDeep' | 'unsupported';

export function desertCampRouteArea(tile: WorldTile | null): DesertCampRouteArea {
    if (!tile) return 'unsupported';
    if (tile.level === 1 && tile.x >= 3274 && tile.x <= 3306 && tile.z >= 3011 && tile.z <= 3043) {
        return 'campSurface';
    }
    if (tile.level !== 0) return 'unsupported';
    if (tile.x >= 3284 && tile.x <= 3286 && tile.z >= 3032 && tile.z <= 3036) return 'unsupported';
    if (tile.x >= 3274 && tile.x <= 3306 && tile.z >= 3011 && tile.z <= 3043) return 'campSurface';
    if (tile.x >= 3264 && tile.x <= 3327 && tile.z >= 9408 && tile.z <= 9471) {
        if (tile.x <= 3282) return 'mineEntrance';
        if (tile.x >= 3285 && tile.x <= 3292 && tile.z >= 9429 && tile.z <= 9452) return 'unsupported';
        if (tile.z >= 9449) return 'mineDeep';
        return 'mineLower';
    }
    if (tile.z >= 6400) return 'unsupported';
    if (tile.x >= 3288 && tile.x <= 3320 && tile.z >= 3117 && tile.z <= 3140) return 'shantayNorth';
    if (tile.x >= 3136 && tile.x <= 3375 && tile.z >= 2880 && tile.z < 3117) return 'desert';
    return 'mainland';
}

export type DesertCampRouteDirection = 'enter' | 'exit';
export type DesertCampRoutePhase = 'prepareAndCrossShantay' | 'enterCamp' | 'enterMine' | 'exitMine' | 'exitCamp' | 'crossShantayNorth' | 'done' | 'unsupported';

export function desertCampBankTripDirection(
    bankTrip: boolean,
    needsBank: boolean
): {
    bankTrip: boolean;
    direction: DesertCampRouteDirection;
} {
    const latched = bankTrip || needsBank;
    return { bankTrip: latched, direction: latched ? 'exit' : 'enter' };
}

export function desertCampBankCatchNeeded(bankTrip: boolean, startupBank: boolean, restock: boolean, fullWithDeposit: boolean): boolean {
    return bankTrip || startupBank || restock || fullWithDeposit;
}

export function desertCampRoutePhase(
    direction: DesertCampRouteDirection,
    area: DesertCampRouteArea,
    destination: DesertCampDestination = 'mineDeep'
): DesertCampRoutePhase {
    if (area === 'unsupported') return 'unsupported';
    if (direction === 'enter') {
        if (area === 'mainland' || area === 'shantayNorth') return 'prepareAndCrossShantay';
        if (area === 'desert') return 'enterCamp';
        if (destination === 'campSurface') {
            if (area === 'campSurface') return 'done';
            if (area === 'mineEntrance' || area === 'mineLower' || area === 'mineDeep') return 'exitMine';
            return 'unsupported';
        }
        if (area === 'campSurface') return 'enterMine';
        return area === 'mineDeep' ? 'done' : 'enterMine';
    }
    if (area === 'mineDeep' || area === 'mineLower' || area === 'mineEntrance') return 'exitMine';
    if (area === 'campSurface') return 'exitCamp';
    if (area === 'desert') return 'crossShantayNorth';
    return 'done';
}

export interface DesertCampSupplySnapshot {
    inventory: Readonly<Record<string, number>>;
    equipment: Readonly<Record<string, number>>;
    bank: Readonly<Record<string, number>>;
    freeSlots: number;
}

export interface DesertCampSupplyPlan {
    ok: boolean;
    withdraw: { name: string; qty: number }[];
    buyOutfit: DesertOutfitItem[];
    buyPass: boolean;
    recoverSlaveOutfit: boolean;
    recoverMetalKey: boolean;
    recoverWroughtKey: boolean;
    coinTarget: number;
    requiredSlots: number;
    missing: string[];
}

function countOf(counts: Readonly<Record<string, number>>, name: string): number {
    const wanted = name.toLowerCase();
    return Object.entries(counts)
        .filter(([candidate]) => candidate.toLowerCase() === wanted)
        .reduce((sum, [, count]) => sum + count, 0);
}

function owned(snap: DesertCampSupplySnapshot, name: string): boolean {
    return countOf(snap.inventory, name) + countOf(snap.equipment, name) > 0;
}

function available(snap: DesertCampSupplySnapshot, name: string): number {
    return countOf(snap.inventory, name) + countOf(snap.equipment, name) + countOf(snap.bank, name);
}

export function planDesertCampSupplies(
    snap: DesertCampSupplySnapshot,
    destination: DesertCampDestination = 'mineDeep'
): DesertCampSupplyPlan {
    const withdraw: { name: string; qty: number }[] = [];
    const buyOutfit: DesertOutfitItem[] = [];
    const missing: string[] = [];
    const surface = destination === 'campSurface';

    const recoverSlaveOutfit = !surface && DESERT_CAMP_ITEMS.slave.some(name => available(snap, name) === 0);
    if (!surface && !recoverSlaveOutfit) {
        for (const name of DESERT_CAMP_ITEMS.slave) {
            if (!owned(snap, name)) withdraw.push({ name, qty: 1 });
        }
    }

    // Why: underground trips bank desert clothes and only withdraw them to buy
    // a replacement slave disguise. Surface trips wear desert clothes for heat.
    const desertTarget = surface || recoverSlaveOutfit ? 1 : 0;
    for (const name of DESERT_CAMP_ITEMS.desert) {
        const held = countOf(snap.inventory, name) + countOf(snap.equipment, name);
        const needed = Math.max(0, desertTarget - held);
        const banked = Math.min(needed, countOf(snap.bank, name));
        if (banked > 0) withdraw.push({ name, qty: banked });
        for (let copy = banked; copy < needed; copy++) buyOutfit.push(name);
    }

    const planKey = (name: string): boolean => {
        if (owned(snap, name)) return false;
        if (countOf(snap.bank, name) > 0) {
            withdraw.push({ name, qty: 1 });
            return false;
        }
        return true;
    };
    const recoverMetalKey = planKey(DESERT_CAMP_ITEMS.metalKey);
    const recoverWroughtKey = surface ? false : planKey(DESERT_CAMP_ITEMS.wroughtKey);

    let buyPass = false;
    if (countOf(snap.inventory, DESERT_CAMP_ITEMS.pass) === 0) {
        if (countOf(snap.bank, DESERT_CAMP_ITEMS.pass) > 0) {
            withdraw.push({ name: DESERT_CAMP_ITEMS.pass, qty: 1 });
        } else {
            buyPass = true;
        }
    }

    const coinTarget = buyOutfit.reduce((sum, name) => sum + DESERT_SHOP_BUDGET[name], 0) + (buyPass ? FIXED_PASS_COST : 0);
    const heldCoins = countOf(snap.inventory, DESERT_CAMP_ITEMS.coins);
    const coinShortage = Math.max(0, coinTarget - heldCoins);
    if (coinShortage > countOf(snap.bank, DESERT_CAMP_ITEMS.coins)) {
        missing.push(`${coinTarget} ${DESERT_CAMP_ITEMS.coins} for Shantay purchases`);
    } else if (coinShortage > 0) {
        withdraw.push({ name: DESERT_CAMP_ITEMS.coins, qty: coinShortage });
    }

    let requiredSlots = withdraw.reduce((slots, step) => slots + (step.name === DESERT_CAMP_ITEMS.coins && countOf(snap.inventory, step.name) > 0 ? 0 : step.name === DESERT_CAMP_ITEMS.coins ? 1 : step.qty), 0);
    requiredSlots += buyOutfit.length;
    if (buyPass && countOf(snap.inventory, DESERT_CAMP_ITEMS.pass) === 0) requiredSlots++;
    // Desk awards every missing key, so surface metal recovery still reserves three slots.
    if (recoverMetalKey && (recoverWroughtKey || surface)) {
        requiredSlots += 3;
    } else if (recoverWroughtKey) {
        requiredSlots += countOf(snap.inventory, DESERT_CAMP_ITEMS.cellKey) > 0 ? 1 : 2;
    } else if (recoverMetalKey) {
        requiredSlots += 1;
    }

    if (requiredSlots > snap.freeSlots) {
        missing.push(`${requiredSlots - snap.freeSlots} free inventory slot(s)`);
    }
    return {
        ok: missing.length === 0,
        withdraw,
        buyOutfit,
        buyPass,
        recoverSlaveOutfit,
        recoverMetalKey,
        recoverWroughtKey,
        coinTarget,
        requiredSlots,
        missing
    };
}

export interface DesertMiningCampRouteHost {
    log(message: string): void;
    setStatus(message: string): void;
    stop(reason: string): void;
    foodCount(): number;
}

export function metalKeyDuelNeedsRetreat(foodCount: number, captainAlive: boolean): boolean {
    return captainAlive && desertCampFoodReserveDepleted(foodCount);
}

export function metalKeyCaptainAvailable(
    captain: { inCombat: boolean; targetsAnotherPlayer(): boolean } | null
): boolean {
    return captain !== null && !captain.inCombat && !captain.targetsAnotherPlayer();
}

export function metalKeyRetreatAfterSustain(
    hasKey: boolean,
    foodCount: number,
    captainAlive: boolean
): boolean {
    return !hasKey && metalKeyDuelNeedsRetreat(foodCount, captainAlive);
}

export function metalKeyCaptainClaimAcknowledged(
    chatOpen: boolean,
    captainTargetsMe: boolean,
    hasKey: boolean
): boolean {
    return chatOpen || captainTargetsMe || hasKey;
}

function liveCounts(items: { name: string | null; count: number }[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) {
        if (item.name) out[item.name] = (out[item.name] ?? 0) + Math.max(1, item.count);
    }
    return out;
}

function equipmentCount(name: string): number {
    const wanted = name.toLowerCase();
    return Equipment.items()
        .filter(item => item.name?.toLowerCase() === wanted)
        .reduce((sum, item) => sum + item.count, 0);
}

function questComplete(): boolean {
    return Quests.status('The Tourist Trap') === 'complete' || Quests.status('Tourist Trap') === 'complete';
}

function pickaxeName(items: { name: string | null }[]): string | null {
    return items.find(item => /pickaxe$/i.test(item.name ?? ''))?.name ?? null;
}

export class DesertMiningCampRoute {
    constructor(
        private readonly host: DesertMiningCampRouteHost,
        readonly destination: DesertCampDestination = 'mineDeep'
    ) {}

    area(): DesertCampRouteArea {
        return desertCampRouteArea(Game.tile());
    }

    phase(direction: DesertCampRouteDirection): DesertCampRoutePhase {
        return desertCampRoutePhase(direction, this.area(), this.destination);
    }

    needsStep(direction: DesertCampRouteDirection): boolean {
        return this.phase(direction) !== 'done';
    }

    planSuppliesAtOpenBank(): DesertCampSupplyPlan {
        if (!Bank.isOpen() || !Bank.snapshotReady()) {
            throw new Error('desert camp: supply planning requires an authoritative open bank snapshot');
        }
        return planDesertCampSupplies(
            {
                inventory: liveCounts(Inventory.items()),
                equipment: liveCounts(Equipment.items()),
                bank: liveCounts(Bank.items()),
                freeSlots: Inventory.free()
            },
            this.destination
        );
    }

    async withdrawPlannedSuppliesAtOpenBank(plan: DesertCampSupplyPlan): Promise<boolean> {
        if (!Bank.isOpen() || !Bank.snapshotReady()) {
            return this.fail('desert camp: route withdrawal requires an authoritative open bank snapshot');
        }
        for (const step of plan.withdraw) {
            const before = Inventory.count(step.name);
            if (!(await Bank.withdrawX(step.name, step.qty))) {
                return this.fail(`desert camp: failed to withdraw ${step.qty} ${step.name}`);
            }
            if (!(await Execution.delayUntilTicks(() => Inventory.count(step.name) >= before + step.qty, 7))) {
                return this.fail(`desert camp: withdrawal did not land for ${step.name}`);
            }
        }
        if (this.destination === 'mineDeep' && !plan.recoverSlaveOutfit && !(await this.bankOptionalDesertOutfit())) return false;
        this.host.log(
            `desert camp: route supplies ready; withdraw=${plan.withdraw.map(step => `${step.qty} ${step.name}`).join(', ') || 'none'}; ` +
                `buyOutfit=${plan.buyOutfit.join(', ') || 'none'}; buyPass=${plan.buyPass}; ` +
                `recoverSlave=${plan.recoverSlaveOutfit}; recoverMetal=${plan.recoverMetalKey}; ` +
                `recoverWrought=${plan.recoverWroughtKey}; slots=${plan.requiredSlots}`
        );
        return true;
    }

    private async bankOptionalDesertOutfit(): Promise<boolean> {
        const optionalWasHeld = DESERT_CAMP_ITEMS.desert.some(name => Inventory.contains(name) || Equipment.contains(name));
        const depositPackCopies = async (): Promise<boolean> => {
            if (!Bank.isOpen()) {
                this.host.log('desert camp: reopening Shantay bank after removing a worn desert item');
                if (!(await Banking.open({ stand: SHANTAY_BANK, log: message => this.host.log(`  ${message}`) }))) {
                    return this.fail('desert camp: could not reopen Shantay bank for the removed desert outfit');
                }
                if (!(await Execution.delayUntilTicks(() => Bank.snapshotReady(), 7))) {
                    return this.fail('desert camp: reopened Shantay bank did not produce an authoritative item snapshot');
                }
            }
            await Bank.depositAllMatching(name => DESERT_CAMP_ITEMS.desert.some(item => item.toLowerCase() === name.toLowerCase()));
            if (!(await Execution.delayUntilTicks(() => DESERT_CAMP_ITEMS.desert.every(name => !Inventory.contains(name)), 7))) {
                return this.fail(`desert camp: bank did not accept optional desert outfit: ${DESERT_CAMP_ITEMS.desert.filter(name => Inventory.contains(name)).join(', ')}`);
            }
            return true;
        };

        if (!(await depositPackCopies())) return false;
        for (const name of DESERT_CAMP_ITEMS.desert) {
            if (!Equipment.contains(name)) continue;
            if (Bank.isOpen() && !(await Bank.close())) {
                return this.fail(`desert camp: could not close Shantay bank before removing optional '${name}'`);
            }
            if (!(await Execution.delayUntilTicks(() => !Bank.isOpen(), 5))) {
                return this.fail(`desert camp: Shantay bank stayed open before removing optional '${name}'`);
            }
            if (Inventory.free() < 1) return this.fail(`desert camp: no free slot to remove optional '${name}' at Shantay bank`);
            if (!(await Equipment.unequip(name))) return this.fail(`desert camp: could not remove optional '${name}' at Shantay bank`);
            if (!(await Execution.delayUntilTicks(() => Inventory.contains(name), 7))) {
                return this.fail(`desert camp: removed optional '${name}' did not reach the backpack`);
            }
            if (!(await depositPackCopies())) return false;
        }
        if (!Bank.isOpen()) return this.fail('desert camp: Shantay bank closed while removing the optional desert outfit');
        if (optionalWasHeld) this.host.log('desert camp: banked optional desert outfit; normal trips wear the slave disguise');
        return true;
    }

    async runStep(direction: DesertCampRouteDirection): Promise<boolean> {
        const statuses = [Quests.status('The Tourist Trap'), Quests.status('Tourist Trap')];
        if (statuses.every(status => status === 'unknown')) {
            this.host.log('desert camp: Tourist Trap status unavailable — waiting for the quest list');
            await Execution.delayTicks(1);
            return false;
        }
        if (!questComplete()) return this.fail('desert camp: The Tourist Trap must be complete');
        const area = this.area();
        const phase = desertCampRoutePhase(direction, area, this.destination);
        this.host.log(`desert camp: route ${direction}; dest=${this.destination}; area=${area}; phase=${phase}; tile=${this.tileLabel()}`);
        this.host.setStatus(`desert camp: ${phase}`);
        if (phase === 'unsupported') return this.fail(`desert camp: unsupported route tile ${this.tileLabel()}`);
        if (phase === 'done') return true;
        if (phase === 'exitMine' && direction === 'enter') return this.exit(area);

        if (direction === 'enter') return this.enter(area);
        return this.exit(area);
    }

    private async enter(area: DesertCampRouteArea): Promise<boolean> {
        if (area === 'mainland' || area === 'shantayNorth') {
            if (!(await this.finishShantayProvisioning())) return false;
            if (!(await this.wearTravelOutfit())) return false;
            if (!(await this.walk(SHANTAY_SOUTH, 1, 'Kharidian desert', 'desert'))) return false;
            this.host.log(`desert camp: shared walk completed Shantay south; tile=${this.tileLabel()}`);
            return true;
        }

        if (area === 'desert') {
            if (!(await this.wearTravelOutfit())) return false;
            if (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey) && !(await this.recoverMetalKey())) return false;
            if (!(await this.walk(CAMP_INSIDE, 0, 'mining-camp surface', 'campSurface'))) return false;
            this.host.log(`desert camp: shared walk completed outer gate in; tile=${this.tileLabel()}`);
            return true;
        }

        if (area === 'campSurface') {
            if (this.destination === 'campSurface') {
                if (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey) && !(await this.recoverDeskKeys())) return false;
                if (!(await this.wear(DESERT_CAMP_ITEMS.desert, 'desert travel outfit'))) return false;
                this.host.log(`desert camp: surface destination reached; tile=${this.tileLabel()}`);
                return true;
            }
            if (!Inventory.contains(DESERT_CAMP_ITEMS.wroughtKey) && !(await this.recoverDeskKeys())) return false;
            if (!this.hasSlaveOutfit() && !(await this.recoverSlaveOutfit())) return false;
            if (!(await this.wear(DESERT_CAMP_ITEMS.slave, 'slave disguise'))) return false;
            if (!(await this.walk(DESERT_CAMP_MINE_ANCHOR, 4, 'deep mine', 'mineDeep'))) return false;
            this.host.log(`desert camp: shared walk completed camp surface → deep mine; tile=${this.tileLabel()}`);
            return true;
        }

        if (area === 'mineEntrance' || area === 'mineLower') {
            if (!(await this.wear(DESERT_CAMP_ITEMS.slave, 'slave disguise'))) return false;
            if (!Inventory.contains(DESERT_CAMP_ITEMS.wroughtKey)) {
                return this.fail(`desert camp: '${DESERT_CAMP_ITEMS.wroughtKey}' is required from inside the mine`);
            }
            if (!(await this.walk(DESERT_CAMP_MINE_ANCHOR, 4, 'deep mine', 'mineDeep'))) return false;
            this.host.log(`desert camp: shared walk resumed ${area} → deep mine; tile=${this.tileLabel()}`);
            return true;
        }
        return this.fail(`desert camp: unhandled enter area '${area}' at ${this.tileLabel()}`);
    }

    private async exit(area: DesertCampRouteArea): Promise<boolean> {
        if (area === 'mineDeep' || area === 'mineLower' || area === 'mineEntrance') {
            if (!(await this.wear(DESERT_CAMP_ITEMS.slave, 'slave disguise', false))) return false;
            if (!(await this.walk(CAMP_INSIDE, 3, 'mining-camp surface', 'campSurface'))) return false;
            this.host.log(`desert camp: shared walk completed mine → camp surface; tile=${this.tileLabel()}`);
            return true;
        }

        if (area === 'campSurface') {
            if (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey) && !(await this.recoverDeskKeys())) return false;
            if (this.destination === 'mineDeep') {
                if (!(await this.wear(DESERT_CAMP_ITEMS.slave, 'slave disguise'))) return false;
            } else if (!(await this.wear(DESERT_CAMP_ITEMS.desert, 'desert travel outfit'))) {
                return false;
            }
            if (!(await this.walk(CAMP_OUTSIDE, 0, 'outside mining-camp gate', 'desert'))) return false;
            this.host.log(`desert camp: shared walk completed outer gate out; tile=${this.tileLabel()}`);
            return true;
        }

        if (area === 'desert') {
            if (!(await this.walk(SHANTAY_NORTH, 1, 'Shantay bank side', 'shantayNorth'))) return false;
            this.host.log(`desert camp: shared walk completed Shantay north; tile=${this.tileLabel()}`);
            return true;
        }
        return this.fail(`desert camp: unhandled exit area '${area}' at ${this.tileLabel()}`);
    }

    private async finishShantayProvisioning(): Promise<boolean> {
        const desertTarget = this.destination === 'campSurface' || !this.hasSlaveOutfit() ? 1 : 0;
        const missingDesert = DESERT_CAMP_ITEMS.desert.flatMap(name => Array.from({ length: Math.max(0, desertTarget - Inventory.count(name) - equipmentCount(name)) }, () => name));
        if (missingDesert.length > 0 && !(await this.buyDesertOutfit(missingDesert))) return false;
        if (!Inventory.contains(DESERT_CAMP_ITEMS.pass)) {
            if (Inventory.count(DESERT_CAMP_ITEMS.coins) < FIXED_PASS_COST) {
                return this.fail('desert camp: no Shantay pass and fewer than 5 Coins after bank provisioning');
            }
            if (!(await this.buyPass())) return false;
        }
        return true;
    }

    private hasSlaveOutfit(): boolean {
        return DESERT_CAMP_ITEMS.slave.every(name => Inventory.contains(name) || Equipment.contains(name));
    }

    private wearTravelOutfit(): Promise<boolean> {
        if (this.destination === 'campSurface') {
            return this.wear(DESERT_CAMP_ITEMS.desert, 'desert travel outfit');
        }
        return this.hasSlaveOutfit()
            ? this.wear(DESERT_CAMP_ITEMS.slave, 'slave disguise')
            : this.wear(DESERT_CAMP_ITEMS.desert, 'slave-disguise recovery outfit');
    }

    private async recoverSlaveOutfit(): Promise<boolean> {
        const shortDesert = DESERT_CAMP_ITEMS.desert.filter(name => Inventory.count(name) + equipmentCount(name) < 1);
        if (shortDesert.length > 0) {
            return this.fail(`desert camp: slave-outfit recovery needs one complete desert outfit; short ${shortDesert.join(', ')}`);
        }
        if (!(await this.wear(DESERT_CAMP_ITEMS.desert, 'desert outfit'))) return false;
        if (!(await this.walk(MALE_SLAVE, 3, 'male slave'))) return false;
        const findSlave = () =>
            Npcs.query()
                .where(candidate => (candidate.id === NPC.maleSlave || candidate.id === NPC.escapedSlave) && candidate.actions().some(action => /^talk/i.test(action)))
                .withinOf(MALE_SLAVE, 6)
                .nearest();
        if (!(await Execution.delayUntil(() => findSlave() !== null, 8_000))) {
            return this.fail(`desert camp: no male slave 825/826 loaded near ${this.tileLabel()}`);
        }
        const slave = findSlave();
        const talk = slave?.actions().find(action => /^talk/i.test(action));
        if (!slave || !talk || !(await slave.interact(talk))) {
            return this.fail(`desert camp: could not talk to the male slave at ${this.tileLabel()}`);
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8_000))) {
            return this.fail('desert camp: slave-outfit recovery dialogue did not open');
        }
        this.host.log('desert camp: trading one desert outfit to replace the missing slave disguise');
        if (!(await this.drainInteractionDialog(["Yes, I'll trade."], () => this.hasSlaveOutfit()))) return false;
        if (!this.hasSlaveOutfit()) {
            return this.fail(`desert camp: slave trade ended without ${DESERT_CAMP_ITEMS.slave.filter(name => !Inventory.contains(name) && !Equipment.contains(name)).join(', ')}`);
        }
        this.host.log('desert camp: recovered complete slave disguise');
        return true;
    }

    private async recoverMetalKey(): Promise<boolean> {
        if (metalKeyDuelNeedsRetreat(this.host.foodCount(), true)) {
            return this.retreatFromMetalKeyDuel('fewer than 2 configured food items remain before the duel');
        }
        if (Inventory.free() < 1) return this.fail('desert camp: no reserved slot for Metal key recovery');
        if (!(await this.walk(CAPTAIN, 5, 'Mercenary Captain'))) return false;
        const findCaptain = () => Npcs.query()
            .where(candidate => candidate.id === NPC.mercenaryCaptain && metalKeyCaptainAvailable(candidate))
            .action('Talk-to')
            .withinOf(CAPTAIN, 10)
            .nearest();
        const findTargetedCaptain = () => Npcs.query()
            .where(candidate => candidate.id === NPC.mercenaryCaptain && candidate.targetsMe())
            .action('Attack')
            .withinOf(CAPTAIN, 10)
            .nearest();
        const targetedCaptainNearby = (): boolean => findTargetedCaptain() !== null;
        const captainDeadline = performance.now() + 245_000;
        let captainInteraction = false;
        let duelCaptainIndex: number | null = null;
        let lastWaitLogAt = 0;
        while (!captainInteraction && performance.now() < captainDeadline) {
            if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
                captainInteraction = true;
                break;
            }
            if (metalKeyDuelNeedsRetreat(this.host.foodCount(), true)) {
                return this.retreatFromMetalKeyDuel('the Mercenary Captain wait consumed the food reserve');
            }
            const resumedCaptain = findTargetedCaptain();
            if (resumedCaptain) {
                duelCaptainIndex = resumedCaptain.index;
                captainInteraction = true;
                this.host.log('desert camp: resuming the existing Mercenary Captain duel');
                break;
            }
            const captain = findCaptain();
            if (captain && await captain.interact('Talk-to')) {
                const acknowledged = await Execution.delayUntil(
                    () => metalKeyCaptainClaimAcknowledged(
                        ChatDialog.isOpen() || ChatDialog.canContinue(),
                        targetedCaptainNearby(),
                        Inventory.contains(DESERT_CAMP_ITEMS.metalKey)
                    ),
                    8_000
                );
                if (acknowledged) {
                    if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
                        captainInteraction = true;
                        break;
                    }
                    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                        if (!(await this.drainInteractionDialog(CAPTAIN_KEY_DUEL))) return false;
                    }
                    if (await Execution.delayUntil(
                        () => targetedCaptainNearby() || Inventory.contains(DESERT_CAMP_ITEMS.metalKey),
                        8_000
                    )) {
                        const claimedCaptain = findTargetedCaptain();
                        if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey) || claimedCaptain) {
                            duelCaptainIndex = claimedCaptain?.index ?? null;
                            captainInteraction = true;
                            break;
                        }
                    }
                    this.host.log('desert camp: another bot won the Mercenary Captain challenge — returning to the queue');
                } else {
                    this.host.log('desert camp: Mercenary Captain interaction was not acknowledged — returning to the queue');
                }
            }
            if (performance.now() - lastWaitLogAt >= 30_000) {
                const observed = Npcs.query()
                    .where(candidate => candidate.id === NPC.mercenaryCaptain)
                    .withinOf(CAPTAIN, 10)
                    .nearest();
                this.host.log(
                    'desert camp: waiting up to 245s for Mercenary Captain; ' +
                        `observed=${observed ? `combat=${observed.inCombat},otherPlayer=${observed.targetsAnotherPlayer()}` : 'absent'}`
                );
                lastWaitLogAt = performance.now();
            }
            if (EventSignal.pending()) {
                this.host.log('desert camp: Captain wait interrupted by a random event — route will resume');
                return false;
            }
            await Sustain.run();
            await Execution.delayTicks(1);
        }
        if (!captainInteraction) {
            const observed = Npcs.query()
                .where(candidate => candidate.id === NPC.mercenaryCaptain)
                .withinOf(CAPTAIN, 10)
                .nearest();
            return this.fail(
                'desert camp: Mercenary Captain unavailable after 245s; ' +
                    `observed=${observed ? `combat=${observed.inCombat},otherPlayer=${observed.targetsAnotherPlayer()}` : 'absent'}`
            );
        }
        let attackAttempts = 0;
        const hitpointsXpBefore = Skills.xp('hitpoints');
        let lastHitpointsXp = hitpointsXpBefore;
        let lastHitAt = performance.now();
        if (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
            const duelCaptain = findTargetedCaptain();
            if (!duelCaptain || !(await duelCaptain.interact('Attack'))) {
                return this.fail('desert camp: could not retaliate against the attacking Mercenary Captain');
            }
            duelCaptainIndex = duelCaptain.index;
            attackAttempts = 1;
            this.host.log('desert camp: accepted Mercenary Captain duel; retaliating with Auto Retaliate off');
            if (!(await Execution.delayUntil(() => reader.selfFaceEntity() === duelCaptain.index, 8_000))) {
                return this.fail('desert camp: retaliatory Attack was accepted but the Mercenary Captain did not become our target');
            }
        }
        const deadline = performance.now() + 180_000;
        const findDuelCaptain = () => duelCaptainIndex === null
            ? null
            : Npcs.query()
                .where(candidate => candidate.index === duelCaptainIndex && candidate.id === NPC.mercenaryCaptain)
                .action('Attack')
                .withinOf(CAPTAIN, 10)
                .nearest();
        while (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey) && performance.now() < deadline) {
            let liveCaptain = findDuelCaptain();
            const captainAlive = liveCaptain !== null
                && (liveCaptain.health !== 0 || liveCaptain.snap.totalHealth <= 0);
            if (metalKeyDuelNeedsRetreat(this.host.foodCount(), captainAlive)) {
                return this.retreatFromMetalKeyDuel('the Metal key duel reached its final configured food item');
            }
            await Sustain.run();
            const hasKeyAfterSustain = Inventory.contains(DESERT_CAMP_ITEMS.metalKey);
            if (hasKeyAfterSustain) break;
            liveCaptain = findDuelCaptain();
            const captainStillAlive = liveCaptain !== null
                && (liveCaptain.health !== 0 || liveCaptain.snap.totalHealth <= 0);
            if (metalKeyRetreatAfterSustain(hasKeyAfterSustain, this.host.foodCount(), captainStillAlive)) {
                return this.retreatFromMetalKeyDuel('the Metal key duel consumed its food reserve');
            }
            if (!Game.ingame()) {
                this.host.log('desert camp: Metal key duel ended by logout — waiting for the client to recover');
                return false;
            }
            if (EventSignal.pending()) {
                this.host.log('desert camp: Metal key recovery interrupted by a random event — route will resume');
                return false;
            }
            if (this.area() !== 'desert') {
                return this.fail(`desert camp: left the Mercenary Captain area during Metal key recovery; tile=${this.tileLabel()}`);
            }
            if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) break;

            if (liveCaptain) {
                const hitpointsXp = Skills.xp('hitpoints');
                if (hitpointsXp > lastHitpointsXp) {
                    lastHitpointsXp = hitpointsXp;
                    lastHitAt = performance.now();
                }
                const alive = liveCaptain.health !== 0 || liveCaptain.snap.totalHealth <= 0;
                if (alive && liveCaptain.targetsMe() && reader.selfFaceEntity() !== liveCaptain.index) {
                    if (!(await liveCaptain.interact('Attack'))) {
                        return this.fail('desert camp: could not re-engage challenged Mercenary Captain after our target cleared');
                    }
                    attackAttempts++;
                    this.host.log(`desert camp: re-engaged challenged Mercenary Captain after our target cleared; attack=${attackAttempts}`);
                }
            }
            await Execution.delayTicks(1);
        }
        if (!Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
            const liveCaptain =
                duelCaptainIndex === null
                    ? null
                    : Npcs.query()
                        .where(candidate => candidate.index === duelCaptainIndex && candidate.id === NPC.mercenaryCaptain)
                        .withinOf(CAPTAIN, 10)
                        .nearest();
            return this.fail(
                `desert camp: Metal key recovery timed out after 180s; tile=${this.tileLabel()}; ` +
                    `inCombat=${Game.inCombat()}; attackAttempts=${attackAttempts}; ` +
                    `hitpointsXp=${Skills.xp('hitpoints') - hitpointsXpBefore}; lastHitAgo=${Math.round((performance.now() - lastHitAt) / 1000)}s; ` +
                    `selfFace=${reader.selfFaceEntity()}; captain=${liveCaptain ? `${liveCaptain.health}/${liveCaptain.snap.totalHealth}` : 'absent'}`
            );
        }
        if (!(await this.drainOwnedChatUntil(() => Inventory.contains(DESERT_CAMP_ITEMS.metalKey)))) {
            return this.fail('desert camp: Metal key arrived but its reward modal did not settle');
        }
        this.host.log(`desert camp: recovered Metal key from Mercenary Captain; tile=${this.tileLabel()}; ` + `attacks=${attackAttempts}; hitpointsXp=${Skills.xp('hitpoints') - hitpointsXpBefore}`);
        return true;
    }

    private async retreatFromMetalKeyDuel(reason: string): Promise<false> {
        this.host.setStatus('desert camp: emergency food retreat');
        this.host.log(`desert camp: ${reason}; retreating to Shantay before continuing combat`);
        await Sustain.run();
        if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
            this.host.log('desert camp: Metal key arrived while preparing the emergency retreat — continuing the route');
            return false;
        }
        const escaped = await Traversal.walkResilient(SHANTAY_NORTH, {
            radius: 2,
            attempts: 12,
            timeoutMs: 180_000,
            log: message => this.host.log(`  ${message}`)
        });
        if (!escaped && EventSignal.pending()) {
            this.host.log('desert camp: emergency food retreat interrupted by a random event — route will resume');
            return false;
        }
        if (!escaped || desertCampRouteArea(Game.tile()) !== 'shantayNorth') {
            return this.fail(`desert camp: emergency food retreat failed; tile=${this.tileLabel()}`);
        }
        if (Inventory.contains(DESERT_CAMP_ITEMS.metalKey)) {
            this.host.log('desert camp: Metal key arrived during the emergency retreat; safely reached Shantay');
            return false;
        }
        this.host.log(`desert camp: ${reason}; safely retreated to Shantay — refilling before retrying`);
        return false;
    }

    private async recoverDeskKeys(): Promise<boolean> {
        const wanted = this.destination === 'campSurface'
            ? [DESERT_CAMP_ITEMS.metalKey]
            : [DESERT_CAMP_ITEMS.cellKey, DESERT_CAMP_ITEMS.metalKey, DESERT_CAMP_ITEMS.wroughtKey];
        const deskAwards = [DESERT_CAMP_ITEMS.cellKey, DESERT_CAMP_ITEMS.metalKey, DESERT_CAMP_ITEMS.wroughtKey].filter(
            name => !Inventory.contains(name)
        );
        if (Inventory.free() < deskAwards.length) {
            return this.fail(`desert camp: Captain Siad desk needs ${deskAwards.length} free slot(s), only ${Inventory.free()} available`);
        }
        if (!(await this.walk(SIAD_DESK, 2, "Captain Siad's desk"))) return false;
        const findDesk = () =>
            Locs.query()
                .where(candidate => candidate.id === LOC.siadDesk && candidate.tile().distanceTo(SIAD_DESK) <= 3)
                .action('Search')
                .nearest();
        if (!(await Execution.delayUntil(() => findDesk() !== null, 8_000))) {
            return this.fail(`desert camp: Captain Siad's exact desk did not load near ${this.tileLabel()}`);
        }
        const desk = findDesk();
        if (!desk || !(await desk.interact('Search'))) {
            return this.fail(`desert camp: Captain Siad's desk has no usable Search action at ${this.tileLabel()}`);
        }
        if (!(await this.drainOwnedChatUntil(() => deskAwards.every(name => Inventory.contains(name))))) {
            return this.fail(`desert camp: Captain Siad's desk did not award ${deskAwards.join(', ')}`);
        }
        if (wanted.some(name => !Inventory.contains(name))) {
            return this.fail(`desert camp: Captain Siad's desk recovery finished without ${wanted.filter(name => !Inventory.contains(name)).join(', ')}`);
        }
        this.host.log(
            this.destination === 'campSurface'
                ? `desert camp: recovered Metal key from Captain Siad's desk; tile=${this.tileLabel()}`
                : `desert camp: recovered Wrought iron key from Captain Siad's desk; tile=${this.tileLabel()}`
        );
        return true;
    }

    private async buyDesertOutfit(items: readonly DesertOutfitItem[]): Promise<boolean> {
        if (!(await this.walk(SHANTAY_SHOP, 3, 'Shantay shop'))) return false;
        if (!(await Shop.open('Shantay'))) return this.fail('desert camp: could not open the Shantay Pass Shop');
        const stock = Shop.stock();
        for (const name of items) {
            const entry = stock.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (!entry || entry.count <= 0) {
                await Shop.close();
                return this.fail(`desert camp: Shantay shop has no '${name}' in stock`);
            }
        }
        for (const name of items) {
            const before = Inventory.count(name);
            const bought = await Shop.buy(name, 1);
            if (bought !== 1 || Inventory.count(name) !== before + 1) {
                await Shop.close();
                return this.fail(`desert camp: failed to buy required '${name}' (bought ${bought})`);
            }
            this.host.log(`desert camp: bought required ${name}`);
        }
        await Shop.close();
        return true;
    }

    private async buyPass(): Promise<boolean> {
        if (Inventory.free() < 1) return this.fail('desert camp: need 1 free inventory slot before buying a Shantay pass');
        if (!(await this.walk(SHANTAY_SHOP, 3, 'Shantay shop'))) return false;
        const beforeCoins = Inventory.count(DESERT_CAMP_ITEMS.coins);
        const shantay = Npcs.query().name('Shantay').action('Talk-to').nearest();
        if (!shantay || !(await shantay.interact('Talk-to'))) {
            return this.fail('desert camp: could not talk to Shantay for a fixed-price pass');
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8_000))) {
            return this.fail('desert camp: Shantay pass dialogue did not open');
        }
        if (!(await this.drainInteractionDialog(['I want to buy a shantay pass for 5 gold coins.']))) return false;
        if (!(await this.drainOwnedChatUntil(() => Inventory.contains(DESERT_CAMP_ITEMS.pass)))) {
            return this.fail('desert camp: Shantay pass confirmation did not complete');
        }
        if (!(await Execution.delayUntilTicks(() => Inventory.contains(DESERT_CAMP_ITEMS.pass) && Inventory.count(DESERT_CAMP_ITEMS.coins) === beforeCoins - FIXED_PASS_COST, 8))) {
            return this.fail('desert camp: fixed-price Shantay pass purchase did not land');
        }
        this.host.log('desert camp: bought 1 Shantay pass for 5 Coins');
        return true;
    }

    private hasPickaxe(): boolean {
        return pickaxeName(Equipment.items()) !== null || pickaxeName(Inventory.items()) !== null;
    }

    private async wear(items: readonly string[], label: string, requirePickaxe = true): Promise<boolean> {
        for (const name of items) {
            if (Equipment.contains(name)) continue;
            if (!Inventory.contains(name)) return this.fail(`desert camp: missing required ${label} item '${name}'`);
            if (!(await Equipment.equip(name))) {
                this.host.log(`desert camp: ${label} item '${name}' not yet confirmed — waiting for the live equipment state`);
                if (!(await Execution.delayUntilTicks(() => Equipment.contains(name), 10))) {
                    return this.fail(`desert camp: could not equip required ${label} item '${name}'`);
                }
                this.host.log(`desert camp: ${label} item '${name}' confirmed after a delayed equipment update`);
            }
        }
        if (requirePickaxe && !this.hasPickaxe()) {
            return this.fail('desert camp: no pickaxe equipped or in the inventory');
        }
        return true;
    }

    private async walk(destination: Tile, radius: number, label: string, expectedArea?: DesertCampRouteArea): Promise<boolean> {
        const here = Game.tile();
        if (here && here.level === destination.level && destination.distanceTo(here) <= radius && (expectedArea === undefined || this.area() === expectedArea)) {
            return true;
        }
        this.host.log(`desert camp: shared walk to ${label} ${destination}; from=${this.tileLabel()}`);
        const arrived = await Traversal.walkResilient(destination, {
            radius,
            attempts: 12,
            timeoutMs: 180_000,
            log: message => this.host.log(`  ${message}`)
        });
        if (!arrived && EventSignal.pending()) {
            this.host.log(`desert camp: ${label} interrupted by a random event — route will resume afterward`);
            return false;
        }
        if (!arrived) return this.fail(`desert camp: could not reach ${label} ${destination}; from=${this.tileLabel()}`);
        if (expectedArea !== undefined && this.area() !== expectedArea) {
            return this.fail(`desert camp: ${label} walk ended in area=${this.area()}, expected=${expectedArea}; tile=${this.tileLabel()}`);
        }
        return true;
    }

    private async drainOwnedChatUntil(done: () => boolean): Promise<boolean> {
        let sawQuietCompletion = false;
        for (let step = 0; step < 30; step++) {
            if (!ChatDialog.isOpen()) {
                if (done()) {
                    if (sawQuietCompletion) return true;
                    sawQuietCompletion = true;
                    await Execution.delayTicks(1);
                    continue;
                }
                sawQuietCompletion = false;
                await Execution.delayTicks(1);
                continue;
            }
            sawQuietCompletion = false;
            if (!ChatDialog.canContinue() || !(await ChatDialog.continue())) return false;
        }
        return !ChatDialog.isOpen() && done() && sawQuietCompletion;
    }

    private async drainInteractionDialog(allowedOptions: readonly string[], done?: () => boolean): Promise<boolean> {
        let reachedDone = false;
        for (let step = 0; step < 140; step++) {
            if (EventSignal.pending()) return false;
            if (done?.()) reachedDone = true;
            if (ChatDialog.canContinue()) {
                if (!(await ChatDialog.continue())) return this.fail('desert camp: dialogue Continue failed');
                await Execution.delayTicks(1);
                continue;
            }
            const options = ChatDialog.options();
            if (options.length > 0) {
                const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
                const allowed = new Set(allowedOptions.map(normalize));
                const choice = options.find(option => allowed.has(normalize(option)));
                if (!choice) return this.fail(`desert camp: unexpected dialogue options [${options.join(' | ')}]`);
                if (!(await ChatDialog.chooseOption(choice))) {
                    return this.fail(`desert camp: could not choose dialogue option '${choice}'`);
                }
                await Execution.delayTicks(1);
                continue;
            }
            if (!ChatDialog.isOpen()) {
                if (!done || reachedDone) return true;
                await Execution.delayTicks(1);
                continue;
            }
            await Execution.delayTicks(1);
        }
        return this.fail('desert camp: dialogue exceeded 140 steps');
    }

    private tileLabel(): string {
        const tile = Game.tile();
        return tile ? `(${tile.x},${tile.z},${tile.level})` : '(unavailable)';
    }

    private fail(reason: string): false {
        this.host.log(reason);
        this.host.setStatus(`${reason} — stopped`);
        this.host.stop(reason);
        return false;
    }
}
