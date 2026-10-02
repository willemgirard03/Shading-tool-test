/* The whole working storey, in the selected unit's coordinates.

   The window drawings - the plan, the section and the window in 3D - are cut
   and drawn in the frame of the selected unit: u across it from its middle,
   v up from the floor, w out from its glass. The rest of the storey is laid
   into that frame here: every unit of every side, the plain wall a spaced
   layout leaves at the ends of a side, and a side with no glazing at all.

   Each part keeps its own local frame (u from the part's middle, w from its
   own glass or wall face) so its cell can be built and cut exactly as it
   always is, and carries the affine map from there into the selected frame.
   The sides are square to one another, so the map is a quarter turn or a half
   turn and a shift, and normals map by the turn alone.                      */

import { BLANK_WALL_T } from './cell.js';

/** the working storey as parts: { f, st, kind, cell, i, cc, rect, rev, map, nmap, sel, out } */
export function storeyParts(F) {
  const { B, sel, m } = F;
  const row0 = sel.row, fr0 = row0.frame, cc0 = m.opening ? m.cc : 0, rev0 = m.reveal || 0;
  const parts = [];
  for (const f of Object.keys(B.facades)) {
    const row = B.facades[f].rows[sel.st], fr = row.frame;
    // the part's axes in the selected frame: U along its side, W out of it
    const Uu = fr.U[0] * fr0.U[0] + fr.U[1] * fr0.U[1], Uw = fr.U[0] * fr0.W[0] + fr.U[1] * fr0.W[1];
    const Wu = fr.W[0] * fr0.U[0] + fr.W[1] * fr0.U[1], Ww = fr.W[0] * fr0.W[0] + fr.W[1] * fr0.W[1];
    const dO = [fr.O[0] - fr0.O[0], fr.O[1] - fr0.O[1]];
    const Ou = dO[0] * fr0.U[0] + dO[1] * fr0.U[1], Ow = dO[0] * fr0.W[0] + dO[1] * fr0.W[1];
    const mk = (cc, rev) => {
      // local (u, v, w) -> world: O + U (cc + u) + W (w - rev) -> selected: u0 = . U0 - cc0, w0 = . W0 + rev0
      const bu = Ou + Uu * cc - Wu * rev - cc0, bw = Ow + Uw * cc - Ww * rev + rev0;
      return {
        map: ([u, v, w]) => [bu + Uu * u + Wu * w, v, bw + Uw * u + Ww * w],
        nmap: ([a, b, c]) => [Uu * a + Wu * c, b, Uw * a + Ww * c],
        /** a point of the selected frame in this part's own - the map run backward */
        inv: ([us, v, ws]) => { const a = us - bu, b = ws - bw; return [Uu * a + Uw * b, v, Wu * a + Ww * b]; },
        /** the selected frame's eye in this part's own axes */
        eye: e => [e[0] * Uu + e[2] * Uw, e[1], e[0] * Wu + e[2] * Ww]
      };
    };
    const out = [Wu, 0, Ww];              // this side's outward normal, in the selected frame
    if (!row.cell) {
      parts.push(Object.assign({ f, st: sel.st, kind: 'blank', cell: null, i: null, cc: 0, rev: 0, out,
        rect: { u0: -row.len / 2, u1: row.len / 2, v0: 0, v1: row.h }, wallT: BLANK_WALL_T, sel: false }, mk(0, 0)));
      continue;
    }
    const c = row.cell;
    for (const q of row.units) {
      const isSel = f === sel.f && q.i === sel.unit;
      parts.push(Object.assign({ f, st: sel.st, kind: 'unit', cell: q.cell, i: q.i, cc: q.cc, rev: q.cell.reveal, out, broken: q.broken,
        rect: { u0: q.r0, u1: q.r1, v0: 0, v1: row.h }, sel: isSel }, mk(q.cc, q.cell.reveal)));
    }
    // what a spaced layout leaves at the two ends is plain wall, the cell's own
    for (const [a, b] of row.ends)
      parts.push(Object.assign({ f, st: sel.st, kind: 'end', cell: c, i: null, cc: (a + b) / 2, rev: c.reveal, out,
        rect: { u0: (a - b) / 2, u1: (b - a) / 2, v0: 0, v1: row.h }, wallT: Math.max(c.wallT, 0.2), sel: false }, mk((a + b) / 2, c.reveal)));
  }
  return parts;
}

/** the storey's floorplate in the selected frame: its four corners at the wall faces */
export function plateCorners(F) {
  const { B, sel } = F, row0 = sel.row, fr0 = row0.frame, m = F.m, cc0 = m.opening ? m.cc : 0, rev0 = m.reveal || 0;
  const pts = [];
  for (const f of ['S', 'E', 'N', 'W']) {
    const fr = B.facades[f].rows[sel.st].frame, A = fr.A;
    const d = [A[0] - fr0.O[0], A[1] - fr0.O[1]];
    pts.push([d[0] * fr0.U[0] + d[1] * fr0.U[1] - cc0, d[0] * fr0.W[0] + d[1] * fr0.W[1] + rev0]);
  }
  return pts;
}
