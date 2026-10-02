/* The window in its storey, in 3D. The building view answers "where is the
   sun"; this one answers "where does it land" - on the glass, and then inside.

   The whole working storey is modelled - every side's walls, glass and
   devices, its floor and ceiling - and the camera orbits the middle of the
   selected window. The sun is followed through that window only: its lit
   glass, the patch it throws, the beam between them. Each part of the storey
   is its own small hidden-surface tree, walked from the eye and painted far to
   near; any side other than the window's that faces the eye stands between it
   and the room, and is ghosted.

   It is drawn in unit coordinates from the same model every number comes from:
   orange on the glass where the beam still reaches, glass tint where a device
   or the reveal has taken it, and orange on the floor and walls of the room
   where that beam lands. The camera orbits all the way round. Every surface is
   drawn from its visible side only, so whatever wall stands between the eye
   and the room simply drops away - look from behind and above and the room
   opens like a cut model. The two ghosted planes are the plan and section
   cuts, and can be pushed and pulled.                                        */

import { clamp, fmt, v3, wrap180, clipRect } from '../util.js';
import { boxHi, boxLo, boxSpan } from '../geometry/boxes.js';
import { GLAZING_TYPES, GLASS_T, wallPieces, wallFaces } from '../geometry/cell.js';
import { roomOf, roomSurfaces, sunPatches, toUnit, litGlass } from '../geometry/room.js';
import { getRegion } from '../studies.js';
import { bpoly, bspBuild, bspOrder, paintOrder, BSP_CAP } from '../geometry/bsp.js';
import { openingFaces, GLASS_GROUP } from './opening.js';
import { boxFaces } from '../geometry/boxes.js';
import { storeyParts, plateCorners } from '../geometry/storey.js';
import { lightUnits, PLAN_LIGHT, PLAN_LIGHT_WORDS } from '../geometry/floorsun.js';
import { sunLocal } from '../solar.js';
import { W, H, L, T, TB, CIRCLE, POLY, defsCommon, svg, paintFaces, sunKnob } from './svg.js';

export const DETAIL_VIEWS = {
  outside: { az: -32, el: 14, zoom: 1, panX: 0, panY: 0 },
  inside: { az: 205, el: 30, zoom: 1, panX: 0, panY: 0 },
  above: { az: -18, el: 78, zoom: 1, panX: 0, panY: 0 }
};
const FLOOR = '#E4DFD4', ROOMWALL = '#F2F0EB';

/** the bay the unit stands in, or a nominal one for a blank storey */
const bayOf = m => m.opening ? { u0: m.r0, u1: m.r1 } : { u0: -1.6, u1: 1.6 };

/** the interior behind the unit, and the part of it the sun reaches on this date */
export function interiorOf(m, S) {
  if (!m.opening) return null;
  const R = roomOf(m, S);
  return { R, region: getRegion(m, R, S, 'day') };
}
/** the frame of the drawing: the opening, its devices, and the floor the sun
 *  reaches - as far as a couple of storey heights into the room, so the window
 *  stays the subject; the wheel zooms out to the rest of the storey */
function extents(m, S) {
  const b = bayOf(m), bs = m.own, I = interiorOf(m, S), h = m.storeyH;
  const uMax = Math.max(b.u1 - b.u0, 1.5 * h) / 2 + 0.5;
  const u0 = Math.max(-uMax, I ? Math.min(b.u0, I.region.u0) : b.u0), u1 = Math.min(uMax, I ? Math.max(b.u1, I.region.u1) : b.u1);
  return {
    u0: Math.min(u0, boxLo(bs, 0, u0)), u1: Math.max(u1, boxHi(bs, 0, u1)),
    v0: Math.min(0, boxLo(bs, 1, 0)), v1: Math.max(h, boxHi(bs, 1, 0)),
    w0: Math.max(-2.2 * h, I ? I.region.w0 : -3), w1: Math.max(0.3, boxHi(bs, 2, 0), m.reveal)
  };
}
/** how far the cuts may travel: across the opening and what its devices add */
export function cutLimits(m) {
  if (!m.opening) return { u0: -1.5, u1: 1.5, v0: 0, v1: m.storeyH };
  const bs = m.own;
  const uHi = Math.max(Math.abs(m.opening.u0), Math.abs(m.opening.u1), boxHi(bs, 0, 0), -boxLo(bs, 0, 0));
  return { u0: -uHi, u1: uHi, v0: Math.max(0, Math.min(m.sill, boxLo(bs, 1, 0))), v1: Math.max(m.head, boxHi(bs, 1, 0)) };
}
export function clampCuts(S, m) {
  const c = cutLimits(m);
  S.cutU = clamp(S.cutU, c.u0, c.u1);
  S.cutV = clamp(S.cutV, c.v0, c.v1);
}

