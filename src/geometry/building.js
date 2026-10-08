/* The building: turned from true north by its north offset (S.rot,
   clockwise), a stack of rectangular storeys, each with its own floorplate,
   its own rotation (rot, from the building's north offset, the floor below,
   or true north, as rotRel says) and its own offset from the building's axis
   (ox east, oy north - measured along its own axes, the building's, the floor
   below's or true north, as oxyIn says), each side of each storey a cell with its own glazing and
   shading, and the frames that place every cell in the world. A storey that
   is bigger than the one below it overhangs it, and its underside shades the
   glass below like a canopy - so its mass is one of the neighbours a unit is
   analysed with.

   A glazing unit is analysed with its neighbours: the devices of the units
   beside it, above it and below it are moved into its coordinates and join its
   own, so a canopy on the second storey shades the head of the first and a fin
   at the end of one bay reaches across to the next. Only neighbours within
   reach are taken - a device can only be met by a ray that has not yet left
   its depth - and units whose surroundings are identical are recognised as
   such, so a whole facade costs a handful of distinct units, not every one.

   Context buildings - plain extrusions on the site - are neighbours too:
   each is a box in the world, taken into a unit's coordinates wherever it
   stands in front of the glass and rises above its foot. */

import { D2R, wrap360, wrap180 } from '../util.js';
import { buildCell, glazingBox, BLANK_WALL_T, SLAB0 } from './cell.js';
import { flatGlazing } from '../library.js';
import { boxSpan, moveBox, aaBox, turnBox } from './boxes.js';

export const FACADES = { N: 0, E: 90, S: 180, W: 270 };
export const FACADE_NAMES = { N: 'north', E: 'east', S: 'south', W: 'west' };
const storeyOf = (S, st) => S.storeys[Math.max(0, Math.min(S.storeys.length - 1, st ?? S.sel.st))];
const idxOf = (S, st) => Math.max(0, Math.min(S.storeys.length - 1, st ?? S.sel.st));
/** a storey's plan as it stands, turned from true north, clockwise, in degrees:
 *  its own rotation added to the building's north offset, to the floor below's
 *  as it stands, or to nothing (from true north) */
export function storeyRot(S, st) {
  let i = idxOf(S, st), a = 0;
  for (;;) {
    const p = S.storeys[i], rel = p.rotRel || 'building';
    a += p.rot || 0;
    if (rel === 'true') return a;
    if (rel === 'below' && i > 0) { i--; continue; }
    return a + (S.rot || 0);
  }
}
/* What a floor's rotation is measured from. */
export const ROT_FROM = { building: 'the building’s north offset', below: 'the floor below', true: 'true north' };
/** the rotation storey st would be given, measured from `rel`, to stand as it does now */
export function rotIn(S, st, rel) {
  const i = idxOf(S, st), base = rel === 'true' ? 0 : rel === 'below' && i > 0 ? storeyRot(S, i - 1) : S.rot || 0;
  return wrap180(storeyRot(S, i) - base);
}
/** which way a side of a storey faces, as a compass bearing (the selected storey unless one is named) */
export const facadeAzimuth = (S, f, st) => wrap360(FACADES[f] + storeyRot(S, st));
/* A storey's offset is a distance east and north of the building's axis, read
   along one of four sets of axes: the storey's own, turned with it; the
   building's; the storey below's; or true north and east. */
