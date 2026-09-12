// A wrong p1/p2/psmart silently shifts the read position and corrupts the next decode.
// Every dispatched packet must consume exactly the byte count in its header.
//
// Allow trailing bytes only for a named engine encoder that requires them.
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
