/**
 * Semantic input operations, dispatched through the client's own doAction
 * synchronously — rs2b0t is direct-only (ADR-0003): byte-identical OP
 * packets, no cursor telemetry. `op` is the 1-based option index (OP_*1..5),
 * already resolved from an action name by the entity layer.
 */
export interface InputDriver {
    /** The label telemetry/dataset rows get. */
    readonly mode: 'direct';

    interactNpc(index: number, op: number): boolean;
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean;
    takeObj(lx: number, lz: number, objId: number, op: number): boolean;
    heldOp(objId: number, slot: number, comId: number, op: number): boolean;
    /** Component-defined item button (bank withdraw/deposit etc.). */
    invButton(objId: number, slot: number, comId: number, op: number): boolean;
    /** Use a held item on a scenery loc (smithing anvil, furnace, …). */
    useItemOnLoc(useObjId: number, useSlot: number, useComId: number, lx: number, lz: number, typecode: number): boolean;
    /** Use a held item on an npc (e.g. payment/quest steps). */
    useItemOnNpc(useObjId: number, useSlot: number, useComId: number, index: number): boolean;
    /** Use a held item on another held item (knife→logs, herb→vial). */
    useItemOnItem(useObjId: number, useSlot: number, useComId: number, targetObjId: number, targetSlot: number, targetComId: number): boolean;
    /** Cast a side-tab spell (a BUTTON_TARGET component) on an npc. */
    castOnNpc(spellComId: number, index: number): boolean;
    walk(lx: number, lz: number): boolean;
    continueDialog(): boolean;
}
