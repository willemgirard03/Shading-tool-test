/* The plan: the working storey cut at v = cutV, looking down, the selected
   window's side at the BOTTOM. The whole floor is drawn - every side's walls
   and glass as the cut meets them, every device as it stands over the cut -
   and on the floor, the direct sun that comes in through the selected window:
   at this instant as a crisp patch, or summed over the day or the year as a
   map. The selected window carries the constructions: the horizontal profile
   angle off the fin that governs it, SW = Pd tan γ, and the fin depth that
   would shade it now. The camera frames the window, the sun's reach, or the
   whole floor, and zooms about the window.                                  */

import { D2R, fmt, clamp } from '../util.js';
import { sliceBox, projectBox, boxHi, boxLo, aaBox } from '../geometry/boxes.js';
import { wallPieces, GLASS_T } from '../geometry/cell.js';
import { scanLine } from '../geometry/analysis.js';
import { sunPatches, SURFACE_NAMES } from '../geometry/room.js';
import { storeyParts, plateCorners } from '../geometry/storey.js';
import { W, H, T, L, POLY, RECT, TB, CIRCLE, dim, arc, tickLine, defsCommon, svg, sunKnob, gripMark, mm } from './svg.js';
import { deviceEdit, depthStrings } from './devedit.js';
import { siteAcross } from '../geometry/site.js';
const SITE_LOOK = { line: { stroke: '#A23A16', w: 1.1, dash: '9 3 2 3' }, curb: { stroke: 'var(--ink3)', w: .8, dash: '5 3' }, limit: { stroke: '#C0442B', w: 1, dash: '3 2', op: .85 } };
import { sheetCam } from './sheetcam.js';
import { PLAN_LIGHT_WORDS } from '../geometry/floorsun.js';

export const INTERIOR_MODES = { now: 'This instant', day: 'Over the day', year: 'Over the year' };

/* the floor's ramp: bare floor to the amber used for sun everywhere else */
const FLOOR = '#E4DFD4';
/** the sheet itself: where a shadow falls inside a patch of sun on a floor that is not drawn */
const BG = '#ffffff';
const RAMP0 = [228, 223, 212], RAMP1 = [217, 130, 26];
const ramp = t => 'rgb(' + RAMP0.map((c, i) => Math.round(c + (RAMP1[i] - c) * Math.pow(clamp(t, 0, 1), 0.7))).join(',') + ')';

/** what each framing takes in, in plan axes (u across, w down the sheet) */
export function planFrames(F, study) {
  const { m } = F, own = m.own || [];
  const halfW = m.opening ? Math.max(Math.abs(m.opening.u0), Math.abs(m.opening.u1)) : 1.5;
  const uSpan = Math.max(halfW, boxHi(own, 0, 0), -boxLo(own, 0, 0)) + 0.45;
  const wMax = Math.max(0.7, boxHi(own, 2, 0) + 0.42, (m.reveal || 0) + 0.30);
  const wMin = Math.min(-0.5, (m.wIn ?? -0.3) - 0.12);
  const win = [-uSpan, uSpan, wMin, wMax];
  const Rg = study && study.region;
  const reach = Rg ? [Math.min(win[0], Rg.u0), Math.max(win[1], Rg.u1), Math.min(win[2], Rg.w0), win[3]] : win;
  const pc = plateCorners(F);
  const floor = [Math.min(win[0], ...pc.map(p => p[0])) - 0.4, Math.max(win[1], ...pc.map(p => p[0])) + 0.4,
    Math.min(win[2], ...pc.map(p => p[1])) - 0.4, win[3]];
  return { window: win, reach, floor };
}

/** the plan's sun handle as last drawn, in sheet coordinates; null when there is none */
export let planHandle = null;
/** where the section cut stands on the plan, and the plan's sheet x back to u */
export let planCutLine = null;
/** the plan's grips as last drawn: the jambs, the selected fin's depth */
export let planGrips = [];
/** each device of the window as drawn, to be picked by a click; and where the picked one's popover hangs */
export let planDevHits = [], planPop = null;

