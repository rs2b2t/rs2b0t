import ObjType from '#/client/config/ObjType.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

const MODE_HIGH = 'High';
const MODE_LOW = 'Low';
const MODE_OPTIONS = [MODE_HIGH, MODE_LOW] as const;
type AlchMode = (typeof MODE_OPTIONS)[number];

interface SpellDef {
    key: AlchMode;
    label: string;
    level: number;
    fire: number;
    ticks: number;
    names: string[];
}

type ItemQuery =
    | { kind: 'empty'; raw: string }
    | { kind: 'id'; raw: string; id: number; ids: Set<number>; name: string | null }
    | { kind: 'name'; raw: string; name: string };

const SPELLS: Record<AlchMode, SpellDef> = {
    [MODE_HIGH]: {
        key: MODE_HIGH,
        label: 'High Level Alchemy',
        level: 55,
        fire: 5,
        ticks: 5,
        names: ['High Level Alchemy', 'High alchemy', 'High Alchemy', 'High-level alchemy']
    },
    [MODE_LOW]: {
        key: MODE_LOW,
        label: 'Low Level Alchemy',
        level: 21,
        fire: 3,
        ticks: 3,
        names: ['Low Level Alchemy', 'Low alchemy', 'Low Alchemy', 'Low-level alchemy']
    }
};

const NATURE_RUNE_IDS = new Set([561]);
const FIRE_RUNE_IDS = new Set([554]);
const COINS_ID = 995;

const FIRE_STAFF_NAMES = [
    'Staff of fire',
    'Fire staff',
    'Fire battlestaff',
    'Mystic fire staff',
    'Lava battlestaff',
    'Mystic lava staff',
    'Steam battlestaff',
    'Mystic steam staff',
    'Smoke battlestaff',
    'Mystic smoke staff'
];

export const ALCHER_SETTINGS: SettingsSchema = {
    alchType: {
        type: 'string',
        default: MODE_HIGH,
        options: [...MODE_OPTIONS],
        label: 'Alchemy',
        group: 'Alch',
        help: 'High Level Alchemy (Magic 55, 5 fire + 1 nature) or Low Level Alchemy (Magic 21, 3 fire + 1 nature). A fire staff replaces fire runes.'
    },
    item: {
        type: 'string',
        default: '',
        label: 'Item name or ID',
        group: 'Alch',
        help: 'Exact item name (e.g. Yew longbow) or numeric object ID. Noted and unnoted both match. Stops when pack and bank are empty of that item or runes.'
    }
};

