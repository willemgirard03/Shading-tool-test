/* Hidden surfaces: a BSP tree.

   Sorting whole faces by depth cannot be right when two of them interpenetrate:
   an egg-crate's fins cross its blades, and each crossing face is then drawn
   wholly in front of or wholly behind the other. No ordering of whole faces is
   correct there, so faces are split against each other's planes until a strict
   back-to-front order exists, and the splits are kept in a tree.

   The tree does not depend on where the eye is - only the walk does - so it is
   built when the geometry or the sun moves and merely walked on an orbit.

   Splitting must not invent linework. Each edge carries a flag saying whether
   it is a real boundary or a cut the tree made; only real ones are stroked.  */

const BSP_EPS = 1e-7, BSP_MAX = 64;
const CO = 0, FR = 1, BK = 2, SP = 3;
/** past this many input faces the tree grows too large to be worth drawing */
export const BSP_CAP = 420;

/** a polygon the tree can carry. `n` is the normal it was born with, kept rather
 *  than recomputed so a thin sliver off a split cannot flip it. */
export function bpoly(pts, n, kind, extra) {
  const p = Object.assign({ pts, n, kind, edge: pts.map(() => true) }, extra);
  p.d = n[0] * pts[0][0] + n[1] * pts[0][1] + n[2] * pts[0][2];
  return p;
}

export function bspSplit(p, pl, co, front, back) {
  const n = p.pts.length, t = [];
  let all = 0;
  for (let i = 0; i < n; i++) {
    const q = p.pts[i];
    const v = pl.n[0] * q[0] + pl.n[1] * q[1] + pl.n[2] * q[2] - pl.d;
    const c = v < -BSP_EPS ? BK : v > BSP_EPS ? FR : CO;
    t.push(c); all |= c;
  }
  if (all === CO) { co.push(p); return; }
  if (all === FR) { front.push(p); return; }
  if (all === BK) { back.push(p); return; }
  const f = [], b = [], fe = [], be = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ti = t[i], tj = t[j], vi = p.pts[i], vj = p.pts[j], ei = p.edge[i];
    if (ti === FR) { f.push(vi); fe.push(ei); }
    else if (ti === BK) { b.push(vi); be.push(ei); }
    else {                                  // on the plane, so it belongs to both
      f.push(vi); fe.push(tj === BK ? false : ei);
      b.push(vi); be.push(tj === FR ? false : ei);
    }
    if ((ti | tj) === SP) {
      const da = pl.n[0] * vi[0] + pl.n[1] * vi[1] + pl.n[2] * vi[2] - pl.d;
      const db = pl.n[0] * vj[0] + pl.n[1] * vj[1] + pl.n[2] * vj[2] - pl.d;
      const k = da / (da - db);
      const x = [vi[0] + (vj[0] - vi[0]) * k, vi[1] + (vj[1] - vi[1]) * k, vi[2] + (vj[2] - vi[2]) * k];
      // the half the edge carries on into keeps it; the half that stops here gets
      // a cut edge, which is not drawn
      if (ti === FR) { f.push(x); fe.push(false); b.push(x); be.push(ei); }
      else { b.push(x); be.push(false); f.push(x); fe.push(ei); }
    }
  }
  if (f.length > 2) front.push(Object.assign({}, p, { pts: f, edge: fe }));
  if (b.length > 2) back.push(Object.assign({}, p, { pts: b, edge: be }));
}

export function bspBuild(polys, depth = 0) {
  if (!polys.length) return null;
  const node = { pl: { n: polys[0].n, d: polys[0].d }, co: [], f: null, b: null };
  if (depth > BSP_MAX) { node.co = polys; return node; }
  const front = [], back = [];
  for (const q of polys) bspSplit(q, node.pl, node.co, front, back);
  node.f = bspBuild(front, depth + 1);
  node.b = bspBuild(back, depth + 1);
  return node;
}

/** back to front for an orthographic eye direction. Coplanar faces keep the
 *  order they went in, which is how a shadow stays on top of its glass. */
export function bspOrder(node, e, out) {
  while (node) {
    const s = node.pl.n[0] * e[0] + node.pl.n[1] * e[1] + node.pl.n[2] * e[2];
    const near = s > 0 ? node.f : node.b, far = s > 0 ? node.b : node.f;
    bspOrder(far, e, out);
    for (const q of node.co) out.push(q);
    node = near;
  }
  return out;
}

/** the whole pass: a tree when the scene is small enough, otherwise a depth sort
 *  with the given flat group kept in insertion order at the back */
export function paintOrder(polys, e, flatKinds) {
  if (polys.length <= BSP_CAP) return { order: bspOrder(bspBuild(polys), e, []), exact: true };
  const flat = polys.filter(q => flatKinds.includes(q.kind));
  const rest = polys.filter(q => !flatKinds.includes(q.kind));
  rest.forEach(q => { q.dd = q.pts.reduce((mx, x) => Math.max(mx, x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -1e9); });
  return { order: flat.concat(rest.sort((a, b) => a.dd - b.dd)), exact: false };
}