export const OFFSET_FRAMES = { own: 'this floor’s axes', building: 'the building’s axes', below: 'the floor below’s axes', global: 'true north' };
/** the bearing the offset of storey st is read along */
export function offsetAngle(S, st) {
  const i = idxOf(S, st), fr = S.storeys[i].oxyIn || 'own';
  if (fr === 'global') return 0;
  if (fr === 'building') return S.rot || 0;
  if (fr === 'below') return i > 0 ? storeyRot(S, i - 1) : S.rot || 0;
  return storeyRot(S, i);
}
const turn = (a, x, y) => { const r = a * D2R, c = Math.cos(r), s = Math.sin(r); return [x * c + y * s, -x * s + y * c]; };
const unturn = (a, x, y) => turn(-a, x, y);
/** where a storey's middle stands, east and north of the building's axis */
export const storeyCentre = (S, st) => { const p = storeyOf(S, st); return turn(offsetAngle(S, st), p.ox || 0, p.oy || 0); };
/** the offset of storey st written along the axes `frame` would read it on, the storey staying where it is */
export function offsetIn(S, st, frame) {
  const p = S.storeys[st], was = p.oxyIn || 'own';
  const c = turn(offsetAngle(S, st), p.ox || 0, p.oy || 0);
  p.oxyIn = frame;
  const [x, y] = unturn(offsetAngle(S, st), c[0], c[1]);
  p.oxyIn = was;
  return [x, y];
}
/** the length of one side of a storey (the selected storey unless one is named) */
export const facadeLength = (S, f, st) => { const p = storeyOf(S, st); return (f === 'S' || f === 'N') ? p.w : p.d; };
/** how far a side's wall face stands out from the building's axis, along its own normal, offset and all */
export const faceOffset = (S, f, st) => { const fr = facadeFrame(S, f, st); return fr.O[0] * fr.W[0] + fr.O[1] * fr.W[1]; };
/** the storey's depth behind a side: from its wall face to the opposite one */
export const plateDepth = (S, f, st) => { const p = storeyOf(S, st); return (f === 'S' || f === 'N') ? p.d : p.w; };
/** each storey's floorplate corners in the world, east and north of the axis */
export const plateWorld = (S, st) => {
  const p = storeyOf(S, st), c = storeyCentre(S, st), a = storeyRot(S, st);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => { const q = turn(a, i * p.w / 2, j * p.d / 2); return [q[0] + c[0], q[1] + c[1]]; });
};
/** how far the furthest floorplate corner stands from the building's axis -
 *  the same however the building is turned, so a view framed on it keeps its size */
export const plateRadius = S => Math.max(...S.storeys.flatMap((_, i) => plateWorld(S, i)).map(p => Math.hypot(p[0], p[1])));
/** the width and depth of a box on the axis, square to true north, that takes in every storey, for framing the drawings */
export const plateMax = S => {
  const pts = S.storeys.flatMap((_, i) => plateWorld(S, i));
  return { w: 2 * Math.max(...pts.map(p => Math.abs(p[0]))), d: 2 * Math.max(...pts.map(p => Math.abs(p[1]))) };
};
export const storeyBases = S => { const z = []; let t = 0; for (const s of S.storeys) { z.push(t); t += s.h; } return z; };
export const buildingHeight = S => S.storeys.reduce((a, s) => a + s.h, 0);

/** one side of the block in world axes: the middle of its face at ground level,
 *  and the three unit vectors of facade space - along, up and outward. The
 *  plate line is the wall face. */
export function facadeFrame(S, f, st) {
  const p = storeyOf(S, st), hw = p.w / 2, hd = p.d / 2, a = storeyRot(S, st), C = storeyCentre(S, st);
  const rw = (x, y) => { const q = turn(a, x, y); return [q[0] + C[0], q[1] + C[1]]; };
  const lo = { S: [[-hw, -hd], [hw, -hd]], E: [[hw, -hd], [hw, hd]],
    N: [[hw, hd], [-hw, hd]], W: [[-hw, hd], [-hw, -hd]] }[f];
  const A = rw(lo[0][0], lo[0][1]), B = rw(lo[1][0], lo[1][1]);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const U = [(B[0] - A[0]) / len, (B[1] - A[1]) / len, 0];
  return { f, O: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0], U, V: [0, 0, 1], W: [U[1], -U[0], 0], len, A, B };
}
/** facade coordinates to world: u across the face from its middle, v up from
 *  the ground, w out from a glass set `rev` behind the wall face, so every
 *  cell's wall face lands on the plate line. */
export const toWorld = (fr, u, v, w, rev = 0) =>
  [0, 1, 2].map(k => fr.O[k] + fr.U[k] * u + fr.V[k] * v + fr.W[k] * (w - rev));

