import LocType from '#/client/config/LocType.js';
import VarBitType from '#/client/config/VarBitType.js';

export function resolveMultiloc(loc: LocType, varps: number[]): LocType | null {
    if (loc.multiloc.length === 0) {
        return loc;
    }

    const varbit = VarBitType.list[loc.multivarbit];
    if (!varbit) {
        return null;
    }

    const width = varbit.endbit - varbit.startbit;
    const mask = width === 32 ? -1 : (1 << width) - 1;
    const index = ((varps[varbit.basevar] ?? 0) >> varbit.startbit) & mask;
    const id = loc.multiloc[index];
    return id === undefined || id === -1 ? null : LocType.list(id);
}
