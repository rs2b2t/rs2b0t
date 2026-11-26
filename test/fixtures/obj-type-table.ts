import ObjType from '#/client/config/ObjType.js';

export function installObjTypeTable(entries: Record<number, Partial<ObjType>>, defaultCost = 1): void {
    ObjType.numDefinitions = Math.max(...Object.keys(entries).map(Number)) + 1;
    ObjType.list = id => Object.assign(new ObjType(), { id, cost: defaultCost }, entries[id]);
}
