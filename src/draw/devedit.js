/* The picked shading device, edited on a plan or a section.

   Each drawing sees one of the facade's axes - the section the height (V),
   the plan the width (U) - and the depth out from the wall (w). On the axis
   a device's array runs along - a blade's down the facade, a fin's across
   it - the drawing shows its profile and its array: the member at the
   justified end carries a turning arc about its hinge, its angle dimensioned
   by an arc, and the array's free end is dragged. On the other axis it shows
   the member's own length, whose free end is dragged instead. Either way its
   gap to the wall is dimensioned, it moves by its gumball one axis at a time,
   and its behaviours - alignment, justification, setting out, hinge - are in
   a small window off the gumball's centre.

   v = { P: ([a, w]) => [x, y] the drawing's sheet point, ax: 'U' | 'V', drop:
   the box axis the drawing projects away }. Grips are pushed onto `grips`;
   the drawing's own marks come back as svg, with where the window hangs.   */

import { fmt, D2R } from '../util.js';
import { projectBox } from '../geometry/boxes.js';
import { arrayAnchor, memberSpan } from '../geometry/arrays.js';
import { HINGE_F, memberLen, arrayOn } from '../geometry/device.js';
import { L, POLY, PATH, TB, CIRCLE, dim, arc, arrayBracket, gumball } from './svg.js';
import { arrayFigures } from '../state.js';

const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const COL = 'var(--glass)';

/** an arc about (cx, cy) through sheet angles a0..a1 (y down), with an arrowhead at each end - quiet, until it is wanted */
function turnArc(cx, cy, r, a0, a1) {
  const at = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)], n = 10;
  let d = '';
  for (let i = 0; i <= n; i++) { const p = at(a0 + (a1 - a0) * i / n); d += (i ? 'L' : 'M') + fmt(p[0], 2) + ',' + fmt(p[1], 2); }
  let s = PATH(d, { stroke: COL, w: 1.2, fill: 'none' });
  for (const [a, sg] of [[a0, -1], [a1, 1]]) {
    const p = at(a), t = [-Math.sin(a) * sg * Math.sign(a1 - a0), Math.cos(a) * sg * Math.sign(a1 - a0)], q = [Math.cos(a), Math.sin(a)];
    s += POLY([[p[0] + t[0] * 5, p[1] + t[1] * 5], [p[0] + q[0] * 3, p[1] + q[1] * 3], [p[0] - q[0] * 3, p[1] - q[1] * 3]], { fill: COL, stroke: COL, w: .4 });
  }
  return `<g opacity=".7">${s}</g>`;
}

/* Each device's gap to the wall and what it projects, on one string of
   dimensions from the wall face, just beyond the devices - one string per
   device, stacked, nearest the wall first. The picked one's figures are
   typed over: the gap, and the projection (the depth, while it lies flat). */
export function depthStrings(v, devs, m, selD) {
  const { P, drop } = v, at0 = P([0, 0]), dA = [P([1, 0])[0] - at0[0], P([1, 0])[1] - at0[1]], pxA = Math.hypot(dA[0], dA[1]) || 1;
  const rows = devs.map(({ D, boxes }) => {
    const pts = boxes.flatMap(b => projectBox(b, drop));
    return { D, a1: Math.max(...pts.map(p => p[0])), w0: Math.min(...pts.map(p => p[1])), w1: Math.max(...pts.map(p => p[1])) };
  }).sort((p, q) => p.w1 - q.w1);
  const aTop = Math.max(...rows.map(r => r.a1));
  let s = '';
  rows.forEach((r, i) => {
    const a = aTop + (16 + 17 * i) / pxA, mine = r.D === selD, out = r.D.arr && r.D.arr.along === 'out', tilt = Math.abs(r.D.angle) > 0.5;
    const ext = w => { const p = P([r.a1, w]), q = P([a, w]); return L(p[0], p[1], q[0], q[1], { stroke: 'var(--ink3)', w: .45, dash: '1.5 2', op: .8 }); };
    const pW = P([a, m.reveal]), p0 = P([a, r.w0]), p1 = P([a, r.w1]);
    s += ext(r.w0) + ext(r.w1);
    if (r.w0 - m.reveal > 0.004) s += dim(pW[0], pW[1], p0[0], p0[1], fmt((r.w0 - m.reveal) * 1000, 0), 0, 1, mine ? 'd.clear' : undefined);
    s += dim(p0[0], p0[1], p1[0], p1[1], fmt((r.w1 - r.w0) * 1000, 0), 0, 1, mine && !out ? (tilt ? 'd.proj' : 'd.depth') : undefined);
  });
  return s;
}

