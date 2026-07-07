/**
 * Semantic input operations. DIRECT (Slice 3) dispatches them through the
 * client's doAction synchronously (boolean); SYNTHETIC (Slice 6) resolves
 * the same ops through a virtual cursor + the real minimenu, so its methods
 * return a Promise that settles when the gesture completes. `op` is the
 * 1-based option index (OP_*1..5), already resolved from an action name by
 * the entity layer. No silent fallback between modes — a synthetic failure
 * resolves false (and logs) rather than degrading to direct (ADR-0003).
 */
export interface InputDriver {
    /** The label telemetry/dataset rows get (PLAN.md §humanization). */
    readonly mode: 'direct' | 'synthetic';

    interactNpc(index: number, op: number): boolean | Promise<boolean>;
    /**
     * `viaMenu` (synthetic only): always right-click and pick the op from the
     * open menu, even when it's the left-click default — steadier on small or
     * thin models (agility ropes/logs) where hover-picking is noisy. Direct
     * mode dispatches the same packet either way and ignores it.
     */
    interactLoc(lx: number, lz: number, typecode: number, op: number, viaMenu?: boolean): boolean | Promise<boolean>;
    takeObj(lx: number, lz: number, objId: number, op: number): boolean | Promise<boolean>;
    heldOp(objId: number, slot: number, comId: number, op: number): boolean | Promise<boolean>;
    /** Component-defined item button (bank withdraw/deposit etc.). */
    invButton(objId: number, slot: number, comId: number, op: number): boolean | Promise<boolean>;
    /** Use a held item on a scenery loc (smithing anvil, runecraft altar, …). */
    useItemOnLoc(useObjId: number, useSlot: number, useComId: number, lx: number, lz: number, typecode: number): boolean | Promise<boolean>;
    /** Use a held item on an npc (e.g. payment/quest steps). */
    useItemOnNpc(useObjId: number, useSlot: number, useComId: number, index: number): boolean | Promise<boolean>;
    /** Use a held item on another held item (fletch knife→logs, herb→vial). */
    useItemOnItem(useObjId: number, useSlot: number, useComId: number, targetObjId: number, targetSlot: number, targetComId: number): boolean | Promise<boolean>;
    /** Cast a side-tab spell (a BUTTON_TARGET component) on an npc. */
    castOnNpc(spellComId: number, index: number): boolean | Promise<boolean>;
    walk(lx: number, lz: number): boolean | Promise<boolean>;
    continueDialog(): boolean | Promise<boolean>;
}
