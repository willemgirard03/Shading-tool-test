/* The sun-path chart, cartesian: x is the solar bearing from due south (east
   negative), y is altitude. The shading mask is painted as cells on the same
   pair of axes, so the sky a device blocks is read straight against the hours
   the sun actually occupies. Altitude is exaggerated so the low winter arcs stay
   legible; the factor is printed under the frame.

   Everything except the sun, the arc already travelled and the clock marker is
   fixed for a given date, facade and device, so it is built once and cached -
   the chart is redrawn every frame while the day is playing.                */

import { clamp, fmt, wrap180, dateLabel, hhmm } from '../util.js';
import { solarPosition, CLOCK_NAME, sunriseSunsetSolar, solarToClock } from '../solar.js';
import { facadeWWR, SCOPES, FACADES } from '../geometry/building.js';
/** glazed over opaque for every side a multi-side target takes in, storey or building */
function multiWWR(B, TG) {
  let wall = 0, glass = 0;
  for (const f of Object.keys(FACADES)) B.facades[f].rows.forEach(r => {
    if (TG.scope === 'level' && r.st !== B.S.sel.st) return;
    wall += B.facades[f].len * r.h;
    for (const q of r.units) glass += q.cell.winW * q.cell.winH;
  });
  return wall > 0 ? glass / wall : 0;
}
import { litSpans, limitAtNormal } from '../geometry/analysis.js';
import { ALT_MAX, getMask, getEnvelopes, getDaySamples, getDaySpan } from '../studies.js';
import { hourly } from '../weather.js';
import { W, H, El, T, L, POLY, PATH, RECT, CIRCLE, TB, defsCommon, svg } from './svg.js';

const PATH_DOYS = [355, 21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325];
const NOON_LABELS = { 172: '21 Jun', 264: '21 Sep', 355: '21 Dec' };
export const bearing = az => wrap180(az - 180);

/** chart geometry: V1's 135 deg either side of south, widened to a full
 *  hemisphere when the facade looks far enough north to fall off it, or when
 *  more than one side is analysed and every bearing matters */
export function sunGeom(gf, wide = false) {
  // the chart takes the sheet's height, less the day strip under it
  const X0 = 46, X1 = W - 18, Y0 = 48, Y1 = Math.max(Y0 + 120, H - 72);
  const fb = bearing(gf);
  const AZ1 = wide || Math.abs(fb) + 90 > 135 ? 180 : 135, AZ0 = -AZ1;
  return {
    X0, X1, Y0, Y1, AZ0, AZ1, fb, gf,
    px: a => X0 + (a - AZ0) / (AZ1 - AZ0) * (X1 - X0),
    py: e => Y1 - clamp(e, 0, ALT_MAX) / ALT_MAX * (Y1 - Y0),
    exag: ((Y1 - Y0) / ALT_MAX) / ((X1 - X0) / (AZ1 - AZ0)),
    TY: Y1 + 44
  };
}

/* The day strip under the chart is laid on the chart's own axis: each moment
   sits under the bearing the sun has then, so the strip stretches from the
   sunrise bearing to the sunset bearing and shortens toward winter. At this
   latitude the bearing only ever increases through a day, so the mapping runs
   both ways - the clock can be scrubbed along it. */
