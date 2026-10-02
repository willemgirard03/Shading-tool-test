/* The section: a cut through the selected unit at u = cutU, looking along the
   facade, exterior to the LEFT, carried right across the storey to the facade
   opposite - its wall and glass as the plane meets them - so the beam can be
   followed to where it lands. The camera frames the window, the sun's reach
   or the whole floor, and zooms about the window. The wall and every element are sectioned by
   the same code, so a cut through a pier shows a pier and a cut through a
   tilted blade shows its true profile. Elements the plane passes through are
   cut solid; elements beyond it are dotted in, which is what makes a finite
   array readable. Devices of the storeys above and below are drawn where they
   reach into the sheet, since their shadows are part of this one.            */

import { D2R, fmt, clipSeg, clamp } from '../util.js';
import { sliceBox, projectBox, boxHi, boxLo, aaBox } from '../geometry/boxes.js';
import { wallPieces, GLASS_T } from '../geometry/cell.js';
import { scanLine } from '../geometry/analysis.js';
import { W, H, T, L, POLY, RECT, TB, CIRCLE, dim, arc, defsCommon, svg, sunKnob } from './svg.js';
import { sheetCam } from './sheetcam.js';
import { storeyParts } from '../geometry/storey.js';
import { plateDepth } from '../geometry/building.js';

const FAR = 50;                           // the wall runs on well past the drawing

/** the facade opposite, as the section plane meets it: its cut wall pieces and
 *  glass in (v, w) of the selected frame */
function farSide(F, cutU) {
  const out = { pieces: [], glass: null };
  for (const P of storeyParts(F)) {
    if (P.out[2] > -0.5) continue;        // only the side facing the other way
    const b = P.map([0, 0, 0])[0], Uu = P.map([1, 0, 0])[0] - b;
    const uc = (cutU - b) / Uu;
    if (uc < P.rect.u0 - 1e-9 || uc > P.rect.u1 + 1e-9) continue;
    const ws = (v, w) => P.map([uc, v, w])[2];
    let pieces;
    if (P.kind === 'blank') pieces = [aaBox(P.rect.u0, P.rect.u1, 0, P.rect.v1, -P.wallT, 0, { role: 'wall' })];
    else if (P.kind === 'end') pieces = [aaBox(P.rect.u0, P.rect.u1, 0, P.rect.v1, P.rev - P.wallT, P.rev, { role: 'wall' })];
    else pieces = wallPieces(P.cell, P.rect);
    for (const p of pieces) { const c = sliceBox(p, 0, uc); if (c) out.pieces.push({ role: p.role, pts: c.map(([v, w]) => [v, ws(v, w)]) }); }
    if (P.kind === 'unit' && uc > P.cell.opening.u0 && uc < P.cell.opening.u1)
      out.glass = { v0: P.cell.opening.v0, v1: P.cell.opening.v1, w0: ws(0, 0), w1: ws(0, -GLASS_T) };
  }
  return out;
}

/** what each framing takes in, in section axes (x = -w across, y = -v down the sheet) */
export function sectionFrames(F, study) {
  const { S, m } = F, h = m.storeyH, own = (m.own || []).filter(b => b.kind === 'h');
  const head = m.opening ? m.head : h, wallOut = m.reveal || 0, wallIn = m.wIn ?? -0.3;
  const wSlab = Math.min(wallIn, -0.12) - 0.16;
  const wMax = Math.max(own.length ? Math.max(0.75, boxHi(own, 2, 0) + 0.30) : 0.62, wallOut + 0.25);
  const wMin = Math.min(-0.42, wSlab - 0.06);
  const vMax = Math.max(head + 0.45, h + 0.1, boxHi(own, 1, 0) + 0.30), vMin = Math.min(-0.45, boxLo(own, 1, 0) - 0.30);
  const far = wallOut - plateDepth(S, F.sel.f, F.sel.st);
  const win = [-wMax, -wMin, -vMax, -vMin];
  const Rg = study && study.region;
  const reach = Rg ? [win[0], Math.max(win[1], -Rg.w0 + 0.3), win[2], win[3]] : win;
  const floor = [win[0], Math.max(win[1], -far + 0.5), win[2], win[3]];
  return { window: win, reach, floor, far };
}

