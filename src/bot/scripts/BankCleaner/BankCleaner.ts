import ObjType from '#/client/config/ObjType.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

const BANK_SWAP_FALLBACK = 5392;
const SWAP_DELAY_MS = 90;
const RESYNC_EVERY = 8;

const CAT = {
    CURRENCY: 0,
    QUEST: 1,
    TOOLS: 2,
    JEWELLERY: 3,
    RUNES: 4,
    STAVES: 5,
    TALISMANS: 6,
    ESSENCE: 7,
    ORES: 8,
    BARS: 9,
    GEMS: 10,
    HERBS: 11,
    POTIONS: 12,
    FOOD: 13,
    RAW: 14,
    LOGS: 15,
    FLETCHING: 16,
    CRAFTING: 17,
    FARMING: 18,
    PRAYER: 19,
    AMMO: 20,
    WEAPONS: 21,
    ARMOUR: 22,
    MAGIC_ARMOUR: 23,
    CLOTHES: 24,
    MISC: 25
} as const;

const CAT_LABELS = [
    'Coins',
    'Quest',
    'Tools',
    'Jewellery',
    'Runes',
    'Staves',
    'Talismans',
    'Essence',
    'Ores',
    'Bars',
    'Gems',
    'Herbs',
    'Potions',
    'Food',
    'Raw food',
    'Logs',
    'Fletching',
    'Crafting',
    'Farming',
    'Prayer',
    'Ammo',
    'Weapons',
    'Armour',
    'Magic gear',
    'Clothes',
    'Misc'
] as const;

const RUNE_ORDER = [
    'air',
    'mind',
    'water',
    'earth',
    'fire',
    'body',
    'cosmic',
    'chaos',
    'nature',
    'law',
    'death',
    'astral',
    'blood',
    'soul',
    'wrath',
    'dust',
    'mud',
    'smoke',
    'steam',
    'lava',
    'mist'
] as const;
const ORE_ORDER = [
    'clay',
    'copper',
    'tin',
    'iron',
    'silver',
    'coal',
    'gold',
    'mithril',
    'adamant',
    'adamantite',
    'runite',
    'rune',
    'blurite',
    'elemental',
    'luminite',
    'daeyalt',
    'amethyst'
] as const;
const BAR_ORDER = ['bronze', 'iron', 'silver', 'steel', 'gold', 'mithril', 'adamant', 'adamantite', 'rune', 'runite', 'blurite', 'elemental'] as const;
const METAL_ORDER = ['bronze', 'iron', 'steel', 'black', 'white', 'mithril', 'adamant', 'adamantite', 'rune', 'runite', 'dragon'] as const;
const WEAPON_KIND = [
    'dagger',
    'sword',
    'longsword',
    'scimitar',
    'mace',
    'warhammer',
    'battleaxe',
    'hatchet',
    'axe',
    'pickaxe',
    'spear',
    'hasta',
    'halberd',
    '2h',
    'claws',
    'whip',
    'scythe',
    'bow',
    'crossbow',
    'knife',
    'dart',
    'javelin',
    'thrownaxe'
] as const;
const ARMOUR_SLOT = [
    'full helm',
    'med helm',
    'helm',
    'hood',
    'coif',
    'hat',
    'body',
    'platebody',
    'chainbody',
    'top',
    'platelegs',
    'plateskirt',
    'legs',
    'skirt',
    'chaps',
    'kiteshield',
    'sq shield',
    'shield',
    'boots',
    'gloves',
    'vambraces',
    'gauntlets'
] as const;
const GEM_ORDER = ['opal', 'jade', 'red topaz', 'sapphire', 'emerald', 'ruby', 'diamond', 'dragonstone', 'onyx', 'zenyte'] as const;
const LOG_ORDER = ['logs', 'oak', 'willow', 'teak', 'maple', 'mahogany', 'yew', 'magic', 'redwood'] as const;
const STAFF_ORDER = [
    'staff of air',
    'staff of water',
    'staff of earth',
    'staff of fire',
    'air staff',
    'water staff',
    'earth staff',
    'fire staff',
    'magic staff',
    'battlestaff',
    'air battlestaff',
    'water battlestaff',
    'earth battlestaff',
    'fire battlestaff',
    'lava battlestaff',
    'mud battlestaff',
    'steam battlestaff',
    'smoke battlestaff',
    'dust battlestaff',
    'mist battlestaff',
    'mystic air staff',
    'mystic water staff',
    'mystic earth staff',
    'mystic fire staff',
    'mystic lava staff',
    'mystic mud staff',
    'mystic steam staff',
    'mystic smoke staff',
    'ancient staff',
    'slayer staff',
    "iban's staff",
    'iban staff',
    'saradomin staff',
    'guthix staff',
    'zamorak staff',
    'staff'
] as const;

