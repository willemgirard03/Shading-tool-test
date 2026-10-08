/* The building, the sky dome and the solar angles, orthographic.

   The camera azimuth is a compass bearing, so the sky, the compass and the
   seasonal arcs stay put and the block turns under them. Every sky and ground
   construction is a layer that can be switched off.

   Every storey of every side that has glazing is drawn as its units, each the
   same model the window view draws: wall, reveal, glazing and elements, built
   and sorted once in facade coordinates and repeated. The units tile the face,
   and because each carries its own wall, the wall genuinely hides the glass set
   back behind it. Everything at or behind the wall face is laid down for every
   unit first, and the elements standing off it after, so no unit's wall can
   paint over a neighbour's device. The glass of each unit carries the shadows
   of its neighbours' devices as well as its own.

   The selected condition is outlined, and every unit and storey drawn is
   remembered so a click on the drawing can select it.                      */

import { D2R, clamp, fmt, wrap360, wrap180, v3, MONTHS } from '../util.js';
import { SITE, solarPosition, sunVec } from '../solar.js';
import { buildingHeight, unitModel, unitKey, FACADES, plateRadius, plateWorld, storeyCentre, storeyBases, storeyRot, toWorld, boxCorners, contextAxes, contextGap, CTX_DRAFT0 } from '../geometry/building.js';
import { boxFaces } from '../geometry/boxes.js';
import { bpoly, paintOrder, bspBuild, bspOrder, BSP_CAP } from '../geometry/bsp.js';
import { openingFaces, GLASS_GROUP } from './opening.js';
import { W, H, El, T, L, POLY, PATH, CIRCLE, TB, defsCommon, svg, paintFaces, mm } from './svg.js';
import { AX_LAYERS } from '../view.js';
import { hourly } from '../weather.js';
import { isStreet } from '../geometry/site.js';
import { TEMP_BANDS } from './sunpath.js';

// the solstices and the equinox - March's and September's paths all but lie on each other, so one stands for both
const PATH_DOYS = [355, 80, 172];
const NOON_LABELS = { 172: '21 Jun', 80: '21 Mar · Sep', 355: '21 Dec' };
const compassPt = (brg, r, z) => [r * Math.sin(brg * D2R), r * Math.cos(brg * D2R), z || 0];
const ringPts = (r, z, n = 96) => Array.from({ length: n + 1 }, (_, i) => compassPt(i * 360 / n, r, z));

/* the sun path on the dome does not depend on the camera, so it is built once
   per dome radius and reused on every orbit frame */
let arcs = { R: 0, months: null, days: {} };
function arcRuns(doy, R) {
  const runs = []; let run = null;
  for (let t = 0; t <= 24.001; t += 0.1) {
    const sp = solarPosition(doy, t, 'sol');
    if (sp.alt < 0) { run = null; continue; }
    if (!run) { run = []; runs.push(run); }
    run.push(v3.mul(sunVec(sp.alt, sp.az), R));
  }
  return runs;
}
function domeArcs(R) {
  if (arcs.R === R && arcs.months) return arcs.months;
  const months = PATH_DOYS.map(doy => ({ doy, key: NOON_LABELS[doy] !== undefined, label: NOON_LABELS[doy] || '',
    runs: arcRuns(doy, R), noon: null, hours: [] }));
  months.forEach(mo => {
    const sp = solarPosition(mo.doy, 12, 'sol');
    if (sp.alt > 0) mo.noon = v3.mul(sunVec(sp.alt, sp.az), R);
    if (!mo.key) return;
    for (let h = 4; h <= 20; h++) {
      const s = solarPosition(mo.doy, h, 'sol');
      if (s.alt > 1) mo.hours.push({ h, p: v3.mul(sunVec(s.alt, s.az), R) });
    }
  });
  arcs = { R, months, days: {} };
  return months;
}
/** every daylit hour of a weather file as a point on the unit dome, with its temperature band - built once per file */
let wxDome = { wx: null, pts: [] };
function wxPoints(wx) {
  if (wxDome.wx === wx) return wxDome.pts;
  const db = hourly(wx).db, pts = [];
  for (let d = 1; d <= 365; d++) for (let h = 0; h < 24; h++) {
    const sp = solarPosition(d, h + 0.5, 'lst');
    if (sp.alt < 0.5) continue;
    const t = db[(d - 1) * 24 + h] / 10;
    pts.push([sunVec(sp.alt, sp.az), t < TEMP_BANDS[0][0] ? 0 : t < TEMP_BANDS[1][0] ? 1 : 2]);
  }
  wxDome = { wx, pts };
  return pts;
}
function dayArcPts(doy, R) {
  domeArcs(R);
  if (!arcs.days[doy]) arcs.days[doy] = arcRuns(doy, R);
  return arcs.days[doy];
}

export function axonCamera(S, cam) {
  const Htot = buildingHeight(S);
  const span = Math.max(2 * plateRadius(S), Htot);
  const Rdome = span * 1.45, Rground = span * 1.15, Rfit = Math.max(Rdome, Rground);
  const az = cam.daz * D2R, el = clamp(cam.el, 0, 88) * D2R;
  const c = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const right = v3.unit([-c[1], c[0], 0]), up = v3.cross(c, right);
  const k = 0.46 * W / Rfit * cam.zoom;
  // the dome reaches R above its centre and R*sin(el) below, so the frame is
  // re-centred on that band at whatever elevation the user orbits to; zoomed
  // in, the frame closes on the middle of the building instead
  // a close-up names the point it looks at; otherwise zooming in closes on the building
  const near = cam.focus ? 1 : clamp((cam.zoom - 1) / 1.5, 0, 1), look = cam.focus || [0, 0, Htot / 2 * near];
  const cx = W / 2 + cam.panX, cy = H * 0.5 + Rfit * k / cam.zoom * (1 - Math.sin(el)) / 2 * (1 - near) + cam.panY;
  return {
    Htot, span, Rdome, Rground, e: c,
    P: p => { const d = v3.sub(p, look); return [cx + v3.dot(d, right) * k, cy - v3.dot(d, up) * k]; },
    /** a point on the drawing back onto the ground plane: two equations, x and y */
    ground: (sx, sy) => {
      const a = (sx - cx) / k + v3.dot(look, right), b = (cy - sy) / k + v3.dot(look, up) - look[2] * 0;
      const det = right[0] * up[1] - right[1] * up[0];
      if (Math.abs(det) < 1e-9) return null;
      return [(a * up[1] - b * right[1]) / det, (b * right[0] - a * up[0]) / det, 0];
    },
    front: p => v3.dot(p, c) > span * 0.55,       // in front of the block, so drawn over it
    vis: n => (n[0] * c[0] + n[1] * c[1]) > 0.02
  };
}
/** a polyline split into the stretch behind the block and the stretch in front */
function depthSplit(pts, cam) {
  let back = '', front = '', side = null;
  for (const p of pts) {
    const s = cam.front(p) ? 1 : 0, q = cam.P(p);
    const cmd = (s === side ? 'L' : 'M') + fmt(q[0], 2) + ',' + fmt(q[1], 2);
    if (s) front += (front ? ' ' : '') + cmd; else back += (back ? ' ' : '') + cmd;
    side = s;
  }
  return [back, front];
}
/** the first face of the block a ray meets, or null: storey by storey, each its own box */
function blockEntry(P0, d, S) {
  const zb = storeyBases(S);
  let best = null;
  S.storeys.forEach((s, i) => {
    const r = storeyRot(S, i) * D2R, cr = Math.cos(r), sr = Math.sin(r), c = storeyCentre(S, i);
    const p = boxEntry(P0, d, [c[0], c[1], zb[i] + s.h / 2], [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]], [s.w / 2, s.d / 2, s.h / 2]);
    if (p && (!best || p.t < best.t)) best = p;
  });
  return best ? best.p : null;
}
function boxEntry(P0, d, C, ax, h) {
  const del = v3.sub(P0, C);
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const e = v3.dot(del, ax[i]), f = v3.dot(d, ax[i]);
    if (Math.abs(f) > 1e-9) {
      let t1 = (-h[i] - e) / f, t2 = (h[i] - e) / f;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    } else if (Math.abs(e) > h[i]) return null;
  }
  return tmin > 0 ? { t: tmin, p: v3.add(P0, v3.mul(d, tmin)) } : null;
}