/** the profile-angle handle as last drawn, in sheet coordinates; null when there is none */
export let sectionHandle = null;
/** where the plan cut stands on the section, and the section's sheet y back to v */
export let secCutLine = null;

export function drawSection(F, study) {
  const { S, V, m, cur } = F;
  sectionHandle = null;
  const M = { l: 14, r: 14, t: 30, b: 34 };
  const h = m.storeyH, blank = !m.opening;
  const head = blank ? h : m.head, sill = blank ? 0 : m.sill, cutU = S.cutU;
  const inOpening = !blank && cutU > m.opening.u0 && cutU < m.opening.u1;
  const own = m.own.filter(b => b.kind === 'h');
  const wallOut = m.reveal, wallIn = m.wIn, wSlab = Math.min(wallIn, -0.12) - 0.16;
  const wMax = Math.max(own.length ? Math.max(0.75, boxHi(own, 2, 0) + 0.30) : 0.62, wallOut + 0.25);
  const wMin = Math.min(-0.42, wSlab - 0.06);
  const vMax = Math.max(head + 0.45, h + 0.1, boxHi(own, 1, 0) + 0.30);
  const vMin = Math.min(-0.45, boxLo(own, 1, 0) - 0.30);
  const FR = sectionFrames(F, study), cam = V.seccam, SC = sheetCam(FR.window, M, cam, [0, -(sill + head) / 2]);
  const k = SC.k, X = w => SC.X(-w), Y = v => SC.Y(-v);
  const vw = ([v, w]) => [X(w), Y(v)];
  const [ax0, ay0, ax1, ay1] = SC.area, wFar = FR.far;
  const off = pts => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < ax0 - 20 || x0 > ax1 + 20 || y1 < ay0 - 20 || y0 > ay1 + 20; };
  const PB = (pts, o) => off(pts) ? '' : POLY(pts, o);
  // dimensions and callouts only at a scale they can be read at
  const detail = k > 55;
  const fs = farSide(F, cutU), farIn = fs.pieces.length ? Math.max(...fs.pieces.flatMap(p => p.pts.map(q => q[1]))) : wFar + 0.3;
  // the neighbours' devices that stand within the sheet
  const ctx = m.ctx.filter(b => {
    const p = projectBox(b, 0);
    return p.some(([v, w]) => v > vMin && v < vMax && w > wMin && w < wMax);
  });
  const hb = own.concat(ctx.filter(b => b.kind === 'h'));
  let g = defsCommon + `<defs><clipPath id="secClip"><rect x="${ax0}" y="${ay0}" width="${ax1 - ax0}" height="${ay1 - ay0}"/></clipPath></defs>`;
  const g0 = g;

  // the floor and ceiling slabs across the whole storey, then the wall as cut from the model
  const slab = (v0, v1, w0, w1) => RECT(X(w1), Y(v1), (w1 - w0) * k, (v1 - v0) * k,
    { fill: 'url(#poche)', stroke: 'var(--ink)', 'stroke-width': .9 });
  if (blank || m.type === 'punched') {
    // the storey's own slab at its top, and the floor it stands on
    const sb = blank ? 0.22 : clamp(m.slab ?? 0.22, 0, h - 0.1);
    g += slab(-Math.max(0.15, sb), 0, wFar, wallOut) + (sb > 1e-6 ? slab(h - sb, h, wFar, wallOut) : '');
    const pieces = blank ? [{ c: [0, (h - sb) / 2, -m.wallT / 2], e1: [1, 0, 0], e2: [0, 1, 0], e3: [0, 0, 1], h: [FAR, (h - sb) / 2, m.wallT / 2] }]
      : wallPieces(m, { u0: -FAR, u1: FAR, v0: 0, v1: h - sb });
    for (const p of pieces) {
      const c = sliceBox(p, 0, cutU);
      if (c) g += PB(c.map(vw), { fill: 'url(#poche)', stroke: 'var(--ink)', w: .9 });
    }
  } else if (m.type === 'windowwall') {
    // the glass stands on one slab and runs to the underside of the next
    const T0 = h - m.head;
    g += slab(-T0, 0, wFar, wallOut) + slab(m.head, h, wFar, wallOut);
  } else {
    // a curtain wall hangs in front of the slabs, a spandrel panel across each
    const T0 = h - m.head, sb = Math.min(-0.10, -GLASS_T - 0.06);
    g += slab(-Math.min(0.26, T0), 0, wFar, sb) + slab(h - Math.min(0.26, T0), h, wFar, sb);
    for (const [v0, v1] of [[-T0, 0], [m.head, h]])
      g += RECT(X(0), Y(v1), Math.max(3, GLASS_T * k), (v1 - v0) * k, { fill: 'var(--shade)', stroke: 'var(--ink)', 'stroke-width': .8 });
  }
  // the facade opposite, as the plane meets it
  for (const p of fs.pieces) g += PB(p.pts.map(vw), { fill: p.role === 'spandrel' ? 'var(--shade)' : 'url(#poche)', stroke: 'var(--ink)', w: .8 });
  if (fs.glass) g += RECT(X(fs.glass.w0), Y(fs.glass.v1), Math.max(3, GLASS_T * k), (fs.glass.v1 - fs.glass.v0) * k, { fill: 'var(--glassfill)', stroke: 'var(--glass)', 'stroke-width': .8 });
  g += L(X(wMax), Y(0), X(wFar), Y(0), { stroke: 'var(--rule)', w: .6 });
  g += T(X(wMax) - 4, Y(0) - 4, 'floor', { size: 8.5, fill: 'var(--ink3)' });

  // the glazing, lit and shaded along the cut; its outside face is the plane w = 0
  const gw = Math.max(6, GLASS_T * k);
  if (inOpening) {
    for (const [v0, v1, lit] of scanLine(m, cur.sl, cur.onFacade, 'v', cutU))
      g += RECT(X(0), Y(v1), gw, (v1 - v0) * k, { fill: lit ? 'var(--sun)' : 'url(#shp)' });
    g += RECT(X(0), Y(head), gw, m.winH * k, { fill: 'none', stroke: 'var(--glass)', 'stroke-width': 1.6 });
  }

  // every element: cut solid where the plane passes through it, dotted beyond;
  // the neighbours' in a lighter hand - and the storey above where it overhangs. They are drawn
  // before the sun ray and the profile angle, so the construction reads on top of them
  for (const b of m.own.concat(ctx)) {
    const c = sliceBox(b, 0, cutU), faint = b.ctx;
    if (c) g += PB(c.map(vw), { fill: b.kind === 'h' ? (faint ? 'var(--shade)' : 'var(--poche)') : 'url(#shp)', stroke: faint ? 'var(--ink3)' : 'var(--ink)', w: .7 });
    else g += PB(projectBox(b, 0).map(vw), b.kind === 'h'
      ? { fill: 'none', stroke: 'var(--ink3)', w: .7, dash: '2 2.4', op: faint ? .5 : .85 }
      : { fill: 'none', stroke: 'var(--ink3)', w: .6, dash: '1.5 2.5', op: faint ? .35 : .6 });
  }

  // the principal sun ray and the vertical profile angle, clipped to the sheet
  const outerEdge = b => {
    const cv = b.c[1], cw = b.c[2], e2 = [b.e2[1], b.e2[2]], e3 = [b.e3[1], b.e3[2]];
    let best = null;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, c]) => {
      const v = cv + a * b.h[1] * e2[0] + c * b.h[2] * e3[0];
      const w = cw + a * b.h[1] * e2[1] + c * b.h[2] * e3[1];
      if (!best || w > best[1] + 1e-9 || (Math.abs(w - best[1]) < 1e-9 && v < best[0])) best = [v, w];
    });
    return best;
  };
  const ray = (x0, y0, x1, y1, o) => L(x0, y0, x1, y1, o);
  let omegaPt = null, edgeY = null;       // where the callouts landed, so dimensions keep clear
  let needPh = null, inDeep = null;
  if (cur.onFacade && !blank) {
    const tanO = Math.tan(cur.vsa * D2R);
    // the governing edge: the lowest outer edge above the head, or the head itself
    const key = own.length ? own[0] : null;
    own.forEach((b, i) => {
      if (i === 0) return;
      const [pv, pw] = outerEdge(b);
      g += ray(X(pw), Y(pv), X(0), Y(pv - pw * tanO), { stroke: 'var(--sun)', w: .7, op: .38 });
    });
    // with no blade, the ray is drawn to the head of the opening at the wall face
    const [pv, pw] = key ? outerEdge(key) : [head, wallOut];
    const ev = pv - pw * tanO;
    g += ray(X(pw + 1.2), Y(pv + 1.2 * tanO), X(0), Y(ev), { stroke: 'var(--sun)', w: 1.6 });
    g += L(X(pw + 0.30), Y(pv + 0.30 * tanO), X(pw), Y(pv), { stroke: 'var(--sun)', w: 1.6, marker: 'url(#ar)' });
    // a handle on the ray: dragged, it turns the profile angle about this edge
    {
      const th = cur.vsa * D2R, px = X(pw), py = Y(pv), kx = px - 70 * Math.cos(th), ky = py - 70 * Math.sin(th);
      g += L(px, py, kx, ky, { stroke: 'var(--sun)', w: .8, dash: '2 2', op: .7 });
      g += sunKnob(kx, ky);
      sectionHandle = { pivot: [px, py], knob: [kx, ky] };
    }
    if (ev > vMin + 0.02 && ev < vMax) {
      g += arc(X(0), Y(ev), 46, Math.PI, Math.PI - cur.vsa * D2R, 'var(--sun)');
      const am = Math.PI - cur.vsa * D2R / 2;
      const op = am + Math.PI / 2, od = Math.max(0, 16 - 53 * Math.abs(Math.sin(cur.vsa * D2R / 2)));
      omegaPt = [X(0) + 53 * Math.cos(am) + od * Math.cos(op), Y(ev) - 53 * Math.sin(am) - od * Math.sin(op) + 3];
      g += TB(omegaPt[0], omegaPt[1], 'θ ' + fmt(cur.vsa, 1) + '°', { fill: 'var(--sun)', size: 9.5, anchor: 'middle', edit: 'theta' });
      if (detail && inOpening && ev > sill && ev < head) {
        g += L(X(0), Y(ev), X(-0.30), Y(ev), { stroke: 'var(--sun)', w: .6, dash: '3 2' });
        edgeY = Y(ev) - 3;
        // the sill and height dimensions are lettered at their mid-points, so the
        // callout steps clear of whichever one it has landed on
        [(Y(0) + Y(sill)) / 2, (Y(sill) + Y(head)) / 2].forEach(my => {
          if (Math.abs(edgeY - my) < 13) edgeY = my + (edgeY < my ? -15 : 15);
        });
        g += TB(X(-0.31), edgeY, 'shadow edge ' + fmt(ev, 2) + ' m', { fill: 'var(--sun)', size: 8.5 });
      }
    }
    // the hand construction: the projection a head overhang would need to
    // shade the whole window now, Ph = h / tan θ, laid off from the sill
    if (cur.vsa > 1 && cur.vsa < 89) {
      const Ph = m.winH / tanO;
      const reach = Math.min(Ph, wMax - 0.05);
      g += L(X(0), Y(sill), X(reach), Y(sill + reach * tanO), { stroke: 'var(--glass)', w: .9, dash: '5 3' });
      if (Ph <= wMax - 0.05) {
        g += L(X(0), Y(head), X(Ph), Y(head), { stroke: 'var(--glass)', w: 2.4, op: .55 });
        g += L(X(Ph), Y(head) - 4, X(Ph), Y(head) + 4, { stroke: 'var(--glass)', w: 1.2 });
      }
      needPh = Ph;
    }
    // and where the beam lands inside: the highest sunlit point of the glass on
    // this cut throws the deepest patch on the floor
    if (inOpening) {
      // a sliver narrower than 2 cm is the sampling grazing a cut-off, not a beam worth drawing
      const lit = scanLine(m, cur.sl, cur.onFacade, 'v', cutU).filter(sg => sg[2] && sg[1] - sg[0] > 0.02);
      if (lit.length) {
        const top = Math.max(...lit.map(sg => sg[1])), deep = top / tanO;
        // the beam inside, ghosted: each lit run of the glass carried down at
        // the profile angle to the floor, clipped to the sheet
        let band = '';
        for (const [va, vb] of lit) band += POLY([[X(0), Y(va)], [X(0), Y(vb)], [X(-vb / tanO), Y(0)], [X(-va / tanO), Y(0)]], { fill: 'var(--sun)', op: .16 });
        // inside only: from the glass to the facade opposite, floor to ceiling
        g += `<defs><clipPath id="secIn"><rect x="${fmt(X(0), 2)}" y="${fmt(Y(h), 2)}" width="${fmt(Math.max(0, X(farIn) - X(0)), 2)}" height="${fmt(h * k, 2)}"/></clipPath></defs>`
          + `<g clip-path="url(#secIn)">${band}${ray(X(0), Y(top), X(-deep), Y(0), { stroke: 'var(--sun)', w: .9, dash: '4 3', op: .8 })}</g>`;
        inDeep = deep;
      }
    }
  }

  // where the plan is cut, shown on this drawing
  g += L(X(wMax), Y(S.cutV), X(farIn), Y(S.cutV), { stroke: 'var(--sun)', w: .9, dash: '7 3 2 3', op: .8 });
  let pcy = Y(S.cutV) - 4;
  if (omegaPt && Math.abs(omegaPt[1] - pcy) < 18 && Math.abs(omegaPt[0] - (X(wMax) + 22)) < 95) pcy += 18;
  g += TB(X(wMax) + 4, pcy, 'plan cut ' + fmt(S.cutV, 2) + ' m ↕', { size: 8, fill: 'var(--sun)', bg: .85, edit: 'cutV' });
  // it can be dragged up and down the storey: the plan follows
  secCutLine = { y: Y(S.cutV), x0: Math.min(X(wMax), X(farIn)), x1: Math.max(X(wMax), X(farIn)), toV: sy => (Y(0) - sy) / k };

  // dimensions, taken from the first horizontal device of this unit
  if (detail && own.length) {
    const Q = own[0].D, grp = own.filter(b => b.D === Q), vTop = Math.max(...grp.map(b => b.anchor));
    // over the whole device as built, so a canopy stepping outward is taken whole
    const wIn = Math.min(...grp.map(b => b.c[2] - b.h[1] * Math.abs(b.e2[2])));
    const wOut = Math.max(...grp.map(b => b.c[2] + b.h[1] * Math.abs(b.e2[2])));
    const dx = X((wIn + wOut) / 2);
    let dy = Y(Math.max(vTop, boxHi(grp, 1, vTop))) - 24;
    if (omegaPt && Math.abs(omegaPt[1] - dy) < 15 && Math.abs(omegaPt[0] - dx) < 70) dy -= 22;
    g += dim(X(wIn), dy, X(wOut), dy, fmt((wOut - wIn) * 1000, 0), 0, 1);
    g += T(dx, dy - 13, 'projection', { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
    if (grp.length > 1) {
      const dv = Math.abs(grp[1].anchor - grp[0].anchor);
      if (dv > 1e-6) {
        let sx = X(wOut + 0.20);
        const sy = (Y(grp[0].anchor) + Y(grp[1].anchor)) / 2;
        if (omegaPt && Math.abs(omegaPt[1] - sy) < 18 && Math.abs(omegaPt[0] - sx) < 62) sx = Math.max(22, sx - 36);
        g += dim(sx, Y(grp[0].anchor), sx, Y(grp[1].anchor), fmt(dv * 1000, 0), 0, 1);
      } else {                            // a canopy repeats outward, so its pitch reads that way
        g += dim(X(grp[0].at), dy - 20, X(grp[1].at), dy - 20, fmt(Math.abs(grp[1].at - grp[0].at) * 1000, 0), 0, 1);
      }
    }
    if (Q.offset > 0.001) g += dim(X(wallOut), Y(head) + 22, X(wallOut + Q.offset), Y(head) + 22, fmt(Q.offset * 1000, 0), 0, 1);
  }
  if (detail && !blank) {
    if (sill > 0.001) g += dim(X(wMin) + 22, Y(0), X(wMin) + 22, Y(sill), fmt(sill * 1000, 0), 0, 1);
    g += dim(X(wMin) + 22, Y(sill), X(wMin) + 22, Y(head), fmt(m.winH * 1000, 0), 0, 1);
  }
  if (detail && inOpening) {
    let glazY = Y((sill + head) / 2) + 30;
    if (edgeY !== null && Math.abs(edgeY - glazY) < 13) glazY = edgeY + 22;
    g += T(X(wMin) + 34, glazY, 'glazing', { size: 9, fill: 'var(--glass)' });
  }
  if (detail && wallOut > 0.001) {
    g += dim(X(0), Y(sill) + 20, X(wallOut), Y(sill) + 20, fmt(wallOut * 1000, 0), 0, 1);
    g += T(X(wallOut / 2), Y(sill) + 42, 'set back', { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  }
  g = g0 + `<g clip-path="url(#secClip)">${g.slice(g0.length)}</g>` + RECT(ax0, ay0, ax1 - ax0, ay1 - ay0, { fill: 'none', stroke: 'var(--rule2)', 'stroke-width': .6 });
  if (needPh !== null) g += TB(14, 18, 'to shade the whole window now: Ph = h / tan θ = ' + fmt(m.winH, 2) + ' / tan ' + fmt(cur.vsa, 1) + '° = ' + fmt(needPh, 2) + ' m',
    { size: 8.5, fill: 'var(--glass)', bg: .92 });
  const inside = -wFar - Math.max(0, -wallIn);
  if (inDeep !== null) g += TB(W - 14, H - 22, inDeep < inside ? 'the beam reaches the floor ' + fmt(inDeep, 1) + ' m inside' : 'the beam runs the storey’s ' + fmt(inside, 1) + ' m to the far wall', { anchor: 'end', size: 8.5, fill: 'var(--sun)', bg: .92 });
  g += T(14, H - 8, '← exterior · cut at u = ' + fmt(cutU, 2) + ' m' + (Math.abs(cam.zoom - 1) > 0.01 ? ' · ×' + fmt(cam.zoom, 2) : '') + ' · wheel to zoom out to the floor, drag to pan', { size: 8.5, fill: 'var(--ink3)' });
  const over = (m.ctx || []).some(b => b.mass);
  if (blank) g += TB(W / 2, ay0 + 20, 'no glazing on this storey', { anchor: 'middle', size: 9.5, fill: 'var(--ink3)', bg: .9 });
  else if (!hb.length) g += TB(W / 2, ay0 + 14, over ? 'no device: the storey above overhangs' : m.elements.some(b => b.kind === 'v') ? 'vertical fins — see plan' : 'no horizontal device',
    { anchor: 'middle', size: 9, fill: 'var(--ink3)', bg: .85 });
  if (!blank && !inOpening) g += TB(W / 2, ay0 + 28, 'the section is cut outside the glazing', { anchor: 'middle', size: 9, fill: 'var(--ink3)', bg: .9 });
  return svg(g, 'Section through the glazing showing horizontal shading and the vertical profile angle');
}