function normName(name: unknown): string {
    return String(name ?? '')
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function objType(id: number): ObjType | null {
    if (id < 0) {
        return null;
    }
    try {
        return ObjType.list(id) ?? null;
    } catch {
        return null;
    }
}

function relatedIds(id: number): Set<number> {
    const ids = new Set<number>([id]);
    const t = objType(id);
    if (!t) {
        return ids;
    }
    for (const other of [t.certlink, t.certtemplate]) {
        if (other >= 0 && other !== id) {
            ids.add(other);
            const pair = objType(other);
            if (pair && pair.certlink >= 0) {
                ids.add(pair.certlink);
            }
        }
    }
    return ids;
}

function isNoteId(id: number): boolean {
    const t = objType(id);
    return !!t && t.certtemplate >= 0 && t.certtemplate !== id;
}

function isNatureRune(name: string | null | undefined, id: number): boolean {
    if (NATURE_RUNE_IDS.has(id)) {
        return true;
    }
    const n = normName(name);
    return n === 'nature rune' || n === 'nature runes';
}

function isFireRune(name: string | null | undefined, id: number): boolean {
    if (FIRE_RUNE_IDS.has(id)) {
        return true;
    }
    const n = normName(name);
    return n === 'fire rune' || n === 'fire runes';
}

function isCoins(name: string | null | undefined, id: number): boolean {
    if (id === COINS_ID) {
        return true;
    }
    const n = normName(name);
    return n === 'coins' || n === 'coin';
}

function isFireStaffName(name: string | null | undefined): boolean {
    const n = normName(name);
    if (!n) {
        return false;
    }
    if (FIRE_STAFF_NAMES.some(s => normName(s) === n)) {
        return true;
    }
    return n.includes('staff') && (n.includes('fire') || n.includes('lava') || n.includes('steam') || n.includes('smoke'));
}

function parseItemQuery(raw: unknown): ItemQuery {
    const s = String(raw ?? '').trim();
    if (!s) {
        return { kind: 'empty', raw: '' };
    }
    if (/^\d+$/.test(s)) {
        const id = Number(s);
        return { kind: 'id', raw: s, id, ids: relatedIds(id), name: objType(id)?.name ?? null };
    }
    return { kind: 'name', raw: s, name: s };
}

function spellFor(mode: string): SpellDef {
    return SPELLS[mode as AlchMode] ?? SPELLS[MODE_HIGH];
}

function itemCountBy(pred: (name: string | null, id: number) => boolean): number {
    return Inventory.items()
        .filter(i => pred(i.name, i.id))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

function natureCount(): number {
    return itemCountBy(isNatureRune);
}

function fireCount(): number {
    return itemCountBy(isFireRune);
}

function hasFireStaff(): boolean {
    if (FIRE_STAFF_NAMES.some(n => Equipment.contains(n))) {
        return true;
    }
    return Equipment.items().some(i => isFireStaffName(i.name));
}

function packFireStaff(): InvItem | null {
    return Inventory.items().find(i => isFireStaffName(i.name)) ?? null;
}

function isProtected(name: string | null | undefined, id: number, query: ItemQuery): boolean {
    if (isCoins(name, id) || isNatureRune(name, id) || isFireRune(name, id) || isFireStaffName(name)) {
        return true;
    }
    if (query.kind === 'id' && query.ids.has(id)) {
        return false;
    }
    return false;
}

function itemMatchesQuery(item: { name?: string | null; id: number } | null | undefined, query: ItemQuery): boolean {
    if (!item || query.kind === 'empty') {
        return false;
    }
    if (isProtected(item.name, item.id, query)) {
        return false;
    }
    if (query.kind === 'id') {
        return query.ids.has(item.id);
    }
    return normName(item.name) === normName(query.name);
}

function pickBestStack(items: InvItem[]): InvItem | null {
    if (!items.length) {
        return null;
    }
    return [...items].sort((a, b) => {
        const noteDiff = Number(isNoteId(b.id)) - Number(isNoteId(a.id));
        if (noteDiff !== 0) {
            return noteDiff;
        }
        return Math.max(1, b.count) - Math.max(1, a.count);
    })[0];
}

function findTargetItem(query: ItemQuery): InvItem | null {
    const items = Inventory.items().filter(i => itemMatchesQuery(i, query));
    if (items.length === 0 && query.kind === 'name') {
        const want = normName(query.name);
        if (want.length >= 3) {
            const fuzzy = Inventory.items().filter(i => {
                if (isProtected(i.name, i.id, query)) {
                    return false;
                }
                const have = normName(i.name);
                return have === want || have.includes(want);
            });
            if (fuzzy.length === 1) {
                return fuzzy[0];
            }
            const exactish = fuzzy.filter(i => normName(i.name) === want);
            if (exactish.length > 0) {
                return pickBestStack(exactish);
            }
        }
        return null;
    }
    return pickBestStack(items);
}

function targetCount(query: ItemQuery): number {
    if (query.kind === 'empty') {
        return 0;
    }
    return Inventory.items()
        .filter(i => itemMatchesQuery(i, query))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}

function bankItemMatches(item: { name?: string | null; id: number } | null | undefined, query: ItemQuery): boolean {
    if (!item || query.kind === 'empty') {
        return false;
    }
    if (isProtected(item.name, item.id, query)) {
        return false;
    }
    if (query.kind === 'id') {
        return query.ids.has(item.id);
    }
    return normName(item.name) === normName(query.name);
}

function fireNeeded(spell: SpellDef): number {
    return hasFireStaff() ? 0 : spell.fire;
}

function fmtXph(n: number): string {
    return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

export default class Alcher extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private mode: AlchMode = MODE_HIGH;
    private query: ItemQuery = parseItemQuery('');
    private itemLabel = '';
    private startedAt = Date.now();
    private magicXpAtStart = 0;
    private casts = 0;
    private failStreak = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null && reader.inventorySize() > 0, 0);
        this.startedAt = Date.now();
        this.magicXpAtStart = Skills.xp('magic');
        this.casts = 0;
        this.failStreak = 0;
        this.syncSettings();

        if (this.query.kind === 'empty') {
            ScriptRunner.stop('enter an item name or ID in the script settings');
            return;
        }

        const spell = spellFor(this.mode);
        const magic = Skills.level('magic');
        this.log(
            `Alcher — ${spell.label} (Magic ${magic}, need ${spell.level}) on ${this.itemLabel}` +
                (this.query.kind === 'id' ? ` (id ${this.query.id})` : '')
        );
        if (magic < spell.level) {
            ScriptRunner.stop(`Magic ${magic} < ${spell.level} for ${spell.label}`);
        }
        this.status = 'ready';
    }

    override onStop(): void {
        const xp = Math.max(0, Skills.xp('magic') - this.magicXpAtStart);
        this.log(`stopped — ${this.casts} ${spellFor(this.mode).key.toLowerCase()} alchs, +${fmtXph(xp)} magic xp (${this.status})`);
    }

    private syncSettings(): void {
        const modeRaw = this.settings.str('alchType', MODE_HIGH);
        this.mode = MODE_OPTIONS.includes(modeRaw as AlchMode) ? (modeRaw as AlchMode) : MODE_HIGH;
        this.query = parseItemQuery(this.settings.str('item', ''));
        this.itemLabel =
            this.query.kind === 'id'
                ? this.query.name || `id ${this.query.id}`
                : this.query.kind === 'name'
                  ? this.query.name
                  : '(none)';
    }

    override async loop(): Promise<void> {
        if (!Game.ingame()) {
            return;
        }
        this.syncSettings();
        if (this.query.kind === 'empty') {
            ScriptRunner.stop('enter an item name or ID');
            return;
        }
        if (ChatDialog.canContinue()) {
            this.status = 'continue dialog';
            await ChatDialog.continue();
            return;
        }

        const spell = spellFor(this.mode);
        if (Skills.level('magic') < spell.level) {
            ScriptRunner.stop(`Magic ${Skills.level('magic')} < ${spell.level} for ${spell.label}`);
            return;
        }
        if (this.failStreak >= 8) {
            ScriptRunner.stop('alch keep failing (spell, runes, or item?)');
            return;
        }

        if (Bank.isOpen() && this.canAlchNow(spell)) {
            await Bank.close();
            await Execution.delayTicks(1);
        }

        const staff = packFireStaff();
        if (!hasFireStaff() && staff && fireCount() < spell.fire && staff.name) {
            this.status = `wield ${staff.name}`;
            this.log(`wielding ${staff.name} for fire runes`);
            await Equipment.equip(staff.name);
            await Execution.delayTicks(1);
        }

        if (this.canAlchNow(spell)) {
            await this.alchOnce(spell);
            return;
        }
        await this.bankRestock(spell);
    }

    private canAlchNow(spell: SpellDef): boolean {
        return targetCount(this.query) > 0 && natureCount() > 0 && fireCount() >= fireNeeded(spell);
    }

    private missingReason(spell: SpellDef): string {
        if (targetCount(this.query) <= 0) {
            return `no ${this.itemLabel} in pack`;
        }
        if (natureCount() <= 0) {
            return 'no Nature runes';
        }
        if (fireCount() < fireNeeded(spell)) {
            return `need ${spell.fire} Fire runes (or a fire staff)`;
        }
        return 'ready';
    }

    private async alchOnce(spell: SpellDef): Promise<void> {
        const item = findTargetItem(this.query);
        if (!item) {
            return;
        }
        const before = targetCount(this.query);
        const beforeXp = Skills.xp('magic');
        this.itemLabel = item.name || this.itemLabel;
        this.status = `${spell.key} alch ${item.name ?? this.itemLabel}`;
        this.log(`${spell.label} → ${item.name ?? this.itemLabel} (id ${item.id}) ×${before}`);

        let dispatched = false;
        for (const name of spell.names) {
            if (await Game.castOnInv(name, item)) {
                dispatched = true;
                break;
            }
        }
        if (!dispatched) {
            this.failStreak++;
            this.log(`cast failed (spell com / inv target?) streak ${this.failStreak}`);
            return;
        }

        const ok = await Execution.delayUntil(
            () => targetCount(this.query) < before || Skills.xp('magic') > beforeXp,
            Math.max(2500, spell.ticks * 700)
        );
        if (ok) {
            this.casts++;
            this.failStreak = 0;
            await Execution.delayUntil(() => !Game.animating(), spell.ticks * 600 + 400);
            return;
        }
        this.failStreak++;
        this.log(`alch did not consume an item — streak ${this.failStreak}`);
    }

    private async bankRestock(spell: SpellDef): Promise<void> {
        this.status = 'banking';
        this.log(`banking — ${this.missingReason(spell)}`);

        if (!Bank.isOpen()) {
            if (!(await Banking.open({ log: m => this.log(`  ${m}`) }))) {
                if (targetCount(this.query) <= 0) {
                    ScriptRunner.stop(`no ${this.itemLabel} left and could not open a bank`);
                    return;
                }
                this.log('could not open bank — retrying');
                return;
            }
        }
        await Execution.delayUntil(() => Bank.loaded() || Bank.items().length > 0, 3000);

        await Bank.depositAllMatching((name, id) => {
            if (isNatureRune(name, id) || isFireRune(name, id) || isFireStaffName(name) || isCoins(name, id)) {
                return false;
            }
            if (bankItemMatches({ name, id }, this.query) || itemMatchesQuery({ name, id }, this.query)) {
                return false;
            }
            return !!name;
        });
        await Execution.delayTicks(1);

        if (natureCount() <= 0) {
            const nat = Bank.items().find(i => isNatureRune(i.name, i.id));
            if (!nat) {
                ScriptRunner.stop('no Nature runes in pack or bank');
                return;
            }
            const op = withdrawOp(nat.ops, 'all') ?? 'Withdraw-All';
            this.log('withdrawing Nature runes');
            await Bank.withdrawById(nat.id, op);
            await Execution.delayTicks(1);
        }

        if (!hasFireStaff() && fireCount() < spell.fire) {
            const staff = Bank.items().find(i => isFireStaffName(i.name));
            if (staff?.name) {
                this.log(`withdrawing ${staff.name}`);
                await Bank.withdraw(staff.name, 'Withdraw-1');
                await Execution.delayTicks(1);
            } else {
                const fires = Bank.items().find(i => isFireRune(i.name, i.id));
                if (!fires) {
                    ScriptRunner.stop('no Fire runes or fire staff in pack or bank');
                    return;
                }
                const op = withdrawOp(fires.ops, 'all') ?? 'Withdraw-All';
                this.log('withdrawing Fire runes');
                await Bank.withdrawById(fires.id, op);
                await Execution.delayTicks(1);
            }
        }

        if (targetCount(this.query) <= 0) {
            const rows = Bank.items().filter(i => bankItemMatches(i, this.query));
            if (rows.length === 0) {
                ScriptRunner.stop(`no ${this.itemLabel} left in pack or bank`);
                return;
            }
            const row = rows.find(r => !isNoteId(r.id)) ?? rows[0];
            this.log(`withdrawing ${row.name ?? this.itemLabel} as notes`);
            await Bank.setNoteMode(true);
            const op = withdrawOp(row.ops, 'all') ?? 'Withdraw-All';
            let ok = !!(await Bank.withdrawById(row.id, op));
            if (!ok && row.name) {
                ok = !!(await Bank.withdraw(row.name, op));
            }
            await Execution.delayTicks(1);
            await Bank.setNoteMode(false);
            if (targetCount(this.query) <= 0) {
                this.log('withdraw did not land the alch item — retrying');
                return;
            }
        }

        await Bank.close();
        this.status = 'alching';
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const spell = spellFor(this.mode);
        const elapsed = Date.now() - this.startedAt;
        const hours = elapsed / 3_600_000;
        const xp = Math.max(0, Skills.xp('magic') - this.magicXpAtStart);
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c9a0dc' });
        p.title(`Alcher — ${spell.key}  Magic ${Skills.level('magic')}`);
        p.row(`Runtime: ${fmtDuration(elapsed / 60_000)}`, this.status);
        p.row(`Item: ${this.itemLabel}`, this.query.kind === 'id' ? `id ${this.query.id}` : '');
        p.row(`Casts: ${this.casts}`, `${fmtXph(hours > 0 ? this.casts / hours : 0)}/hr`, `held ${targetCount(this.query)}`);
        p.row(`XP +${fmtXph(xp)}`, `${fmtXph(hours > 0 ? xp / hours : 0)}/hr`);
        p.row(`Nature ${natureCount()}`, `Fire ${hasFireStaff() ? 'staff' : fireCount()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