/* The members of each array along the facade that this drawing sees on its
   axis, each with what a drag needs: its place in the array from the end the
   array starts at, the first and last members, the array's length and how it
   is set out, and the sheet's run per metre along the axis. Dragged, a member
   sets the array's spacing - or its number - within the length it has. */
export function arrayMembers(m, ax, dA, dW) {
  const out = new Map(), groups = new Map();
  for (const b of m.own || []) {
    const D = b.D;
    // an array along the facade on the axis this drawing sees; one stepping out from the wall in either drawing
    if (!D || !D.arr || (D.arr.along !== 'out' && (D.dir === 'h' ? 'V' : 'U') !== ax)) continue;
    if (!groups.has(D)) groups.set(D, []);
    groups.get(D).push(b);
  }
  for (const [D, bs] of groups) {
    const outw = D.arr.along === 'out', sd = outw ? 1 : ax === 'U' ? 1 : -1, pos = b => +(outw ? b.at : b.anchor).toFixed(6);
    const an = [...new Set(bs.map(pos))].sort((p, q) => (p - q) * sd), A = arrayOn(D, m.opening);
    if (an.length < 2 || !A) continue;
    for (const b of bs) out.set(b, { idx: an.indexOf(pos(b)), a0: pos(b), first: an[0], last: an[an.length - 1], n: an.length, sd, dA: outw ? dW : dA, L: A.len, mode: A.mode });
  }
  return out;
}

