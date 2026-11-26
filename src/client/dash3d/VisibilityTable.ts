import { TypedArray4d } from '#/client/util/Arrays.js';

type VisibilityTable = boolean[][][][];
type FillTable = (table: VisibilityTable) => void;
type Wall = Window & { __rs2b0tVisibilityTableV1?: (key: string, fill: FillTable) => VisibilityTable };

export function emptyVisibilityTable(): VisibilityTable {
    return new TypedArray4d(8, 32, 51, 51, false);
}

function buildTable(fill: FillTable): VisibilityTable {
    const table = emptyVisibilityTable();
    fill(table);
    return table;
}

export function installVisibilityTableCache(wall: Wall): void {
    if (wall.__rs2b0tVisibilityTableV1) return;
    const tables = new Map<string, VisibilityTable>();
    wall.__rs2b0tVisibilityTableV1 = (key, fill) => {
        let table = tables.get(key);
        if (!table) {
            table = buildTable(fill);
            tables.set(key, table);
        }
        return table;
    };
}

function parentCache(): Wall['__rs2b0tVisibilityTableV1'] {
    try {
        return (globalThis.window?.parent as Wall | undefined)?.__rs2b0tVisibilityTableV1;
    } catch {
        return undefined;
    }
}

export function getVisibilityTable(key: string, fill: FillTable): VisibilityTable {
    const cached = parentCache();
    return cached ? cached(key, fill) : buildTable(fill);
}