interface LayoutItem {
    key: number;
    slot: number;
    id: number;
    name: string;
    count: number;
    comId: number;
}

type SortKey = [number, number, number, string, number];

export const BANK_CLEANER_SETTINGS: SettingsSchema = {
    depositFirst: {
        type: 'boolean',
        default: false,
        label: 'Deposit pack first',
        group: 'Bank',
        help: 'Dump the inventory into the bank before sorting.'
    },
    closeWhenDone: {
        type: 'boolean',
        default: true,
        label: 'Close bank when done',
        group: 'Bank',
        help: 'Close the bank interface after the sort finishes.'
    }
};

function compactName(name: unknown): string {
    return String(name ?? '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function indexIn(list: readonly string[], n: string): number {
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (n === item || n.startsWith(`${item} `) || n.endsWith(` ${item}`) || n.includes(item)) {
            return i;
        }
    }
    return 99;
}

function metalRank(n: string): number {
    return indexIn(METAL_ORDER, n);
}

function objType(id: number): ObjType | null {
    if (id < 0) {
        return null;
    }
    try {
        return ObjType.list(id);
    } catch {
        return null;
    }
}

function isNoteId(id: number): boolean {
    const t = objType(id);
    return !!t && t.certtemplate >= 0 && t.certtemplate !== id;
}

function uncertId(id: number): number {
    const t = objType(id);
    if (t && t.certtemplate >= 0 && t.certtemplate !== id && t.certlink >= 0) {
        return t.certlink;
    }
    return id;
}

function displayName(id: number, fallback: string): string {
    return objType(uncertId(id))?.name || fallback || '';
}

