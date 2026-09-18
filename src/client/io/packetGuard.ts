export function assertPacketConsumed(ptype: number, psize: number, pos: number): void {
    if (ptype !== -1 && pos !== psize) {
        throw new Error(`packet ${ptype} declared ${psize} bytes, consumed ${pos}`);
    }
}