/* ---------- the building as cells ---------- */
export function buildBuilding(S) {
  const zb = storeyBases(S), facades = {}, cids = new Map();
  for (const f of Object.keys(FACADES)) {
    const rows = S.storeys.map((s, st) => {
      const gf = facadeAzimuth(S, f, st), len = facadeLength(S, f, st), frame = facadeFrame(S, f, st), off = faceOffset(S, f, st);
      // the side's reference read back through the library: its system, unit and shading
      // each side's glass takes the side's SHGC, where one is set
      const side = g => (g && S.shgc && S.shgc[f] !== undefined ? Object.assign(g, { shgc: S.shgc[f] }) : g);
      const ref = s.cells[f] || null, glz = ref ? side(flatGlazing(S, ref)) : null, slab = s.slab ?? SLAB0;
      const cell = glz ? buildCell(glz, s.h, len, gf, slab) : null;
      // each unit's bay, clipped to the side; set out by spacing, what the bays
      // leave at the two ends is plain wall
      const units = [], ends = [], own = new Map();
      if (cell) {
        for (let i = 0; i < cell.n; i++) {
          const cc = cell.first + cell.pitch * i;
          // a unit broken from the array stands in its place with a cell of its own
          const ug = (ref.broken && ref.broken[i]) || (ref.brokenShd && ref.brokenShd[i]) ? side(flatGlazing(S, ref, i)) : null;
          let uc = cell;
          if (ug) { const c2 = buildCell(ug, s.h, len, gf, slab); uc = own.get(c2.key) || c2; own.set(uc.key, uc); }
          if (!cids.has(uc.key)) cids.set(uc.key, cids.size);
          units.push({ i, cc, r0: Math.max(-cell.pitch / 2, -len / 2 - cc), r1: Math.min(cell.pitch / 2, len / 2 - cc),
            cell: uc, broken: !!ug, cid: cids.get(uc.key), bb: uc === cell ? null : elementBounds(uc.elements) });
        }
        const a = units[0].cc + units[0].r0, b = units[units.length - 1].cc + units[units.length - 1].r1;
        if (a > -len / 2 + 1e-9) ends.push([-len / 2, a]);
        if (b < len / 2 - 1e-9) ends.push([b, len / 2]);
      }
      // a short id for the cell's geometry, so a unit's surroundings can be named cheaply
      if (cell && !cids.has(cell.key)) cids.set(cell.key, cids.size);
      const bb = cell ? elementBounds(cell.elements) : null;
      units.forEach(q => { if (!q.bb) q.bb = bb; });
      return { f, st, gf, zb: zb[st], h: s.h, len, depth: plateDepth(S, f, st), frame, off, glz, cell, units, ends, cid: cell ? cids.get(cell.key) : -1, bb: unionBounds(units.map(q => q.bb)) };
    });
    // the side as the selected storey has it, for what reads one side as a whole
    const here = rows[Math.max(0, Math.min(rows.length - 1, S.sel.st))];
    facades[f] = { f, gf: here.gf, len: here.len, frame: here.frame, rows };
  }
  return { facades, height: buildingHeight(S), S, context: contextBoxes(S) };
}

/* ---------- context buildings ----------
   Other buildings on and round the site that may shade this one, each a plain
   extrusion: { id, w, d, h, x, y, a } - its width along its own x, its depth
   along its own y, its height, its centre and its turn (clockwise). Those are
   read in the axes S.site.ctxFrame names: 'building', the ground floor's own,
   so they turn and move with the building and its site; or 'world', east and
   north from true north, so they stay put whatever the building does. */
export const CTX_DRAFT0 = () => ({ w: 20, d: 15, h: 15 });
/** the axes context buildings are read in: turned a from true north, about C */
export function contextAxes(S, mode) {
  const m = mode || (S.site && S.site.ctxFrame) || 'building';
  return m === 'world' ? { a: 0, C: [0, 0] } : { a: storeyRot(S, 0), C: storeyCentre(S, 0) };
}
/** a context building in the world: its centre on the ground and its turn from true north */
export function contextPlace(S, c, mode) {
  const X = contextAxes(S, mode), p = turn(X.a, c.x || 0, c.y || 0);
  return { C: [p[0] + X.C[0], p[1] + X.C[1]], a: X.a + (c.a || 0) };
}
/** a point in the world, in the axes context buildings are read in */
export function contextLocal(S, P, mode) { const X = contextAxes(S, mode); return turn(-X.a, P[0] - X.C[0], P[1] - X.C[1]); }
/** every context building as a box in the world: its centre, its own x and y on the ground, its half-sizes */
export function contextBoxes(S) {
  return ((S.site && S.site.ctx) || []).filter(c => c.w > 0 && c.d > 0 && c.h > 0).map(c => {
    const p = contextPlace(S, c);
    return { id: c.id, c: [p.C[0], p.C[1], c.h / 2], ex: turn(p.a, 1, 0), ey: turn(p.a, 0, 1), h: [c.w / 2, c.d / 2, c.h / 2], a: p.a };
  });
}
/** a context building's footprint in the world, corner by corner */
export function contextFoot(S, c) {
  const p = contextPlace(S, c), ex = turn(p.a, 1, 0), ey = turn(p.a, 0, 1), hw = c.w / 2, hd = c.d / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [p.C[0] + sx * hw * ex[0] + sy * hd * ey[0], p.C[1] + sx * hw * ex[1] + sy * hd * ey[1]]);
}
/* The nearest two convex outlines come on plan: 0 where they overlap (tested
   axis by axis on every edge's normal), else the least of every corner's
   distance to the other's edges, with the two points it runs between. */