export function detailCamera(m, cam, S) {
  const x = extents(m, S);
  // the orbit turns about the middle of the window being worked on
  const ctr = m.opening ? [(m.opening.u0 + m.opening.u1) / 2, (m.opening.v0 + m.opening.v1) / 2, 0] : [0, m.storeyH / 2, 0];
  const R = 0.95 * Math.hypot(x.u1 - x.u0, x.v1 - x.v0, x.w1 - x.w0);
  const az = cam.az * Math.PI / 180, el = clamp(cam.el, -80, 85) * Math.PI / 180;
  const e = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const right = v3.unit(v3.cross([0, 1, 0], e)), up = v3.cross(e, right);
  const k = 0.47 * Math.min(W, H) / R * cam.zoom;
  const cx = W / 2 + cam.panX, cy = H * 0.5 + cam.panY;
  return {
    x, k, e,
    P: p => { const d = v3.sub(p, ctr); return [cx + v3.dot(d, right) * k, cy - v3.dot(d, up) * k]; }
  };
}

/** the other storeys' elements that stand near the unit - this storey's are drawn whole */
function inFrame(m, x) {
  return m.ctx.filter(b => b.st !== m.st && b.c[0] - boxSpan(b, 0) < x.u1 && b.c[0] + boxSpan(b, 0) > x.u0
    && b.c[1] - boxSpan(b, 1) < x.v1 + 0.5 && b.c[1] + boxSpan(b, 1) > x.v0 - 0.5);
}

/* ---------- the storey as faces ----------
   Inside faces look into the room, so each is seen only from inside: the back
   of a part's wall and its glass, tinted and see-through so what stands
   beyond still reads. The floor and the ceiling run over the whole plate. */
