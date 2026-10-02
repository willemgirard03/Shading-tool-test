/* Oriented boxes: the one solid every element, wall piece and pane is made of.

   Each box: { c:[u,v,w] centre, e1,e2,e3 unit axes, h:[h1,h2,h3] half-extents },
   in facade coordinates - u across (to the right, seen from outside), v up from
   the storey's floor, w outward from the glass, which is the plane w = 0.    */

import { hull2, v3 } from '../util.js';

/** how far a box reaches along facade axis i (0 = u, 1 = v, 2 = w) */
export const boxSpan = (b, i) => b.h[0] * Math.abs(b.e1[i]) + b.h[1] * Math.abs(b.e2[i]) + b.h[2] * Math.abs(b.e3[i]);
export const boxHi = (bs, i, dflt) => bs.length ? Math.max(...bs.map(b => b.c[i] + boxSpan(b, i))) : dflt;
export const boxLo = (bs, i, dflt) => bs.length ? Math.min(...bs.map(b => b.c[i] - boxSpan(b, i))) : dflt;

export function boxCorners(b) {
  const A = [b.e1, b.e2, b.e3], out = [];
  for (const s3 of [-1, 1]) for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    out.push([0, 1, 2].map(i => b.c[i] + s1 * b.h[0] * A[0][i] + s2 * b.h[1] * A[1][i] + s3 * b.h[2] * A[2][i]));
  return out;
}

/** the six faces of an oriented box, each with its outward normal */
export function boxFaces(b) {
  const A = [b.e1, b.e2, b.e3], hh = b.h, C = b.c;
  const corner = sg => [0, 1, 2].map(i =>
    C[i] + sg[0] * hh[0] * A[0][i] + sg[1] * hh[1] * A[1][i] + sg[2] * hh[2] * A[2][i]);
  const out = [];
  for (let ax = 0; ax < 3; ax++) for (const sgn of [1, -1]) {
    const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
    const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([p, q]) => {
      const sg = [0, 0, 0]; sg[ax] = sgn; sg[o1] = p; sg[o2] = q;
      return corner(sg);
    });
    out.push({ n: v3.mul(A[ax], sgn), pts, ax });
  }
  return out;
}

/** an axis-aligned box from its extents */
export const aaBox = (u0, u1, v0, v1, w0, w1, extra) => Object.assign({
  c: [(u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2],
  e1: [1, 0, 0], e2: [0, 1, 0], e3: [0, 0, 1],
  h: [(u1 - u0) / 2, (v1 - v0) / 2, (w1 - w0) / 2]
}, extra);

/** the same box turned about the vertical - u' = a u + b w, w' = c u + d w - then moved, and tagged */
export const turnBox = (b, R, du, dv, dw, extra) => {
  const t = e => [R.a * e[0] + R.b * e[2], e[1], R.c * e[0] + R.d * e[2]], c = t(b.c);
  return Object.assign({}, b, { c: [c[0] + du, c[1] + dv, c[2] + dw], e1: t(b.e1), e2: t(b.e2), e3: t(b.e3) }, extra);
};
/** the same box moved, and tagged with whatever else is given */
export const moveBox = (b, du, dv, dw, extra) => Object.assign({}, b, { c: [b.c[0] + du, b.c[1] + dv, b.c[2] + dw] }, extra);

/* ---------- cuts through the model ----------
   The section and the plan are cuts through the model rather than diagrams
   drawn beside it, so a wall and a tilted blade are sectioned by the same code.
   A plane square to one facade axis meets a box in a convex polygon: where its
   twelve edges cross the plane, hulled. The polygon comes back in the two
   remaining axes in index order - (v, w) for a section, (u, w) for a plan.  */
const OTHER = [[1, 2], [0, 2], [0, 1]];
export function sliceBox(b, ax, at) {
  if (Math.abs(b.c[ax] - at) > boxSpan(b, ax) + 1e-12) return null;
  const k = boxCorners(b), pts = [];
  // corners 0-3 are the -e3 face, 4-7 the +e3 face; edges round each face and across
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const [i, j] = OTHER[ax];
  for (const [p, q] of edges) {
    const a = k[p][ax] - at, c = k[q][ax] - at;
    if (Math.abs(a) < 1e-12) pts.push([k[p][i], k[p][j]]);
    if ((a < -1e-12 && c > 1e-12) || (a > 1e-12 && c < -1e-12)) {
      const s = a / (a - c);
      pts.push([k[p][i] + (k[q][i] - k[p][i]) * s, k[p][j] + (k[q][j] - k[p][j]) * s]);
    }
  }
  const h = hull2(pts);
  return h.length > 2 ? h : null;
}
/** a box seen along one axis: its silhouette, in the same two axes */
export function projectBox(b, ax) {
  const [i, j] = OTHER[ax];
  return hull2(boxCorners(b).map(p => [p[i], p[j]]));
}

/* ---------- shadows on the glass ----------
   A convex box throws a convex shadow on the plane w = 0: its eight corners run
   back along the sun vector and hulled. The edge is therefore as sharp as a
   cast shadow really is.                                                    */
export function boxShadow(b, sl) {
  if (sl[2] <= 1e-6) return null;
  return hull2(boxCorners(b).map(q => {
    const t = q[2] / sl[2];
    return [q[0] - sl[0] * t, q[1] - sl[1] * t];
  }));
}