function polyGap(A, B) {
  const separated = (P, Q) => P.some((p, i) => {
    const q = P[(i + 1) % P.length], n = [q[1] - p[1], p[0] - q[0]];
    const pr = R => R.map(r => r[0] * n[0] + r[1] * n[1]), a = pr(P), b = pr(Q);
    return Math.max(...a) < Math.min(...b) - 1e-9 || Math.max(...b) < Math.min(...a) - 1e-9;
  });
  let best = { d: Infinity, a: A[0], b: B[0] };
  const near = (p, Q, flip) => Q.forEach((q0, i) => {
    const q1 = Q[(i + 1) % Q.length], dx = q1[0] - q0[0], dy = q1[1] - q0[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / L2)), x = [q0[0] + dx * t, q0[1] + dy * t];
    const d = Math.hypot(p[0] - x[0], p[1] - x[1]);
    if (d < best.d) best = flip ? { d, a: x, b: p } : { d, a: p, b: x };
  });
  A.forEach(p => near(p, B, false)); B.forEach(p => near(p, A, true));
  if (!separated(A, B) && !separated(B, A)) best = { d: 0, a: best.a, b: best.b };
  return best;
}
/** the nearest a context building comes to the building on plan, at any storey: { d, a: on the massing, b: on the building } */
export function contextGap(S, c) {
  const foot = contextFoot(S, c);
  let best = { d: Infinity, a: foot[0], b: foot[0] };
  for (let i = 0; i < S.storeys.length; i++) { const g = polyGap(foot, plateWorld(S, i)); if (g.d < best.d) best = g; }
  return best;
}
/** a world box's corners: the four at the ground, then the four at its top */
export function boxCorners(b) {
  const out = [];
  for (const z of [0, 2 * b.h[2]]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    out.push([b.c[0] + sx * b.h[0] * b.ex[0] + sy * b.h[1] * b.ey[0], b.c[1] + sx * b.h[0] * b.ex[1] + sy * b.h[1] * b.ey[1], z]);
  return out;
}
/* The context buildings a unit can see, in its own coordinates (u along the
   side from the unit's middle, v up from the storey's floor, w out from the
   glass). Only one that stands in front of the glass and rises above its foot
   can meet a ray leaving it - the sun is above the horizon, so the ray climbs. */
function contextIn(B, row, u) {
  const out = [];
  if (!B.context || !B.context.length) return out;
  const fr = row.frame, U = fr.U, W = fr.W, rev = u.cell.reveal, foot = u.cell.opening ? u.cell.opening.v0 : 0;
  const onU = d => d[0] * U[0] + d[1] * U[1], onW = d => d[0] * W[0] + d[1] * W[1];
  for (const b of B.context) {
    const d = [b.c[0] - fr.O[0], b.c[1] - fr.O[1]];
    const c = [onU(d) - u.cc, b.c[2] - row.zb, onW(d) + rev];
    const e1 = [onU(b.ex), 0, onW(b.ex)], e3 = [onU(b.ey), 0, onW(b.ey)], h = [b.h[0], b.h[2], b.h[1]];
    if (c[2] + Math.abs(e1[2]) * h[0] + Math.abs(e3[2]) * h[2] <= 1e-6 || c[1] + h[1] <= foot) continue;
    out.push({ c, e1, e2: [0, 1, 0], e3, h, ctx: true, site: true, kind: 'site', D: null, id: b.id, name: 'context building' });
  }
  return out;
}

/** where several cells' elements reach together */
function unionBounds(bs) {
  bs = bs.filter(Boolean);
  if (!bs.length) return null;
  return { lo: [0, 1, 2].map(i => Math.min(...bs.map(b => b.lo[i]))), hi: [0, 1, 2].map(i => Math.max(...bs.map(b => b.hi[i]))) };
}
/** where a cell's elements reach, in its own coordinates */
function elementBounds(els) {
  if (!els.length) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of els) for (let i = 0; i < 3; i++) {
    const s = boxSpan(b, i);
    lo[i] = Math.min(lo[i], b.c[i] - s); hi[i] = Math.max(hi[i], b.c[i] + s);
  }
  return { lo, hi };
}

