import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Skills } from '../api/hud/Skills.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// ============================================
// CONFIGURATION - EDIT THESE
// ============================================

// Define bank location type
interface BankLocation {
    x: number;
    z: number;
    name: string;
}

const CONFIG = {
    // Teleport methods and their requirements
    teleports: {
        'varrock': {
            name: 'Varrock Teleport',
            runeCost: { 'Law rune': 1, 'Air rune': 3, 'Fire rune': 1 },
            levelRequired: 25,
            spellName: 'Varrock',
            destination: 'Varrock',
            bank: { x: 3252, z: 3420 }
        },
        'lumbridge': {
            name: 'Lumbridge Teleport',
            runeCost: { 'Law rune': 1, 'Air rune': 3, 'Earth rune': 1 },
            levelRequired: 31,
            spellName: 'Lumbridge',
            destination: 'Lumbridge',
            bank: { x: 3092, z: 3245 }
        },
        'falador': {
            name: 'Falador Teleport',
            runeCost: { 'Law rune': 1, 'Air rune': 3, 'Water rune': 1 },
            levelRequired: 37,
            spellName: 'Falador',
            destination: 'Falador',
            bank: { x: 2946, z: 3368 }
        },
        'camelot': {
            name: 'Camelot Teleport',
            runeCost: { 'Law rune': 1, 'Air rune': 5 },
            levelRequired: 45,
            spellName: 'Camelot',
            destination: 'Camelot',
            bank: { x: 2727, z: 3493 }
        },
        'ardougne': {
            name: 'Ardougne Teleport',
            runeCost: { 'Law rune': 2, 'Water rune': 2 },
            levelRequired: 51,
            spellName: 'Ardougne',
            destination: 'Ardougne',
            bank: { x: 2655, z: 3283 }
        },
        'watchtower': {
            name: 'Watchtower Teleport',
            runeCost: { 'Law rune': 2, 'Earth rune': 2 },
            levelRequired: 58,
            spellName: 'Watchtower',
            destination: 'Watchtower',
            bank: { x: 2547, z: 3111 }
        }
    } as { [key: string]: any },
    
    // All bank locations for nearest bank detection
    allBanks: [
        { x: 3252, z: 3420, name: 'Varrock' },
        { x: 3092, z: 3245, name: 'Lumbridge' },
        { x: 2946, z: 3368, name: 'Falador' },
        { x: 2727, z: 3493, name: 'Camelot' },
        { x: 2655, z: 3283, name: 'Ardougne' },
        { x: 2547, z: 3111, name: 'Watchtower' }
    ] as BankLocation[],
    
    // Progressive teleport progression (stops at Camelot)
    progressiveProgression: [
        { level: 25, teleportKey: 'varrock' },
        { level: 31, teleportKey: 'lumbridge' },
        { level: 37, teleportKey: 'falador' },
        { level: 45, teleportKey: 'camelot' }
    ],
    
    // Staff rune replacements
    staffs: {
        'Air staff': 'Air rune',
        'Staff of air': 'Air rune',
        'Fire staff': 'Fire rune',
        'Staff of fire': 'Fire rune',
        'Water staff': 'Water rune',
        'Staff of water': 'Water rune',
        'Earth staff': 'Earth rune',
        'Staff of earth': 'Earth rune',
        'Lava staff': 'Fire rune',
        'Staff of lava': 'Fire rune',
        'Mud staff': 'Water rune',
        'Staff of mud': 'Water rune',
        'Steam staff': 'Water rune',
        'Staff of steam': 'Water rune',
        'Dust staff': 'Earth rune',
        'Staff of dust': 'Earth rune',
        'Smoke staff': 'Fire rune',
        'Staff of smoke': 'Fire rune',
        'Mystic air staff': 'Air rune',
        'Mystic fire staff': 'Fire rune',
        'Mystic water staff': 'Water rune',
        'Mystic earth staff': 'Earth rune'
    } as { [key: string]: string },
    
    // Bank interaction
    boothName: 'Bank booth',
    boothOp: 'Use-quickly',
    
    // Magic tab
    magicTabIndex: 6,
};