export function deviceEdit(v, D, mine, m, grips) {
  const { P, ax, drop } = v, ai = ax === 'U' ? 0 : 1;
  const at0 = P([0, 0]), dA = [P([1, 0])[0] - at0[0], P([1, 0])[1] - at0[1]], dW = [P([0, 1])[0] - at0[0], P([0, 1])[1] - at0[1]];
  const sc = (d, t) => [d[0] * t, d[1] * t];
  const pts = mine.flatMap(b => projectBox(b, drop));
  const a0 = Math.min(...pts.map(p => p[0])), a1 = Math.max(...pts.map(p => p[0]));
  const w0 = Math.min(...pts.map(p => p[1])), w1 = Math.max(...pts.map(p => p[1]));
  // the gumball stands in the middle of the whole device
  const O = P([(a0 + a1) / 2, (w0 + w1) / 2]);
  const arrayView = ax === (D.dir === 'h' ? 'V' : 'U');
  const AE = arrayOn(D, m.opening), A = AE && AE.len > 1e-9 ? AE : null, out = !!(A && A.along === 'out');
  const span = ax === 'U' ? [m.opening.u0, m.opening.u1] : [m.opening.v0, m.opening.v1], sd = ax === 'U' ? 1 : -1;
  const offA = D.offOn ? D['off' + ax] || 0 : 0, just = D['just' + ax];
  const word = D.dir === 'h' ? 'member' : 'fin';
  let s = '';

  // across the profile, the gap to the wall, from the wall face to the member's nearest point, typed over
  if (!arrayView) {
    const near = pts.reduce((p, q) => q[1] < p[1] ? q : p), gap = near[1] - m.reveal;
    const f = P([near[0], m.reveal]), t = P(near);
    if (gap > 0.004) s += dim(f[0], f[1], t[0], t[1], fmt(gap * 1000, 0), 16, 1, 'd.clear');
    else s += TB(f[0] - dW[0] * 0.08 + 10, f[1] - dW[1] * 0.08 - 6, '0 to wall', { size: 8, fill: COL, edit: 'd.clear' });
  }

  if (arrayView) {
    // the member at the end its justification holds carries the turning arc; the array's others turn with it
    const order = out ? mine.slice().sort((p, q) => p.at - q.at)
      : mine.slice().sort((p, q) => (p.anchor - q.anchor) * sd);
    const bR = out ? order[0] : just === 'end' ? order[order.length - 1] : just === 'centre' ? order[order.length >> 1] : order[0];
    const bp = projectBox(bR, drop);
    const e = D.dir === 'h' ? bR.e2 : bR.e1, f = HINGE_F[D.hinge] ?? 0, kk = (0.5 - f) * D.depth;
    const hinge = [bR.c[ai] - kk * e[ai], bR.c[2] - kk * e[2]], tip = [hinge[0] + (1 - f) * D.depth * e[ai], hinge[1] + (1 - f) * D.depth * e[2]];
    const scr = ang => { const ea = D.dir === 'h' ? -Math.sin(ang) : Math.sin(ang), ew = Math.cos(ang); return [dA[0] * ea + dW[0] * ew, dA[1] * ea + dW[1] * ew]; };
    const r0 = D.angle * D2R, s0 = scr(r0), s1 = scr(r0 + 0.01), sZ = scr(0);
    // which way the member's angle runs as it turns on the sheet
    const sgn = Math.sign(wrapPi(Math.atan2(s1[1], s1[0]) - Math.atan2(s0[1], s0[0]))) || 1;
    const H = P(hinge), Tq = P(tip), phi = Math.atan2(s0[1], s0[0]), phi0 = Math.atan2(sZ[1], sZ[0]);
    // its depth pulled at its tip, along the member as it is turned
    grips.push({ p: Tq, key: 'd.depth', from: D.depth, dir: s0 });
    // the depth along the member, and - turned - what it projects out from the wall, each typed over
    const wallEdge = P([hinge[0] - f * D.depth * e[ai], hinge[1] - f * D.depth * e[2]]);
    // turned, its own depth along it as well as what it projects, on the string
    if (Math.abs(D.angle) > 0.5) s += dim(wallEdge[0], wallEdge[1], Tq[0], Tq[1], fmt(D.depth * 1000, 0), 15, -1, 'd.depth');
    const reach = Math.hypot(Tq[0] - H[0], Tq[1] - H[1]), R = Math.max(reach, 14) + 16;
    // the turning arc, beyond the tip, about the hinge - marked where it is
    s += CIRCLE(H[0], H[1], 3, { fill: 'var(--panel)', stroke: COL, 'stroke-width': 1.2 });
    const half = Math.min(0.32, 12 / R);
    s += turnArc(H[0], H[1], R, phi - half, phi + half);
    for (const da of [0, -0.8 * half, 0.8 * half]) grips.push({ p: [H[0] + R * Math.cos(phi + da), H[1] + R * Math.sin(phi + da)], rot: true, pivot: H, key: 'd.angle', from: D.angle, sgn });
    // the angle, dimensioned by an arc from the member laid flat, and typed over
    const r = Math.max(20, Math.min(reach * 0.7, 56)), d0 = phi0, d1 = phi0 + wrapPi(phi - phi0), mid = (d0 + d1) / 2;
    s += L(H[0], H[1], H[0] + (r + 10) * Math.cos(phi0), H[1] + (r + 10) * Math.sin(phi0), { stroke: 'var(--ink3)', w: .6, dash: '3 2' });
    if (Math.abs(D.angle) > 0.5) s += arc(H[0], H[1], r, -d0, -d1, 'var(--ink3)');
    // the angle's figure on the arc, to the member's one side; its thickness to the other
    const su = [Math.cos(phi), Math.sin(phi)], side = su[0] >= 0 ? 1 : -1, nrm = [-su[1] * side, su[0] * side], lr = r + 10;
    const lift = Math.abs(D.angle) > 12 ? 0 : 12;
    s += TB(H[0] + lr * Math.cos(mid) - nrm[0] * lift, H[1] + lr * Math.sin(mid) - nrm[1] * lift + 3, fmt(D.angle, 0) + '°', { size: 8.5, fill: COL, anchor: 'middle', edit: 'd.angle' });
    const C = P([bR.c[ai], bR.c[2]]);
    s += TB(C[0] + nrm[0] * 13, C[1] + nrm[1] * 13 + 3, fmt(D.thick * 1000, 0) + ' thk', { size: 8, fill: COL, anchor: 'middle', edit: 'd.thick' });
  } else {
    // the member's own length, its free end across from the end its justification holds
    const b0 = mine[mine.length >> 1], bp = projectBox(b0, drop);
    const tm = [(Math.min(...bp.map(p => p[0])) + Math.max(...bp.map(p => p[0]))) / 2, Math.max(...bp.map(p => p[1]))];
    grips.push({ p: P(tm), key: 'd.depth', from: D.depth, dir: dW });
    const full = memberLen(D, span), [c, hh] = memberSpan(full, span, sd, just), cc = c + offA;
    const st = cc - sd * hh, fa = cc + sd * hh, atStart = just === 'end', g = atStart ? -sd : sd, wm = (w0 + w1) / 2;
    grips.push({ p: P([atStart ? st : fa, wm]), key: 'd.full', from: full, dir: sc(dA, g), mul: just === 'centre' ? 2 : 1 });
    const p0 = P([st, w1 + 0.16]), p1 = P([fa, w1 + 0.16]);
    s += dim(p0[0], p0[1], p1[0], p1[1], fmt(full * 1000, 0), 0, 1, 'd.full');
  }

  // the array: bracketed, its number and spacing typed on the bracket, its free end dragged
  if (A && (out || arrayView)) {
    const L0 = A.len, sp = arrayFigures(D, m.opening).sp;
    if (out) {
      const aT = a1 + 0.24, ats = [...new Set(mine.map(b => +b.at.toFixed(6)))].sort((p, q) => p - q);
      const bpts = ats.map(t => P([aT, t])), hz = Math.abs(dW[0]) > Math.abs(dW[1]);
      bpts.sort((p, q) => hz ? p[0] - q[0] : p[1] - q[1]);
      s += arrayBracket(bpts, hz, ats.length, sp, word);
      grips.push({ p: P([aT, ats[0] + L0]), key: 'a.len', from: L0, dir: dW });
    } else {
      const wT = w1 + 0.25, ans = [...new Set(mine.map(b => +b.anchor.toFixed(6)))];
      const bpts = ans.map(t => P([t, wT])), hz = Math.abs(dA[0]) > Math.abs(dA[1]);
      bpts.sort((p, q) => hz ? p[0] - q[0] : p[1] - q[1]);
      s += arrayBracket(bpts, hz, ans.length, sp, word);
      const s0 = arrayAnchor(span, sd, L0, just) + offA, atStart = just === 'end', g = atStart ? -sd : sd;
      grips.push({ p: P([atStart ? s0 : s0 + sd * L0, wT]), key: 'a.len', from: L0, dir: sc(dA, g), mul: just === 'centre' ? 2 : 1 });
    }
  }

  // the gumball: red to the right, green up, each moving the device along that axis only
  const aHz = Math.abs(dA[0]) > Math.abs(dA[1]);
  const offAx = { key: 'd.off' + ax, from: offA, dir: dA }, offW = { key: 'd.offset', from: D.offset, dir: dW };
  s += gumball(grips, O[0], O[1], aHz ? [offAx, offW] : [offW, offAx]);
  return { svg: s, pop: { x: O[0], y: O[1], ax, arrayView, kind: 'device' } };
}