/** the selection made valid against the building as it stands */
export function resolveSel(S, B) {
  const f = FACADES[S.sel.f] !== undefined ? S.sel.f : 'S';
  const st = Math.max(0, Math.min(S.storeys.length - 1, S.sel.st | 0));
  const row = B.facades[f].rows[st];
  const n = row.units.length;
  const unit = n ? (S.sel.unit === null || S.sel.unit === undefined ? Math.floor((n - 1) / 2) : Math.max(0, Math.min(n - 1, S.sel.unit))) : null;
  return { f, st, unit, row, fac: B.facades[f] };
}

/* ---------- a unit with its neighbours ----------
   A device whose far face stands W out from the wall can only be met by a ray
   that is still within W of the glass, so it cannot reach a unit more than
   REACH x W away across the facade - 5 is about 79 degrees off the normal,
   past which the beam carries little and the chart little sky. Keeping the
   reach there is also what lets the units in the middle of a long run be
   recognised as the same unit. */
const REACH = 5;
/* How a storey's side lies in this one's: the four dot products of its axes
   with this side's (along and out), and whether it is turned at all. A storey
   with the same north offset stands square to this one, and its units are
   only moved; a turned one's are turned as well. */
function relTurn(r, row) {
  const U = row.frame.U, Wn = row.frame.W, Ur = r.frame.U, Wr = r.frame.W;
  const a = Ur[0] * U[0] + Ur[1] * U[1], b = Wr[0] * U[0] + Wr[1] * U[1], c = Ur[0] * Wn[0] + Ur[1] * Wn[1], d = Wr[0] * Wn[0] + Wr[1] * Wn[1];
  return { a, b, c, d, square: a > 1 - 1e-9 && Math.abs(b) < 1e-9 };
}
/** unit q of row r - at cc along it, glass `rev` behind its face - in unit u's coordinates: where its origin lands */
function placeIn(r, row, R, cc, rev, u, revU) {
  const dO = [r.frame.O[0] - row.frame.O[0], r.frame.O[1] - row.frame.O[1]], U = row.frame.U, Wn = row.frame.W;
  return [dO[0] * U[0] + dO[1] * U[1] + R.a * cc - R.b * rev - u.cc, dO[0] * Wn[0] + dO[1] * Wn[1] + R.c * cc - R.d * rev + revU];
}
/** a box of unit q's, bounds in its own coordinates, turned into unit u's: the bounds it then spans */
function turnBounds(bb, R, t) {
  const us = [], ws = [];
  for (const x of [bb.lo[0], bb.hi[0]]) for (const z of [bb.lo[2], bb.hi[2]]) { us.push(R.a * x + R.b * z + t[0]); ws.push(R.c * x + R.d * z + t[1]); }
  return { lo: [Math.min(...us), bb.lo[1], Math.min(...ws)], hi: [Math.max(...us), bb.hi[1], Math.max(...ws)] };
}
/** the units near enough to shade this one, row by row and cell by cell:
 *  { r, c, cid, dv, dw, du: [...] } - or, from a turned storey,
 *  { r, c, cid, dv, R, pts: [[du, dw], ...] } - a row with windows broken
 *  from its array holds more than one cell */