function classify(name: string | null | undefined, id: number): { cat: number; sub: number; noted: number; label: string } {
    const noted = isNoteId(id) ? 1 : 0;
    const n = compactName(displayName(id, name ?? ''));
    if (!n || n === 'null' || n === 'dwarf remains') {
        return { cat: CAT.MISC, sub: 900, noted, label: n || `id ${id}` };
    }
    if (n === 'coins' || n === 'coin' || n === 'tokkul' || n === 'trading sticks' || n === 'platinum token') {
        return { cat: CAT.CURRENCY, sub: 0, noted, label: n };
    }
    if (/\b(talisman|tiara)\b/.test(n)) {
        return { cat: CAT.TALISMANS, sub: indexIn(RUNE_ORDER, n), noted, label: n };
    }
    if (/\b(pure essence|rune essence|essence)\b/.test(n) && !n.includes('ore')) {
        return { cat: CAT.ESSENCE, sub: n.includes('pure') ? 1 : 0, noted, label: n };
    }
    if (/\brunes?\b/.test(n) && !n.includes('essence') && !n.includes('pickaxe') && !n.includes('axe')) {
        return { cat: CAT.RUNES, sub: indexIn(RUNE_ORDER, n), noted, label: n };
    }
    if (/\b(staff|stave|battlestaff|wand)\b/.test(n)) {
        const exact = STAFF_ORDER.findIndex(s => n === s || n.startsWith(s));
        return { cat: CAT.STAVES, sub: exact >= 0 ? exact : 80 + indexIn(RUNE_ORDER, n), noted, label: n };
    }
    if (/\bore\b/.test(n) || n === 'coal' || n === 'clay' || n === 'tin' || n === 'copper') {
        return { cat: CAT.ORES, sub: indexIn(ORE_ORDER, n), noted, label: n };
    }
    if (/\bbar\b/.test(n)) {
        return { cat: CAT.BARS, sub: indexIn(BAR_ORDER, n), noted, label: n };
    }
    if (
        /\b(uncut|sapphire|emerald|ruby|diamond|dragonstone|onyx|zenyte|opal|jade|topaz)\b/.test(n) &&
        !n.includes('amulet') &&
        !n.includes('necklace') &&
        !n.includes('ring') &&
        !n.includes('bracelet')
    ) {
        return { cat: CAT.GEMS, sub: (n.includes('uncut') ? 0 : 1) * 20 + indexIn(GEM_ORDER, n), noted, label: n };
    }
    if (/\b(ring|amulet|necklace|bracelet|glory|wealth|dueling|duelling|games necklace|combat bracelet|skills necklace)\b/.test(n)) {
        return { cat: CAT.JEWELLERY, sub: metalRank(n), noted, label: n };
    }
    if (
        /\b(pickaxe|hatchet|tinderbox|hammer|knife|chisel|needle|shears|spade|rake|secateurs|harpoon|lobster pot|small fishing net|big fishing net|fishing rod|fly fishing rod|barbarian rod|saw|glassblowing|pestle|crucible|mould)\b/.test(
            n
        )
    ) {
        return { cat: CAT.TOOLS, sub: metalRank(n), noted, label: n };
    }
    if (
        /\b(grimy|herb|guam|marrentill|tarromin|harralander|ranarr|toadflax|irit|avantoe|kwuarm|snapdragon|cadantine|lantadyme|dwarf weed|torstol)\b/.test(n) &&
        !n.includes('potion') &&
        !n.includes('seed')
    ) {
        return { cat: CAT.HERBS, sub: 0, noted, label: n };
    }
    if (/\b(potion|dose|vial|eye of newt|unicorn horn|snape grass|limpwurt|wine of zamorak|white berries|goat horn)\b/.test(n)) {
        return { cat: CAT.POTIONS, sub: 0, noted, label: n };
    }
    if (/\b(seed|sapling|compost|supercompost|rake|seed dibber)\b/.test(n)) {
        return { cat: CAT.FARMING, sub: 0, noted, label: n };
    }
    if (/\b(bones|big bones|dragon bones|wyvern|ashes|ensouled)\b/.test(n)) {
        return { cat: CAT.PRAYER, sub: 0, noted, label: n };
    }
    if (/\b(arrow|bolt|brutal|cannonball|javelin heads|arrowtips)\b/.test(n)) {
        return { cat: CAT.AMMO, sub: metalRank(n), noted, label: n };
    }
    if (/\b(bow string|bowstring|feather|arrow shaft|headless|unstrung|(u)\b|flax)\b/.test(n) || /\bbow\b/.test(n)) {
        return { cat: CAT.FLETCHING, sub: indexIn(LOG_ORDER, n) * 4 + (n.includes('(u)') || n.includes('unstrung') ? 0 : 1), noted, label: n };
    }
    if (/\b(logs?|kindling)\b/.test(n)) {
        return { cat: CAT.LOGS, sub: indexIn(LOG_ORDER, n), noted, label: n };
    }
    if (/\b(cowhide|leather|dragonhide|d hide|thread|wool|ball of wool|silk|molten glass|soda ash|bucket of sand)\b/.test(n)) {
        return { cat: CAT.CRAFTING, sub: 0, noted, label: n };
    }
    if (/^raw\b/.test(n) || /\braw\b/.test(n)) {
        return { cat: CAT.RAW, sub: 0, noted, label: n };
    }
    if (/\b(shrimp|anchov|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish|shark|manta|karambwan|cake|bread|meat|chicken|stew|pizza|pie|potato|wine|beer|kebab)\b/.test(n)) {
        return { cat: CAT.FOOD, sub: n.includes('burnt') ? 80 : 0, noted, label: n };
    }
    if (/\b(robe|wizard|mystic|splitbark|ahrim|ancestral|infinity)\b/.test(n)) {
        return { cat: CAT.MAGIC_ARMOUR, sub: 0, noted, label: n };
    }
    if (/\b(cape|cloak|boots|gloves|hat|hood|skirt|gown|apron|eye patch|eyepatch|desert)\b/.test(n) && metalRank(n) >= 90) {
        return { cat: CAT.CLOTHES, sub: 0, noted, label: n };
    }
    if (ARMOUR_SLOT.find(s => n.includes(s)) || /\b(plate|chain|shield|helm|kiteshield)\b/.test(n)) {
        return { cat: CAT.ARMOUR, sub: metalRank(n) * 30 + indexIn(ARMOUR_SLOT, n), noted, label: n };
    }
    if (WEAPON_KIND.find(s => n.includes(s))) {
        return { cat: CAT.WEAPONS, sub: metalRank(n) * 40 + indexIn(WEAPON_KIND, n), noted, label: n };
    }
    if (/\b(key|map|scroll|certificate|book|lamp|quest|garlic|stake|hammer)\b/.test(n) && n !== 'hammer') {
        return { cat: CAT.QUEST, sub: 0, noted, label: n };
    }
    return { cat: CAT.MISC, sub: 0, noted, label: n };
}