const FACADE_FILL = '#E9EEEB';
const RED_GLASS = { glass: { fills: [['#C0442B', .62]] }, shadow: { fills: [['#C0442B', .62]] }, lit: { fills: [['#E8806A', .92]] },
  glassN: { fills: [['#C0442B', .45]], stroke: '#6E1F10', w: .8 } };
const RED_DEV = { fills: [['#C0442B', .92]], stroke: '#6E1F10', w: .45 };

/* Two trees per unit, kept across orbits: the layer at and behind the wall face
   (wall, reveal, glazing) and the elements standing off it. Elements never reach
   behind the face, so the wall need not be split by every blade and fin plane.
   The glass carries its neighbours' shadows, so the back tree belongs to a
   unit's surroundings; the front belongs to the cell. Both are shared by every
   unit that is the same, and the whole scene is kept until the geometry or the
   sun moves - an orbit only walks the trees. */
const grow = polys => ({ polys, node: polys.length <= BSP_CAP ? bspBuild(polys) : null });
const walk = (t, e, flat) => t.node ? bspOrder(t.node, e, []) : paintOrder(t.polys, e, flat).order;
let scene = { key: '', units: [], lines: [] };
function sceneOf(F, cur) {
  const { S, B } = F;
  const sun = cur.up ? cur.az.toFixed(3) + ',' + cur.alt.toFixed(3) : '-';
  const key = [(B.context || []).map(b => [...b.c, b.a, ...b.h].map(x => x.toFixed(3)).join(',')).join(';'), S.rot || 0, S.storeys.map(s => [s.w, s.d, s.ox || 0, s.oy || 0, s.rot || 0, s.rotRel || 'building', s.oxyIn || 'own'].join('x')).join(','), sun, ...Object.values(B.facades).flatMap(fc => fc.rows.map(r => r.cell ? r.cell.key + (r.units.some(q => q.broken) ? '#' + r.units.map(q => q.cid).join(',') + '#' + r.units.filter(q => q.broken).map(q => q.cell.key).join('&') : '') : 'x' + r.h))].join('|');
  if (scene.key === key) return scene;
  const backs = new Map(), fronts = new Map(), units = [];
  // each device thinned on its own, so a sparse array is never swallowed by a dense one
  const thin = els => {
    const mp = new Map();
    els.forEach(b => { if (!mp.has(b.D)) mp.set(b.D, []); mp.get(b.D).push(b); });
    return [...mp.values()].flatMap(bs => { const keep = bs[0].kind === 'h' ? 8 : 10, step = Math.max(1, Math.ceil(bs.length / keep)); return bs.filter((_, i) => i % step === 0); });
  };
  for (const fc of Object.values(B.facades)) {
    for (const r of fc.rows) {
      if (!r.cell) continue;
      const sl = cur.up ? solarAtFacade(cur, r.gf) : null;
      for (const q of r.units) {
        const qc = q.cell;
        if (!fronts.has(qc.key)) fronts.set(qc.key, grow(thin(qc.elements).flatMap(b => boxFaces(b).map(f => bpoly(f.pts, f.n, 'dev', { sys: b.sys })))));
        const c2 = { onFacade: !!sl && sl[2] > 1e-6, sl };
        // a bay clipped at the end of a spaced side has a narrower wall of its own
        const bk = unitKey(B, fc.f, r.st, q.i) + '|' + q.r0.toFixed(4) + ',' + q.r1.toFixed(4) + '|' + (c2.onFacade ? sl.map(x => x.toFixed(5)).join(',') : '-');
        // built the first time the unit is drawn: a side facing away may never be
        const f0 = fc.f, st0 = r.st, i0 = q.i, rect = { u0: q.r0, u1: q.r1, v0: 0, v1: r.h };
        const back = () => { let t = backs.get(bk); if (!t) backs.set(bk, t = grow(openingFaces(unitModel(B, f0, st0, i0), c2, rect, false, []))); return t; };
        units.push({ f: fc.f, st: r.st, i: q.i, cc: q.cc, zb: r.zb, rev: qc.reveal, cell: qc, broken: q.broken,
          back, front: fronts.get(qc.key) });
      }
    }
  }
  scene = { key, units };
  return scene;
}
/* The site on the ground: the streets first, each a band from its property line
   across, run on round a corner where the next side is a street too, with its
   curbs; then the boundary, side by side by its condition; then each side's
   setback from the ground floor's face, its figure typed over in place. */
