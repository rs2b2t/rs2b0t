import { blocks, field } from '../lib/content.js';
import { SLOTS, type ItemRecord, type Slot } from '#/bot/api/loadout/types.js';

export interface ParsedItem {
    name: string;
    slot?: Slot;
    twoHanded: boolean;
    consumable?: 'eat' | 'drink';
    cost: number;
    members: boolean;
}

function isSlot(value: string | undefined): value is Slot {
    return value !== undefined && (SLOTS as readonly string[]).includes(value);
}

/** Any `iopN=Eat|Drink` makes the object something the supplies picker can offer. */
function consumableOf(lines: string[]): 'eat' | 'drink' | undefined {
    for (const line of lines) {
        const m = /^iop\d=(Eat|Drink)$/.exec(line);
        if (m) {
            return m[1] === 'Eat' ? 'eat' : 'drink';
        }
    }
    return undefined;
}

export function parseItemDefs(text: string): Record<string, ParsedItem> {
    const out: Record<string, ParsedItem> = {};
    for (const b of blocks(text)) {
        const wearpos = field(b.lines, 'wearpos');
        const slot = isSlot(wearpos) ? wearpos : undefined;
        const consumable = consumableOf(b.lines);
        if (!slot && !consumable) {
            continue;
        }
        out[b.id] = {
            name: field(b.lines, 'name') ?? b.id,
            slot,
            twoHanded: slot === 'righthand' && field(b.lines, 'wearpos2') === 'lefthand',
            consumable,
            cost: Number(field(b.lines, 'cost') ?? '1'),
            members: field(b.lines, 'members') === 'yes'
        };
    }
    return out;
}

/** `pack/obj.pack` lines are `id=debugname`. */
export function parseObjPack(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const line of text.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) {
            out.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
        }
    }
    return out;
}

export function joinItemDb(objs: Record<string, ParsedItem>, ids: Map<string, number>): ItemRecord[] {
    const out: ItemRecord[] = [];
    for (const [obj, parsed] of Object.entries(objs)) {
        const id = ids.get(obj);
        if (id === undefined) {
            continue;
        }
        const record: ItemRecord = {
            obj,
            id,
            name: parsed.name,
            cost: parsed.cost,
            members: parsed.members
        };
        if (parsed.slot) {
            record.slot = parsed.slot;
        }
        if (parsed.twoHanded) {
            record.twoHanded = true;
        }
        if (parsed.consumable) {
            record.consumable = parsed.consumable;
        }
        out.push(record);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.obj.localeCompare(b.obj));
}