// ============================================
// SETTINGS SCHEMA - EXPORTED FOR INDEX.TS
// ============================================

export const SETTINGS: SettingsSchema = {
    teleportName: {
        type: 'string',
        default: 'progressive',
        options: ['progressive', 'varrock', 'lumbridge', 'falador', 'camelot', 'ardougne', 'watchtower'],
        optionLabels: {
            'progressive': '⚡ Progressive (Best for your level)',
            'varrock': 'Varrock Teleport (Lvl 25)',
            'lumbridge': 'Lumbridge Teleport (Lvl 31)',
            'falador': 'Falador Teleport (Lvl 37)',
            'camelot': 'Camelot Teleport (Lvl 45)',
            'ardougne': 'Ardougne Teleport (Lvl 51)',
            'watchtower': 'Watchtower Teleport (Lvl 58)'
        },
        label: 'Teleport Destination',
        help: 'Select a teleport or choose Progressive for best XP progression'
    },
    lawBatchSize: {
        type: 'number',
        default: 1000,
        min: 10,
        max: 10000,
        label: 'Law Rune Batch Size',
        help: 'How many law runes to withdraw from bank at a time'
    },
    minLawRunes: {
        type: 'number',
        default: 100,
        min: 10,
        max: 1000,
        label: 'Minimum Law Runes',
        help: 'Stop script if total law runes fall below this amount'
    },
    useStaffRunes: {
        type: 'boolean',
        default: true,
        label: 'Use Staff Runes',
        help: 'Allow equipped staffs to provide elemental runes (Air staff, Fire staff, etc.)'
    }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function distanceTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return hours + 'h ' + minutes + 'm ' + secs + 's';
    } else if (minutes > 0) {
        return minutes + 'm ' + secs + 's';
    } else {
        return secs + 's';
    }
}

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

// ============================================
// MAIN BOT CLASS
// ============================================

export default class AIOTeleport extends LoopingBot {
    private selectedTeleport: string = 'progressive';
    private lawBatchSize: number = 1000;
    private minLawRunes: number = 100;
    private useStaffRunes: boolean = true;
    
    private teleportMethod: any = null;
    private teleportsCompleted: number = 0;
    private totalRunesUsed: number = 0;
    private startedAt: number = Date.now();
    private isBanking: boolean = false;
    private isCasting: boolean = false;
    private teleportDelay: number = 0;
    private xpAtStart: number = 0;
    private needBanking: boolean = false;
    private equippedStaff: string | null = null;
    private lawRunesRemainingInBatch: number = 0;
    private currentBankPos: BankLocation | null = null;
    
    // Progressive teleport tracking
    private isProgressiveMode: boolean = false;
    private currentTeleportKey: string = 'varrock';

    private loadSettings(): void {
        this.selectedTeleport = this.settings.str('teleportName', 'progressive');
        this.lawBatchSize = this.settings.num('lawBatchSize', 1000);
        this.minLawRunes = this.settings.num('minLawRunes', 100);
        this.useStaffRunes = this.settings.bool('useStaffRunes', true);
        
        this.isProgressiveMode = (this.selectedTeleport === 'progressive');
        
        // If progressive mode, determine the best teleport for current level
        if (this.isProgressiveMode) {
            const bestKey = this.getBestTeleportForLevel();
            this.currentTeleportKey = bestKey;
            const method = CONFIG.teleports[bestKey];
            if (method) {
                this.teleportMethod = method;
                this.log(`⚡ Progressive mode: Using ${method.name} (level ${Skills.level('magic')})`);
            } else {
                this.teleportMethod = CONFIG.teleports['varrock'];
                this.currentTeleportKey = 'varrock';
            }
        } else {
            const method = CONFIG.teleports[this.selectedTeleport];
            if (method) {
                this.teleportMethod = method;
                this.currentTeleportKey = this.selectedTeleport;
            } else {
                this.log('❌ Unknown teleport: ' + this.selectedTeleport + ', using default');
                this.teleportMethod = CONFIG.teleports['varrock'];
                this.currentTeleportKey = 'varrock';
            }
        }
    }

