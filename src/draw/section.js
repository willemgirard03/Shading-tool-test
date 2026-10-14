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
import { W, H, T, L, POLY, RECT, TB, CIRCLE, PATH, dim, arc, defsCommon, svg, sunKnob, gripMark, mm } from './svg.js';
import { deviceEdit, depthStrings, arrayMembers } from './devedit.js';
import { siteAcross } from '../geometry/site.js';
const SITE_LOOK = { line: { stroke: '#A23A16', w: 1.1, dash: '9 3 2 3' }, curb: { stroke: 'var(--ink3)', w: .8, dash: '5 3' }, limit: { stroke: '#C0442B', w: 1, dash: '3 2', op: .85 } };
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
/** the section's grips as last drawn: the sill, the head, the glass's set-back, the selected device's depth */
export let sectionGrips = [];
/** each device of the window as drawn, to be picked by a click; and where the picked one's popover hangs */
export let sectionDevHits = [], sectionPop = null;

export function drawSection(F, study) {
  const { S, V, m, cur } = F;
  sectionHandle = null; sectionGrips = []; sectionDevHits = []; sectionPop = null;
  const M = { l: 14, r: 14, t: 30, b: 34 };
  const h = m.storeyH, blank = !m.opening;
  const head = blank ? h : m.head, sill = blank ? 0 : m.sill, cutU = S.cutU;
  const inOpening = !blank && cutU > m.opening.u0 && cutU < m.opening.u1;
  const own = m.own.filter(b => b.kind === 'h');
  // the handles and the typed figures, only when the view asks for them
  const EDIT = F.pick === 'window', ek = k => EDIT ? k : undefined;
  const wallOut = m.reveal, wallIn = m.wIn, wSlab = Math.min(wallIn, -0.12) - 0.16;
  const wMax = Math.max(own.length ? Math.max(0.75, boxHi(own, 2, 0) + 0.30) : 0.62, wallOut + 0.25);
  const wMin = Math.min(-0.42, wSlab - 0.06);
  const vMax = Math.max(head + 0.45, h + 0.1, boxHi(own, 1, 0) + 0.30);
  const vMin = Math.min(-0.45, boxLo(own, 1, 0) - 0.30);
  // the wall holds the middle of the sheet: drawn from its face, framed about its middle, so the glass moves in it, not it round the glass
  const FR = sectionFrames(F, study), cam = V.seccam, xc = (wallOut - wallIn) / 2;
  const fw = FR.window, fx0 = fw[0] + wallOut, fx1 = fw[1] + wallOut, half = Math.max(xc - fx0, fx1 - xc);
  const SC = sheetCam([xc - half, xc + half, fw[2], fw[3]], M, cam, [xc, -(sill + head) / 2], [F.sel.f, F.sel.st, F.sel.unit, cam.fit, W, H].join('|'));
  const k = SC.k, X = w => SC.X(-(w - wallOut)), Y = v => SC.Y(-v);
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
    // a jamb beyond the cut, seen through the opening - with glass the full height it is all there is of the wall
    if (inOpening && !(m.glz && m.glz.fillW))
      g += PB([[sill, wallIn], [head, wallIn], [head, wallOut], [sill, wallOut]].map(vw), { fill: 'none', stroke: 'var(--ink2)', w: .7 });
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
  const siteBad = V.site && F.checks && F.sel.unit !== null ? F.checks.badOf(F.sel.f, F.sel.st, F.sel.unit) : null;
  // the blades of each array down the facade, ready to be dragged
  const mems = arrayMembers(m, 'V', [0, Y(1) - Y(0)], [X(1) - X(0), 0]);
  for (const b of m.own.concat(ctx)) {
    const c = sliceBox(b, 0, cutU), faint = b.ctx;
    if (c) g += PB(c.map(vw), { fill: b.site ? '#D6DBD8' : b.kind === 'h' ? (faint ? 'var(--shade)' : 'var(--poche)') : 'url(#shp)', stroke: faint ? 'var(--ink3)' : 'var(--ink)', w: .7 });
    else g += PB(projectBox(b, 0).map(vw), b.kind === 'h'
      ? { fill: 'none', stroke: 'var(--ink3)', w: .7, dash: '2 2.4', op: faint ? .5 : .85 }
      : { fill: 'none', stroke: 'var(--ink3)', w: .6, dash: '1.5 2.5', op: faint ? .35 : .6 });
    // the window's own devices can be picked; the picked one is drawn in the glass's colour
    if (!faint && b.sys !== undefined) {
      const pts = (c || projectBox(b, 0)).map(vw);
      sectionDevHits.push({ pts, i: b.sys, cut: !!c, mem: mems.get(b) });
      if (b.D === F.selD) g += PB(pts, { fill: 'none', stroke: 'var(--glass)', w: 1.5 });
      // past what the site allows, red - while the site's constraints are shown
      if (siteBad && siteBad.has(b.sys)) g += PB(pts, { fill: '#C0442B', op: c ? .55 : .14, stroke: '#C0442B', w: 1.2 });
    }
  }

  // the window and its wall, from floor to ceiling, picked by a click; picked, they show their handles
  if (!blank) {
    const ceilV = h - (m.slab || 0), band = [[X(wallOut), Y(0)], [X(wallIn), Y(0)], [X(wallIn), Y(ceilV)], [X(wallOut), Y(ceilV)]];
    sectionDevHits.push({ pts: band, i: 'win', cut: false });
    // the slabs over and under the storey pick the window too - the slab's handle is among its own
    const sbH = clamp(m.slab ?? 0.22, 0, h - 0.1), slabPts = (v0, v1) => [[X(wFar), Y(v0)], [X(wallOut), Y(v0)], [X(wallOut), Y(v1)], [X(wFar), Y(v1)]];
    sectionDevHits.push({ pts: slabPts(h - sbH, h), i: 'win', cut: false }, { pts: slabPts(-Math.max(0.15, sbH), 0), i: 'win', cut: false });
    if (EDIT) { g += POLY(band, { fill: 'none', stroke: 'var(--glass)', w: 1.2, dash: '4 3' }); sectionPop = { x: X(0), y: Y((sill + head) / 2), kind: 'window' }; }
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
        // each lit run shaded and outlined whole - its top and bottom rays, and where it meets the floor - unless the view leaves the beam unshaded
        let band = '';
        const dot = { stroke: 'var(--sun)', w: .9, dash: '4 3', op: .8 };
        if (V.beam !== false) for (const [va, vb] of lit) {
          band += POLY([[X(0), Y(va)], [X(0), Y(vb)], [X(-vb / tanO), Y(0)], [X(-va / tanO), Y(0)]], { fill: 'var(--sun)', op: .16 });
          band += L(X(0), Y(vb), X(-vb / tanO), Y(0), dot) + L(X(0), Y(va), X(-va / tanO), Y(0), dot) + L(X(-va / tanO), Y(0) - 1, X(-vb / tanO), Y(0) - 1, dot);
        }
        // inside only: from the glass to the facade opposite, floor to ceiling
        if (band) g += `<defs><clipPath id="secIn"><rect x="${fmt(X(0), 2)}" y="${fmt(Y(h), 2)}" width="${fmt(Math.max(0, X(farIn) - X(0)), 2)}" height="${fmt(h * k, 2)}"/></clipPath></defs>`
          + `<g clip-path="url(#secIn)">${band}</g>`;
        inDeep = deep;
      }
      // the whole window's beam as if nothing shaded it, dotted in grey: its head and its sill carried down to the floor
      if (tanO > 1e-6) {
        const grey = { stroke: 'var(--ink3)', w: .8, dash: '2 2.5', op: .9 }, wh = -head / tanO, ws = -sill / tanO;
        const whole = L(X(0), Y(head), X(wh), Y(0), grey) + L(X(0), Y(sill), X(ws), Y(0), grey) + L(X(ws), Y(0) - 1.5, X(wh), Y(0) - 1.5, Object.assign({}, grey, { w: 1.6 }));
        g += `<defs><clipPath id="secWhole"><rect x="${fmt(X(0), 2)}" y="${fmt(Y(h), 2)}" width="${fmt(Math.max(0, X(farIn) - X(0)), 2)}" height="${fmt(h * k, 2)}"/></clipPath></defs><g clip-path="url(#secWhole)">${whole}</g>`;
      }
    }
  }

  // where the plan is cut, shown on this drawing
  g += L(X(wMax), Y(S.cutV), X(farIn), Y(S.cutV), { stroke: 'var(--sun)', w: .9, dash: '7 3 2 3', op: .8 });
  // its figure at the room's end, away from the sun and its ray
  g += TB(Math.min(X(farIn), ax1) - 6, Y(S.cutV) - 4, 'plan cut ' + mm(S.cutV) + ' ↕', { size: 8, fill: 'var(--sun)', bg: .85, edit: 'cutV', anchor: 'end' });
  // it can be dragged up and down the storey: the plan follows
  secCutLine = { y: Y(S.cutV), x0: Math.min(X(wMax), X(farIn)), x1: Math.max(X(wMax), X(farIn)), toV: sy => (Y(0) - sy) / k };

  /* The site in front, on request: the property line and the curb standing up
     the sheet, and the furthest the by-law lets a device reach past the line,
     stepping with height - each named on hover; the line and the curb dragged */
  const SA = V.site ? siteAcross(F) : null;
  if (SA) {
    // the property line and the curb are dragged anywhere along them, as the cuts are; their figures typed over
    const on = true, wl = SA.wAt(0, cutU), per = 1 / -SA.dw, f = SA.f;
    const look = o => o, name = (w, txt, col = '#A23A16') => { const x = X(w) - 4, y = Y(h * 0.3); return T(x, y, txt, { size: 8, fill: col, anchor: 'middle', rot: 'rotate(-90 ' + fmt(x, 2) + ' ' + fmt(y, 2) + ')' }); };
    const band = w => [[X(w) - 5, Y(-0.6)], [X(w) + 5, Y(-0.6)], [X(w) + 5, Y(h + 0.6)], [X(w) - 5, Y(h + 0.6)]];
    // the property line, standing up from the boundary: clicked, it and the curb show their handles
    g += L(X(wl), Y(-0.6), X(wl), Y(h + 0.6), look(SITE_LOOK.line)) + name(wl, SA.street ? 'property line' : 'property line - nothing may pass');
    sectionGrips.push({ line: [[X(wl), Y(-0.6)], [X(wl), Y(h + 0.6)]], p: [X(wl), Y(h * 0.5)], key: 'site.' + f + '.off', from: SA.sg.off, dir: [X(wl + per) - X(wl), 0] });
    // its setback from the wall face, dimensioned under the floor
    if (Math.abs(wl - wallOut) > 0.004) g += dim(X(wallOut), Y(-0.2), X(wl), Y(-0.2), fmt(SA.sg.off * 1000, 0), 0, 1, on ? 'site.' + f + '.off' : undefined);
    else if (on) g += TB(X(wl) + 6, Y(-0.2) + 3, 'setback 0', { size: 8, fill: 'var(--glass)', edit: 'site.' + f + '.off' });
    if (SA.street) {
      const wc = SA.wAt(-SA.sg.curb, cutU);
      if (SA.sg.curb > 0.05) {
        g += L(X(wc), Y(-0.6), X(wc), Y(h + 0.6), look(SITE_LOOK.curb)) + name(wc, 'curb', 'var(--ink3)');
        sectionGrips.push({ line: [[X(wc), Y(-0.6)], [X(wc), Y(h + 0.6)]], p: [X(wc), Y(h * 0.5)], key: 'site.' + f + '.curb', from: SA.sg.curb, dir: [X(wc + per) - X(wc), 0] });
        g += dim(X(wl), Y(-0.36), X(wc), Y(-0.36), fmt(SA.sg.curb * 1000, 0), 0, 1, on ? 'site.' + f + '.curb' : undefined);
      }
      // the by-law's reach past the line, step by step up the storey, each step's reach dimensioned
      const cuts = [0, h].concat([2.75, 5.2, 7.62].map(z => z - SA.zb).filter(v => v > 0 && v < h)).sort((a, b) => a - b);
      let path = '', lim = '';
      for (let i = 0; i < cuts.length - 1; i++) {
        const al = SA.allowedAt(SA.zb + (cuts[i] + cuts[i + 1]) / 2), wa = SA.wAt(-al, cutU), vm = (cuts[i] + cuts[i + 1]) / 2;
        path += (i ? 'L' : 'M') + fmt(X(wa), 2) + ',' + fmt(Y(cuts[i]), 2) + 'L' + fmt(X(wa), 2) + ',' + fmt(Y(cuts[i + 1]), 2);
        if (al > 0.004) lim += dim(X(wl), Y(vm), X(wa), Y(vm), fmt(al * 1000, 0), 0, 1);
      }
      g += `<g><title>The furthest the by-law lets a shading device reach past the property line at this height</title>${PATH(path, Object.assign({ fill: 'none' }, SITE_LOOK.limit))}</g>` + lim;
      g += name(SA.wAt(-SA.allowedAt(SA.zb + h * 0.3), cutU), 'by-law limit', '#C0442B');
    }
  }
  // each horizontal device's gap to the wall and projection, on strings above them; an unpicked array's pitch beside it
  if (detail && own.length) {
    const groups = new Map();
    own.forEach(b => { if (!groups.has(b.D)) groups.set(b.D, []); groups.get(b.D).push(b); });
    g += depthStrings({ P: ([a, w]) => [X(w), Y(a)], drop: 0 }, [...groups].map(([D, boxes]) => ({ D, boxes })), m, F.selD);
    for (const [Q, grp] of groups) {
      if (Q === F.selD || grp.length < 2) continue;
      const wOut = Math.max(...grp.map(b => b.c[2] + b.h[1] * Math.abs(b.e2[2]))), dv = Math.abs(grp[1].anchor - grp[0].anchor);
      if (dv > 1e-6) g += dim(X(wOut + 0.20), Y(grp[0].anchor), X(wOut + 0.20), Y(grp[1].anchor), fmt(dv * 1000, 0), 0, 1);
      else g += dim(X(grp[0].at), Y(Math.max(...grp.map(b => b.anchor))) - 20, X(grp[1].at), Y(Math.max(...grp.map(b => b.anchor))) - 20, fmt(Math.abs(grp[1].at - grp[0].at) * 1000, 0), 0, 1);
    }
  }
  if (detail && !blank) {
    const fillH = !!(m.glz && m.glz.fillH);
    // the floor to the sill, the window, and the head to the ceiling - the underside of the slab - in one string
    const ceil = h - (m.slab || 0);
    g += dim(X(wMin) + 22, Y(0), X(wMin) + 22, Y(sill), fmt(sill * 1000, 0), 0, 1, ek('g.sillK'));
    g += dim(X(wMin) + 22, Y(sill), X(wMin) + 22, Y(head), fmt(m.winH * 1000, 0), 0, 1, fillH ? undefined : ek('g.winH'));
    if (ceil - head > 0.005) g += dim(X(wMin) + 22, Y(head), X(wMin) + 22, Y(ceil), fmt((ceil - head) * 1000, 0), 0, 1, fillH ? undefined : ek('g.headGap'));
    // the slab over the storey, on the same string; picked, its underside is dragged
    if (h - ceil > 0.004) g += dim(X(wMin) + 22, Y(ceil), X(wMin) + 22, Y(h), fmt((h - ceil) * 1000, 0), 0, 1, ek('slabT'));
    if (EDIT) sectionGrips.push({ p: [X(wallIn - 0.3), Y(ceil)], key: 'slabT', from: h - ceil, dir: [0, Y(-1) - Y(0)] });
    // the sill and the head dragged up and down the glass, kept between the floor and the ceiling; the glass pushed in or out of its wall from its middle
    const up = [0, Y(1) - Y(0)], gx = X(0) + 9;
    if (EDIT) {
      sectionGrips.push({ p: [gx, Y(sill)], key: 'g.sillK', from: sill, dir: up });
      if (!fillH) sectionGrips.push({ p: [gx, Y(head)], key: 'g.head', from: head, dir: up });
      sectionGrips.push({ p: [X(0) - 2, Y((sill + head) / 2)], key: 'g.reveal', from: wallOut, dir: [X(-1) - X(0), 0] });
      // the wall's inside face pushed in or out - the framing holds while it is dragged, and centres the wall again after;
      // glass the bay's full width and height leaves no wall in the bay to push
      if (!(m.glz && m.glz.fillW && fillH)) {
        const vIn = sill > 0.2 ? sill / 2 : ceil - head > 0.2 ? (head + ceil) / 2 : (sill + head) / 2;
        sectionGrips.push({ p: [X(wallIn), Y(vIn)], key: 'g.wallT', from: wallOut - wallIn, dir: [X(-1) - X(0), 0] });
        g += dim(X(wallOut), Y(vIn) + 18, X(wallIn), Y(vIn) + 18, fmt((wallOut - wallIn) * 1000, 0), 0, 1, 'g.wallT');
      }
    }
  }
  // the picked device: its handles, its gumball, its array - a blade's profile and array, a fin's length
  const D = F.selD, mineD = D ? m.own.filter(b => b.D === D) : [];
  if (detail && mineD.length && !blank) {
    const de = deviceEdit({ P: ([a, w]) => [X(w), Y(a)], ax: 'V', drop: 0 }, D, mineD, m, sectionGrips);
    g += de.svg; sectionPop = de.pop;
  }
  for (const gp of sectionGrips) if (!gp.arrow && !gp.rot && !gp.pop && !gp.line) g += gripMark(gp.p[0], gp.p[1]);
  if (detail && wallOut > 0.001) {
    g += dim(X(0), Y(sill) + 20, X(wallOut), Y(sill) + 20, fmt(wallOut * 1000, 0), 0, 1, ek('g.reveal'));
  }
  g = g0 + `<g clip-path="url(#secClip)">${g.slice(g0.length)}</g>` + RECT(ax0, ay0, ax1 - ax0, ay1 - ay0, { fill: 'none', stroke: 'var(--rule2)', 'stroke-width': .6 });
  // what the handles edit, named, while they are shown: a type is shared
  if (!blank && F.pick && F.editing) g += T(14, H - 10, F.editing, { size: 8.5, fill: 'var(--glass)' });
  if (blank) g += TB(W / 2, ay0 + 20, 'no glazing on this storey', { anchor: 'middle', size: 9.5, fill: 'var(--ink3)', bg: .9 });
  if (!blank && !inOpening) g += TB(W / 2, ay0 + 28, 'the section is cut outside the glazing', { anchor: 'middle', size: 9, fill: 'var(--ink3)', bg: .9 });
  return svg(g, 'Section through the glazing showing horizontal shading and the vertical profile angle');
}
