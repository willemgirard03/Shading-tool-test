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
import { W, H, T, L, POLY, RECT, TB, CIRCLE, dim, arc, tickLine, defsCommon, svg, sunKnob } from './svg.js';
import { sheetCam } from './sheetcam.js';
import { PLAN_LIGHT_WORDS } from '../geometry/floorsun.js';

export const INTERIOR_MODES = { now: 'This instant', day: 'Over the day', year: 'Over the year' };

/* the floor's ramp: bare floor to the amber used for sun everywhere else */
const FLOOR = '#E4DFD4';
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

export function drawPlan(F, study) {
  const { S, V, m, cur, sel } = F;
  planHandle = null;
  const M = { l: 30, r: 30, t: 48, b: 58 };
  const blank = !m.opening, own = m.own || [], vMid = S.cutV;
  const fr = planFrames(F, study), cam = V.plancam, SC = sheetCam(fr.window, M, cam, [0, 0]);
  const k = SC.k, X = SC.X, Y = SC.Y, uw = ([u, w]) => [X(u), Y(w)];
  const [ax0, ay0, ax1, ay1] = SC.area;
  // what lies wholly off the sheet is left out, so a zoomed-in floor stays light
  const off = pts => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < ax0 - 20 || x0 > ax1 + 20 || y1 < ay0 - 20 || y0 > ay1 + 20; };
  const PB = (pts, o) => off(pts) ? '' : POLY(pts, o);
  const RB = (x, y, w, h, o) => off([[x, y], [x + w, y + h]]) ? '' : RECT(x, y, w, h, o);
  const LB = (x0, y0, x1, y1, o) => off([[x0, y0], [x1, y1]]) ? '' : L(x0, y0, x1, y1, o);
  const wallOut = m.reveal || 0, wallIn = m.wIn ?? -0.3;
  const inOpening = !blank && vMid > m.opening.v0 && vMid < m.opening.v1;
  const halfW = blank ? 1.5 : Math.max(Math.abs(m.opening.u0), Math.abs(m.opening.u1)), oc = blank ? 0 : (m.opening.u0 + m.opening.u1) / 2;
  let g = defsCommon + `<defs><clipPath id="planClip"><rect x="${ax0}" y="${ay0}" width="${ax1 - ax0}" height="${ay1 - ay0}"/></clipPath></defs>`;
  let body = '';

  // the floor of the whole storey
  const pc = plateCorners(F);
  body += PB(pc.map(uw), { fill: FLOOR, stroke: 'none' });

  // the direct sun on it, through the selected window
  const mode = V.inMode, R = study && study.R;
  let legend = null, headline = '';
  if (!blank && study) {
    if (mode === 'now') {
      // through every window the results are for, or through the selected one
      if (study.nowAll) for (const p of study.nowAll.patches) {
        body += PB(p.lit.map(uw), { fill: 'var(--sun)', op: .9 });
        for (const sh of p.shade) body += PB(sh.map(uw), { fill: FLOOR });
      } else if (cur.onFacade) for (const p of sunPatches(m, R, cur.sl)) {
        if (p.S.key !== 'floor') continue;
        body += PB(p.lit.map(uw), { fill: 'var(--sun)', op: .9 });
        for (const sh of p.shade) body += PB(sh.map(uw), { fill: FLOOR });
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

  // distance in from the selected facade, a line every metre or two
  if (R) {
    const deep = R.w1 - R.w0, every = deep > 14 ? 2 : 1;
    for (let d = every; d < deep; d += every) {
      body += LB(X(R.u0), Y(R.w1 - d), X(R.u1), Y(R.w1 - d), { stroke: 'var(--ink3)', w: .4, op: .3, dash: '2 3' });
      const lx = clamp(X(Math.min(R.u1, halfW + 0.6)), ax0 + 4, ax1 - 24);
      if (Y(R.w1 - d) > ay0 + 6 && Y(R.w1 - d) < ay1 - 4) body += T(lx + 3, Y(R.w1 - d) + 3, d + ' m', { size: 7.5, fill: 'var(--ink3)', op: .8 });
    }
  }

  // every side of the storey as the cut meets it: walls, glass, and the devices over
  const parts = storeyParts(F);
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
    if (c) body += PB(c.map(uw), { fill: b.kind === 'v' ? (fnt ? 'var(--shade)' : 'var(--poche)') : 'url(#shp)', stroke: fnt ? 'var(--ink3)' : 'var(--ink)', w: .7 });
    else if (b.kind === 'v') body += PB(projectBox(b, 1).map(uw), { fill: 'none', stroke: 'var(--ink3)', w: .7, dash: '2 2.4', op: fnt ? .45 : .85 });
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
    // the way the beam runs across the floor
    const d = [-cur.sl[0], -cur.sl[2]], len = Math.hypot(d[0], d[1]);
    if (len > 1e-6 && R) {
      const s = Math.min(1.4, (R.w1 - R.w0) * 0.25) / len, a = [(m.opening.u0 + m.opening.u1) / 2, -0.15];
      body += LB(X(a[0]), Y(a[1]), X(a[0] + d[0] * s), Y(a[1] + d[1] * s), { stroke: 'var(--sun)', w: 1.3, marker: 'url(#ar)' });
    }
  }
  // how far the sun gets in now
  if (mode === 'now' && study && study.nowGrid && R && study.light !== 'floor') {
    const G = study.nowGrid;
    let far = null;
    if (study.nowAll) far = study.nowAll.far;
    else for (let j = G.nw - 1; j >= 0 && far === null; j--) for (let i = 0; i < G.nu; i++) if (G.v[i * G.nw + j] > 0) { far = G.w1 - (j + 1) * G.dw; break; }
    if (far !== null) {
      const xa = X(Math.max(R.u0, -halfW - 0.8));
      body += tickLine(xa, Y(R.w1), xa, Y(far), { stroke: 'var(--sun)', w: 1.2 });
      // the figure stays on the sheet however far in the sun gets
      body += TB(xa - 4, clamp(Y(far) - 4, ay0 + 12, ay1 - 4), fmt(R.w1 - far, 1) + ' m in', { size: 8.5, fill: 'var(--sun)', bg: .9, anchor: 'end' });
    }
  }

  // where the section is cut, shown on this drawing
  const wTop = R ? R.w0 : wallIn - 1;
  // it can be dragged across the window: the section follows
  body += LB(X(S.cutU), Y(wTop), X(S.cutU), Y(fr.window[3]), { stroke: 'var(--glass)', w: .9, dash: '7 3 2 3', op: .85 });
  body += TB(X(S.cutU) + 5, Y(fr.window[3]) - 5, 'section cut ' + fmt(S.cutU, 2) + ' m ↔', { size: 8, fill: 'var(--glass)', bg: .85, edit: 'cutU' });
  planCutLine = { x: X(S.cutU), y0: Math.min(Y(wTop), Y(fr.window[3])), y1: Math.max(Y(wTop), Y(fr.window[3])), toU: sx => (sx - X(0)) / k };

  if (k > 60 && vb.length > 1 && vb[1].D === vb[0].D && Math.abs(vb[1].anchor - vb[0].anchor) > 1e-6) {
    const Q = vb[0].D, qw = boxHi([vb[0]], 2, 0);
    body += dim(X(vb[0].anchor), Y(qw + 0.32), X(vb[1].anchor), Y(qw + 0.32), fmt(Math.abs(vb[1].anchor - vb[0].anchor) * 1000, 0), 0, 1);
    const w0 = m.reveal + Q.offset;
    body += dim(X(vb[0].anchor), Y(w0), X(vb[0].anchor), Y(w0 + Q.depth * Math.cos(Q.angle * D2R)), fmt(Q.depth * 1000, 0), -30, 1);
  }
  if (!blank && k > 60) body += dim(X(m.opening.u0), Y(wallIn) - 22, X(m.opening.u1), Y(wallIn) - 22, fmt(m.winW * 1000, 0), 0, 1);
  if (!blank && k > 60 && Math.abs(oc) > 1e-3) body += TB(X(oc), Y(wallIn) - 36, 'moved ' + fmt(oc * 1000, 0) + ' mm in its bay', { anchor: 'middle', size: 8, fill: 'var(--ink3)', bg: .85 });
  g += `<g clip-path="url(#planClip)">${body}</g>`;
  g += RECT(ax0, ay0, ax1 - ax0, ay1 - ay0, { fill: 'none', stroke: 'var(--rule2)', 'stroke-width': .6 });

  // the words round the sheet
  g += T(12, 18, blank ? 'no glazing on this storey of the ' + sel.f + ' side' : INTERIOR_MODES[mode] + ' · ' + headline, { size: 9.5, fill: 'var(--ink2)' });
  if (study && study.light && study.light !== 'unit') g += T(12, 31, 'the sun through ' + PLAN_LIGHT_WORDS[study.light] + (mode === 'now' && study.nowAll ? ' · ' + study.nowAll.n + ' lit now' : ''), { size: 8.5, fill: 'var(--ink3)' });
  else if (mode === 'now' && study && study.land && study.land.total > 0) {
    const parts2 = Object.entries(study.land.by).sort((a, b) => b[1] - a[1]).map(([kk, v]) => fmt(v, 0) + ' W on ' + SURFACE_NAMES[kk]);
    g += T(12, 31, parts2.join(' · '), { size: 8.5, fill: 'var(--ink3)' });
  } else if (!blank && !vb.length) g += T(12, 31, hb.length ? 'horizontal device over, dashed — see section' : 'no vertical device', { size: 8.5, fill: 'var(--ink3)' });
  if (legend) {
    const lx = W - 158, ly = 12;
    for (let i = 0; i < 20; i++) g += RECT(lx + i * 6, ly + 4, 6.2, 7, { fill: ramp(i / 19), stroke: 'none' });
    g += T(lx - 4, ly + 10, '0', { size: 8, fill: 'var(--ink3)', anchor: 'end' }) + T(lx + 124, ly + 10, fmt(legend.max, 0) + ' ' + legend.unit, { size: 8, fill: 'var(--ink3)' });
  }
  lines.forEach((t, i) => { g += TB(14, H - 40 + i * 12, t, { size: 8.5, fill: 'var(--glass)', bg: .92 }); });
  if (!blank && !inOpening) g += TB(W / 2, ay0 + 14, 'the plan is cut outside the glazing', { anchor: 'middle', size: 9, fill: 'var(--ink3)', bg: .9 });
  g += T(W - 12, H - 14, 'cut at ' + fmt(vMid, 2) + ' m' + (Math.abs(cam.zoom - 1) > 0.01 ? ' · ×' + fmt(cam.zoom, 2) : '') + ' · wheel to zoom out to the floor, drag to pan',
    { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  return svg(g, 'Plan of the working storey cut through the glazing, with the direct sun on the floor and the horizontal profile angle');
}
