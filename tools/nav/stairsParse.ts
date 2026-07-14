/**
 * Pure parsers for the content pack's ladders+stairs/scripts/stairs.rs2 —
 * a set of `[oplocN,<debugname>]` blocks each holding
 * `switch_coord (loc_coord) { case <coord> : p_telejump(<dest>); ... }`.
 * Coord literal = level_mapsqX_mapsqZ_localX_localZ (world x=mx*64+lx).
 * dest is either a literal coord or movecoord(coord|loc_coord, dx, dLevel, dz).
 *
 * Only fully-formed switch_coord cases are baked. The real file also contains
 * shapes this generator deliberately ignores (they can't become a fixed graph
 * edge from the script alone):
 *   - switch_int (loc_angle) blocks (`case 0 :` … angle, not a coord) whose
 *     dest is movecoord(loc_coord, …) — resolvable only per loc instance.
 *   - random destinations, e.g. p_telejump(movecoord(<lit>, $randomX, 0, $randomZ)).
 *   - @stair_options(up, down) choice cases (no p_telejump) — the paired
 *     oploc2/oploc3 Climb-up/Climb-down blocks carry the same hops directly.
 * Requiring a 5-component case coord + a recognised dest form drops all of the
 * above without emitting garbage edges.
 */
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

// case coord must be a full level_mx_mz_lx_lz literal (5 components); a bare
// `case 0 :` is a switch_int (loc_angle) arm and must not be parsed as a coord.
const CASE_RE = /case\s+(\d+_\d+_\d+_\d+_\d+)\s*:\s*p_telejump\(\s*(movecoord\([^)]*\)|\d+(?:_\d+)+)\s*\)/g;
// movecoord relative to the player (coord) or the loc (loc_coord); both resolve
// against the case coord — the player arrives on the loc tile before telejump.
const MOVECOORD_RE = /^movecoord\(\s*(?:loc_)?coord\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
const LITERAL_RE = /^\d+(?:_\d+)+$/;

export function parseSwitchStairs(text: string): StairCase[] {
    const out: StairCase[] = [];
    const blockRe = /^\[oploc(\d+),([a-z0-9_]+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
        const op = Number(m[1]);
        const debugname = m[2];
        // body runs to the next block header of any kind so a trailing
        // [label,…]/[proc,…] block is never folded into this one.
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
            // else: unrecognised dest (random movecoord, etc.) — skip.
        }
    }
    return out;
}