function innerFaces(cell, rect, withReturns) {
  const out = [], o = cell.opening, wg = -GLASS_T, face = (pts, n, kind) => out.push(bpoly(pts, n, kind));
  for (const p of wallPieces(cell, rect)) {
    if (p.role === 'spandrel') continue;
    const a0 = p.c[0] - p.h[0], a1 = p.c[0] + p.h[0], b0 = p.c[1] - p.h[1], b1 = p.c[1] + p.h[1], wb = p.c[2] - p.h[2];
    face([[a0, b0, wb], [a0, b1, wb], [a1, b1, wb], [a1, b0, wb]], [0, 0, -1], 'inwall');
  }
  const g0 = Math.max(o.u0, rect.u0), g1 = Math.min(o.u1, rect.u1);
  if (g1 - g0 > 1e-6) face([[g0, o.v0, wg], [g0, o.v1, wg], [g1, o.v1, wg], [g1, o.v0, wg]], [0, 0, -1], 'glassIn');
  const wi = cell.wIn;
  if (withReturns && wi < wg - 1e-4) {
    // across a run of units filling their bays, the head and sill run on and there are no jambs
    const ret = (p0, p1, n) => face([[p0[0], p0[1], wg], [p1[0], p1[1], wg], [p1[0], p1[1], wi], [p0[0], p0[1], wi]], n, 'inreturn');
    const L = cell.run ? rect.u0 : o.u0, R = cell.run ? rect.u1 : o.u1;
    if (!cell.run || o.v1 < rect.v1 - 1e-9) ret([L, o.v1], [R, o.v1], [0, -1, 0]);
    if (!cell.run || o.v0 > rect.v0 + 1e-9) ret([R, o.v0], [L, o.v0], [0, 1, 0]);
    if (!cell.run) { ret([o.u0, o.v0], [o.u0, o.v1], [1, 0, 0]); ret([o.u1, o.v1], [o.u1, o.v0], [-1, 0, 0]); }
  }
  return out;
}
/** a plain slab of wall, outside and inside, between wall faces w1 (out) and w0 (in) */
function slabFaces(rect, w0, w1) {
  const { u0, u1, v0, v1 } = rect;
  return [bpoly([[u0, v0, w1], [u1, v0, w1], [u1, v1, w1], [u0, v1, w1]], [0, 0, 1], 'wall'),
    bpoly([[u0, v0, w0], [u0, v1, w0], [u1, v1, w0], [u1, v0, w0]], [0, 0, -1], 'inwall')];
}
/** every other part of the storey as it stands, unanalysed: wall, plain glass, devices, inside */
function partFaces(P) {
  if (P.kind === 'blank') return slabFaces(P.rect, -P.wallT, 0);
  if (P.kind === 'end') return slabFaces(P.rect, P.rev - P.wallT, P.rev);
  const c = P.cell, o = c.opening, out = [];
  const g0 = Math.max(o.u0, P.rect.u0), g1 = Math.min(o.u1, P.rect.u1);
  if (g1 - g0 > 1e-6) out.push(bpoly([[g0, o.v0, 0], [g1, o.v0, 0], [g1, o.v1, 0], [g0, o.v1, 0]], [0, 0, 1], 'glassN'));
  for (const f of wallFaces(c, P.rect, false)) out.push(bpoly(f.pts, f.n, f.kind));
  for (const b of c.elements) for (const f of boxFaces(b)) out.push(bpoly(f.pts, f.n, 'dev', { sys: b.sys }));
  return out.concat(innerFaces(c, P.rect, false));
}
/* ---------- the beam coming in ----------
   The lit glass, carried along the beam to where each of its corners meets
   the floor or a wall: the edges of the volume of sunlight inside, drawn
   ghosted over everything so the eye can follow it from the glass to the patch. */
function beamVolume(m, I, sl) {
  const L = litGlass(m, sl);
  if (!L) return null;
  const { R } = I, d = [-sl[0], -sl[1], -sl[2]];
  const hit = P => {
    let t = Infinity;
    if (d[1] < -1e-9) t = Math.min(t, -P[1] / d[1]);
    if (d[2] < -1e-9) t = Math.min(t, (R.w0 - P[2]) / d[2]);
    if (d[0] < -1e-9) t = Math.min(t, (R.u0 - P[0]) / d[0]);
    if (d[0] > 1e-9) t = Math.min(t, (R.u1 - P[0]) / d[0]);
    return isFinite(t) ? [P[0] + d[0] * t, P[1] + d[1] * t, P[2] + d[2] * t] : null;
  };
  const glass = [[L.u0, L.v0, -GLASS_T], [L.u1, L.v0, -GLASS_T], [L.u1, L.v1, -GLASS_T], [L.u0, L.v1, -GLASS_T]];
  const far = glass.map(hit);
  return far.some(x => !x) ? null : { glass, far };
}

/* The trees survive an orbit. The other parts' depend on their geometry
   alone and are shared by every part that is the same; the selected unit's
   carries the sun as well, and is rebuilt when either moves. */
const grow = polys => ({ polys, node: polys.length <= BSP_CAP ? bspBuild(polys) : null });
const walkT = (t, e) => t.node ? bspOrder(t.node, e, []) : paintOrder(t.polys, e, GLASS_GROUP).order;
let parts = new Map(), selTree = { key: '', t: null };
function partTree(P) {
  const key = [P.kind, P.cell ? P.cell.key : P.wallT, P.rev, P.rect.u0.toFixed(4), P.rect.u1.toFixed(4), P.rect.v1].join('|');
  let t = parts.get(key);
  if (!t) { if (parts.size > 600) parts = new Map(); parts.set(key, t = grow(partFaces(P))); }
  return t;
}
/* the other windows the results are for, lit: their glass with its sun and
   shadows, their patches, their beams - all kept until the sun or the design moves */