let strip = { key: '', v: null };
export function dayStrip(G, doy, mode) {
  const key = doy + '|' + mode + '|' + G.AZ0 + '|' + G.X0 + ',' + G.X1;
  if (strip.key === key) return strip.v;
  const ss = sunriseSunsetSolar(doy);
  let v = null;
  if (ss) {
    const t0 = solarToClock(ss[0], doy, mode), t1 = solarToClock(ss[1], doy, mode), pts = [];
    for (let i = 0; i <= 240; i++) {
      const t = t0 + (t1 - t0) * i / 240, b = bearing(solarPosition(doy, t, mode).az);
      pts.push([t, G.px(clamp(b, G.AZ0, G.AZ1))]);
    }
    for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
    const lerp = (x, i, j) => { const a = pts[i - 1], b = pts[i]; const s = (x - a[j]) / ((b[j] - a[j]) || 1e-9); return a[1 - j] + (b[1 - j] - a[1 - j]) * s; };
    const find = (x, j) => { let i = 1; while (i < pts.length - 1 && pts[i][j] < x) i++; return i; };
    v = { t0, t1, x0: pts[0][1], x1: pts[pts.length - 1][1],
      x: t => t <= t0 ? pts[0][1] : t >= t1 ? pts[pts.length - 1][1] : lerp(t, find(t, 0), 0),
      t: x => x <= pts[0][1] ? t0 : x >= pts[pts.length - 1][1] ? t1 : lerp(x, find(x, 1), 1) };
  }
  strip = { key, v };
  return v;
}
/** a wrapped bearing interval clipped to the chart, as 0-2 segments */
function bandSegs(c, half, AZ0, AZ1) {
  const segs = [];
  for (const k of [-360, 0, 360]) {
    const lo = Math.max(c - half + k, AZ0), hi = Math.min(c + half + k, AZ1);
    if (hi > lo + 1e-9) segs.push([lo, hi]);
  }
  return segs;
}
function dayArc(G, doy, mode, t0, t1, step, o) {
  let pts = [], up = false;
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const sp = solarPosition(doy, t, mode), b = bearing(sp.az);
    if (sp.alt < 0 || b < G.AZ0 || b > G.AZ1) { up = false; continue; }
    pts.push((up ? 'L' : 'M') + fmt(G.px(b), 2) + ',' + fmt(G.py(sp.alt), 2)); up = true;
  }
  return pts.length ? PATH(pts.join(' '), o) : '';
}
/** the stretches of a sampled day that are (or are not) reaching the glass */
function litRuns(G, samples, want, o) {
  let d = '', open = false;
  for (const p of samples) {
    const b = bearing(p.az);
    if (!!p.lit !== want || b < G.AZ0 || b > G.AZ1) { open = false; continue; }
    d += (open ? 'L' : 'M') + fmt(G.px(b), 2) + ',' + fmt(G.py(p.alt), 2) + ' ';
    open = true;
  }
  return d ? PATH(d.trim(), o) : '';
}

/* The mask ramp runs from the amber used for sun everywhere else to the slate
   the facade's own back reads as, so warmth tracks how much beam is still
   getting through rather than being a second, unrelated code. */
export const SHADE_MAX = 0.80;
const SHADE_STEPS = 12;
const doy21 = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];
/** Climate Consultant's three bands: cool below 20 C, comfortable to 27, warm above */
export const TEMP_BANDS = [[20, '#4A6FA5', 'below 20 °C'], [27, '#D9A625', '20–27 °C'], [99, '#C0442B', 'above 27 °C']];
/** the days of the year the weather dots are drawn for */
export const DOT_SPANS = { year: 'The whole year', half: 'Half the year, the date’s half', off: 'Off' };
function dotSpan(mode, doy) {
  if (mode === 'off' || mode === false) return null;
  const set = new Set();
  if (mode === 'year') { for (let d = 1; d <= 365; d++) set.add(d); return set; }
  // the solstices split the year into two halves that retrace the same sky
  const rising = doy >= 355 || doy < 172;
  for (let d = 1; d <= 365; d++) if ((d >= 355 || d < 172) === rising) set.add(d);
  return set;
}
const SHADE_WARM = [217, 130, 26], SHADE_DARK = [36, 50, 48];
export const shadeColour = t => {
  const k = Math.pow(clamp(t, 0, 1), 0.8);
  return 'rgb(' + SHADE_WARM.map((c, i) => Math.round(c + (SHADE_DARK[i] - c) * k)).join(',') + ')';
};

/* The sky the sun actually occupies here over a year: bounded above by the June
   arc and below by the December one. For a fixed bearing the altitude is
   monotone in declination, so that band is exactly the set of positions the sun
   ever takes at this latitude. Outside it the mask and the limits are still
   true - they describe the device in sky that can never deliver a beam here -
   so they are washed back rather than removed. */