    private getBestTeleportForLevel(): string {
        const currentLevel = Skills.level('magic');
        let bestKey = 'varrock';
        
        for (const tier of CONFIG.progressiveProgression) {
            if (currentLevel >= tier.level) {
                bestKey = tier.teleportKey;
            }
        }
        
        return bestKey;
    }

    private updateProgressiveTeleport(): void {
        if (!this.isProgressiveMode) return;
        
        const currentLevel = Skills.level('magic');
        const bestKey = this.getBestTeleportForLevel();
        
        if (bestKey !== this.currentTeleportKey) {
            const newMethod = CONFIG.teleports[bestKey];
            if (newMethod) {
                const oldName = this.teleportMethod ? this.teleportMethod.name : 'None';
                this.teleportMethod = newMethod;
                this.currentTeleportKey = bestKey;
                this.log(`🔁 Progressive switch: ${oldName} → ${newMethod.name} (level ${currentLevel})`);
                
                // Check if we have the required runes for the new teleport
                if (!this.hasRequiredRunes()) {
                    this.log(`📦 Missing runes for ${newMethod.name}, banking...`);
                    this.needBanking = true;
                }
            }
        }
    }

    private checkStaffRunes(): void {
        this.equippedStaff = null;
        
        const equippedItems = Equipment.items();
        for (const item of equippedItems) {
            if (!item || !item.name) continue;
            
            for (const staffName of Object.keys(CONFIG.staffs)) {
                if (item.name.includes(staffName) || item.name === staffName) {
                    this.equippedStaff = staffName;
                    return;
                }
            }
        }
    }

    private hasRune(runeName: string, amount: number): boolean {
        const inventoryCount = Inventory.count(runeName);
        if (inventoryCount >= amount) {
            return true;
        }
        
        if (this.useStaffRunes && this.equippedStaff) {
            const providedRune = CONFIG.staffs[this.equippedStaff];
            if (providedRune === runeName) {
                return true;
            }
        }
        
        return false;
    }

    private getRuneCount(runeName: string): number {
        let count = Inventory.count(runeName);
        
        if (this.useStaffRunes && this.equippedStaff) {
            const providedRune = CONFIG.staffs[this.equippedStaff];
            if (providedRune === runeName) {
                return count + 99999;
            }
        }
        
        return count;
    }

    private findNearestBank(): BankLocation | null {
        const currentPos = Game.tile();
        if (!currentPos) return null;
        
        let nearest: BankLocation | null = null;
        let nearestDist = Infinity;
        
        for (const bank of CONFIG.allBanks) {
            const dist = distanceTo(currentPos, bank);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = bank;
            }
        }
        