function sortTuple(item: LayoutItem): SortKey {
    const c = classify(item.name, item.id);
    return [c.cat, c.sub, c.noted, c.label, item.id];
}

function compareItems(a: LayoutItem, b: LayoutItem): number {
    const ka = sortTuple(a);
    const kb = sortTuple(b);
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) {
            return -1;
        }
        if (ka[i] > kb[i]) {
            return 1;
        }
    }
    return 0;
}

function walkCache(): { named: number; counts: number[] } {
    const counts = new Array<number>(CAT_LABELS.length).fill(0);
    let named = 0;
    const cap = ObjType.numDefinitions || 8000;
    let miss = 0;
    for (let id = 0; id < cap && miss < 400; id++) {
        const t = objType(id);
        if (!t?.name) {
            miss++;
            continue;
        }
        miss = 0;
        if (t.certtemplate >= 0 && t.certtemplate !== id) {
            continue;
        }
        named++;
        counts[classify(t.name, id).cat]++;
    }
    return { named, counts };
}

function layoutSnapshot(): LayoutItem[] {
    return Bank.items()
        .filter(i => i && i.slot >= 0 && i.id >= 0)
        .map((i, key) => ({
            key,
            slot: i.slot,
            id: i.id,
            name: i.name ?? displayName(i.id, ''),
            count: i.count ?? 1,
            comId: i.comId
        }));
}

function alreadySorted(layout: LayoutItem[]): boolean {
    const wanted = layout.slice().sort(compareItems);
    for (let i = 0; i < wanted.length; i++) {
        const at = layout.find(x => x.slot === i);
        if (!at || at.key !== wanted[i].key) {
            return false;
        }
    }
    return true;
}

async function ensureSwapMode(): Promise<void> {
    const main = reader.modals().main;
    const swap = main !== -1 ? reader.buttonByText(main, 'Swap') : -1;
    const id = swap >= 0 ? swap : BANK_SWAP_FALLBACK;
    if (id >= 0) {
        actions.ifButton(id);
        await Execution.delayTicks(1);
    }
}