function neighbours(fac, row, i) {
  const u = row.units[i], cell = u.cell, o = cell.opening, out = [];
  for (const r of fac.rows) {
    if (!r.cell || !r.bb) continue;
    const dv = r.zb - row.zb, groups = new Map(), R = relTurn(r, row);
    if (!R.square) {
      for (const q of r.units) {
        if (!q.bb) continue;
        const t = placeIn(r, row, R, q.cc, q.cell.reveal, u, cell.reveal), bb = turnBounds(q.bb, R, t);
        const reach = REACH * Math.max(0.05, bb.hi[2]);
        const gu = Math.max(0, bb.lo[0] - o.u1, o.u0 - bb.hi[0]), gv = Math.max(0, bb.lo[1] + dv - o.v1, o.v0 - (bb.hi[1] + dv));
        if (bb.hi[2] <= 0 || gu > reach || gv > reach) continue;
        let gp = groups.get(q.cid);
        if (!gp) groups.set(q.cid, gp = { r, c: q.cell, cid: q.cid, dv, R, pts: [] });
        gp.pts.push(t);
      }
      for (const gp of groups.values()) out.push(gp);
      continue;
    }
    // a storey offset along this side moves its units along it
    const sU = alongShift(r, row);
    for (const q of r.units) {
      if (r === row && q.i === i) continue;
      if (!q.bb) continue;
      // a storey with a bigger floorplate stands out from this one by the difference
      const dw = cell.reveal - q.cell.reveal + (r.off - row.off);
      const reach = REACH * Math.max(0.05, q.bb.hi[2] + dw), du = q.cc - u.cc + sU;
      const gu = Math.max(0, q.bb.lo[0] + du - o.u1, o.u0 - (q.bb.hi[0] + du));
      const gv = Math.max(0, q.bb.lo[1] + dv - o.v1, o.v0 - (q.bb.hi[1] + dv));
      if (gu > reach || gv > reach) continue;
      let gp = groups.get(q.cid);
      if (!gp) groups.set(q.cid, gp = { r, c: q.cell, cid: q.cid, dv, dw, du: [] });
      gp.du.push(du);
    }
    for (const gp of groups.values()) out.push(gp);
  }
  return out;
}
/** a run of offsets named briefly when it is even - or even but for the unit
 *  itself - and in full when windows broken out of the array leave gaps in it */
function runSig(du) {
  if (du.length < 3) return du.map(x => x.toFixed(4)).join('/');
  const st = du.slice(1).map((x, k) => x - du[k]), p = Math.min(...st);
  const even = st.every(s => Math.abs(s - p) < 1e-6 || (Math.abs(s - 2 * p) < 1e-6 && du.some(x => Math.abs(x + p) < 1e-6)));
  return even && st.filter(s => Math.abs(s - 2 * p) < 1e-6).length <= 1 ? du[0].toFixed(4) + 'x' + du.length : du.map(x => x.toFixed(4)).join('/');
}
/* The storeys above that stand out past this one's wall face. Only the part of
   their mass in front of the face can meet a ray leaving the glass, and it is
   a box: as long as that storey's side, from its floor to its ceiling, from
   the glass out to its own face. A storey below cannot shade - the sun is
   always above the horizon, so a ray from the glass climbs. */
/* A storey above that is turned against this one is taken whole: its
   floorplate as a box, turned into the unit's coordinates, wherever it
   stands out past this side's wall face. */
function overhangs(fac, row, u) {
  const out = [];
  for (const r of fac.rows) {
    if (r.zb <= row.zb + 1e-9) continue;
    const R = relTurn(r, row);
    if (R.square) {
      const out0 = r.off - row.off;
      if (out0 > 1e-6) out.push({ r, dv: r.zb - row.zb, out: out0, sU: alongShift(r, row) });
      continue;
    }
    const rev = u.cell.reveal, dep = r.depth;
    // the plate's middle: in from the middle of its face by half its depth
    const t = placeIn(r, row, R, 0, 0, u, rev), half = [r.len / 2, r.h / 2, dep / 2];
    const cw = t[1] - R.d * dep / 2;
    if (cw + Math.abs(R.c) * half[0] + Math.abs(R.d) * half[2] <= rev + 1e-6) continue;
    const box = { c: [t[0] - R.b * dep / 2, r.zb - row.zb + r.h / 2, cw], e1: [R.a, 0, R.c], e2: [0, 1, 0], e3: [R.b, 0, R.d], h: half,
      ctx: true, mass: true, kind: 'mass', D: null, st: r.st, name: 'storey ' + (r.st + 1) };
    out.push({ r, box });
  }
  return out;
}
/** how far storey r's face stands along this side from storey row's */
function alongShift(r, row) {
  const a = r.frame.O, b = row.frame.O, U = row.frame.U;
  return (a[0] - b[0]) * U[0] + (a[1] - b[1]) * U[1];
}
const massBox = (cell, u, o) => aaBox(-o.r.len / 2 + o.sU - u.cc, o.r.len / 2 + o.sU - u.cc, o.dv, o.dv + o.r.h, 0, cell.reveal + o.out,
  { ctx: true, mass: true, kind: 'mass', D: null, st: o.r.st, name: 'storey ' + (o.r.st + 1) });