export function drawPlan(F, study) {
  const { S, V, m, cur, sel } = F;
  planHandle = null; planGrips = []; planDevHits = []; planPop = null;
  const M = { l: 30, r: 30, t: 48, b: 58 };
  const blank = !m.opening, own = m.own || [], vMid = S.cutV;
  // the wall holds the middle of the sheet: drawn from its face, framed about its middle
  const wOut0 = m.reveal || 0, wIn0 = m.wIn ?? -0.3, yc = (wIn0 - wOut0) / 2;
  const fr = planFrames(F, study), cam = V.plancam, fw = fr.window, fy0 = fw[2] - wOut0, fy1 = fw[3] - wOut0, halfY = Math.max(yc - fy0, fy1 - yc);
  const SC = sheetCam([fw[0], fw[1], yc - halfY, yc + halfY], M, cam, [0, yc], [F.sel.f, F.sel.st, F.sel.unit, cam.fit, !!V.whole, W, H].join('|'));
  const k = SC.k, X = SC.X, Y = w => SC.Y(w - wOut0), uw = ([u, w]) => [X(u), Y(w)];
  const [ax0, ay0, ax1, ay1] = SC.area;
  // what lies wholly off the sheet is left out, so a zoomed-in floor stays light
  const off = pts => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < ax0 - 20 || x0 > ax1 + 20 || y1 < ay0 - 20 || y0 > ay1 + 20; };
  const PB = (pts, o) => off(pts) ? '' : POLY(pts, o);
  const RB = (x, y, w, h, o) => off([[x, y], [x + w, y + h]]) ? '' : RECT(x, y, w, h, o);
  const LB = (x0, y0, x1, y1, o) => off([[x0, y0], [x1, y1]]) ? '' : L(x0, y0, x1, y1, o);
  const wallOut = m.reveal || 0, wallIn = m.wIn ?? -0.3;
  const inOpening = !blank && vMid > m.opening.v0 && vMid < m.opening.v1;
  const halfW = blank ? 1.5 : Math.max(Math.abs(m.opening.u0), Math.abs(m.opening.u1)), oc = blank ? 0 : (m.opening.u0 + m.opening.u1) / 2;
  // the handles and typed figures on request; the bay alone, or the whole floor
  const EDIT = F.pick === 'window', ek = k => EDIT ? k : undefined, WHOLE = !!V.whole;
  let g = defsCommon + `<defs><clipPath id="planClip"><rect x="${ax0}" y="${ay0}" width="${ax1 - ax0}" height="${ay1 - ay0}"/></clipPath></defs>`;
  let body = '';

  // no floor is drawn: the sun on it, and the walls, say where the room is
  const pc = plateCorners(F);

  // the direct sun on it, through the selected window
  const mode = V.inMode, R = study && study.R;
  let legend = null, headline = '';
  if (!blank && study) {
    if (mode === 'now') {
      // through every window the results are for, or through the selected one
      if (study.nowAll && WHOLE) for (const p of study.nowAll.patches) {
        body += PB(p.lit.map(uw), { fill: 'var(--sun)', op: .9 });
        for (const sh of p.shade) body += PB(sh.map(uw), { fill: BG });
      } else if (cur.onFacade) for (const p of sunPatches(m, R, cur.sl)) {
        if (p.S.key !== 'floor') continue;
        body += PB(p.lit.map(uw), { fill: 'var(--sun)', op: .9 });
        for (const sh of p.shade) body += PB(sh.map(uw), { fill: BG });
      }
      const E = study.nowAll ? study.nowAll.max : study.now ? study.now.max : 0;
      headline = E > 0 ? fmt(E, 0) + ' W/m² on the sunlit floor' : 'no direct sun on the floor';
    } else if (study[mode]) {
      const G = study[mode], mx = G.max || 1;
      for (let i = 0; i < G.nu; i++) for (let j = 0; j < G.nw; j++) {
        const v = G.v[i * G.nw + j];
        if (v > 0) body += RB(X(G.u0 + i * G.du), Y(G.w1 - (j + 1) * G.dw), G.du * k + .3, G.dw * k + .3, { fill: ramp(v / mx), stroke: 'none' });
      }
      legend = { max: G.max, unit: mode === 'day' ? 'Wh/m²' : 'kWh/m²' };
      headline = G.max > 0 ? 'up to ' + fmt(G.max, 0) + ' ' + legend.unit + ' ' + (mode === 'day' ? 'today' : 'a year') + ' on the floor'
        : 'no direct sun on the floor ' + (mode === 'day' ? 'today' : 'all year');
    } else headline = 'working…';
  }

  // distance in from the selected facade, a line every metre or two, over the whole floor
  if (R && WHOLE) {
    const deep = R.w1 - R.w0, every = deep > 14 ? 2 : 1;
    for (let d = every; d < deep; d += every) {
      body += LB(X(R.u0), Y(R.w1 - d), X(R.u1), Y(R.w1 - d), { stroke: 'var(--ink3)', w: .4, op: .3, dash: '2 3' });
      const lx = clamp(X(Math.min(R.u1, halfW + 0.6)), ax0 + 4, ax1 - 24);
      if (Y(R.w1 - d) > ay0 + 6 && Y(R.w1 - d) < ay1 - 4) body += T(lx + 3, Y(R.w1 - d) + 3, mm(d), { size: 7.5, fill: 'var(--ink3)', op: .8 });
    }
  }

  // every side of the storey as the cut meets it: walls, glass, and the devices over - or the selected bay alone
  const parts = storeyParts(F).filter(P => WHOLE || P.sel);
  const gh = Math.max(4, GLASS_T * k);
  for (const P of parts) {
    const map2 = ([u, w]) => { const q = P.map([u, 0, w]); return [X(q[0]), Y(q[2])]; };
    const faint = !P.sel && P.f !== sel.f;
    let pieces;
    if (P.kind === 'blank') pieces = [aaBox(P.rect.u0, P.rect.u1, 0, P.rect.v1, -P.wallT, 0, { role: 'wall' })];
    else if (P.kind === 'end') pieces = [aaBox(P.rect.u0, P.rect.u1, 0, P.rect.v1, P.rev - P.wallT, P.rev, { role: 'wall' })];
    else pieces = wallPieces(P.cell, P.rect);
    for (const p of pieces) {
      const c = sliceBox(p, 1, vMid);
      if (c) body += PB(c.map(map2), { fill: p.role === 'spandrel' ? 'var(--shade)' : 'url(#poche)', stroke: 'var(--ink)', w: P.sel ? .9 : .6 });
    }
    if (P.kind !== 'unit') continue;
    const c = P.cell, o = c.opening;
    if (vMid > o.v0 && vMid < o.v1) {
      const g0 = Math.max(o.u0, P.rect.u0), g1 = Math.min(o.u1, P.rect.u1);
      // the sill under the glass, seen from above - with glass the bay's full width it is all there is of the wall
      if (o.v0 > 0.005 && g1 > g0) body += PB([[g0, c.wIn], [g1, c.wIn], [g1, c.reveal], [g0, c.reveal]].map(map2), { fill: 'none', stroke: 'var(--ink2)', w: P.sel ? .7 : .5 });
      const glassBox = (a, b) => [[a, -GLASS_T], [b, -GLASS_T], [b, 0], [a, 0]].map(map2);
      if (P.sel) {
        for (const [a, b, lit] of scanLine(m, cur.sl, cur.onFacade, 'u', vMid)) {
          const a2 = Math.max(a, g0), b2 = Math.min(b, g1);
          if (b2 > a2) body += PB(glassBox(a2, b2), { fill: lit ? 'var(--sun)' : 'url(#shp)' });
        }
        body += PB(glassBox(g0, g1), { fill: 'none', stroke: 'var(--glass)', w: 1.6 });
      } else if (g1 > g0) body += PB(glassBox(g0, g1), { fill: 'var(--glassfill)', stroke: 'var(--glass)', w: .6 });
    }
    // this part's own devices: cut where the plane passes through them, outlined over where it does not
    for (const b of c.elements) {
      if (P.sel) continue;                // the selected unit's are drawn with its constructions below
      const cut = sliceBox(b, 1, vMid);
      if (cut) body += PB(cut.map(map2), { fill: b.kind === 'v' ? 'var(--shade)' : 'url(#shp)', stroke: 'var(--ink3)', w: .5 });
      else body += PB(projectBox(b, 1).map(map2), { fill: 'none', stroke: 'var(--ink3)', w: .5, dash: '2 2.4', op: faint ? .4 : .6 });
    }
  }
  body += LB(X(Math.min(...pc.map(p => p[0]))), Y(wallOut), X(Math.max(...pc.map(p => p[0]))), Y(wallOut), { stroke: 'var(--rule)', w: .5, dash: '6 3', op: .6 });

  // the selected unit's devices and its neighbours' from other storeys where the cut meets them
  const ctx = (m.ctx || []).filter(b => b.st !== sel.st && sliceBox(b, 1, vMid));
  const hb = own.filter(b => b.kind === 'h');
  if (hb.length) {
    const groups = new Map();
    hb.forEach(b => { if (!groups.has(b.D)) groups.set(b.D, []); groups.get(b.D).push(b); });
    groups.forEach(bs => {
      const u0 = boxLo(bs, 0, 0), u1 = boxHi(bs, 0, 0), w0 = boxLo(bs, 2, 0), w1 = boxHi(bs, 2, 0);
      body += RB(X(u0), Y(w0), (u1 - u0) * k, (w1 - w0) * k, { fill: 'none', stroke: 'var(--ink3)', 'stroke-width': .9, 'stroke-dasharray': '6 3' });
    });
  }
  for (const b of own.concat(ctx)) {
    const c = sliceBox(b, 1, vMid), fnt = b.ctx;
    if (c) body += PB(c.map(uw), { fill: b.site ? '#D6DBD8' : b.kind === 'v' ? (fnt ? 'var(--shade)' : 'var(--poche)') : 'url(#shp)', stroke: fnt ? 'var(--ink3)' : 'var(--ink)', w: .7 });
    else if (b.kind === 'v') body += PB(projectBox(b, 1).map(uw), { fill: 'none', stroke: 'var(--ink3)', w: .7, dash: '2 2.4', op: fnt ? .45 : .85 });
  }
  // the site in front, on request: the property line, the curb and the by-law's reach at the plan cut, across the sheet - the first two dragged
  const SA = V.site ? siteAcross(F) : null;
  if (SA) {
    // the property line and the curb are dragged anywhere along them, as the cuts are; their figures typed over
    const on = true, per = 1 / -SA.dw, U = 60, f = SA.f, uR = (ax1 - 8 - X(0)) / k, uD = oc - halfW - 0.9;
    const look = o => o;
    const across = (c, o, txt, col) => {
      const a = [X(-U), Y(SA.wAt(c, -U))], b = [X(U), Y(SA.wAt(c, U))];
      return L(a[0], a[1], b[0], b[1], look(o)) + T(ax1 - 8, Y(SA.wAt(c, uR)) - 4, txt, { size: 8, fill: col, anchor: 'end' });
    };
    const grip = (c, key, from) => { const w = SA.wAt(c, oc); planGrips.push({ line: [[X(-U), Y(SA.wAt(c, -U))], [X(U), Y(SA.wAt(c, U))]], p: [X(oc), Y(w)], key, from, dir: [0, Y(w + per) - Y(w)] }); };
    const wl = SA.wAt(0, uD);
    body += across(0, SITE_LOOK.line, SA.street ? 'property line' : 'property line - nothing may pass', '#A23A16');
    grip(0, 'site.' + f + '.off', SA.sg.off);
    if (Math.abs(wl - wallOut) > 0.004) body += dim(X(uD), Y(wallOut), X(uD), Y(wl), fmt(SA.sg.off * 1000, 0), 0, 1, on ? 'site.' + f + '.off' : undefined);
    else if (on) body += TB(X(uD), Y(wl) + 12, 'setback 0', { size: 8, fill: 'var(--glass)', edit: 'site.' + f + '.off', anchor: 'middle' });
    if (SA.street) {
      if (SA.sg.curb > 0.05) {
        body += across(-SA.sg.curb, SITE_LOOK.curb, 'curb', 'var(--ink3)');
        grip(-SA.sg.curb, 'site.' + f + '.curb', SA.sg.curb);
        body += dim(X(uD - 0.35), Y(wl), X(uD - 0.35), Y(SA.wAt(-SA.sg.curb, uD - 0.35)), fmt(SA.sg.curb * 1000, 0), 0, 1, on ? 'site.' + f + '.curb' : undefined);
      }
      const al = SA.allowedAt(SA.zb + vMid);
      body += `<g><title>The furthest the by-law lets a shading device reach past the property line at the plan cut’s height</title>${across(-al, SITE_LOOK.limit, 'by-law limit', '#C0442B')}</g>`;
      if (al > 0.004) body += dim(X(uD), Y(wl), X(uD), Y(SA.wAt(-al, uD)), fmt(al * 1000, 0), 0, 1);
    }
  }
  // each vertical device's gap to the wall and projection, on strings beside them
  if (k > 60) {
    const groups = new Map();
    own.filter(b => b.kind === 'v').forEach(b => { if (!groups.has(b.D)) groups.set(b.D, []); groups.get(b.D).push(b); });
    if (groups.size) body += depthStrings({ P: ([a, w]) => [X(a), Y(w)], drop: 1 }, [...groups].map(([D, boxes]) => ({ D, boxes })), m, F.selD);
  }
  // the window's own devices can be picked, each by its outline from above; the picked one is drawn in the glass's colour
  const siteBad = V.site && F.checks && F.sel.unit !== null ? F.checks.badOf(F.sel.f, F.sel.st, F.sel.unit) : null;
  for (const b of own) {
    if (b.sys === undefined) continue;
    const pts = projectBox(b, 1).map(uw);
    planDevHits.push({ pts, i: b.sys, cut: !!sliceBox(b, 1, vMid) });
    if (b.D === F.selD) body += PB(pts, { fill: 'none', stroke: 'var(--glass)', w: 1.5 });
    // past what the site allows, red - while the site's constraints are shown
    if (siteBad && siteBad.has(b.sys)) body += PB(pts, { fill: '#C0442B', op: .3, stroke: '#C0442B', w: 1.2 });
  }
  // the window and its wall across the bay, picked by a click; picked, they show their handles
  if (!blank) {
    const bu = Math.max(m.opening.u1 - m.opening.u0, m.pitch || 0) / 2 + Math.abs(oc), band = [[X(-bu), Y(wallOut)], [X(bu), Y(wallOut)], [X(bu), Y(wallIn)], [X(-bu), Y(wallIn)]];
    planDevHits.push({ pts: band, i: 'win', cut: false });
    if (EDIT) { body += PB(band, { fill: 'none', stroke: 'var(--glass)', w: 1.2, dash: '4 3' }); planPop = { x: X(oc), y: Y(0), kind: 'window' }; }
  }

  // the horizontal profile angle, off the fin that governs it
  const vb = own.filter(b => b.kind === 'v');
  let lines = [];
  if (cur.onFacade && !blank) {
    const tanG = Math.tan(cur.gamma * D2R), keyIdx = cur.gamma >= 0 ? 0 : vb.length - 1;
    const outer = b => {
      const cu = b.c[0], cw = b.c[2], e1 = [b.e1[0], b.e1[2]], e3 = [b.e3[0], b.e3[2]];
      let best = null;
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, c2]) => {
        const u = cu + a * b.h[0] * e1[0] + c2 * b.h[2] * e3[0], w = cw + a * b.h[0] * e1[1] + c2 * b.h[2] * e3[1];
        if (!best || w > best[1]) best = [u, w];
      });
      return best;
    };
    vb.forEach((b, i) => { if (i === keyIdx) return; const [pu, pw] = outer(b); body += LB(X(pu), Y(pw), X(pu + pw * tanG), Y(0), { stroke: 'var(--sun)', w: .7, op: .38 }); });
    // with no fin, the jamb arris at the wall face governs it; a window wall has no jamb
    const jamb = !m.run ? (cur.gamma >= 0 ? m.opening.u0 : m.opening.u1) : 0;
    const [pu, pw] = vb.length ? outer(vb[keyIdx]) : [jamb, wallOut];
    const eu = pu + pw * tanG;
    body += LB(X(pu - 1.3 * tanG), Y(pw + 1.3), X(eu), Y(0), { stroke: 'var(--sun)', w: 1.6 });
    body += LB(X(pu - 0.34 * tanG), Y(pw + 0.34), X(pu), Y(pw), { stroke: 'var(--sun)', w: 1.6, marker: 'url(#ar)' });
    // a handle on the ray: dragged, it swings the sun round in plan
    {
      const gr = cur.gamma * D2R, px = X(pu), py = Y(pw), kx = px - 105 * Math.sin(gr), ky = py + 105 * Math.cos(gr);
      body += LB(px, py, kx, ky, { stroke: 'var(--sun)', w: .8, dash: '2 2', op: .7 });
      body += sunKnob(kx, ky);
      planHandle = { pivot: [px, py], knob: [kx, ky] };
    }
    const a1 = Math.atan2(-cur.sl[2], cur.sl[0]);
    body += arc(X(eu), Y(0), 46, -Math.PI / 2, a1, 'var(--sun)');
    const am = (-Math.PI / 2 + a1) / 2, half = (a1 + Math.PI / 2) / 2, pdir = am - Math.sign(half || 1) * Math.PI / 2,
      pd = Math.max(0, 17 - 56 * Math.abs(Math.sin(half)));
    // gamma = surface azimuth - solar azimuth
    body += TB(X(eu) + 56 * Math.cos(am) + pd * Math.cos(pdir), Y(0) - 56 * Math.sin(am) - pd * Math.sin(pdir) + 3, 'γ ' + fmt(-cur.gamma, 1) + '°', { fill: 'var(--sun)', size: 9.5, anchor: 'middle', edit: 'gamma' });
    // the vertical-element relations: a fin of depth Pd throws a shadow SW = Pd tan|gamma|
    // across the glass, and would need Pd = w / tan|gamma| to shade a width w entirely
    const tg = Math.abs(tanG), Dv = vb.length ? vb[0].D : null;
    const Pd = Dv ? boxHi([vb[0]], 2, 0) - wallOut : null;
    const wGap = vb.length > 1 && vb[1].D === Dv ? Math.abs(vb[1].anchor - vb[0].anchor) : m.winW;
    if (Pd !== null) lines.push('SW = Pd · tan γ = ' + fmt(Pd, 2) + ' × ' + fmt(tg, 2) + ' = ' + fmt(Pd * tg, 2) + ' m');
    if (tg > 1e-3) lines.push('to shade w = ' + fmt(wGap, 2) + ' m now: Pd = w / tan γ = ' + fmt(wGap / tg, 2) + ' m');
    // the beam coming in at the plan cut, ghosted, its edges dotted to where it meets the floor - as the section has it
    if (R && inOpening && cur.sl[1] > 1e-6) {
      const t = vMid / cur.sl[1], du = -cur.sl[0] * t, dw = -cur.sl[2] * t;
      let band = '';
      // each lit run shaded and outlined whole, unless the view leaves the beam unshaded
      const dot = { stroke: 'var(--sun)', w: .9, dash: '4 3', op: .8 };
      if (V.beam !== false) for (const [a, b] of scanLine(m, cur.sl, cur.onFacade, 'u', vMid).filter(r => r[2] && r[1] - r[0] > 0.02)) {
        band += POLY([[X(a), Y(0)], [X(b), Y(0)], [X(b + du), Y(dw)], [X(a + du), Y(dw)]], { fill: 'var(--sun)', op: .16 });
        for (const u of [a, b]) band += L(X(u), Y(0), X(u + du), Y(dw), dot);
        band += L(X(a + du), Y(dw), X(b + du), Y(dw), dot);
      }
      const rx0 = Math.min(X(R.u0), X(R.u1)), ry0 = Math.min(Y(0), Y(R.w0));
      // the whole window's beam as if nothing shaded it, dotted in grey: from its jambs to where its head lands, and the patch it would make
      {
        const grey = { stroke: 'var(--ink3)', w: .8, dash: '2 2.5', op: .9 }, o = m.opening, fl = (u, v) => [u - cur.sl[0] * v / cur.sl[1], -cur.sl[2] * v / cur.sl[1]];
        const q = [fl(o.u0, o.v0), fl(o.u1, o.v0), fl(o.u1, o.v1), fl(o.u0, o.v1)];
        band += POLY(q.map(uw), Object.assign({ fill: 'none' }, grey)) + L(X(o.u0), Y(0), X(q[3][0]), Y(q[3][1]), grey) + L(X(o.u1), Y(0), X(q[2][0]), Y(q[2][1]), grey);
      }
      body += `<defs><clipPath id="planIn"><rect x="${fmt(rx0, 2)}" y="${fmt(ry0, 2)}" width="${fmt(Math.abs(X(R.u1) - X(R.u0)), 2)}" height="${fmt(Math.abs(Y(R.w0) - Y(0)), 2)}"/></clipPath></defs><g clip-path="url(#planIn)">${band}</g>`;
    }
  }
  // how far the sun gets in now
  if (mode === 'now' && study && study.nowGrid && R && study.light !== 'floor') {
    const G = study.nowGrid;
    let far = null;
    if (study.nowAll) far = study.nowAll.far;
    else for (let j = G.nw - 1; j >= 0 && far === null; j--) for (let i = 0; i < G.nu; i++) if (G.v[i * G.nw + j] > 0) { far = G.w1 - (j + 1) * G.dw; break; }
    // how far in is read from the patch itself
  }

  // where the section is cut, shown on this drawing
  const wTop = R ? R.w0 : wallIn - 1;
  // it can be dragged across the window: the section follows
  body += LB(X(S.cutU), Y(wTop), X(S.cutU), Y(fr.window[3]), { stroke: 'var(--glass)', w: .9, dash: '7 3 2 3', op: .85 });
  // its figure at the room's end, away from the sun, on the side its beam does not run to
  {
    const beamRight = -cur.sl[0] > 0, ty = Math.max(Math.min(Y(wTop), Y(fr.window[3])), ay0) + 14;
    body += TB(X(S.cutU) + (beamRight ? -5 : 5), ty, 'section cut ' + mm(S.cutU) + ' ↔', { size: 8, fill: 'var(--glass)', bg: .85, edit: 'cutU', anchor: beamRight ? 'end' : 'start' });
  }
  planCutLine = { x: X(S.cutU), y0: Math.min(Y(wTop), Y(fr.window[3])), y1: Math.max(Y(wTop), Y(fr.window[3])), toU: sx => (sx - X(0)) / k };

  if (k > 60 && vb.length > 1 && vb[1].D === vb[0].D && vb[0].D !== F.selD && Math.abs(vb[1].anchor - vb[0].anchor) > 1e-6) {
    const Q = vb[0].D, qw = boxHi([vb[0]], 2, 0);
    body += dim(X(vb[0].anchor), Y(qw + 0.32), X(vb[1].anchor), Y(qw + 0.32), fmt(Math.abs(vb[1].anchor - vb[0].anchor) * 1000, 0), 0, 1, Q === F.selD ? ek('a.arrSp') : undefined);
  }
  const fillW = !!(m.glz && m.glz.fillW);
  if (!blank && k > 60) body += dim(X(m.opening.u0), Y(wallIn) - 22, X(m.opening.u1), Y(wallIn) - 22, fmt(m.winW * 1000, 0), 0, 1, fillW ? undefined : ek('g.winW'));
  // the glass's set-back from the wall face, here as in the section
  if (!blank && k > 60 && m.reveal > 0.001) body += dim(X(m.opening.u1) + 16, Y(0), X(m.opening.u1) + 16, Y(m.reveal), fmt(m.reveal * 1000, 0), 0, 1, ek('g.reveal'));
  // the jambs pulled apart or together - the window widens about its middle
  if (!blank && EDIT && k > 40) {
    const right = [X(1) - X(0), 0], gy = Y(-0.02) + 8;
    if (!fillW) {
      planGrips.push({ p: [X(m.opening.u1), gy], key: 'g.winW', from: m.winW, dir: right, mul: 2 });
      planGrips.push({ p: [X(m.opening.u0), gy], key: 'g.winW', from: m.winW, dir: [-right[0], 0], mul: 2 });
    }
    // the glass pushed into its wall, or out to its face, from the middle of the window
    planGrips.push({ p: [X(oc), gy], key: 'g.reveal', from: m.reveal, dir: [0, Y(-1) - Y(0)] });
    // the wall's inside face pushed in or out, on the wall beside the window - the framing holds while it is dragged, and centres the wall again after;
    // glass the bay's full width and height leaves no wall in the bay to push
    if (!(fillW && m.glz && m.glz.fillH)) {
      const pier = (m.pitch || 0) / 2 - m.opening.u1, uIn = m.opening.u1 + Math.min(Math.max(pier, 0) / 2, 0.2);
      planGrips.push({ p: [X(uIn), Y(wallIn)], key: 'g.wallT', from: wallOut - wallIn, dir: [0, Y(-1) - Y(0)] });
      body += dim(X(m.opening.u0) - 16, Y(wallOut), X(m.opening.u0) - 16, Y(wallIn), fmt((wallOut - wallIn) * 1000, 0), 0, 1, 'g.wallT');
    }
  }
  // the picked device: its handles, its gumball, its array - a fin's profile and array, a blade's length
  const D = F.selD, mineD = !blank && D ? own.filter(b => b.D === D) : [];
  if (mineD.length && k > 40) {
    const de = deviceEdit({ P: ([a, w]) => [X(a), Y(w)], ax: 'U', drop: 1 }, D, mineD, m, planGrips);
    body += de.svg; planPop = de.pop;
  }
  for (const gp of planGrips) if (!gp.arrow && !gp.rot && !gp.pop && !gp.line) body += gripMark(gp.p[0], gp.p[1]);
  if (!blank && EDIT && k > 60 && Math.abs(oc) > 1e-3) body += TB(X(oc), Y(wallIn) - 36, 'moved ' + fmt(oc * 1000, 0) + ' mm in its bay', { anchor: 'middle', size: 8, fill: 'var(--ink3)', bg: .85 });
  g += `<g clip-path="url(#planClip)">${body}</g>`;
  g += RECT(ax0, ay0, ax1 - ax0, ay1 - ay0, { fill: 'none', stroke: 'var(--rule2)', 'stroke-width': .6 });

  // the words round the sheet
  if (blank) g += T(12, 18, 'no glazing on this storey of the ' + sel.f + ' side', { size: 9.5, fill: 'var(--ink2)' });
  if (legend) {
    const lx = W - 158, ly = 12;
    for (let i = 0; i < 20; i++) g += RECT(lx + i * 6, ly + 4, 6.2, 7, { fill: ramp(i / 19), stroke: 'none' });
    g += T(lx - 4, ly + 10, '0', { size: 8, fill: 'var(--ink3)', anchor: 'end' }) + T(lx + 124, ly + 10, fmt(legend.max, 0) + ' ' + legend.unit, { size: 8, fill: 'var(--ink3)' });
  }
  if (!blank && !inOpening) g += TB(W / 2, ay0 + 14, 'the plan is cut outside the glazing', { anchor: 'middle', size: 9, fill: 'var(--ink3)', bg: .9 });
  if (!blank && F.pick && F.editing) g += T(12, H - 10, F.editing, { size: 8.5, fill: 'var(--glass)' });
  return svg(g, 'Plan of the working storey cut through the glazing, with the direct sun on the floor and the horizontal profile angle');
}