function siteGround(F, P) {
  const SF = F.checks.SF, sg = SF.seg, { x0, x1, y0, y1 } = SF;
  const pt = (x, y) => { const w = SF.toW(x, y); return P([w[0], w[1], 0]); };
  const line = (a, b, o) => L(...pt(a[0], a[1]), ...pt(b[0], b[1]), o);
  const ext = f => isStreet(sg[f]) ? sg[f].width : 0;
  let g = '', over = '';
  const bands = {
    S: s => ({ q: [[x0 - ext('W'), y0], [x1 + ext('E'), y0], [x1 + ext('E'), y0 - s.width], [x0 - ext('W'), y0 - s.width]], at: c => [[x0 - ext('W'), y0 - c], [x1 + ext('E'), y0 - c]], mid: [(x0 + x1) / 2, y0 - s.width / 2] }),
    N: s => ({ q: [[x0 - ext('W'), y1], [x1 + ext('E'), y1], [x1 + ext('E'), y1 + s.width], [x0 - ext('W'), y1 + s.width]], at: c => [[x0 - ext('W'), y1 + c], [x1 + ext('E'), y1 + c]], mid: [(x0 + x1) / 2, y1 + s.width / 2] }),
    E: s => ({ q: [[x1, y0 - ext('S')], [x1, y1 + ext('N')], [x1 + s.width, y1 + ext('N')], [x1 + s.width, y0 - ext('S')]], at: c => [[x1 + c, y0 - ext('S')], [x1 + c, y1 + ext('N')]], mid: [x1 + s.width / 2, (y0 + y1) / 2] }),
    W: s => ({ q: [[x0, y0 - ext('S')], [x0, y1 + ext('N')], [x0 - s.width, y1 + ext('N')], [x0 - s.width, y0 - ext('S')]], at: c => [[x0 - c, y0 - ext('S')], [x0 - c, y1 + ext('N')]], mid: [x0 - s.width / 2, (y0 + y1) / 2] })
  };
  for (const f of ['S', 'N', 'E', 'W']) {
    const s = sg[f];
    if (!isStreet(s)) continue;
    const b = bands[f](s);
    // the walks between the property lines and the curbs, the roadway between the curbs a shade warmer, and its centre line
    g += POLY(b.q.map(p => pt(p[0], p[1])), { fill: '#EFEBE2' });
    const [r0, r1] = b.at(s.curb), [r2, r3] = b.at(s.width - s.curb);
    g += POLY([r0, r1, r3, r2].map(p => pt(p[0], p[1])), { fill: '#E1DACB' });
    if (s.curb > 0.05) g += line(r0, r1, { stroke: '#9A9384', w: .8 }) + line(r2, r3, { stroke: '#9A9384', w: .8 });
    const [m0, m1] = b.at(s.width / 2);
    g += line(m0, m1, { stroke: '#B8AE97', w: .9, dash: '8 6' });
    const m = pt(b.mid[0], b.mid[1]);
    over += TB(m[0], m[1], s.kind + ' ' + mm(s.width), { anchor: 'middle', size: 8.5, fill: 'var(--ink2)', bg: .85, edit: 'site.' + f + '.width' });
  }
  const sides = { S: [[x0, y0], [x1, y0]], E: [[x1, y0], [x1, y1]], N: [[x1, y1], [x0, y1]], W: [[x0, y1], [x0, y0]] };
  const look = { street: { stroke: 'var(--ink)', w: 1.4 }, lane: { stroke: 'var(--ink)', w: 1.1, dash: '6 3' }, property: { stroke: '#A23A16', w: 1.1, dash: '9 3 2 3' }, open: { stroke: 'var(--ink3)', w: .7, dash: '2 3' } };
  for (const f of Object.keys(sides)) g += line(sides[f][0], sides[f][1], look[sg[f].kind] || look.open);
  // each side's setback, from the middle of the ground floor's face
  const face = { S: [0, -SF.d / 2], N: [0, SF.d / 2], E: [SF.w / 2, 0], W: [-SF.w / 2, 0] }, bnd = { S: [0, y0], N: [0, y1], E: [x1, 0], W: [x0, 0] };
  for (const f of Object.keys(face)) {
    const a = pt(...face[f]), b = pt(...bnd[f]);
    if (sg[f].off > 0.05) g += L(a[0], a[1], b[0], b[1], { stroke: 'var(--ink2)', w: .7 });
    over += TB((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 3, mm(sg[f].off), { anchor: 'middle', size: 8, fill: 'var(--ink2)', bg: .85, edit: 'site.' + f + '.off' });
  }
  return { g, over };
}
/* A selected massing, ready to edit in place: a handle in the middle of each
   face toward the eye, pushed or pulled to move that face alone; a ring on
   the ground to turn it; its width, depth, height and turn written where they
   read, each typed over by a click; and its nearest distance to the building
   dimensioned on the ground, typed over to move it toward or away. */
function contextEdit(F, b, c, cam, P) {
  const e = cam.e, H2 = 2 * b.h[2], [hw, hd] = b.h;
  const at = (u, v, z) => [b.c[0] + u * b.ex[0] + v * b.ey[0], b.c[1] + u * b.ex[1] + v * b.ey[1], z];
  const lab = (q, txt, k, dx = 0, dy = 0) => TB(q[0] + dx, q[1] + dy, txt, { anchor: 'middle', size: 9, fill: 'var(--glass)', bg: .92, edit: k });
  let g = '';
  // the footprint, outlined
  g += POLY([at(-hw, -hd, 0), at(hw, -hd, 0), at(hw, hd, 0), at(-hw, hd, 0)].map(P), { fill: 'none', stroke: 'var(--glass)', w: 1.2, dash: '4 2' });
  // a handle on every face toward the eye: the screen's run per metre along its normal goes with it, for the drag
  const faces = [], toward = n => n[0] * e[0] + n[1] * e[1] > 0.05;
  for (const [key, n, u, v] of [['+x', b.ex, hw, 0], ['-x', [-b.ex[0], -b.ex[1]], -hw, 0], ['+y', b.ey, 0, hd], ['-y', [-b.ey[0], -b.ey[1]], 0, -hd]]) {
    if (!toward(n)) continue;
    const Q = at(u, v, b.h[2]), q = P(Q), q1 = P([Q[0] + n[0], Q[1] + n[1], Q[2]]);
    faces.push({ key, p: q, sv: [q1[0] - q[0], q1[1] - q[1]], n: [n[0], n[1], 0] });
  }
  if (e[2] > 0.05) { const Q = at(0, 0, H2), q = P(Q), q1 = P([Q[0], Q[1], Q[2] + 1]); faces.push({ key: 'top', p: q, sv: [q1[0] - q[0], q1[1] - q[1]], n: [0, 0, 1] }); }
  for (const f of faces) g += POLY([[f.p[0] - 4.5, f.p[1] - 4.5], [f.p[0] + 4.5, f.p[1] - 4.5], [f.p[0] + 4.5, f.p[1] + 4.5], [f.p[0] - 4.5, f.p[1] + 4.5]], { fill: 'var(--panel)', stroke: 'var(--glass)', w: 1.5 });
  // the ring on the ground, and its knob out past a corner - off the line of every face's handle, and never so near the middle on the drawing that it crowds them
  const DG = Math.SQRT1_2, pc = P(at(0, 0, 0)), pk = P(at(DG, DG, 0)), perM = Math.max(1e-6, Math.hypot(pk[0] - pc[0], pk[1] - pc[1]));
  const rr = Math.max(Math.hypot(hw, hd) + Math.max(2, 0.12 * Math.hypot(hw, hd)), 34 / perM), ring = [];
  for (let k = 0; k <= 48; k++) { const t = k / 48 * 2 * Math.PI; ring.push(P(at(rr * Math.sin(t), rr * Math.cos(t), 0))); }
  g += PATH(ring.map((q, k) => (k ? 'L' : 'M') + fmt(q[0], 1) + ',' + fmt(q[1], 1)).join(' '), { stroke: 'var(--glass)', w: .8, dash: '2 3', op: .7 });
  const kx = b.ex[0] * e[0] + b.ex[1] * e[1] >= 0 ? 1 : -1, ky = b.ey[0] * e[0] + b.ey[1] * e[1] >= 0 ? 1 : -1;
  const kq = P(at(kx * rr * DG, ky * rr * DG, 0));
  g += CIRCLE(kq[0], kq[1], 6.5, { fill: 'var(--panel)', stroke: 'var(--glass)', 'stroke-width': 1.6 }) + T(kq[0], kq[1] + 3.5, '↻', { anchor: 'middle', size: 9, fill: 'var(--glass)' });
  g += lab(kq, (Math.abs(c.a) < 0.05 ? '0' : fmt(c.a, 0)) + '°', 'site.k.a', 0, -12);
  // width along a ground edge toward the eye, depth along the other, height up the nearest corner
  const sy = toward(b.ey) ? 1 : -1, sx = toward(b.ex) ? 1 : -1, off = Math.max(1, 0.06 * Math.max(hw, hd) * 2);
  g += lab(P(at(0, sy * (hd + off), 0)), mm(c.w), 'site.k.w', 0, 3);
  g += lab(P(at(sx * (hw + off), 0, 0)), mm(c.d), 'site.k.d', 0, 3);
  g += lab(P(at(sx * hw, sy * hd, b.h[2])), mm(c.h), 'site.k.h', 26, 0);
  // the nearest distance to the building, on the ground
  const G = contextGap(F.S, c), qa = P([G.a[0], G.a[1], 0]), qb = P([G.b[0], G.b[1], 0]);
  if (G.d > 0.05) g += L(qa[0], qa[1], qb[0], qb[1], { stroke: 'var(--glass)', w: 1, dash: '5 3' }) + CIRCLE(qa[0], qa[1], 2.2, { fill: 'var(--glass)' }) + CIRCLE(qb[0], qb[1], 2.2, { fill: 'var(--glass)' });
  g += lab([(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2], (G.d > 0.05 ? mm(G.d) : 'touching'), 'site.k.gap', 0, -4);
  return { g, edit: { id: b.id, faces, rot: { p: kq, C: [b.c[0], b.c[1]] } } };
}
/* The selected side's window array, as a drawing program brackets an array:
   a dotted line through the middles of its windows, a tick at each, held off
   the facade over the heads, and its number and spacing in the middle - each
   typed over. A number typed sets the windows out by number, a spacing by
   spacing; the side then takes the other figure from it. */
function windowBracket(F, cam, P) {
  const { sel, S } = F, row = sel.row, fr = row.frame, us = row.units, o = us[0].cell.opening;
  if (!o) return '';
  const vb = Math.min(row.h - 0.15, o.v1 + 0.45), out = 0.6;
  const at = (u, v) => P([fr.O[0] + fr.U[0] * u + fr.W[0] * out, fr.O[1] + fr.U[1] * u + fr.W[1] * out, row.zb + v]);
  const a = at(us[0].cc, vb), b = at(us[us.length - 1].cc, vb);
  let g = L(a[0], a[1], b[0], b[1], { stroke: 'var(--glass)', w: 1.2, dash: '2 3' });
  for (const [k, q] of us.entries()) { const t0 = at(q.cc, vb - (k === 0 || k === us.length - 1 ? 0.35 : 0.18)), t1 = at(q.cc, vb + (k === 0 || k === us.length - 1 ? 0.35 : 0.18)); g += L(t0[0], t0[1], t1[0], t1[1], { stroke: 'var(--glass)', w: 1 }); }
  const n = us.length, pitch = n > 1 ? Math.abs(us[1].cc - us[0].cc) : sel.row.cell.pitch, m = at((us[0].cc + us[n - 1].cc) / 2, vb + 0.7);
  const opt = { size: 9.5, fill: 'var(--glass)', bg: .94 };
  g += TB(m[0] - 4, m[1], n + (n === 1 ? ' window' : ' windows'), Object.assign({ anchor: 'end', edit: 'g.arrN' }, opt));
  g += TB(m[0] + 4, m[1], '@ ' + mm(pitch), Object.assign({ anchor: 'start', edit: 'g.arrSp' }, opt));
  return g;
}
/** each side's SHGC, written over the top of its facade where the facade faces the eye, typed over in place */
function shgcLabels(F, cam, P, only) {
  const { S, B } = F;
  let g = '';
  for (const f of only ? [only] : Object.keys(FACADES)) {
    const rows = B.facades[f].rows, top = rows[rows.length - 1], fr = top.frame;
    if (!rows.some(r => r.cell)) continue;
    const q = P([fr.O[0] + fr.W[0] * 0.5, fr.O[1] + fr.W[1] * 0.5, top.zb + top.h + 1.2]);
    const v = S.shgc && S.shgc[f] !== undefined ? S.shgc[f] : (rows.find(r => r.cell).cell.glz.shgc ?? 0.36);
    g += TB(q[0], q[1], f + ' glass SHGC ' + fmt(v, 2), { anchor: 'middle', size: 8.5, fill: 'var(--sun)', bg: .9, edit: 'shgc.' + f });
  }
  return g;
}
/* The selected storey, ready to edit in place, as a massing is: a handle in
   the middle of each side toward the eye, pushed or pulled to move that side
   alone; a ring round it at its floor to turn it; its width, depth, turn and
   offset written where they read, each typed over by a click. */
function plateEdit(F, i, zb, cam, P) {
  const S = F.S, p = S.storeys[i], a = storeyRot(S, i) * D2R, C = storeyCentre(S, i), e = cam.e;
  const ex = [Math.cos(a), -Math.sin(a)], ey = [Math.sin(a), Math.cos(a)], hw = p.w / 2, hd = p.d / 2, h = p.h;
  const at = (u, v, z) => [C[0] + u * ex[0] + v * ey[0], C[1] + u * ex[1] + v * ey[1], zb + z];
  const lab = (q, txt, k, dx = 0, dy = 0) => TB(q[0] + dx, q[1] + dy, txt, { anchor: 'middle', size: 9, fill: 'var(--glass)', bg: .92, edit: k });
  let g = '';
  const foot = [at(-hw, -hd, 0), at(hw, -hd, 0), at(hw, hd, 0), at(-hw, hd, 0)], roof = foot.map(q => [q[0], q[1], q[2] + h]);
  g += POLY(foot.map(P), { fill: 'none', stroke: 'var(--glass)', w: 1.4, dash: '5 3' }) + POLY(roof.map(P), { fill: 'none', stroke: 'var(--glass)', w: 1.4, dash: '5 3' });
  const faces = [], toward = n => n[0] * e[0] + n[1] * e[1] > 0.05;
  for (const [key, n, u, v] of [['+x', ex, hw, 0], ['-x', [-ex[0], -ex[1]], -hw, 0], ['+y', ey, 0, hd], ['-y', [-ey[0], -ey[1]], 0, -hd]]) {
    if (!toward(n)) continue;
    const Q = at(u, v, h / 2), q = P(Q), q1 = P([Q[0] + n[0], Q[1] + n[1], Q[2]]);
    faces.push({ key, p: q, sv: [q1[0] - q[0], q1[1] - q[1]], n: [n[0], n[1], 0] });
  }
  for (const f of faces) g += POLY([[f.p[0] - 5, f.p[1] - 5], [f.p[0] + 5, f.p[1] - 5], [f.p[0] + 5, f.p[1] + 5], [f.p[0] - 5, f.p[1] + 5]], { fill: 'var(--panel)', stroke: 'var(--glass)', w: 1.6 });
  // the ring at the floor, its knob out past a corner, off every side's handle
  const DG = Math.SQRT1_2, pc = P(at(0, 0, 0)), pk = P(at(DG, DG, 0)), perM = Math.max(1e-6, Math.hypot(pk[0] - pc[0], pk[1] - pc[1]));
  const rr = Math.max(Math.hypot(hw, hd) + Math.max(2, 0.1 * Math.hypot(hw, hd)), 40 / perM), ring = [];
  for (let k = 0; k <= 64; k++) { const t = k / 64 * 2 * Math.PI; ring.push(P(at(rr * Math.sin(t), rr * Math.cos(t), 0))); }
  g += PATH(ring.map((q, k) => (k ? 'L' : 'M') + fmt(q[0], 1) + ',' + fmt(q[1], 1)).join(' '), { stroke: 'var(--glass)', w: .8, dash: '2 3', op: .7 });
  const kx = ex[0] * e[0] + ex[1] * e[1] >= 0 ? 1 : -1, ky = ey[0] * e[0] + ey[1] * e[1] >= 0 ? 1 : -1;
  const kq = P(at(kx * rr * DG, ky * rr * DG, 0));
  g += CIRCLE(kq[0], kq[1], 7, { fill: 'var(--panel)', stroke: 'var(--glass)', 'stroke-width': 1.6 }) + T(kq[0], kq[1] + 3.5, '↻', { anchor: 'middle', size: 9.5, fill: 'var(--glass)' });
  g += lab(kq, (Math.abs(p.rot || 0) < 0.05 ? '0' : fmt(p.rot, 1)) + '°' + ((p.rotRel || 'building') === 'below' && i > 0 ? ' on floor below' : ''), 'plnRot', 0, -13);
  // width and depth along the floor's edges toward the eye; its offset from the building's axis on the roof
  const sy = toward(ey) ? 1 : -1, sx = toward(ex) ? 1 : -1, off = Math.max(1, 0.05 * Math.max(p.w, p.d));
  g += lab(P(at(0, sy * (hd + off), 0)), mm(p.w), 'plnW', 0, 3);
  g += lab(P(at(sx * (hw + off), 0, 0)), mm(p.d), 'plnD', 0, 3);
  // the ground floor stays centred on the site: only the floors above have an offset to type
  const top = P(at(0, 0, h));
  if (i > 0) g += lab(top, 'E ' + mm(p.ox || 0), 'plnOX', -40, 4) + lab(top, 'N ' + mm(p.oy || 0), 'plnOY', 40, 4);
  // the hull of the storey on the drawing: dragged anywhere in it, it moves
  const pts = foot.concat(roof).map(P).sort((u, v) => u[0] - v[0] || u[1] - v[1]), crs = (k, u, v) => (u[0] - k[0]) * (v[1] - k[1]) - (u[1] - k[1]) * (v[0] - k[0]);
  const lo = [], hi = [];
  for (const q of pts) { while (lo.length >= 2 && crs(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let k = pts.length - 1; k >= 0; k--) { const q = pts[k]; while (hi.length >= 2 && crs(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return { g, edit: { st: i, faces, rot: { p: kq, C: C.slice() }, hull: lo.slice(0, -1).concat(hi.slice(0, -1)) } };
}
/** a context building drawn: its faces toward the eye, side by side then its top, and the outline of them all */
function contextArt(b, cam, P, o = {}) {
  const cs = boxCorners(b), e = cam.e, q = cs.map(P);
  const sides = [[0, 1, -b.ey[0], -b.ey[1]], [1, 2, b.ex[0], b.ex[1]], [2, 3, b.ey[0], b.ey[1]], [3, 0, -b.ex[0], -b.ex[1]]];
  const fill = o.ghost ? 'var(--glass)' : '#D6DBD8', op = o.ghost ? .16 : o.front ? .42 : .92;
  const stroke = o.ghost || o.sel ? 'var(--glass)' : 'var(--ink3)', w = o.sel ? 1.6 : .7, dash = o.ghost ? '5 3' : undefined;
  let g = '';
  for (const [i, j, nx, ny] of sides) {
    const lit = nx * e[0] + ny * e[1];
    if (lit <= 1e-6) continue;
    // a side square to the eye a little lighter than one seen at a slant
    g += POLY([q[i], q[j], q[j + 4], q[i + 4]], { fill: o.ghost ? fill : lit > 0.6 ? '#E1E5E3' : fill, op, stroke, w, dash });
  }
  if (e[2] > 1e-6) g += POLY([q[4], q[5], q[6], q[7]], { fill: o.ghost ? fill : '#EEF1EF', op, stroke, w, dash });
  // the outline on the drawing, for a click to pick it: the hull of its corners
  const pts = q.slice().sort((a, c) => a[0] - c[0] || a[1] - c[1]), crs = (k, a, c) => (a[0] - k[0]) * (c[1] - k[1]) - (a[1] - k[1]) * (c[0] - k[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && crs(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && crs(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return { g, hull: lo.slice(0, -1).concat(hi.slice(0, -1)) };
}
/** the sun in one facade's coordinates */
function solarAtFacade(cur, gf) {
  const sv = sunVec(cur.alt, cur.az), g = gf * D2R;
  const n = [Math.sin(g), Math.cos(g), 0], u = [-Math.cos(g), Math.sin(g), 0];
  return [v3.dot(sv, u), sv[2], v3.dot(sv, n)];
}

/** what a click on the drawing can select, front-most last: the glass of every
 *  unit drawn, and the band of every storey of every face seen */
export let axonHits = [];
/** the draggable facade-azimuth arrow, in drawing coordinates */
export let axonHandle = null;
/** the context massing as last drawn, for a click to pick: { id, pts, front } */
export let axonCtxHits = [];
/** the selected massing's handles as last drawn: { id, faces: [{ key, p, sv, n }], rot: { p, C } } */
export let axonCtxEdit = null;
/** the selected storey's handles, when it is being edited: { st, faces, rot: { p, C }, hull } */
export let axonPlateEdit = null;
/** the middle of the selected window's glass, in the world, for zooming to it */
export let axonFocus = null;

/* A group's labels hidden: its figures and names - the text, and the boxes behind it - taken out of what it drew. */
const unlabelled = s => s.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, '').replace(/<rect\b[^>]*fill="var\(--panel\)"[^>]*\/>/g, '');
const GROUP_OF = Object.fromEntries(AX_LAYERS.map(([k, , gk]) => [k, gk]));
export function drawAxon(F) {
  const { S, V, m, cur, sel } = F, AX = V.axcam;
  // a layer shows when it is on and its group is on
  const Ly = Object.fromEntries(Object.entries(V.layers).map(([k, on]) => [k, on && (V.groups || {})[GROUP_OF[k]] !== false]));
  const Lb = V.labels || {};
  // the shadow and the context massing are part of the scene, not layers to switch off
  Ly.shadow = true; Ly.context = true;
  const cam = axonCamera(S, AX);
  const { Htot, span, Rdome, Rground, P } = cam;
  const gf = m.gf, nrm = [Math.sin(gf * D2R), Math.cos(gf * D2R), 0];
  // each storey's footprint, at its floor and its ceiling, turned its own way
  const zbs = F.B.facades.S.rows.map(r => r.zb);
  const foots = S.storeys.map((s2, i) => ({ z0: zbs[i], z1: zbs[i] + s2.h, pts: plateWorld(S, i).map(p => [p[0], p[1], 0]) }));
  { const fr = sel.row.frame, o = m.opening;
    axonFocus = toWorld(fr, (o ? m.cc : 0), sel.row.zb + (o ? (o.v0 + o.v1) / 2 : sel.row.h / 2), 0, m.reveal || 0); }
  const sv = cur.up ? sunVec(cur.alt, cur.az) : null;
  let g = defsCommon, over = '';            // over = painted after the block
  // what one group draws, between two marks; its labels taken out when they are off
  const mark = () => [g.length, over.length];
  const labels = (mk, gk) => { if (Lb[gk] !== false) return; g = g.slice(0, mk[0]) + unlabelled(g.slice(mk[0])); over = over.slice(0, mk[1]) + unlabelled(over.slice(mk[1])); };
  const mSky = mark();

  if (Ly.dome) {
    const line = (pts, o) => {
      const [b, f] = depthSplit(pts, cam);
      if (b) g += PATH(b, o);
      if (f) over += PATH(f, Object.assign({}, o, { op: (o.op || 1) * 0.85 }));
    };
    line(ringPts(Rdome, 0), { stroke: 'var(--ink3)', w: .8, op: .8 });
    [30, 60].forEach(alt => line(ringPts(Rdome * Math.cos(alt * D2R), Rdome * Math.sin(alt * D2R)), { stroke: 'var(--rule)', w: .6, op: .9 }));
    for (let b = 0; b < 360; b += 45) {
      const mer = [];
      for (let a = 0; a <= 90; a += 3) mer.push(v3.mul(sunVec(a, b), Rdome));
      line(mer, { stroke: 'var(--rule)', w: .5, op: .8 });
    }
    [30, 60].forEach(alt => {
      const p = P(v3.mul(sunVec(alt, wrap360(gf + 90)), Rdome));
      g += T(p[0], p[1], alt + '°', { size: 8, fill: 'var(--ink3)', anchor: 'middle' });
    });
    const z = P([0, 0, Rdome]);
    g += CIRCLE(z[0], z[1], 1.6, { fill: 'var(--ink3)' }) + T(z[0] + 6, z[1] + 3, 'zenith', { size: 8, fill: 'var(--ink3)' });
  }

  if (Ly.wxdots) {
    const back = ['', '', ''], front = ['', '', ''];
    for (const [v, k] of wxPoints(S.wx)) {
      const p = v3.mul(v, Rdome), q = P(p), s = 'M' + fmt(q[0], 1) + ',' + fmt(q[1], 1) + 'h0';
      if (cam.front(p)) front[k] += s; else back[k] += s;
    }
    [0, 1, 2].forEach(k => {
      if (back[k]) g += El('path', { d: back[k], stroke: TEMP_BANDS[k][1], 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .3, fill: 'none' });
      if (front[k]) over += El('path', { d: front[k], stroke: TEMP_BANDS[k][1], 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: .75, fill: 'none' });
    });
  }

  if (Ly.seasons) domeArcs(Rdome).forEach(mo => {
    if (Ly.day && mo.doy === cur.doy) return;                // the day layer draws this one
    const o = mo.key ? { stroke: 'var(--poche)', w: 1.2 } : { stroke: 'var(--ink3)', w: .6, op: .55 };
    mo.runs.forEach(run => {
      const [b, f] = depthSplit(run, cam);
      if (b) g += PATH(b, Object.assign({}, o, { op: (o.op || 1) * .55 }));
      if (f) over += PATH(f, o);
    });
    mo.hours.forEach(({ h, p }) => {
      const q = P(p);
      over += CIRCLE(q[0], q[1], 1.5, { fill: 'var(--poche)', opacity: .8 });
      if (mo.doy === 172 && h % 4 === 0 && h !== 12) over += TB(q[0], q[1] - 5, h + 'h', { anchor: 'middle', size: 7.5, fill: 'var(--ink3)', bg: .75 });
    });
    if (mo.label && mo.noon) { const q = P(mo.noon); over += TB(q[0], q[1] - 6, mo.label, { anchor: 'middle', size: 8.5, fill: 'var(--ink2)', bg: .88 }); }
  });

  // the selected day's own path, picked out on the dome
  if (Ly.day) {
    const runs = dayArcPts(cur.doy, Rdome);
    runs.forEach(run => {
      const [bk, fr] = depthSplit(run, cam);
      if (bk) g += PATH(bk, { stroke: 'var(--sun)', w: 1.3, op: .5 });
      if (fr) over += PATH(fr, { stroke: 'var(--sun)', w: 2 });
    });
    const pts = runs.length ? runs[0] : [];
    if (pts.length > 4) {
      const mid = P(pts[Math.floor(pts.length / 4)]), md = F.date;
      over += TB(mid[0], mid[1] - 8, MONTHS[md.m - 1] + ' ' + md.d + ' path', { anchor: 'middle', size: 8.5, fill: 'var(--sun)', bg: .9 });
    }
  }

  labels(mSky, 'sky');
  const mGround = mark();
  if (Ly.site && F.checks) { const sx = siteGround(F, P); g += sx.g; over += sx.over; }

  if (Ly.grid) {
    const e = span * 0.9;
    for (let i = -3; i <= 3; i++) {
      g += L(...P([i * e / 3, -e, 0]), ...P([i * e / 3, e, 0]), { stroke: 'var(--rule2)', w: .5 });
      g += L(...P([-e, i * e / 3, 0]), ...P([e, i * e / 3, 0]), { stroke: 'var(--rule2)', w: .5 });
    }
  }

  if (Ly.compass) {
    const [b, f] = depthSplit(ringPts(Rdome, 0), cam);
    if (b) g += PATH(b, { stroke: 'var(--ink3)', w: .7, op: .7 });
    if (f) over += PATH(f, { stroke: 'var(--ink3)', w: .7, op: .7 });
    for (let a = 0; a < 360; a += 15) {
      const len = a % 90 === 0 ? 0.10 : a % 45 === 0 ? 0.06 : 0.035;
      g += L(...P(compassPt(a, Rdome, 0)), ...P(compassPt(a, Rdome * (1 - len), 0)), { stroke: 'var(--ink3)', w: a % 45 === 0 ? .8 : .5, op: .8 });
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([lab, a]) => {
      const q = P(compassPt(a, Rdome * 1.14, 0));
      g += TB(q[0], q[1] + 3.5, lab + ' ' + a + '°', { anchor: 'middle', size: 10, fill: a === 0 ? 'var(--ink)' : 'var(--ink2)', bg: .85 });
    });
    [['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].forEach(([lab, a]) => {
      const q = P(compassPt(a, Rdome * 1.10, 0));
      g += T(q[0], q[1] + 3, lab, { anchor: 'middle', size: 8, fill: 'var(--ink3)' });
    });
    g += POLY([P(compassPt(0, Rdome, 0)), P(compassPt(354, Rdome * 0.90, 0)), P(compassPt(6, Rdome * 0.90, 0))], { fill: 'var(--ink)' });
  }

  /* the selected facade's azimuth on the ground, always drawn: dragging it
     turns the building under the sky, as the marker under the chart does */
  {
    const o = P([0, 0, 0]), nEnd = P(compassPt(gf, Rdome * 0.97, 0)), knob = P(compassPt(gf, Rdome, 0));
    g += L(o[0], o[1], nEnd[0], nEnd[1], { stroke: 'var(--glass)', w: 1.3, marker: 'url(#ad)' });
    over += CIRCLE(knob[0], knob[1], 6, { fill: 'var(--panel)', stroke: 'var(--glass)', 'stroke-width': 1.6 })
      + CIRCLE(knob[0], knob[1], 2.4, { fill: 'var(--glass)' });
    axonHandle = { a: P(compassPt(gf, Rground * 0.45, 0)), b: knob };
    // the selected side's surface azimuth, from due south, by the arrow that turns the building: typed over in place
    const sa = wrap180(gf - 180);
    over += TB(knob[0], knob[1] - 13, 'surface azimuth ' + (Math.abs(sa) < 0.05 ? '0' : fmt(sa, 1)) + '°', { anchor: 'middle', size: 8.5, fill: 'var(--glass)', bg: .9, edit: 'surfAz' });
  }

  if (Ly.shadow && cur.up && cur.alt > 2) {
    // every storey's footprint and its ceiling carried down the sun, hulled; each context building's on its own
    const cast = (feet, z) => { const t = Math.min(z / sv[2], Rground * 2.6), pts = []; for (const p of feet) { pts.push([p[0], p[1]]); pts.push([p[0] - sv[0] * t, p[1] - sv[1] * t]); } return pts; };
    const shade = pts => {
      pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const crs = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], hi = [];
      for (const p of pts) { while (lo.length >= 2 && crs(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && crs(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      return POLY(lo.slice(0, -1).concat(hi.slice(0, -1)).map(p => P([p[0], p[1], 0])), { fill: '#7E95A3' });
    };
    // drawn solid and faded together, so where two shadows overlap they read as one shadow, not a darker one
    let sh = shade(foots.flatMap(fo => cast(fo.pts, fo.z1)));
    if (Ly.context) for (const b of F.B.context || []) sh += shade(cast(boxCorners(b).slice(0, 4), 2 * b.h[2]));
    g += '<g opacity=".34">' + sh + '</g>';
  }

  /* Context buildings, whole: one standing beyond the block, seen from here,
     is drawn before it; one standing in front, after it and see-through, so
     the block reads through it. The one being edited is outlined. */
  axonCtxHits = [];
  const ctxSel = S.site && S.site.ctxSel, ctxFront = [];
  if (Ly.context) {
    const bs = (F.B.context || []).map(b => ({ b, d: b.c[0] * cam.e[0] + b.c[1] * cam.e[1] })).sort((a, b) => a.d - b.d);
    for (const { b, d } of bs) {
      const front = d > 0, art = contextArt(b, cam, P, { front, sel: b.id === ctxSel });
      axonCtxHits.push({ id: b.id, pts: art.hull, front });
      if (front) ctxFront.push(art.g); else g += art.g;
    }
  }

  labels(mGround, 'ground');

  /* ---- the block ----
     Storey by storey from the ground up: each storey's walls, then its units,
     then its roof. Seen from above, a storey hides only what is below and
     behind it, so this order is right for any stack of floorplates - a
     bigger storey's walls come down over the one it overhangs, a setback
     storey stands on the roof of the one below. */
  const seen = {}, hits = [];
  const sc = sceneOf(F, cur);
  const visOf = (f, st) => { const W0 = F.B.facades[f].rows[st].frame.W; return cam.vis([W0[0], W0[1]]); };
  const seenSel = visOf(sel.f, sel.st);
  const style = q => {
    switch (q.kind) {
      case 'glass': return { fills: [['var(--shadefill)', 1]] };
      case 'lit': return { fills: [['var(--sun)', .88]] };
      case 'shadow': return { fills: [['var(--shadefill)', 1]] };
      case 'opening': return { fills: [], stroke: 'var(--glass)', w: .7 };
      case 'wall': return { fills: [[FACADE_FILL, 1]] };
      case 'spandrel': return { fills: [['var(--shade)', .7]] };
      case 'return': return { fills: [['var(--shade)', .55]], stroke: 'var(--ink3)', w: .35 };
      default: return q.n[1] > 0.55
        ? { fills: [['var(--shade)', .95]], stroke: 'var(--ink)', w: .35 }
        : { fills: [['var(--poche)', .88]], stroke: 'var(--ink)', w: .35 };
    }
  };
  const frameOf = u => F.B.facades[u.f].rows[u.st].frame;
  const depth = u => { const fr = frameOf(u); return v3.dot([fr.O[0] + fr.U[0] * u.cc, fr.O[1] + fr.U[1] * u.cc, u.zb], cam.e); };
  const proj = u => { const fr = frameOf(u); return ([a, v, w]) => P([fr.O[0] + fr.U[0] * (u.cc + a) + fr.W[0] * (w - u.rev),
    fr.O[1] + fr.U[1] * (u.cc + a) + fr.W[1] * (w - u.rev), u.zb + v]); };
  // the eye in each side's own axes - a storey turned its own way sees it from its own angle
  const eLocs = {};
  const eLoc = (f, st) => eLocs[f + st] || (eLocs[f + st] = (fr => [v3.dot(fr.U, cam.e), cam.e[2], v3.dot(fr.W, cam.e)])(F.B.facades[f].rows[st].frame));
  const eKey = (f, st) => { const e = eLoc(f, st); return e.map(x => x.toFixed(6)).join(','); };
  const orders = new Map();
  const order = (t, f, st, flat) => { let mp = orders.get(t); if (!mp) orders.set(t, mp = {}); const k = eKey(f, st); return mp[k] || (mp[k] = walk(t, eLoc(f, st), flat)); };
  const byStorey = S.storeys.map(() => []);
  for (const u of sc.units) if (visOf(u.f, u.st)) byStorey[u.st].push(u);
  for (let st = 0; st < S.storeys.length; st++) {
    const fo = foots[st];
    for (const key of Object.keys(FACADES)) {
      if (!visOf(key, st)) continue;
      const r = F.B.facades[key].rows[st], fr = r.frame, A = fr.A, B = fr.B;
      const band = [P([A[0], A[1], r.zb]), P([B[0], B[1], r.zb]), P([B[0], B[1], r.zb + r.h]), P([A[0], A[1], r.zb + r.h])];
      g += POLY(band, { fill: '#E6EAE8', stroke: 'none' });
      g += L(...band[0], ...band[3], { stroke: 'var(--ink)', w: .8 }) + L(...band[1], ...band[2], { stroke: 'var(--ink)', w: .8 });
      // the floor line: a storey line where the storey below has the same face, an edge where it steps
      const below = st ? F.B.facades[key].rows[st - 1] : null;
      const same = below && Math.hypot(below.frame.A[0] - A[0], below.frame.A[1] - A[1]) < 1e-6 && Math.hypot(below.frame.B[0] - B[0], below.frame.B[1] - B[1]) < 1e-6;
      g += L(...band[0], ...band[1], same ? { stroke: 'var(--rule)', w: .5 } : { stroke: 'var(--ink)', w: .8 });
      // every storey band of the face can be clicked to select it
      hits.push({ f: key, st, unit: null, d: -1e9 + st, pts: band });
    }
    const drawn = byStorey[st].sort((a, b) => depth(a) - depth(b));
    // glass over the by-law's SHGC is drawn red, as a device the by-law does not allow is
    for (const u of drawn) g += paintFaces(order(u.back(), u.f, u.st, GLASS_GROUP), proj(u), eLoc(u.f, u.st),
      F.checks && F.checks.glassBad(u.f, u.st, u.i) ? q => RED_GLASS[q.kind] || style(q) : style);
    // a device the by-law does not allow where it stands is drawn red
    for (const u of drawn) {
      const bad = Ly.site && F.checks && F.checks.badOf(u.f, u.st, u.i);
      g += paintFaces(order(u.front, u.f, u.st, []), proj(u), eLoc(u.f, u.st), bad && bad.size ? q => (q.kind === 'dev' && bad.has(q.sys) ? RED_DEV : style(q)) : style);
    }
    // the glass of every unit drawn can be clicked, and the selected one is outlined
    for (const u of drawn) {
      const o = u.cell.opening, pr = proj(u), pts = [[o.u0, o.v0, 0], [o.u1, o.v0, 0], [o.u1, o.v1, 0], [o.u0, o.v1, 0]].map(pr);
      hits.push({ f: u.f, st: u.st, unit: u.i, d: depth(u), pts });
      if (u.f === sel.f && u.st === sel.st && u.i === sel.unit) g += POLY(pts, { fill: 'var(--glass)', op: .42, stroke: 'var(--glass)', w: 3 }) + POLY(pts, { fill: 'none', stroke: 'var(--panel)', w: 1.2, dash: '3 2.5' });
      else if (u.broken) g += POLY(pts, { fill: 'none', stroke: 'var(--sun)', w: 1.2, dash: '3 2' });
    }
    // the roof of this storey: what the next one does not cover shows
    g += POLY(fo.pts.map(p => P([p[0], p[1], fo.z1])), { fill: '#F6F8F7', stroke: 'var(--ink)', w: st === S.storeys.length - 1 ? 1 : .7 });
  }
  if (seenSel) {
    const fr = sel.row.frame, r = sel.row;
    g += POLY([P([fr.A[0], fr.A[1], r.zb]), P([fr.B[0], fr.B[1], r.zb]), P([fr.B[0], fr.B[1], r.zb + r.h]), P([fr.A[0], fr.A[1], r.zb + r.h])],
      { fill: 'none', stroke: 'var(--glass)', w: 1.4, dash: '5 3' });
  }
  axonHits = hits.sort((a, b) => a.d - b.d);
  g += ctxFront.join('');
  // a context building being placed: its ghost where the pointer is on the ground, square to the axes it will be read in
  if (V.place && V.place.on && V.place.P) {
    const dr = Object.assign(CTX_DRAFT0(), S.site && S.site.draft), a = contextAxes(S).a * D2R;
    const gb = { c: [V.place.P[0], V.place.P[1], dr.h / 2], ex: [Math.cos(a), -Math.sin(a)], ey: [Math.sin(a), Math.cos(a)], h: [dr.w / 2, dr.d / 2, dr.h / 2] };
    const art = contextArt(gb, cam, P, { ghost: true });
    const top = P([gb.c[0], gb.c[1], dr.h]);
    over += art.g + TB(top[0], top[1] - 8, 'click to place · ' + fmt(dr.w * 1000, 0) + ' × ' + fmt(dr.d * 1000, 0) + ' × ' + fmt(dr.h * 1000, 0) + ' mm', { anchor: 'middle', size: 9, fill: 'var(--glass)', bg: .9 });
  }
  { const fr = sel.row.frame, mid = P([fr.O[0], fr.O[1], cam.Htot + span * 0.06]);
    g += TB(mid[0], mid[1], seenSel ? sel.f + ' · storey ' + (sel.st + 1) : sel.f + ' side, behind', { anchor: 'middle', size: 10, fill: 'var(--glass)' }); }
  g += over;

  /* Where the angles are drawn (V.angAt): on the ground at the foot of the
     selected facade, at the floor of the selected window's storey, or with
     their pivot at the middle of the selected window's glass. */
  const angAt = V.angAt || 'ground';
  const O0 = angAt === 'window' ? axonFocus.slice() : [sel.row.frame.O[0], sel.row.frame.O[1], angAt === 'level' ? sel.row.zb : 0];
  /* the sun-angle triangle, in the vertical plane square to the facade: the
     angle sits at its pivot and opens toward the sun.
     It is the vertical shadow angle, equal to the altitude only when gamma = 0. */
  const mTri = mark();
  if (Ly.triangle) {
    const O = O0;
    if (cur.onFacade && cur.vsa > 0.6) {
      // a protractor, not a shadow: the hypotenuse keeps one length and only
      // the angle moves, so a steep sun does not shrink the figure away
      const Rt = span * 0.34, th = cur.vsa * D2R, d = Rt * Math.cos(th), hUse = Rt * Math.sin(th);
      const M = v3.add(O, v3.mul(nrm, d)), Q = [M[0], M[1], O[2] + hUse];
      const pO = P(O), pM = P(M), pQ = P(Q);
      g += POLY([pO, pM, pQ], { fill: 'var(--sun)', op: .12, stroke: 'var(--sun)', w: 1.2 });
      const ray = v3.unit(v3.sub(Q, O));
      const pX = P(v3.add(O, v3.mul(ray, Rt * 1.35)));
      g += L(pQ[0], pQ[1], pX[0], pX[1], { stroke: 'var(--sun)', w: 1, dash: '4 3', op: .85 });
      const sq = Math.min(d, hUse, Rt * 0.12) * 0.5;
      g += PATH([v3.sub(M, v3.mul(nrm, sq)), v3.add(v3.sub(M, v3.mul(nrm, sq)), [0, 0, sq]), [M[0], M[1], O[2] + sq]]
        .map((p, i) => (i ? 'L' : 'M') + P(p).map(v => fmt(v, 2)).join(',')).join(' '), { stroke: 'var(--sun)', w: .7 });
      const w0 = v3.unit(v3.sub(ray, v3.mul(nrm, v3.dot(nrm, ray))));
      const rad = Rt * 0.3, arcp = [];
      for (let i = 0; i <= 20; i++) {
        const a = cur.vsa * D2R * i / 20;
        arcp.push(v3.add(O, v3.mul(v3.add(v3.mul(nrm, Math.cos(a)), v3.mul(w0, Math.sin(a))), rad)));
      }
      g += PATH(arcp.map((p, i) => (i ? 'L' : 'M') + P(p).map(v => fmt(v, 2)).join(',')).join(' '), { stroke: 'var(--sun)', w: 1 });
      const lq = P(v3.add(O, v3.mul(v3.unit(v3.add(nrm, ray)), rad * 1.7)));
      g += TB(lq[0], lq[1] + 3, 'θ ' + fmt(cur.vsa, 1) + '°', { anchor: 'middle', size: 10, fill: 'var(--sun)', bg: .92, edit: 'theta' });
    } else {
      const pO = P(O), pT = P([O[0], O[1], Math.max(Htot, O[2] + span * 0.3)]);
      g += L(pO[0], pO[1], pT[0], pT[1], { stroke: 'var(--ink3)', w: .8, dash: '3 3' });
      g += TB(pT[0], pT[1] - 8, cur.up ? 'no profile angle: the sun is behind the facade' : 'no profile angle: the sun is down',
        { anchor: 'middle', size: 8.5, fill: 'var(--ink3)', bg: .9 });
    }
  }

  labels(mTri, 'angles');
  const mRay = mark();
  /* the sun on the dome at exactly the radius the arcs are drawn at, and the ray
     it sends through the origin - parallel to the sun vector by construction */
  if (Ly.ray && cur.up) {
    const Psun = v3.mul(sv, Rdome), pS = P(Psun), pO0 = P([0, 0, 0]);
    const enter = blockEntry(Psun, v3.mul(sv, -1), S), pE = P(enter || [0, 0, 0]);
    g += L(pS[0], pS[1], pE[0], pE[1], { stroke: 'var(--sun)', w: 1.5, marker: 'url(#ar)' });
    if (enter) g += L(pE[0], pE[1], pO0[0], pO0[1], { stroke: 'var(--sun)', w: .8, dash: '2 3', op: .45 });
    g += CIRCLE(pO0[0], pO0[1], 2.2, { fill: 'none', stroke: 'var(--sun)', 'stroke-width': .9 });
    g += CIRCLE(pS[0], pS[1], 11, { fill: 'var(--sun)', opacity: .18 });
    g += CIRCLE(pS[0], pS[1], 7, { fill: 'var(--sun)', stroke: 'var(--panel)', 'stroke-width': 1.2 });
    g += TB(clamp(pS[0], 62, W - 62), clamp(pS[1] - 14, 70, H - 40), fmt(cur.alt, 1) + '° alt / ' + fmt(cur.az, 0) + '° az',
      { anchor: 'middle', size: 9, fill: 'var(--sun)', bg: .9 });
  }

  labels(mRay, 'sky');
  const mAng = mark();
  /* the composition of angles, at the foot of the selected facade
     where the profile angle is drawn too: the sun ray's horizontal projection,
     the solar altitude beta above it, the solar azimuth measured from due
     south, and gamma between the facade's normal and the sun's projection
     (surface azimuth - solar azimuth). */
  if ((Ly.angles && cur.up) || Ly.azimuth) {
    const O = O0, brg = wrap180(cur.az - 180), dev = wrap180(gf - 180);
    const at = (d, r, z = 0) => v3.add(O, [d[0] * r, d[1] * r, z]);
    const dirOf = b => [Math.sin(b * D2R), Math.cos(b * D2R)];
    const pth = pts => pts.map((p, i) => (i ? 'L' : 'M') + P(p).map(v => fmt(v, 2)).join(',')).join(' ');
    const arcG = (b0, b1, r) => { const pts = []; for (let i = 0; i <= 48; i++) pts.push(at(dirOf(b0 + (b1 - b0) * i / 48), r)); return pts; };
    const lab = (b, r, txt, col, size = 9, edit) => { const q = P(at(dirOf(b), r)); g += TB(q[0], q[1] + 3, txt, { anchor: 'middle', size, fill: col, bg: .92, edit }); };
    // due south, the line every azimuth is read from
    g += PATH(pth([O, at([0, -1], span * 0.62)]), { stroke: 'var(--ink3)', w: .8, dash: '2 3' });
    const sq = P(at([0, -1], span * 0.66));
    g += T(sq[0], sq[1] + 3, 'S', { anchor: 'middle', size: 9, fill: 'var(--ink3)' });
    if (Ly.azimuth) {
      // the surface azimuth: due south round to the facade normal
      g += PATH(pth([O, at(dirOf(gf), span * 0.5)]), { stroke: 'var(--glass)', w: 1.2 });
      if (Math.abs(dev) > 0.5) g += PATH(pth(arcG(180, 180 + dev, span * 0.42)), { stroke: 'var(--glass)', w: 1.2, marker: 'url(#ad)' });
    }
    if (Ly.angles && cur.up) {
      const gdir = v3.unit([sv[0], sv[1], 0]);
      // the sun's projection on the ground, out from the facade
      g += PATH(pth([O, at(gdir, span * 0.62)]), { stroke: 'var(--sun)', w: 1, dash: '6 3', op: .85 });
      // the solar azimuth: due south round to the sun
      g += PATH(pth(arcG(180, 180 + brg, span * 0.56)), { stroke: 'var(--sun)', w: 1, marker: 'url(#ar)' });
      lab(180 + brg / 2, span * 0.62, 'solar azimuth ' + fmt(brg, 0) + '°', 'var(--sun)', 8.5, 'sunAz');
      // beta, in the vertical plane of the ray: its upper arm runs from the pivot toward the sun,
      // parallel to the sun's own ray, which reaches the ground elsewhere
      g += PATH(pth([O, v3.add(O, v3.mul(sv, span * 0.62))]), { stroke: 'var(--sun)', w: 1.1 });
      const rb = span * 0.30, ab = [];
      for (let i = 0; i <= 24; i++) { const t = cur.alt * D2R * i / 24; ab.push(at(gdir, rb * Math.cos(t), rb * Math.sin(t))); }
      g += PATH(pth(ab), { stroke: 'var(--sun)', w: 1.6 });
      const mb = P(at(gdir, rb * 1.2 * Math.cos(cur.alt * D2R / 2), rb * 1.2 * Math.sin(cur.alt * D2R / 2)));
      g += TB(mb[0], mb[1] + 3, 'β ' + fmt(cur.alt, 1) + '°', { anchor: 'middle', size: 9.5, fill: 'var(--sun)', bg: .92, edit: 'sunAlt' });
      // gamma: the facade normal round to the sun, surface azimuth - solar azimuth
      if (cur.onFacade) {
        const gam = wrap180(gf - cur.az);
        g += PATH(pth(arcG(gf, gf - gam, span * 0.2)), { stroke: 'var(--ink)', w: 1.6 });
        lab(gf - gam / 2, span * 0.26, 'γ ' + fmt(gam, 1) + '°', 'var(--ink)', 9.5, 'gamma');
      }
    }
  }

  labels(mAng, 'angles');
  if (!Ly.compass) {                      // a north arrow only when the compass is off
    const o = P([0, 0, 0]), n1 = P([0, 1, 0]);
    let dx = n1[0] - o[0], dy = n1[1] - o[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const ax = W - 56, ay = H - 62, rr = 26;
    g += L(ax - dx * rr, ay - dy * rr, ax + dx * rr, ay + dy * rr, { stroke: 'var(--ink)', w: 1.3, marker: 'url(#ar)' });
    g += CIRCLE(ax - dx * rr, ay - dy * rr, 2.2, { fill: 'var(--ink)' });
    g += TB(ax + dx * (rr + 11), ay + dy * (rr + 11) + 4, 'N', { size: 12, fill: 'var(--ink)', mono: false, anchor: 'middle' });
  }

  // the selected storey, ready to edit in place
  axonPlateEdit = null;
  if (V.plate && V.plate.on) {
    const pe = plateEdit(F, sel.st, zbs[sel.st], cam, P);
    g += pe.g; axonPlateEdit = pe.edit;
    g += T(12, 56, sel.st === 0 ? 'ground floor selected: it stays centred on the site · pull a face · turn it by its ring · click a figure to type it'
      : 'storey ' + (sel.st + 1) + ' selected: drag it to move · pull a face · turn it by its ring · click a figure to type it' + (S.matchAbove.plate ? ' · the floors above follow' : ''), { size: 8.5, fill: 'var(--glass)' });
  }
  // the selected side's window array, bracketed as a drawing program brackets an array: its number and its spacing typed over
  if (V.plate && V.plate.on && sel.row.cell && sel.row.units.length) g += windowBracket(F, cam, P);
  // the selected side's SHGC, above its facade, typed over - while a window or a wall of that side is selected
  if (V.plate && V.plate.on) g += shgcLabels(F, cam, P, sel.f);
  // the selected massing, ready to edit in place, over everything
  axonCtxEdit = null;
  const cSel = Ly.context && ctxSel && (S.site.ctx || []).find(c => c.id === ctxSel), bSel = cSel && (F.B.context || []).find(b => b.id === ctxSel);
  if (bSel) {
    const ed = contextEdit(F, bSel, cSel, cam, P);
    g += ed.g; axonCtxEdit = ed.edit;
    // its other instances, outlined where they stand
    const mates = cSel.grp ? (S.site.ctx || []).filter(c => c.grp === cSel.grp && c.id !== cSel.id).map(c => c.id) : [];
    for (const b of (F.B.context || []).filter(b => mates.includes(b.id))) {
      const cs = boxCorners(b);
      g += POLY(cs.slice(0, 4).map(P), { fill: 'none', stroke: 'var(--glass)', w: 1, dash: '2 3' }) + POLY(cs.slice(4).map(P), { fill: 'none', stroke: 'var(--glass)', w: 1, dash: '2 3' });
    }
    const who = mates.length ? 'instance, one of ' + (mates.length + 1) + (cSel.inheritRot ? ', passing its turns on' : '') + ' · ' : 'massing selected: ';
    g += T(12, 56, who + 'drag it to move (Alt: a copy or instance) · pull a face · turn it by its ring · click a figure to type it · right-click for instances · Delete removes it', { size: 8.5, fill: 'var(--glass)' });
  }
  return svg(g, 'Interactive 3D view of the block with the sun path dome, compass and solar angle constructions');
}