/* A unit's key: its own cell, and where its neighbours stand and what they
   are. The units of a row are evenly spaced, so a row's neighbours are named
   by the first one's offset and how many there are; cells are named by short
   ids, and the geometry behind those ids is written once at the end, so the
   key still changes whenever any of them does. The key is all that is needed
   to tell units apart, so the models - with every neighbour's members moved
   into place - are built only for the distinct ones. */
function keyOf(cell, nb, oh, u, cx = []) {
  const sig = nb.map(g => g.R ? g.dv.toFixed(4) + ',R' + [g.R.a, g.R.b].map(x => x.toFixed(6)).join(',') + ',' + g.cid + ',' + g.pts.map(p => p[0].toFixed(4) + ':' + p[1].toFixed(4)).join('/')
    : g.dv.toFixed(4) + ',' + g.dw.toFixed(4) + ',' + g.cid + ',' + runSig(g.du));
  const ids = [...new Map(nb.map(g => [g.cid, g.c.key])).entries()].sort((a, b) => a[0] - b[0]);
  // an overhanging storey is placed relative to this unit, so where the unit stands matters
  const ms = oh.map(o => o.box ? 'B' + [...o.box.c, ...o.box.e1, ...o.box.h].map(x => x.toFixed(4)).join(',') : [o.dv, o.r.h, o.out, o.r.len / 2 + o.sU - u.cc, o.r.len / 2 - o.sU + u.cc].map(x => x.toFixed(4)).join(','));
  // and so are the context buildings it can see
  const cs = cx.map(b => [...b.c, b.e1[0], b.e1[2], ...b.h].map(x => x.toFixed(4)).join(','));
  return cell.key + '#' + sig.join(';') + '#' + ids.map(([id, k]) => id + '=' + k).join('&') + (ms.length ? '#M' + ms.join(';') : '') + (cs.length ? '#C' + cs.join(';') : '');
}
/** a unit's key, worked out once per building - the analysis and the building view both ask */
export function unitKey(B, f, st, i) {
  const memo = B.keys || (B.keys = new Map()), id = f + st + ':' + i;
  let k = memo.get(id);
  if (k === undefined) {
    const fac = B.facades[f], row = fac.rows[st];
    memo.set(id, k = keyOf(row.units[i].cell, neighbours(fac, row, i), overhangs(fac, row, row.units[i]), row.units[i], contextIn(B, row, row.units[i])));
  }
  return k;
}
export function unitModel(B, f, st, i) {
  const fac = B.facades[f], row = fac.rows[st], u = row.units[i], cell = u.cell;
  const nb = neighbours(fac, row, i), oh = overhangs(fac, row, u), ctx = [];
  for (const g of nb) {
    if (g.R) { for (const t of g.pts) for (const b of g.c.elements) ctx.push(turnBox(b, g.R, t[0], g.dv, t[1], { ctx: true, st: g.r.st })); continue; }
    for (const d of g.du) for (const b of g.c.elements) ctx.push(moveBox(b, d, g.dv, g.dw, { ctx: true, st: g.r.st }));
  }
  for (const o of oh) ctx.push(o.box ? Object.assign({}, o.box) : massBox(cell, u, o));
  const cx = contextIn(B, row, u);
  ctx.push(...cx);
  return Object.assign({}, cell, {
    own: cell.elements, ctx, elements: cell.elements.concat(ctx),
    key: keyOf(cell, nb, oh, u, cx), off: row.off, len: row.len,
    f, st, i, cc: u.cc, zb: row.zb, r0: u.r0, r1: u.r1, shgc: cell.glz.shgc ?? 0.4, broken: u.broken
  });
}

