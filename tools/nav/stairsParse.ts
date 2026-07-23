import type { NavPoint } from '#/bot/nav/PathFinder.js';

export function decodeCoord(s: string): NavPoint {
    const [level, mx, mz, lx, lz] = s.split('_').map(Number);
    return { x: mx * 64 + lx, z: mz * 64 + lz, level };
}

export function applyMovecoord(base: NavPoint, args: number[]): NavPoint {
    const [dx, dLevel, dz] = args;
    return { x: base.x + dx, z: base.z + dz, level: base.level + dLevel };
}

export interface StairCase {
    from: NavPoint;
    to: NavPoint;
    debugname: string;
    op: number;
}

const CASE_RE = /case\s+(\d+_\d+_\d+_\d+_\d+)\s*:\s*p_telejump\(\s*(movecoord\([^)]*\)|\d+(?:_\d+)+)\s*\)/g;
const MOVECOORD_RE = /^movecoord\(\s*(?:loc_)?coord\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
const LITERAL_RE = /^\d+(?:_\d+)+$/;

export function parseSwitchStairs(text: string): StairCase[] {
    const out: StairCase[] = [];
    const blockRe = /^\[oploc(\d+),([a-z0-9_]+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
        const op = Number(m[1]);
        const debugname = m[2];
        const end = text.indexOf('\n[', m.index + 1);
        const body = text.slice(m.index, end === -1 ? undefined : end);

        CASE_RE.lastIndex = 0;
        let c: RegExpExecArray | null;
        while ((c = CASE_RE.exec(body)) !== null) {
            const from = decodeCoord(c[1]);
            const dest = c[2].trim();
            const mv = MOVECOORD_RE.exec(dest);
            if (mv) {
                out.push({ from, to: applyMovecoord(from, [Number(mv[1]), Number(mv[2]), Number(mv[3])]), debugname, op });
            } else if (LITERAL_RE.test(dest)) {
                out.push({ from, to: decodeCoord(dest), debugname, op });
            }
        }
    }
    return out;
}