        return nearest;
    }

    // ✅ Only log when bank location changes
    private updateBankLocation(): void {
        const nearest = this.findNearestBank();
        if (nearest) {
            // Only log if bank location actually changed
            if (!this.currentBankPos || this.currentBankPos.name !== nearest.name) {
                this.currentBankPos = nearest;
                this.log(`📍 Using nearest bank: ${nearest.name} at ${nearest.x},${nearest.z}`);
            } else {
                // Bank hasn't changed, just update silently
                this.currentBankPos = nearest;
            }
        } else {
            this.currentBankPos = null;
            this.log('⚠️ No bank found nearby!');
        }
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        
        this.loadSettings();
        
        if (!this.teleportMethod) {
            this.teleportMethod = CONFIG.teleports['varrock'];
            this.currentTeleportKey = 'varrock';
        }
        
        this.checkStaffRunes();
        this.updateBankLocation();
        
        this.xpAtStart = Skills.xp('magic');
        this.startedAt = Date.now();
        this.lawRunesRemainingInBatch = 0;
        
        this.log('=== AIO Teleport Started ===');
        this.log('Target: ' + this.teleportMethod.name);
        this.log('Magic Level: ' + Skills.level('magic'));
        this.log('Law batch size: ' + this.lawBatchSize);
        this.log('Minimum law runes: ' + this.minLawRunes);
        this.log('Staff rune support: ' + (this.useStaffRunes ? 'Enabled' : 'Disabled'));
        this.log('Progressive mode: ' + (this.isProgressiveMode ? 'Enabled (stops at Camelot)' : 'Disabled'));
        
        if (this.equippedStaff) {
            this.log('✓ Equipped: ' + this.equippedStaff + ' (provides ' + CONFIG.staffs[this.equippedStaff] + ')');
        }
        
        if (this.teleportMethod.levelRequired && Skills.level('magic') < this.teleportMethod.levelRequired) {
            this.log('⚠️ WARNING: Magic level ' + Skills.level('magic') + ' is below required ' + this.teleportMethod.levelRequired);
            this.log('You may fail to cast this spell!');
        }
        
        const currentLawRunes = Inventory.count('Law rune');
        this.log('Initial law runes: ' + currentLawRunes);
        
        if (this.hasRequiredRunes()) {
            this.log('✓ Already have required runes in inventory! Starting teleport directly.');
            this.needBanking = false;
            this.lawRunesRemainingInBatch = Inventory.count('Law rune');
            this.log(`Batch size set to ${this.lawRunesRemainingInBatch} law runes (will bank for more when depleted)`);
        } else {
            this.log('Missing required runes! Banking...');
            this.needBanking = true;
        }
        
        this.log('✓ Bot ready!');
    }

    async loop(): Promise<void> {
        try {
            this.checkStaffRunes();
            
            // ✅ Check level EVERY loop (instant, no delay)
            if (this.isProgressiveMode) {
                this.updateProgressiveTeleport();
            }
            
            if (this.teleportDelay > 0) {
                this.teleportDelay--;
                await Execution.delayTicks(1);
                return;
            }
            
            if (this.needBanking) {
                // Update bank location and check for progressive teleport upgrade
                this.updateBankLocation();
                if (this.isProgressiveMode) {
                    this.updateProgressiveTeleport();
                }
                await this.performBanking();
                return;
            }
            
            const currentLawRunes = Inventory.count('Law rune');
            
            if (!this.teleportMethod) {
                this.log('❌ No teleport method selected!');
                return;
            }
            
            const lawRuneCost = this.teleportMethod.runeCost['Law rune'] as number;
            
            if (currentLawRunes < lawRuneCost) {
                this.log('⚠️ Out of law runes! Banking...');
                this.needBanking = true;
                await this.performBanking();
                return;
            }
            
            if (this.lawRunesRemainingInBatch <= 0) {
                this.log('📦 Batch empty, going to bank for more...');
                this.needBanking = true;
                await this.performBanking();
                return;
            }
            
            if (!this.hasRequiredRunes()) {
                this.log('Missing required runes! Banking...');
                this.needBanking = true;
                await this.performBanking();
                return;
            }
            
            if (Bank.isOpen()) {
                const canvas = document.getElementById('canvas') as HTMLCanvasElement;
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const clickX = rect.left + rect.width / 2;
                    const clickY = rect.top + rect.height / 2;
                    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: clickX, clientY: clickY }));
                    await Execution.delayTicks(1);
                    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: clickX, clientY: clickY }));
                    await Execution.delayTicks(1);
                }
            }
            
            await this.performTeleport();
            
        } catch (e) {
            this.log('❌ Error in loop: ' + e);
            await Execution.delayTicks(5);
        }
    }

    private async sendKeyboardInput(text: string): Promise<void> {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        if (!canvas) {
            this.log('❌ Canvas not found!');
            return;
        }
        
        for (const char of text) {
            const keydownEvent = new KeyboardEvent('keydown', { key: char, code: char });
            const keyupEvent = new KeyboardEvent('keyup', { key: char, code: char });
            canvas.dispatchEvent(keydownEvent);
            canvas.dispatchEvent(keyupEvent);
            await Execution.delayTicks(0.5);
        }
    }

    private async sendEnterKey(): Promise<void> {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        if (!canvas) {
            this.log('❌ Canvas not found!');
            return;
        }
        
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' });
        const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter' });
        canvas.dispatchEvent(enterDown);
        canvas.dispatchEvent(enterUp);
    }

    private async withdrawFromBankWithX(itemName: string, amount: number): Promise<boolean> {
        this.log(`Withdrawing ${amount} ${itemName} using Withdraw X...`);
        
        const bankItems = Bank.items();
        const item = bankItems.find(i => i.name === itemName);
        if (!item) {
            this.log(`❌ No ${itemName} found in bank!`);
            return false;
        }
        
        const bankCount = Bank.count(itemName);
        if (bankCount < amount) {
            this.log(`⚠️ Only ${bankCount} ${itemName} in bank, need ${amount}`);
            return false;
        }
        
        const ops = item.ops || [];
        
        const exactOp = `Withdraw ${amount}`;
        if (ops.includes(exactOp)) {
            this.log(`Using ${exactOp}...`);
            const before = Inventory.count(itemName);
            const result = await Bank.withdraw(itemName, exactOp);
            if (result) {
                await Execution.delayTicks(2);
                const after = Inventory.count(itemName);
                this.log(`✓ Withdrew ${after - before} ${itemName}`);
                return (after - before) > 0;
            }
            return false;
        }
        
        if (ops.includes('Withdraw X')) {
            this.log('Using Withdraw X...');
            const before = Inventory.count(itemName);
            
            const result = await Bank.withdraw(itemName, 'Withdraw X');
            if (!result) {
                this.log('❌ Failed to click Withdraw X');
                return false;
            }
            
            await Execution.delayTicks(3);
            
            this.log(`Typing ${amount}...`);
            await this.sendKeyboardInput(amount.toString());
            await Execution.delayTicks(1);
            
            this.log('Pressing Enter...');
            await this.sendEnterKey();
            await Execution.delayTicks(2);
            
            const after = Inventory.count(itemName);
            const withdrawn = after - before;
            this.log(`✓ Withdrew ${withdrawn} ${itemName}`);
            return withdrawn > 0;
        }
        
        if (ops.includes('Withdraw All')) {
            this.log('Using Withdraw All...');
            const before = Inventory.count(itemName);
            const result = await Bank.withdraw(itemName, 'Withdraw All');
            if (result) {
                await Execution.delayTicks(2);
                const after = Inventory.count(itemName);
                this.log(`✓ Withdrew ${after - before} ${itemName}`);
                return (after - before) > 0;
            }
            return false;
        }
        
        this.log(`❌ Could not withdraw ${amount} ${itemName}`);
        return false;
    }

    private async performBanking(): Promise<void> {
        if (this.isBanking) return;
        this.isBanking = true;
        
        try {
            this.log('=== Banking ===');
            
            if (this.currentBankPos) {
                this.log(`Walking to nearest bank at ${this.currentBankPos.x},${this.currentBankPos.z}...`);
                await Traversal.walkTo(new Tile(this.currentBankPos.x, this.currentBankPos.z, 0), {
                    radius: 3,
                    timeoutMs: 60_000
                });
            } else {
                this.log('No bank found! Stopping...');
                return;
            }
            
            this.log('Opening bank...');
            const opened = await Bank.openNearest(
                CONFIG.boothName,
                CONFIG.boothOp,
                m => this.log('  ' + m)
            );
            
            if (!opened) {
                this.log('❌ Failed to open bank!');
                this.isBanking = false;
                return;
            }
            
            this.log('✓ Bank opened successfully');
            
            this.log('Depositing all inventory...');
            await Bank.depositInventory();
            await Execution.delayTicks(2);
            
            // If in progressive mode, check if we should upgrade teleport after banking
            if (this.isProgressiveMode) {
                this.updateProgressiveTeleport();
            }
            
            const lawRunesInBank = Bank.count('Law rune');
            this.log('Law runes in bank: ' + lawRunesInBank);
            
            if (!this.teleportMethod) {
                this.log('❌ No teleport method!');
                this.isBanking = false;
                return;
            }
            
            const lawRuneCost = this.teleportMethod.runeCost['Law rune'] as number;
            if (lawRunesInBank < lawRuneCost) {
                this.log('❌ Not enough law runes in bank! Have ' + lawRunesInBank + ', need at least ' + lawRuneCost);
                this.log('Stopping script - need more law runes');
                this.isBanking = false;
                return;
            }
            
            if (lawRunesInBank < this.minLawRunes) {
                this.log('⚠️ Below minimum law runes (' + lawRunesInBank + ' < ' + this.minLawRunes + ')');
                this.log('Stopping script - add more law runes to bank');
                this.isBanking = false;
                return;
            }
            
            const toWithdraw = Math.min(this.lawBatchSize, lawRunesInBank);
            
            const lawWithdrawn = await this.withdrawFromBankWithX('Law rune', toWithdraw);
            if (lawWithdrawn) {
                this.lawRunesRemainingInBatch = Inventory.count('Law rune');
                this.log(`✓ Batch set to ${this.lawRunesRemainingInBatch} law runes`);
            } else {
                this.log('Withdraw X failed, using Withdraw All...');
                await Bank.withdraw('Law rune', 'Withdraw All');
                await Execution.delayTicks(2);
                this.lawRunesRemainingInBatch = Inventory.count('Law rune');
                this.log(`✓ Withdrew ${this.lawRunesRemainingInBatch} law runes`);
            }
            
            await this.withdrawElementalRunes();
            await Execution.delayTicks(2);
            
            // Walk to the bank tile to close the interface
            this.log('Walking to bank tile to close interface...');
            const bankTile = new Tile(this.currentBankPos.x, this.currentBankPos.z, 0);
            await Traversal.walkTo(bankTile, { radius: 0, timeoutMs: 15_000 });
            
            this.needBanking = false;
            
            this.log('✓ Banking complete!');
            this.log('Current law runes: ' + Inventory.count('Law rune'));
            this.log('Batch remaining: ' + this.lawRunesRemainingInBatch + '/' + this.lawBatchSize);
            
        } catch (e) {
            this.log('❌ Banking error: ' + e);
        } finally {
            this.isBanking = false;
        }
    }

    private async withdrawElementalRunes(): Promise<void> {
        if (!this.teleportMethod) return;
        
        const requiredRunes = this.teleportMethod.runeCost;
        for (const [runeName, amount] of Object.entries(requiredRunes)) {
            if (runeName === 'Law rune') continue;
            
            const neededAmount = amount as number;
            const current = this.getRuneCount(runeName);
            
            const needed = this.lawBatchSize * neededAmount;
            const needToWithdraw = Math.max(0, needed - current);
            
            this.log(`Need ${needToWithdraw} ${runeName} (have ${current}, ${neededAmount} per teleport x ${this.lawBatchSize} teleports = ${needed} total)`);
            
            if (needToWithdraw > 0) {
                const inBank = Bank.count(runeName);
                
                if (inBank > 0) {
                    const toWithdraw = Math.min(needToWithdraw, inBank);
                    await this.withdrawFromBankWithX(runeName, toWithdraw);
                } else {
                    this.log('⚠️ No ' + runeName + ' in bank!');
                    if (this.equippedStaff) {
                        this.log('   Your staff provides ' + CONFIG.staffs[this.equippedStaff] + ' but you need ' + runeName);
                    }
                }
            } else {
                this.log(`✓ Already have enough ${runeName} (${current})`);
            }
        }
    }

    private async castSpellByName(spellName: string): Promise<boolean> {
        try {
            const result = await Game.teleport(spellName);
            return result;
        } catch (e) {
            this.log(`  Error: ${e}`);
            return false;
        }
    }

    private async performTeleport(): Promise<void> {
        if (this.isCasting) return;
        if (!this.teleportMethod) return;
        
        this.isCasting = true;
        
        try {
            if (!this.hasRequiredRunes()) {
                this.log('Missing required runes!');
                this.isCasting = false;
                this.needBanking = true;
                return;
            }
            
            const lawBefore = Inventory.count('Law rune');
            
            const spellName = this.teleportMethod.spellName;
            const result = await this.castSpellByName(spellName);
            
            if (result) {
                // ✅ Instant bank location update - NO DELAY
                this.updateBankLocation();
                
                const lawAfter = Inventory.count('Law rune');
                const lawUsed = lawBefore - lawAfter;
                
                if (lawUsed > 0) {
                    this.teleportsCompleted++;
                    this.totalRunesUsed += lawUsed;
                    
                    if (this.lawRunesRemainingInBatch > 0) {
                        this.lawRunesRemainingInBatch = Math.max(0, this.lawRunesRemainingInBatch - lawUsed);
                    }
                    
                    this.log(`✓ Teleport #${this.teleportsCompleted} (${this.lawRunesRemainingInBatch}/${this.lawBatchSize} remaining)`);
                    
                    if (this.lawRunesRemainingInBatch <= 0 && this.teleportsCompleted > 0) {
                        this.log('📦 Batch empty, going to bank for more...');
                        this.needBanking = true;
                    }
                }
                
                this.teleportDelay = 0;
            } else {
                this.log('❌ Teleport failed');
                if (Inventory.count('Law rune') < 1) {
                    this.needBanking = true;
                }
                this.teleportDelay = 1;
            }
            
        } catch (e) {
            this.log('❌ Error: ' + e);
            this.teleportDelay = 1;
        } finally {
            this.isCasting = false;
        }
    }

    private hasRequiredRunes(): boolean {
        if (!this.teleportMethod) return false;
        
        const cost = this.teleportMethod.runeCost;
        for (const [runeName, amount] of Object.entries(cost)) {
            const needed = amount as number;
            if (!this.hasRune(runeName, needed)) {
                return false;
            }
        }
        return true;
    }

    private getTotalLawRunes(): number {
        return Inventory.count('Law rune') + Bank.count('Law rune');
    }

    private async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && distanceTo(here, dest) <= radius) {
            return;
        }
        
        this.log('Walking to ' + dest.x + ',' + dest.z + '...');
        try {
            await Traversal.walkResilient(dest, { 
                radius, 
                attempts: 6, 
                timeoutMs: 30000,
                log: m => this.log('  ' + m) 
            });
        } catch (e) {
            this.log('⚠️ Walk failed: ' + e);
            const currentTile = Game.tile();
            if (currentTile && distanceTo(currentTile, dest) <= radius) {
                this.log('✓ Actually arrived despite error');
                return;
            }
            this.log('Retrying walk...');
            await Traversal.walkTo(dest, { radius, timeoutMs: 15000 });
        }
    }

    override onStop(): void {
        const runtime = Math.floor((Date.now() - this.startedAt) / 1000);
        const xpGained = Skills.xp('magic') - this.xpAtStart;
        
        this.log('=== AIO Teleport Stopped ===');
        this.log('Runtime: ' + formatTime(runtime));
        this.log('Teleports: ' + this.teleportsCompleted);
        this.log('Law runes used: ' + this.totalRunesUsed);
        this.log('Magic XP gained: ' + formatNumber(xpGained));
        this.log('Magic level: ' + Skills.level('magic'));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const runtime = Math.floor((Date.now() - this.startedAt) / 1000);
        const xpGained = Skills.xp('magic') - this.xpAtStart;
        const magicLevel = Skills.level('magic');
        const magicXp = Skills.xp('magic');
        
        ctx.font = '13px monospace';
        let y = 22;
        const lineHeight = 16;
        const indent = 12;
        
        ctx.fillStyle = '#66ccff';
        ctx.fillText('AIO Teleport', indent, y);
        y += lineHeight + 4;
        
        ctx.fillStyle = '#66ccff';
        
        // Show destination with progressive indicator
        let destDisplay = this.teleportMethod ? this.teleportMethod.destination : 'Unknown';
        if (this.isProgressiveMode) {
            destDisplay = '⚡ ' + destDisplay + ' (Progressive)';
        }
        ctx.fillText(`📍 ${destDisplay}`, indent, y);
        y += lineHeight + 4;
        
        ctx.fillText(`⏱ Runtime: ${formatTime(runtime)}`, indent, y);
        y += lineHeight + 4;
        
        ctx.fillText(`⚡ Magic: ${magicLevel} (${formatNumber(magicXp)} XP)`, indent, y);
        y += lineHeight + 4;
        
        ctx.fillText(`📈 XP Gained: +${formatNumber(xpGained)}`, indent, y);
        y += lineHeight + 4;
        
        const mins = runtime / 60;
        let xph: number = 0;
        if (mins > 0.5) {
            xph = (xpGained / mins) * 60;
        }
        ctx.fillText(`📊 XP/hr: ${formatNumber(xph)}`, indent, y);
        y += lineHeight + 4;
    }
}