/* ---------- what is analysed ----------
   One unit; a storey of one side; a storey all round; one side, every storey;
   or the whole building: a list of distinct units, each weighted by the glass
   it stands for. Identical units in identical surroundings are one item with
   the weight of all of them. A target spanning more than one side is `multi`:
   its units look different ways, and it is studied over the whole sky.     */
export const SCOPES = { unit: 'Selected window', storey: 'This floor, this side', level: 'Whole floor, all sides',
  facade: 'This side, every floor', building: 'Whole building' };
export const MULTI = { level: true, building: true };
export function analysisTarget(B, sel, scope) {
  const fac = B.facades[sel.f], items = new Map();
  const add = (f, st, i) => {
    const k = unitKey(B, f, st, i), it = items.get(k);
    if (it) { it.w += it.m.winW * it.m.winH; it.count++; return; }
    const m = unitModel(B, f, st, i);
    items.set(k, { m, w: m.winW * m.winH, count: 1 });
  };
  const oneStorey = scope === 'storey' || scope === 'level';
  if (scope === 'unit') { if (sel.unit !== null) add(sel.f, sel.st, sel.unit); }
  else for (const f of MULTI[scope] ? Object.keys(FACADES) : [sel.f])
    B.facades[f].rows.forEach(r => { if (r.cell && (!oneStorey || r.st === sel.st)) r.units.forEach(q => add(f, r.st, q.i)); });
  const list = [...items.values()], area = list.reduce((a, it) => a + it.w, 0);
  if (list.length > SHARE_ABOVE) shareGrids(list, area);
  // one side of storeys turned different ways looks more than one way, and is read over the whole sky too
  const turned = new Set(list.map(it => it.m.gf.toFixed(4))).size > 1;
  return {
    scope, gf: fac.gf, f: sel.f, items: list, multi: !!MULTI[scope] || turned,
    sides: [...new Set(list.map(it => it.m.f))],
    area, units: list.reduce((a, it) => a + it.count, 0),
    key: scope + '|' + fac.gf + '|' + list.map(it => it.m.key + '*' + it.w.toFixed(6)).join('&')
  };
}

/* A tall building with deep shading can hold hundreds of distinct units -
   each a little different where the balconies above, below and beside it run
   out. Every one is kept, but past GRID_FULL of them the ray samples are
   shared out by glass: a unit standing for a large share of the target keeps
   the full sampling grid, a unit standing for a sliver of it takes a coarser
   one (never under 2 x 2), and each coarse grid is set off from the next by a
   different fraction of a step, so their errors scatter and cancel instead of
   stacking. The target costs about GRID_FULL units' worth of rays plus a few
   per edge unit, instead of all of them at full density. Up to SHARE_ABOVE
   distinct units, every one keeps the full grid and the figures are exact. */
export const GRID_FULL = 8, SHARE_ABOVE = 24;
function shareGrids(list, area) {
  list.forEach((it, k) => {
    const r = Math.min(1, Math.sqrt(GRID_FULL * it.w / area));
    // the golden-ratio sequences keep the phases evenly spread however many there are
    it.m.grid = r < 1 ? { r, pu: (0.5 + k * 0.6180339887) % 1, pv: (0.5 + k * 0.7548776662) % 1 } : null;
  });
}

/** glazed area against the whole wall of one side of the block */
export function facadeWWR(B, f) {
  const fac = B.facades[f];
  let wall = 0, glass = 0;
  fac.rows.forEach(r => {
    wall += r.len * r.h;
    for (const q of r.units) glass += q.cell.winW * q.cell.winH;
  });
  return { wall, glass, ratio: wall > 0 ? glass / wall : 0 };
}

/** a storey with no glazing system, for the drawings and the export */
export const blankCell = (h, gf) => ({ type: 'blank', gf, storeyH: h, reveal: 0, wallT: BLANK_WALL_T, wIn: -BLANK_WALL_T,
  opening: null, elements: [], own: [], ctx: [], live: [], notes: [], key: 'blank|' + h + '|' + gf });

export { glazingBox };
