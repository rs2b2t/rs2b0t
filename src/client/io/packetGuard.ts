// A wrong p1/p2/psmart does not throw — it leaves the read position short or long and
// silently corrupts whatever decodes next. Every fully-dispatched packet must consume
// exactly the byte count its header declared.
//
// Opcodes here legitimately ignore trailing bytes. Add one only with a comment naming
// the engine encoder that justifies it; never widen the condition to silence a failure.
const ALLOWLIST = new Set<number>([
    -1 // sentinel: no packet was dispatched on this call
]);

export function assertPacketConsumed(ptype: number, psize: number, pos: number): void {
    if (ALLOWLIST.has(ptype)) {
        return;
    }

    if (pos !== psize) {
        throw new Error(`packet ${ptype} declared ${psize} bytes, consumed ${pos}`);
    }
}