let litCache = { key: '', v: new Map() };
function litParts(F, sunKey) {
  // the selected window is drawn on its own, so the set of others changes with it
  const key = sunKey + '|' + F.S.scope + '|' + F.sel.f + F.sel.st + ':' + F.sel.unit + '|' + (F.S.rot || 0) + '|' + JSON.stringify(F.S.storeys);
  // while the sun is being dragged the other windows wait; an orbit finds them kept
  if (litCache.key !== key && F.light) return new Map();
  if (litCache.key !== key) litCache = { key, v: new Map() };
  const out = litCache.v;
  if (out.size) return out;
  const { cur } = F;
  for (const x of lightUnits(F)) {
    if (x.P.sel) continue;
    const sl = sunLocal(cur.alt, cur.az, x.m.gf);
    if (!cur.up || sl[2] <= 1e-9) continue;
    const c2 = { onFacade: true, sl }, rect = x.P.rect;
    const tree = grow(openingFaces(x.m, c2, rect, false, x.m.own).filter(q => q.kind !== 'glassN').concat(innerFaces(x.m, rect, false)));
    const patches = sl[1] > 1e-6 ? sunPatches(x.m, x.R, sl).filter(pt => pt.S.key !== 'ceiling') : [];
    out.set(x.P.f + ':' + x.P.i, { x, tree, patches, beam: beamVolume(x.m, { R: x.R }, sl) });
  }
  return out;
}
function selectedTree(m, cur, x) {
  const key = [m.key, fmt(x.u0, 3), fmt(x.u1, 3), cur.onFacade ? cur.sl.map(s => fmt(s, 4)).join(',') : 'none'].join('|');
  if (selTree.key !== key) {
    const rect = { u0: m.r0, u1: m.r1, v0: 0, v1: m.storeyH };
    const polys = openingFaces(m, cur, rect, true, m.own.concat(inFrame(m, x)))
      .filter(q => q.kind !== 'glassN').concat(innerFaces(m, rect, true));
    selTree = { key, t: grow(polys) };
  }
  return selTree.t;
}
/** the sun ray's handle, and the glass of every window drawn, as last drawn */
export let detailSun = null, detailHits = [], detailEye = [0, 0, 1];

