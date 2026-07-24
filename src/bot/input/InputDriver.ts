export interface InputDriver {
    readonly mode: 'direct';

    interactNpc(index: number, op: number): boolean;
    interactPlayer(index: number, op: number): boolean;
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean;
    takeObj(lx: number, lz: number, objId: number, op: number): boolean;
    heldOp(objId: number, slot: number, comId: number, op: number): boolean;
    invButton(objId: number, slot: number, comId: number, op: number): boolean;
    useItemOnLoc(useObjId: number, useSlot: number, useComId: number, lx: number, lz: number, typecode: number): boolean;
    useItemOnNpc(useObjId: number, useSlot: number, useComId: number, index: number): boolean;
    useItemOnItem(useObjId: number, useSlot: number, useComId: number, targetObjId: number, targetSlot: number, targetComId: number): boolean;
    castOnNpc(spellComId: number, index: number): boolean;
    walk(lx: number, lz: number): boolean;
    continueDialog(): boolean;
}