let REACH = null;
function reachArcs() {
  if (REACH) return REACH;
  const sample = doy => {
    const out = [];
    for (let t = 0; t <= 24.001; t += 0.04) {
      const sp = solarPosition(doy, t, 'sol');
      if (sp.alt >= 0) out.push([bearing(sp.az), sp.alt]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  };
  return (REACH = { jun: sample(172), dec: sample(355) });
}
const arcAt = (arr, b) => {
  if (!arr.length || b < arr[0][0] || b > arr[arr.length - 1][0]) return null;
  let i = 1;
  while (i < arr.length - 1 && arr[i][0] < b) i++;
  const [b0, a0] = arr[i - 1], [b1, a1] = arr[i];
  return b1 === b0 ? a0 : a0 + (a1 - a0) * (b - b0) / (b1 - b0);
};
/** the lit band as chart paths: its top out and its bottom back, one closed run
 *  per unbroken stretch of sky */
function envRuns(G, cols) {
  const { AZ0, AZ1, px, py } = G;
  const shift = b => { for (const k of [0, -360, 360]) if (b + k >= AZ0 - 1e-9 && b + k <= AZ1 + 1e-9) return b + k; return null; };
  const out = []; let run = [];
  const flush = () => {
    if (run.length > 1) {
      const top = run.map((c, i) => (i ? 'L' : 'M') + fmt(px(c.b), 2) + ',' + fmt(py(c.hi), 2));
      const bot = run.slice().reverse().map(c => 'L' + fmt(px(c.b), 2) + ',' + fmt(py(c.lo), 2));
      out.push(top.concat(bot).join(' ') + ' Z');
    }
    run = [];
  };
  cols.forEach(c => {
    const b = c.lo === null ? null : shift(bearing(c.az));
    if (b === null) { flush(); return; }
    run.push({ b, lo: c.lo, hi: c.hi });
  });
  flush();
  return out;
}

let cache = { key: '', svg: '', ds: null, lit: [] };
function backdrop(F, G) {
  const { S, V, m, B, sel } = F, TG = F.T, doy = S.doy, fast = V.sunFast;
  const mask = fast ? null : getMask(TG), env = fast ? null : getEnvelopes(TG);
  const key = [TG.key || '-', TG.gf, S.timeMode, doy, mask ? mask.key : '-', env ? env.key : '-', m.key, S.storeys.map(s => [s.w, s.d, s.ox || 0, s.oy || 0].join('x')).join(','), S.wx, V.dots, W, H].join('|');
  if (!fast && cache.key === key) return cache;
  const { X0, X1, Y0, Y1, AZ0, AZ1, fb, gf, px, py, TY } = G;
  let g = defsCommon;

  // the plot field: white is full sun on the glazing
  g += RECT(X0, Y0, X1 - X0, Y1 - Y0, { fill: 'var(--panel)', stroke: 'none' });
  // sky the facade cannot see at all, |gamma| > 90: full shadow, whatever the device
  const seen = bandSegs(fb, 90, AZ0, AZ1).sort((a, b) => a[0] - b[0]);
  const blind = []; let xw = AZ0;
  seen.forEach(([a, b]) => { if (a > xw + 1e-9) blind.push([xw, a]); xw = Math.max(xw, b); });
  if (xw < AZ1 - 1e-9) blind.push([xw, AZ1]);
  // round more than one side, the mask itself says which sky is behind them all
  if (!TG.multi) blind.forEach(([a, b]) => { g += RECT(px(a), Y0, px(b) - px(a), Y1 - Y0, { fill: 'var(--poche)', opacity: SHADE_MAX }); });

  // the mask, cell by cell, banded so the fill is a dozen paths
  if (mask) {
    const { az0, dAz, nAz, dAlt, nAlt, cells } = mask;
    const bins = new Array(SHADE_STEPS + 1).fill('');
    for (let i = 0; i < nAz; i++) {
      const segs = bandSegs(bearing(az0 + (i + 0.5) * dAz), dAz / 2, AZ0, AZ1);
      if (!segs.length) continue;
      for (let j = 0; j < nAlt; j++) {
        const q = Math.round(cells[i * nAlt + j] * SHADE_STEPS);
        if (q < 1) continue;
        const b0 = j * dAlt, b1 = Math.min((j + 1) * dAlt, ALT_MAX);
        if (b0 >= ALT_MAX) break;
        segs.forEach(([a, b]) => {
          bins[q] += 'M' + fmt(px(a), 1) + ',' + fmt(py(b1), 1) + 'H' + fmt(px(b), 1) + 'V' + fmt(py(b0), 1) + 'H' + fmt(px(a), 1) + 'Z';
        });
      }
    }
    let tiles = '';
    for (let q = 1; q <= SHADE_STEPS; q++) if (bins[q])
      tiles += PATH(bins[q], { fill: shadeColour(q / SHADE_STEPS), stroke: 'none', op: (SHADE_MAX * q / SHADE_STEPS).toFixed(3) });
    g += El('g', { 'shape-rendering': 'crispEdges' }, tiles);
  }

  // the limit a protractor would draw for the same device (fine, dashed), and
  // the limit the device as built sets (heavy)
  let limits = '';
  if (env) {
    envRuns(G, env.ideal).forEach(d => {
      limits += PATH(d, { stroke: 'var(--panel)', w: 3, op: .8 });
      limits += PATH(d, { stroke: 'var(--glass)', w: 1.1, dash: '5 3' });
    });
    envRuns(G, env.real).forEach(d => {
      limits += PATH(d, { stroke: 'var(--panel)', w: 3.4, op: .85 });
      limits += PATH(d, { stroke: 'var(--ink)', w: 1.7 });
    });
  }
  g += limits;

  // the sky the sun never occupies here, washed back
  {
    const { jun, dec } = reachArcs();
    const top = jun.filter(([b]) => b >= AZ0 - 1e-9 && b <= AZ1 + 1e-9);
    if (top.length > 1) {
      const band = top.map(([b, a]) => [b, Math.min(a, ALT_MAX)]);
      for (let i = top.length - 1; i >= 0; i--) { const b = top[i][0], d = arcAt(dec, b); band.push([b, d === null ? 0 : d]); }
      const outer = 'M' + fmt(X0, 1) + ',' + fmt(Y0, 1) + 'H' + fmt(X1, 1) + 'V' + fmt(Y1, 1) + 'H' + fmt(X0, 1) + 'Z ';
      const inner = band.map((q, i) => (i ? 'L' : 'M') + fmt(px(q[0]), 1) + ',' + fmt(py(q[1]), 1)).join(' ') + ' Z';
      g += El('path', { d: outer + inner, 'fill-rule': 'evenodd', fill: 'var(--panel)', opacity: .62, stroke: 'none' });
      // the limits belong to the device, not the sun: inside the sun's band
      // they are laid down again at full weight
      if (limits) {
        g += El('defs', {}, El('clipPath', { id: 'sunReach' }, El('path', { d: inner })));
        g += El('g', { 'clip-path': 'url(#sunReach)' }, limits);
      }
    }
  }

  // graticule and axes
  for (let a = AZ0; a <= AZ1; a += 15)
    g += L(px(a), Y0, px(a), Y1, { stroke: 'var(--rule)', w: a % 45 === 0 ? .7 : .4, op: a % 45 === 0 ? .9 : .55 });
  for (let e = 0; e <= 70; e += 10)
    g += L(X0, py(e), X1, py(e), { stroke: 'var(--rule)', w: e % 30 === 0 ? .7 : .4, op: e % 30 === 0 ? .9 : .55 });
  g += L(px(0), Y0, px(0), Y1, { stroke: 'var(--ink3)', w: .8, dash: '4 3' });
  g += RECT(X0, Y0, X1 - X0, Y1 - Y0, { fill: 'none', stroke: 'var(--ink2)', 'stroke-width': 1 });
  for (let e = 10; e <= 70; e += 20) g += T(X0 - 6, py(e) + 3.2, e + '°', { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  // lettered every 30 degrees from south, whichever width the chart is
  for (let a = -150; a <= 150; a += 30) {
    if (a === 0 || a <= AZ0 || a >= AZ1) continue;
    g += T(px(a), Y1 + 13, Math.abs(a) + '°' + (a < 0 ? 'E' : 'W'), { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  }
  g += T(px(0), Y1 + 13, 'S', { anchor: 'middle', size: 9.5, fill: 'var(--ink)' });
  g += T(X0, Y0 - 24, 'Solar bearing from due south × altitude', { size: 10.5, fill: 'var(--ink2)', mono: false });
  g += T(X0, Y0 - 11, 'white: the whole opening in sun · darker: more of it shaded · solid: none of it lit', { size: 8.5, fill: 'var(--ink3)', mono: false });
  g += T(X1, Y0 - 24, 'drag sun, strip or bearing', { anchor: 'end', size: 8.5, fill: 'var(--glass)' });
  g += T(X0 - 6, Y0 - 3, 'alt', { anchor: 'end', size: 8, fill: 'var(--ink3)' });

  // hour lines through the year, on the selected clock
  for (let h = 4; h <= 20; h++) {
    let pts = [], up = false, peak = null;
    for (let d = 1; d <= 365; d += 3) {
      const sp = solarPosition(d, h, S.timeMode), b = bearing(sp.az);
      if (sp.alt < 0.5 || b < AZ0 || b > AZ1) { up = false; continue; }
      const p = [px(b), py(sp.alt)];
      pts.push((up ? 'L' : 'M') + fmt(p[0], 2) + ',' + fmt(p[1], 2)); up = true;
      if (!peak || sp.alt > peak[2]) peak = [p[0], p[1], sp.alt];
    }
    if (!pts.length) continue;
    g += PATH(pts.join(' '), { stroke: 'var(--panel)', w: 1.6, op: .3 });
    g += PATH(pts.join(' '), { stroke: 'var(--ink3)', w: .55, dash: '3 2.5', op: .95 });
    // noon is marked by the south axis already, and its label would land on the sun
    if (peak && h % 2 === 0 && h !== 12) g += TB(peak[0], peak[1] - 5, h + 'h', { anchor: 'middle', size: 7.5, fill: 'var(--ink3)', bg: .8 });
  }

  // monthly arcs, then the selected day on top
  PATH_DOYS.forEach(d => {
    if (d === doy) return;
    const key2 = NOON_LABELS[d] !== undefined;
    g += dayArc(G, d, 'sol', 2, 22, 0.1, { stroke: 'var(--panel)', w: key2 ? 3.2 : 2.2, op: .8 });
    g += dayArc(G, d, 'sol', 2, 22, 0.1, { stroke: key2 ? 'var(--ink2)' : 'var(--ink3)', w: key2 ? 1.1 : .7, op: key2 ? .95 : .6 });
  });
  Object.keys(NOON_LABELS).forEach(k => {          // named at the eastern end, clear of the noon apex
    for (let t = 2; t <= 12; t += 0.05) {
      const sp = solarPosition(+k, t, 'sol'), b = bearing(sp.az);
      if (sp.alt <= 1 || b < AZ0 + 20) continue;
      g += TB(px(b) + 5, py(sp.alt) - 5, NOON_LABELS[k], { size: 8, fill: 'var(--ink2)', bg: .88 });
      return;
    }
  });
  // the weather: a dot for every daylit hour in the weather file, where the
  // sun stood at that hour, coloured by the dry-bulb temperature recorded for
  // it - sun wanted where it is cool, shade where it is warm. The sun covers
  // the same sky twice a year, so by default only the half of the year the
  // selected date is in is shown, and the two halves do not hide each other.
  const dots = dotSpan(V.dots, doy);
  if (dots) {
    const db = hourly(S.wx).db, runs = { 0: '', 1: '', 2: '' };
    for (let d = 1; d <= 365; d++) {
      if (!dots.has(d)) continue;
      for (let h = 0; h < 24; h++) {
        const sp = solarPosition(d, h + 0.5, 'lst');
        if (sp.alt < 0.5) continue;
        const b = bearing(sp.az);
        if (b < AZ0 || b > AZ1) continue;
        const t = db[(d - 1) * 24 + h] / 10, band = t < TEMP_BANDS[0][0] ? 0 : t < TEMP_BANDS[1][0] ? 1 : 2;
        runs[band] += 'M' + fmt(px(b), 1) + ',' + fmt(py(sp.alt), 1) + 'h0';
      }
    }
    // each band as one path of zero-length strokes with round caps: thousands of dots, three elements
    for (const k of [0, 1, 2]) if (runs[k]) g += El('path', { d: runs[k], stroke: TEMP_BANDS[k][1], 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: .8, fill: 'none' });
  }
  const lit = getDaySamples(TG, doy, S.timeMode);
  g += litRuns(G, lit, false, { stroke: 'var(--poche)', w: 4.2, op: .35 });
  g += litRuns(G, lit, false, { stroke: 'var(--panel)', w: 1.4, dash: '1.6 2.4', op: .95 });
  g += litRuns(G, lit, true, { stroke: 'var(--panel)', w: 4.6, op: .95 });
  g += litRuns(G, lit, true, { stroke: 'var(--poche)', w: 2 });

  // the edges of the sky this facade can see, gamma = +/-90
  if (!TG.multi) bandSegs(fb, 90, AZ0, AZ1).forEach(seg => seg.forEach(e => {
    const d = wrap180(e - fb);
    if (Math.abs(Math.abs(d) - 90) > 1) return;     // an edge cut by the chart is not the real limit
    g += L(px(e), Y0, px(e), Y1, { stroke: 'var(--glass)', w: .8, dash: '2 3', op: .8 });
    g += TB(px(e) + (d < 0 ? 4 : -4), Y0 + 11, 'γ ' + (d < 0 ? '−' : '+') + '90°',
      { anchor: d < 0 ? 'start' : 'end', size: 8, fill: 'var(--glass)', bg: .88 });
  }));
  // the facade normal, and the handle that turns the building
  g += L(px(fb), Y0, px(fb), Y1, { stroke: 'var(--glass)', w: 1.2, dash: '6 4' });
  g += POLY([[px(fb), Y1], [px(fb) - 7, Y1 + 11], [px(fb) + 7, Y1 + 11]], { fill: 'var(--glass)' });
  g += RECT(px(fb) - 7, Y1 + 11, 14, 5, { rx: 1.5, fill: 'var(--glass)' });
  const anch = px(fb) > X1 - 90 ? 'end' : 'start';
  g += TB(px(fb) + (anch === 'end' ? -7 : 7), Y1 - 34, 'facade normal ' + fmt(gf, 0) + '°', { anchor: anch, size: 8.5, fill: 'var(--glass)', bg: .9 });

  // the day on a strip laid on the chart's axis, so the clock runs under the sun
  const ds = getDaySpan(TG, doy, S.timeMode), spans = litSpans(lit), st = dayStrip(G, doy, S.timeMode);
  g += T(X0, TY - 14, 'The selected day, ' + CLOCK_NAME[S.timeMode] + ' clock, under the sun’s bearing', { size: 9.5, fill: 'var(--ink2)', mono: false });
  if (st) {
    const sx = t => st.x(t), bar = (t0, t1, o) => RECT(sx(t0), TY, Math.max(1, sx(t1) - sx(t0)), 13, o);
    g += RECT(st.x0, TY, st.x1 - st.x0, 13, { fill: 'var(--sunsoft)', stroke: 'var(--rule)', 'stroke-width': .7 });
    ds.on.forEach(([t0, t1]) => { g += bar(t0, t1, { fill: 'var(--sun)', opacity: .26 }); });
    spans.forEach(([t0, t1]) => { g += bar(t0, t1, { fill: 'var(--sun)', opacity: .62 }); });
    // an hour every tick; lettered as often as they have room
    const hrs = [];
    for (let h = Math.ceil(st.t0); h <= Math.floor(st.t1); h++) hrs.push(h);
    let lastX = -1e9;
    hrs.forEach(h => {
      const x = sx(h);
      g += L(x, TY + 13, x, TY + 17, { stroke: 'var(--ink3)', w: .6 });
      if (x - lastX >= 17) { g += T(x, TY + 26, String(h), { anchor: 'middle', size: 8, fill: 'var(--ink3)' }); lastX = x; }
    });
    g += T(st.x0 - 4, TY + 10, hhmm(ds.rise), { anchor: 'end', size: 7.5, fill: 'var(--ink3)' });
    g += T(st.x1 + 4, TY + 10, hhmm(ds.set), { size: 7.5, fill: 'var(--ink3)' });
  } else g += T(X0, TY + 10, 'the sun does not rise', { size: 8.5, fill: 'var(--ink3)' });
  g += T(X1, TY - 14, ds.rise === null ? 'no sunrise' : 'rise ' + hhmm(ds.rise) + '  set ' + hhmm(ds.set), { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  cache = { key: fast ? '' : key, svg: g, ds, lit };
  return cache;
}

export function drawSunPath(F) {
  const { S, cur, m } = F;
  const G = sunGeom(m.gf, F.T.multi);
  const { X0, X1, Y0, Y1, AZ0, AZ1, px, py, TY } = G;
  const back = backdrop(F, G), ds = back.ds;
  let g = back.svg;
  // the arc already travelled, and the hours along it
  if (ds.rise !== null) {
    const past = back.lit.filter(p => p.t <= S.hour);
    g += litRuns(G, past, false, { stroke: 'var(--sun)', w: 1.7, dash: '1.6 2.4', op: .85 });
    g += litRuns(G, past, true, { stroke: 'var(--panel)', w: 4.6, op: .9 });
    g += litRuns(G, past, true, { stroke: 'var(--sun)', w: 2.6, op: 1 });
    for (let h = Math.ceil(ds.rise); h <= Math.floor(ds.set); h++) {
      const sp = solarPosition(S.doy, h, S.timeMode), b = bearing(sp.az);
      if (sp.alt < 0 || b < AZ0 || b > AZ1) continue;
      g += CIRCLE(px(b), py(sp.alt), 1.9, { fill: h <= S.hour ? 'var(--sun)' : 'var(--poche)', stroke: 'var(--panel)', 'stroke-width': .8 });
    }
  }
  // the sun now
  if (cur.up && bearing(cur.az) >= AZ0 && bearing(cur.az) <= AZ1) {
    const x = px(bearing(cur.az)), y = py(cur.alt);
    g += L(x, Y1, x, y, { stroke: 'var(--sun)', w: .8, op: .45, dash: '3 3' });
    g += CIRCLE(x, y, 9.5, { fill: 'var(--sun)', opacity: .18 });
    g += CIRCLE(x, y, 5.5, { fill: 'var(--sun)', stroke: 'var(--panel)', 'stroke-width': 1.6 });
    const above = y - 13 > Y0 + 6;
    g += TB(x, above ? y - 13 : y + 20, fmt(cur.alt, 1) + '° / ' + fmt(cur.az, 1) + '°', { anchor: 'middle', size: 8.5, fill: 'var(--sun)', bg: .9 });
  } else {
    g += TB((X0 + X1) / 2, (Y0 + Y1) / 2, 'sun below the horizon', { anchor: 'middle', size: 11, fill: 'var(--ink3)', bg: .9 });
  }
  // the clock on the strip, under the sun
  const st = dayStrip(G, S.doy, S.timeMode);
  if (st) {
    const night = S.hour < st.t0 || S.hour > st.t1, x = st.x(S.hour);
    g += L(x, TY - 4, x, TY + 17, { stroke: 'var(--sun)', w: 1.4, op: night ? .45 : 1 });
    g += CIRCLE(x, TY - 5, 3, { fill: night ? 'var(--ink3)' : 'var(--sun)' });
  }
  return svg(g, 'Cartesian sun path chart for Vancouver with the shading mask of the current device');
}
export const clearSunCache = () => { cache.key = ''; };
