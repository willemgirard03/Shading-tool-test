/* The three studies over time, as small charts. */

import { fmt, MONTHS } from '../util.js';
import { El, T, L, PATH, RECT, CIRCLE } from './svg.js';
import { shadeColour, SHADE_MAX } from './sunpath.js';
import { sunriseSunsetSolar, solarToClock } from '../solar.js';

const frame = (w, h, g) => El('svg', { viewBox: `0 0 ${w} ${h}`, xmlns: 'http://www.w3.org/2000/svg' }, g);

export function chartDaily(prof, cur, hour) {
  const W = 440, H = 200, m = { l: 34, r: 12, t: 12, b: 26 };
  const X = t => m.l + (W - m.l - m.r) * t / 24, Y = f => m.t + (H - m.t - m.b) * (1 - f);
  let g = '';
  for (let f = 0; f <= 1.001; f += 0.25) {
    g += L(m.l, Y(f), W - m.r, Y(f), { stroke: 'var(--rule2)', w: .6 });
    g += T(m.l - 5, Y(f) + 3.2, Math.round(f * 100) + '%', { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  }
  for (let t = 0; t <= 24; t += 6) {
    g += L(X(t), m.t, X(t), H - m.b, { stroke: 'var(--rule2)', w: .6 });
    g += T(X(t), H - m.b + 12, t + ':00', { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  }
  const runs = []; let cs = null;         // sun on the facade
  prof.forEach(p => { if (p.on && cs === null) cs = p.t; if (!p.on && cs !== null) { runs.push([cs, p.t]); cs = null; } });
  if (cs !== null) runs.push([cs, 24]);
  runs.forEach(([a, b]) => { g += RECT(X(a), m.t, X(b) - X(a), H - m.t - m.b, { fill: 'var(--sunsoft)' }); });
  let d = '', up = false;
  prof.forEach(p => { if (!p.on) { up = false; return; } d += (up ? 'L' : 'M') + fmt(X(p.t), 2) + ',' + fmt(Y(p.frac), 2) + ' '; up = true; });
  if (d) g += PATH(d, { stroke: 'var(--glass)', w: 1.8 });
  g += L(X(hour), m.t, X(hour), H - m.b, { stroke: 'var(--sun)', w: 1.2, dash: '4 3' });
  if (cur.onFacade) g += CIRCLE(X(hour), Y(cur.frac), 4, { fill: 'var(--sun)' });
  g += L(m.l, H - m.b, W - m.r, H - m.b, { stroke: 'var(--ink3)', w: .8 });
  return frame(W, H, g);
}

export function chartHeat(ann) {
  const W = 440, H = 210, m = { l: 34, r: 12, t: 12, b: 42 };
  const cw = (W - m.l - m.r) / 24, ch = (H - m.t - m.b) / 12;
  let g = '';
  for (let mo = 0; mo < 12; mo++) {
    for (let h = 0; h < 24; h++) {
      const f = ann.heat[mo][h], x = m.l + h * cw, y = m.t + mo * ch;
      g += RECT(x, y, cw + .4, ch + .4, { fill: f === null ? '#EDEFEE' : 'var(--shade)', opacity: f === null ? 1 : (0.1 + 0.9 * f).toFixed(2) });
      if (f !== null && f < 0.02) g += RECT(x, y, cw + .4, ch + .4, { fill: 'var(--sun)', opacity: .5 });
    }
    g += T(m.l - 5, m.t + mo * ch + ch / 2 + 3, MONTHS[mo], { anchor: 'end', size: 8, fill: 'var(--ink3)' });
  }
  for (let h = 0; h <= 24; h += 6) g += T(m.l + h * cw, H - m.b + 12, h + 'h', { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  g += RECT(m.l, H - 26, 13, 9, { fill: 'var(--sun)', opacity: .5 }) + T(m.l + 17, H - 18, 'fully exposed', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(m.l + 92, H - 26, 13, 9, { fill: 'var(--shade)' }) + T(m.l + 109, H - 18, 'fully shaded', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(m.l + 182, H - 26, 13, 9, { fill: '#EDEFEE' }) + T(m.l + 199, H - 18, 'no sun on this facade', { size: 8.5, fill: 'var(--ink3)' });
  return frame(W, H, g);
}

export function chartIrr(ann) {
  const W = 440, H = 210, m = { l: 40, r: 12, t: 14, b: 40 };
  const mx = Math.max(...ann.monthBare, 1e-6), bw = (W - m.l - m.r) / 12;
  const Y = v => m.t + (H - m.t - m.b) * (1 - v / mx);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = mx * i / 4;
    g += L(m.l, Y(v), W - m.r, Y(v), { stroke: 'var(--rule2)', w: .6 });
    g += T(m.l - 5, Y(v) + 3.2, v.toFixed(0), { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  }
  for (let mo = 0; mo < 12; mo++) {
    const x = m.l + mo * bw + bw * 0.16, w = bw * 0.68;
    g += RECT(x, Y(ann.monthBare[mo]), w, Y(0) - Y(ann.monthBare[mo]), { fill: 'var(--sun)', opacity: .35 });
    g += RECT(x, Y(ann.monthShaded[mo]), w, Y(0) - Y(ann.monthShaded[mo]), { fill: 'var(--sun)' });
    g += T(x + w / 2, H - m.b + 12, MONTHS[mo][0], { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  }
  g += L(m.l, Y(0), W - m.r, Y(0), { stroke: 'var(--ink3)', w: .8 });
  g += T(m.l, m.t - 3, 'kWh/m² of glazing per month, direct beam only', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(m.l, H - 24, 13, 9, { fill: 'var(--sun)', opacity: .35 }) + T(m.l + 17, H - 16, 'no device', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(m.l + 86, H - 24, 13, 9, { fill: 'var(--sun)' }) + T(m.l + 103, H - 16, 'reaching glazing with device', { size: 8.5, fill: 'var(--ink3)' });
  return frame(W, H, g);
}

/* ---------- direct solar gain ---------- */
/** watts coming in through the day: with the shading, and the same glass bare */
export function chartGainDay(day, hour) {
  const W = 440, H = 210, m = { l: 46, r: 12, t: 14, b: 28 };
  const mx = Math.max(1, ...day.pts.map(p => p.bare)) * 1.08;
  const X = t => m.l + (W - m.l - m.r) * t / 24, Y = v => m.t + (H - m.t - m.b) * (1 - v / mx);
  let g = '';
  // a round step giving four to six lines, whatever the size of what the results are for
  const raw = mx / 5, p10 = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(k => k * p10).find(v => v >= raw);
  for (let v = 0; v <= mx; v += step) {
    g += L(m.l, Y(v), W - m.r, Y(v), { stroke: 'var(--rule2)', w: .6 });
    g += T(m.l - 5, Y(v) + 3.2, v >= 10000 ? fmt(v / 1000, 0) + 'k' : v >= 1000 ? fmt(v / 1000, 1) + 'k' : String(Math.round(v)), { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  }
  for (let t = 0; t <= 24; t += 6) {
    g += L(X(t), m.t, X(t), H - m.b, { stroke: 'var(--rule2)', w: .6 });
    g += T(X(t), H - m.b + 12, t + ':00', { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  }
  const line = key => day.pts.map((p, i) => (i ? 'L' : 'M') + fmt(X(p.t), 2) + ',' + fmt(Y(p[key]), 2)).join(' ');
  g += PATH(line('ent') + ` L${fmt(X(24), 2)},${fmt(Y(0), 2)} L${fmt(X(0), 2)},${fmt(Y(0), 2)} Z`, { fill: 'var(--sun)', stroke: 'none', op: .35 });
  g += PATH(line('bare'), { stroke: 'var(--ink3)', w: 1, dash: '4 3' });
  g += PATH(line('ent'), { stroke: 'var(--sun)', w: 1.8 });
  g += L(X(hour), m.t, X(hour), H - m.b, { stroke: 'var(--glass)', w: 1, dash: '3 3' });
  g += L(m.l, H - m.b, W - m.r, H - m.b, { stroke: 'var(--ink3)', w: .8 });
  g += T(m.l, m.t - 3, 'W entering', { size: 8.5, fill: 'var(--ink3)' });
  g += L(W - 190, m.t - 6, W - 176, m.t - 6, { stroke: 'var(--sun)', w: 1.8 }) + T(W - 172, m.t - 3, 'with shading', { size: 8.5, fill: 'var(--ink3)' });
  g += L(W - 100, m.t - 6, W - 86, m.t - 6, { stroke: 'var(--ink3)', w: 1, dash: '4 3' }) + T(W - 82, m.t - 3, 'bare glass', { size: 8.5, fill: 'var(--ink3)' });
  return frame(W, H, g);
}
/** kWh a month coming in: with the shading, and the same glass bare */
export function chartGainYear(year) {
  const W = 440, H = 210, m = { l: 46, r: 12, t: 16, b: 30 };
  const mx = Math.max(1e-6, ...year.months.map(x => x.bare)), bw = (W - m.l - m.r) / 12;
  const Y = v => m.t + (H - m.t - m.b) * (1 - v / mx);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = mx * i / 4;
    g += L(m.l, Y(v), W - m.r, Y(v), { stroke: 'var(--rule2)', w: .6 });
    g += T(m.l - 5, Y(v) + 3.2, v >= 100 ? fmt(v, 0) : fmt(v, 1), { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  }
  year.months.forEach((x, mo) => {
    const x0 = m.l + mo * bw + bw * 0.16, w = bw * 0.68;
    g += RECT(x0, Y(x.bare), w, Y(0) - Y(x.bare), { fill: 'var(--sun)', opacity: .28 });
    g += RECT(x0, Y(x.ent), w, Y(0) - Y(x.ent), { fill: 'var(--sun)' });
    g += T(x0 + w / 2, H - m.b + 12, MONTHS[mo][0], { anchor: 'middle', size: 8.5, fill: 'var(--ink3)' });
  });
  g += L(m.l, Y(0), W - m.r, Y(0), { stroke: 'var(--ink3)', w: .8 });
  g += T(m.l, m.t - 4, 'kWh entering per month', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(W - 200, m.t - 12, 11, 8, { fill: 'var(--sun)' }) + T(W - 185, m.t - 4, 'with shading', { size: 8.5, fill: 'var(--ink3)' });
  g += RECT(W - 110, m.t - 12, 11, 8, { fill: 'var(--sun)', opacity: .28 }) + T(W - 95, m.t - 4, 'bare glass', { size: 8.5, fill: 'var(--ink3)' });
  return frame(W, H, g);
}

/** when the glass is in shade across the year: every hour of every week, the
 *  share of the glass the beam does not reach */
/* The year's shading as a day-length chart: the year across, the hours of the
   day down, the night left blank between the sunrise and sunset lines. Each
   week-and-hour is shaded as the sun path chart shades its sky - white where
   the glass is all in sun, darker as more of it is shaded, solid where none of
   it is lit - counting only the glass the sun is in front of, so a building's
   far sides do not read as shade. Where no glass faces the sun at all the
   cell is the chart's poche, as behind a facade. */
export function chartShadeYear(Hh) {
  const W = 440, H = 250, m = { l: 34, r: 12, t: 12, b: 58 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, cw = pw / 52, ch = ph / 24;
  const X = d => m.l + (d - 1) / 365 * pw, Y = t => m.t + t / 24 * ph;
  let g = RECT(m.l, m.t, pw, ph, { fill: 'var(--panel)', stroke: 'var(--rule)', 'stroke-width': .6 });
  for (let wk = 0; wk < 52; wk++) for (let h = 0; h < 24; h++) {
    let a = 0, n = 0, up = false;
    for (let d = wk * 7 + 1; d <= Math.min(365, wk * 7 + 7); d++) {
      const i = (d - 1) * 24 + h;
      if (Hh.alt[i] > 0) up = true;
      if (!Number.isNaN(Hh.fface[i])) { a += Hh.fface[i]; n++; }
    }
    if (!up) continue;
    const x = m.l + wk * cw, y = m.t + h * ch;
    if (!n) { g += RECT(x, y, cw + .3, ch + .3, { fill: 'var(--poche)', opacity: SHADE_MAX }); continue; }
    const f = a / n;
    if (f > 0.004) g += RECT(x, y, cw + .3, ch + .3, { fill: shadeColour(f), opacity: (SHADE_MAX * f).toFixed(3) });
  }
  // the day's length: sunrise and sunset on the clock the hours are read on
  const rise = [], set = [];
  for (let d = 1; d <= 365; d += 2) {
    const ss = sunriseSunsetSolar(d);
    if (!ss) continue;
    rise.push([X(d), Y(solarToClock(ss[0], d, 'lst'))]); set.push([X(d), Y(solarToClock(ss[1], d, 'lst'))]);
  }
  const line = pts => pts.map((p, k) => (k ? 'L' : 'M') + fmt(p[0], 1) + ',' + fmt(p[1], 1)).join(' ');
  g += PATH(line(rise), { stroke: 'var(--ink2)', w: 1 }) + PATH(line(set), { stroke: 'var(--ink2)', w: 1 });
  for (let h = 0; h <= 24; h += 6) {
    g += L(m.l, Y(h), m.l + pw, Y(h), { stroke: 'var(--rule2)', w: .5 });
    g += T(m.l - 5, Y(h) + 3, String(h).padStart(2, '0') + ':00', { anchor: 'end', size: 7.5, fill: 'var(--ink3)' });
  }
  const starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  starts.forEach((d, mo) => { g += T(X(d) + 2, m.t + ph + 11, MONTHS[mo].slice(0, 3), { size: 8, fill: 'var(--ink3)' }); });
  // the key: the sun path chart's gradient, then the poche and the night
  const ky = H - 22, k0 = m.l + 30;
  g += T(m.l, ky + 8, 'in sun', { size: 8, fill: 'var(--ink3)' });
  for (let k = 0; k <= 10; k++) g += RECT(k0 + k * 7, ky, 7.3, 9, { fill: shadeColour(k / 10), opacity: (SHADE_MAX * k / 10).toFixed(3) });
  g += RECT(k0, ky, 77, 9, { fill: 'none', stroke: 'var(--rule)', 'stroke-width': .5 }) + T(k0 + 81, ky + 8, 'shaded', { size: 8, fill: 'var(--ink3)' });
  g += RECT(m.l + 160, ky, 12, 9, { fill: 'var(--poche)', opacity: SHADE_MAX }) + T(m.l + 176, ky + 8, 'no glass faces sun', { size: 8, fill: 'var(--ink3)' });
  g += L(m.l + 268, ky + 4.5, m.l + 280, ky + 4.5, { stroke: 'var(--ink2)', w: 1 }) + T(m.l + 284, ky + 8, 'sunrise, sunset (PST)', { size: 8, fill: 'var(--ink3)' });
  return frame(W, H, g);
}