export function drawDetail(F) {
  const { S, V, m, cur, sel } = F;
  detailSun = null; detailHits = [];
  const I = interiorOf(m, S), cam = detailCamera(m, V.detcam, S), P = cam.P, x = cam.x, e = cam.e;
  detailEye = e;
  let g = defsCommon;
  const fop = V.detSolid ? 1 : 0.34, wop = V.detWall ? 1 : .22;
  const style = q => {
    switch (q.kind) {
      case 'glassN': return { fills: [['var(--glassfill)', wop]], stroke: 'var(--glass)', w: .8 };
      case 'glass': return { fills: [['var(--shadefill)', wop]] };
      case 'lit': return { fills: [['var(--sun)', Math.max(.5, wop)]] };
      case 'shadow': return { fills: [['var(--shadefill)', wop]] };
      case 'opening': return { fills: [], stroke: 'var(--glass)', w: 1.6 };
      case 'wall': return { fills: [['var(--panel)', wop], ['url(#poche)', wop * .8]] };
      case 'spandrel': return { fills: [['var(--shade)', wop * .9]], stroke: 'var(--ink3)', w: .5 };
      case 'cut': return { fills: [['var(--panel)', wop], ['url(#poche)', wop * .8]], stroke: 'var(--ink3)', w: .5 };
      case 'return': return { fills: [['var(--panel)', wop], ['var(--shade)', wop * .85]], stroke: 'var(--ink)', w: .6 };
      case 'inwall': return { fills: [[ROOMWALL, 1]], stroke: 'var(--ink3)', w: .4 };
      case 'inreturn': return { fills: [['#DCD8CE', 1]], stroke: 'var(--ink3)', w: .5 };
      case 'glassIn': return { fills: [['var(--glassfill)', 1]], stroke: 'var(--glass)', w: 1.2 };
      case 'room': return { fills: [[q.fill, 1]], stroke: 'var(--ink3)', w: .5 };
      case 'patch': return { fills: [['var(--sun)', .92]] };
      case 'patchShade': return { fills: [[q.fill, 1]] };
      case 'ctx': return { fills: [['var(--shade)', .35 * fop + .1]], stroke: 'var(--ink3)', w: .4 };
      default: {
        const top = q.n[1] > 0.55;
        return { fills: [[top ? 'var(--shade)' : 'var(--poche)', (top ? .95 : .92) * fop]], stroke: 'var(--ink)', w: V.detSolid ? .35 : .5 };
      }
    }
  };
  // a device the by-law does not allow where it stands is drawn red
  const RED = { fills: [['#C0442B', .92]], stroke: '#6E1F10', w: .45 };
  // and glass over the by-law's SHGC
  const REDG = { glassN: { fills: [['#C0442B', .45 * wop + .1]], stroke: '#6E1F10', w: .8 }, glass: { fills: [['#C0442B', .55 * wop]] }, shadow: { fills: [['#C0442B', .55 * wop]] }, lit: { fills: [['#E8806A', Math.max(.5, wop)]] } };
  const redden = (f, st, i, base) => {
    const bad = F.checks && F.checks.badOf(f, st, i), dev = bad && bad.size, gl = F.checks && F.checks.glassBad(f, st, i);
    return dev || gl ? q => (dev && q.kind === 'dev' && bad.has(q.sys) ? RED : gl && REDG[q.kind] ? REDG[q.kind] : base(q)) : base;
  };
  // a side standing between the eye and the room is ghosted
  const ghost = q => { const s0 = style(q); return s0 && { fills: s0.fills.map(([f, o]) => [f, o * 0.16]), stroke: s0.stroke ? 'var(--ink3)' : undefined, w: .3 }; };

  // the floor and ceiling of the whole plate, and on the floor the sun through this window
  const pc = plateCorners(F), h = m.storeyH, R = I ? I.R : null;
  const floor = bpoly(pc.map(([u, w]) => [u, 0, w]).reverse(), [0, 1, 0], 'room', { fill: FLOOR });
  const ceil = bpoly(pc.map(([u, w]) => [u, h, w]), [0, -1, 0], 'room', { fill: ROOMWALL });
  if (floor.n[1] * e[1] > 0) g += paintFaces([floor], P, e, style);
  else g += paintFaces([ceil], P, e, style);
  const items = [];
  if (m.opening && cur.onFacade && R) for (const pt of sunPatches(m, R, cur.sl)) {
    if (pt.S.key === 'ceiling') continue;
    const polys = [bpoly(pt.lit.map(p => toUnit(pt.S, p)), pt.S.n, 'patch')]
      .concat(pt.shade.map(sh => bpoly(sh.map(p => toUnit(pt.S, p)), pt.S.n, 'patchShade', { fill: pt.S.key === 'floor' ? FLOOR : ROOMWALL })));
    if (pt.S.key === 'floor') { g += paintFaces(polys, P, e, style); continue; }
    // a patch on a wall of the room paints just in front of that wall
    const c = polys[0].pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => v / polys[0].pts.length);
    items.push({ d: v3.dot(v3.add(c, v3.mul(pt.S.n, 0.4)), e), paint: () => paintFaces(polys, P, e, style) });
  }
  const lit = m.opening && cur.up ? litParts(F, cur.az.toFixed(3) + ',' + cur.alt.toFixed(3)) : new Map();
  const hits = [];
  // the other windows' patches: on the floor now, on a wall in its place in depth
  for (const L0 of lit.values()) for (const pt of L0.patches) {
    const mp = p => L0.x.P.map(toUnit(pt.S, p)), n = L0.x.P.nmap(pt.S.n);
    const polys = [bpoly(pt.lit.map(mp), n, 'patch')].concat(pt.shade.map(sh => bpoly(sh.map(mp), n, 'patchShade', { fill: pt.S.key === 'floor' ? FLOOR : ROOMWALL })));
    if (pt.S.key === 'floor') { g += paintFaces(polys, P, e, style); continue; }
    const c = polys[0].pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => v / polys[0].pts.length);
    items.push({ d: v3.dot(v3.add(c, v3.mul(n, 0.4)), e), paint: () => paintFaces(polys, P, e, style) });
  }
  for (const Pt of storeyParts(F)) {
    if (Pt.sel) continue;
    const cc = Pt.map([(Pt.rect.u0 + Pt.rect.u1) / 2, h / 2, Pt.rev || 0]);
    const ghosted = Pt.f !== sel.f && v3.dot(Pt.out, e) > 0.05, eL = Pt.eye(e), L0 = lit.get(Pt.f + ':' + Pt.i);
    const d = v3.dot(cc, e);
    items.push({ d, paint: () => paintFaces(walkT(L0 ? L0.tree : partTree(Pt), eL), p => P(Pt.map(p)), eL, ghosted ? ghost : Pt.kind === 'unit' ? redden(Pt.f, Pt.st, Pt.i, style) : style) });
    // a window's glass can be clicked to select it
    if (Pt.kind === 'unit' && !ghosted) {
      const o = Pt.cell.opening;
      hits.push({ f: Pt.f, st: Pt.st, unit: Pt.i, d, eye: Pt.eye, pts: [[o.u0, o.v0, 0], [o.u1, o.v0, 0], [o.u1, o.v1, 0], [o.u0, o.v1, 0]].map(q => P(Pt.map(q))) });
    }
  }
  if (m.opening) {
    const ts = selectedTree(m, cur, x);
    items.push({ d: v3.dot([(m.opening.u0 + m.opening.u1) / 2, h / 2, 0], e), paint: () => paintFaces(walkT(ts, e), P, e, redden(sel.f, sel.st, sel.unit, style)) });
  }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) g += it.paint();
  detailHits = hits.sort((a, b) => a.d - b.d);

  const where = sel.f + ' side · storey ' + (sel.st + 1) + (sel.unit !== null ? ' · unit ' + (sel.unit + 1) + ' of ' + sel.row.units.length : '');
  if (!m.opening) {
    g += TB(W / 2, H / 2, 'No glazing on this storey of the ' + sel.f + ' side', { anchor: 'middle', size: 11, fill: 'var(--ink2)', bg: .9 });
    g += T(12, 20, where, { size: 9, fill: 'var(--ink3)' });
    return svg(g, 'Three-dimensional view of a blank storey');
  }

  // the volume of sunlight coming in, ghosted over the room: the other windows' fainter
  if (V.beam !== false) for (const L0 of lit.values()) {
    const b = L0.beam;
    if (!b) continue;
    const mp = q => P(L0.x.P.map(q));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      g += POLY([b.glass[i], b.glass[j], b.far[j], b.far[i]].map(mp), { fill: 'var(--sun)', op: .05 });
    }
  }
  const beam = cur.onFacade && V.beam !== false ? beamVolume(m, I, cur.sl) : null;
  if (beam) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, q = [beam.glass[i], beam.glass[j], beam.far[j], beam.far[i]].map(P);
      g += POLY(q, { fill: 'var(--sun)', op: .09 });
    }
    for (let i = 0; i < 4; i++) { const a = P(beam.glass[i]), b = P(beam.far[i]); g += L(a[0], a[1], b[0], b[1], { stroke: 'var(--sun)', w: .7, op: .55, dash: '3 2' }); }
  }

  // the two cuts, ghosted, each with a tab to pull it by
  const quad = (pts, o) => POLY(pts.map(P), o);
  g += quad([[S.cutU, x.v0, x.w0], [S.cutU, x.v1, x.w0], [S.cutU, x.v1, x.w1], [S.cutU, x.v0, x.w1]],
    { fill: 'var(--glass)', op: .07, stroke: 'var(--glass)', w: .8, dash: '5 3' });
  g += quad([[x.u0, S.cutV, x.w0], [x.u1, S.cutV, x.w0], [x.u1, S.cutV, x.w1], [x.u0, S.cutV, x.w1]],
    { fill: 'var(--sun)', op: .07, stroke: 'var(--sun)', w: .8, dash: '5 3' });
  const tab = (pt, col, label, edit) => {
    const q = P(pt);
    return CIRCLE(q[0], q[1], 7.5, { fill: 'var(--panel)', stroke: col, 'stroke-width': 1.6 }) + CIRCLE(q[0], q[1], 3, { fill: col })
      + TB(clamp(q[0], 46, W - 46), clamp(q[1] - 13, 48, H - 26), label, { anchor: 'middle', size: 8.5, fill: col, bg: .9, edit });
  };
  // the tabs are pulled to move the cuts; their figures take a typed value
  g += tab(sectionTab(S, cam), 'var(--glass)', 'section ' + fmt(S.cutU, 2) + ' m', 'cutU');
  g += tab(planTab(S, cam), 'var(--sun)', 'plan ' + fmt(S.cutV, 2) + ' m', 'cutV');

  // one sun ray, from outside through the glass to where it lands inside
  if (cur.onFacade) {
    const o = m.opening, oc = (o.u0 + o.u1) / 2, hw = m.winW / 2, land = [clamp(S.cutU, oc - hw * 0.8, oc + hw * 0.8), (m.sill + m.head) / 2, 0];
    const Lr = Math.max(x.w1 * 2.2, 1.2), a = P(v3.add(land, v3.mul(cur.sl, Lr))), b = P(land);
    g += L(a[0], a[1], b[0], b[1], { stroke: 'var(--sun)', w: 1.5, marker: 'url(#ar)', op: .9 });
    // its outer end is a handle: dragged, the sun follows it round the window
    g += sunKnob(a[0], a[1]);
    const gf = m.gf;
    detailSun = { knob: a, project: (alt, az) => { const sl = sunLocal(alt, az, gf); return sl[2] > 1e-6 ? P(v3.add(land, v3.mul(sl, Lr))) : null; } };
    if (cur.sl[1] > 1e-3) {
      const tf = land[1] / cur.sl[1], fl = v3.sub(land, v3.mul(cur.sl, tf));
      if (fl[2] > x.w0) { const c = P(fl); g += L(b[0], b[1], c[0], c[1], { stroke: 'var(--sun)', w: 1, dash: '4 3', op: .8 }) + CIRCLE(c[0], c[1], 2.4, { fill: 'var(--sun)' }); }
    }
  }

  const A = m.winW * m.winH, litArea = (1 - cur.frac) * A;
  g += T(12, 20, cur.onFacade
    ? 'orange is where the beam reaches · ' + fmt(litArea, 2) + ' of ' + fmt(A, 2) + ' m² of glass (' + fmt(litArea / A * 100, 0) + ' %)'
    : cur.up ? 'the sun is up but behind this facade' : 'the sun is below the horizon', { size: 9, fill: 'var(--ink3)' });
  const side = Math.abs(wrap180(V.detcam.az)) > 90 ? 'from inside' : 'from outside';
  g += T(12, 32, where + ' · ' + side + (V.detWall ? '' : ' · wall ghosted') + (V.detSolid ? '' : ' · devices see-through'), { size: 9, fill: 'var(--ink3)' });
  const wallTxt = !m.opening ? 'no glazing' : 'wall ' + fmt(m.wallT * 1000, 0) + ' mm · glass set back ' + fmt(m.reveal * 1000, 0) + ' mm' + (m.run ? ' · glass to glass' : '') + ' · slab ' + fmt((m.slab || 0) * 1000, 0) + ' mm';
  g += T(12, H - 27, wallTxt + ' · the whole storey, open plan · the sun through ' + PLAN_LIGHT_WORDS[PLAN_LIGHT[S.scope] || 'unit'], { size: 9, fill: 'var(--ink3)' });
  g += T(12, H - 14, 'drag to orbit · click a window to select it · drag the ray\'s end to move the sun · wheel to zoom', { size: 9, fill: 'var(--ink3)' });
  return svg(g, 'Three-dimensional view of one glazing unit in its storey, showing where direct sun lands');
}
export const sectionTab = (S, cam) => [S.cutU, cam.x.v1, cam.x.w1];
export const planTab = (S, cam) => [cam.x.u1, S.cutV, cam.x.w1];