export default class BankCleaner extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private swaps = 0;
    private stacks = 0;
    private catalogNamed = 0;
    private failStreak = 0;
    private lastMove = '';
    private depositFirst = false;
    private closeWhenDone = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.startedAt = Date.now();
        this.swaps = 0;
        this.failStreak = 0;
        this.syncSettings();
        const cache = walkCache();
        this.catalogNamed = cache.named;
        const filled = cache.counts
            .map((n, i) => (n > 0 ? `${CAT_LABELS[i]} ${n}` : null))
            .filter((line): line is string => Boolean(line))
            .slice(0, 8)
            .join(', ');
        this.log(`BankCleaner — slot-swap sort (INV_BUTTOND). Cache ${cache.named} items. ${filled}`);
        this.status = 'ready';
    }

    override onStop(): void {
        this.log(`stopped — ${this.swaps} swaps, ${this.stacks} stacks (${this.status})`);
    }

    private syncSettings(): void {
        this.depositFirst = this.settings.bool('depositFirst', false);
        this.closeWhenDone = this.settings.bool('closeWhenDone', true);
    }

    override async loop(): Promise<void> {
        if (!Game.ingame()) {
            return;
        }
        this.syncSettings();
        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            return;
        }

        if (!Bank.isOpen()) {
            this.status = 'opening bank';
            const opened = await Banking.open({ log: m => this.log(`  ${m}`) });
            if (!opened && !Bank.isOpen()) {
                this.failStreak++;
                if (this.failStreak >= 6) {
                    ScriptRunner.stop('could not open a bank (stand at a booth)');
                    return;
                }
                this.log('could not open bank — retrying');
                return;
            }
        }

        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 4000);
        this.failStreak = 0;

        if (this.depositFirst) {
            this.status = 'depositing pack';
            await Bank.depositInventory();
            await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 4000);
        }

        await ensureSwapMode();

        const layout = layoutSnapshot();
        this.stacks = layout.length;
        if (layout.length === 0) {
            ScriptRunner.stop('bank is empty — nothing to sort');
            return;
        }
        if (alreadySorted(layout)) {
            if (this.closeWhenDone && Bank.isOpen()) {
                await Bank.close();
            }
            ScriptRunner.stop(`already sorted (${layout.length} stacks)`);
            return;
        }

        const moved = await this.sortLayout(layout);
        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 2000);
        const after = layoutSnapshot();
        const neat = alreadySorted(after);
        if (this.closeWhenDone && Bank.isOpen()) {
            await Bank.close();
        }
        if (neat) {
            ScriptRunner.stop(`sorted ${after.length} stacks with ${this.swaps} swaps`);
            return;
        }
        if (moved <= 0) {
            ScriptRunner.stop('could not send bank swaps');
            return;
        }
        ScriptRunner.stop(`partial sort — ${this.swaps} swaps, ${after.length} stacks (re-run if gaps remain)`);
    }

    private async sortLayout(start: LayoutItem[]): Promise<number> {
        const layout = start.slice();
        const wanted = layout.slice().sort(compareItems);
        const comId = layout[0]?.comId;
        if (comId == null) {
            return 0;
        }

        let moved = 0;
        for (let dest = 0; dest < wanted.length; dest++) {
            const wantKey = wanted[dest].key;
            const from = layout.find(x => x.key === wantKey);
            if (!from || from.slot === dest) {
                continue;
            }

            this.status = `swap ${from.name || from.id} → slot ${dest + 1}`;
            this.lastMove = this.status;
            const gen = Bank.snapshotGeneration();
            if (!actions.invButtonD(comId, from.slot, dest, 0)) {
                this.log('INV_BUTTOND write failed');
                return moved;
            }

            const occupant = layout.find(x => x.slot === dest && x.key !== wantKey);
            const fromSlot = from.slot;
            from.slot = dest;
            if (occupant) {
                occupant.slot = fromSlot;
            }

            this.swaps++;
            moved++;
            await Execution.delay(SWAP_DELAY_MS);

            if (moved % RESYNC_EVERY === 0) {
                await Bank.waitSnapshotAfter(gen, 2000);
                const live = layoutSnapshot();
                if (live.length === layout.length) {
                    const byId = new Map(live.map(i => [`${i.slot}:${i.id}`, i]));
                    for (const row of layout) {
                        const hit = byId.get(`${row.slot}:${row.id}`);
                        if (hit) {
                            row.slot = hit.slot;
                        }
                    }
                }
            }
        }
        return moved;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c4b28a' });
        p.title(`BankCleaner — ${this.status}`);
        p.row(`Runtime: ${fmtDuration((Date.now() - this.startedAt) / 60_000)}`, `Stacks: ${this.stacks}`, `Swaps: ${this.swaps}`);
        p.row(`Cache: ${this.catalogNamed} items`, 'swap packets (no drag)');
        p.row(this.lastMove || 'Runes · staves · ores pack together');
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
