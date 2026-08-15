/** Rune essence mine, the instanced region Aubury and the Varrock portal teleport into. */
export function inEssMine(x: number, z: number): boolean {
    return (x >> 6) === 45 && (z >> 6) === 75;
}
