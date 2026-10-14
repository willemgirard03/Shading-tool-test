/* The sun chart's year display: every day of the year across, the time of
   day down on the chosen clock, the night greyed out between the sunrise and
   sunset lines. Each moment is shaded as the sun path chart shades its sky -
   white where the glass is all in sun, darker as more of it is shaded - over
   the glass the sun is in front of, so a building's far sides do not read as
   shade; where no glass faces the sun the chart's poche is laid instead.
     It is the same question as the sun path chart asked by date and time
   rather than by bearing and altitude, and it is set the same way: a click or
   a drag picks the day and the hour. The 8,760 hours are painted once into an
   image, a day a column and a quarter hour a row, and kept until the design,
   the scope or the clock changes. */

import { W, H, T, L, RECT, CIRCLE, TB, PATH, svg, El } from './svg.js';
import { fmt, clamp, MONTHS, monthDayOf, hhmm } from '../util.js';
import { solarPosition, sunriseSunsetSolar, solarToClock, CLOCK_NAME } from '../solar.js';
import { shadeColour, SHADE_MAX } from './sunpath.js';

const ROWS = 96;                            // a quarter hour a row
/** where the year sits on the sheet, and the way back from a point to a day and an hour */
export function yearGeom() {
  const X0 = 46, X1 = W - 18, Y0 = 48, Y1 = Math.max(Y0 + 120, H - 50);
  return { X0, X1, Y0, Y1,
    px: d => X0 + (d - 1) / 365 * (X1 - X0), py: t => Y0 + t / 24 * (Y1 - Y0),
    doyAt: x => clamp(Math.floor((x - X0) / (X1 - X0) * 365) + 1, 1, 365),
    hourAt: y => clamp((y - Y0) / (Y1 - Y0) * 24, 0, 24),
    inside: (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1 };
}

const rgbOf = s => { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [251, 251, 249]; };
const hexRgb = s => { const h = String(s).trim().replace('#', ''); return h.length === 6 ? [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)) : null; };
const mix = (a, b, t) => a.map((x, k) => Math.round(x + (b[k] - x) * t));
/** the page's own colours, so the image sits in the chart as the vector parts do */
function palette() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n);
  const bg = hexRgb(v('--panel')) || rgbOf(v('--panel')), poche = hexRgb(v('--poche')) || [60, 72, 70];
  return { bg, night: mix(bg, [120, 128, 126], 0.28), poche: mix(bg, poche, SHADE_MAX) };
}

let img = { key: '', url: null };
/** the year painted: a day a column, a quarter hour a row, on the clock given */
function yearImage(Hh, mode, key) {
  if (typeof document === 'undefined') return null;          // the test suite has no canvas
  if (img.key === key) return img.url;
  const cv = document.createElement('canvas');
  cv.width = 365; cv.height = ROWS;
  const cx = cv.getContext('2d'), im = cx.createImageData(365, ROWS), P = palette();
  for (let d = 1; d <= 365; d++) {
    // the clock's offset from standard time is the same all day
    const off = mode === 'lst' ? 0 : mode === 'pdt' ? -1 : solarToClock(12, d, 'lst') - 12;
    for (let r = 0; r < ROWS; r++) {
      const t = (r + 0.5) * 24 / ROWS, sp = solarPosition(d, t, mode);
      let c = P.night;
      if (sp.alt > 0) {
        if (!Hh) c = P.bg;
        else {
          // the hour of the weather file this quarter falls in; at sunrise and
          // sunset its sample may be under the horizon, and the next one is read
          const lst = ((t + off) % 24 + 24) % 24;
          let h = Math.floor(lst), i = (d - 1) * 24 + h;
          if (Hh.alt[i] <= 0) { const j = (d - 1) * 24 + (lst < 12 ? Math.min(23, h + 1) : Math.max(0, h - 1)); if (Hh.alt[j] > 0) i = j; }
          const f = Hh.fface[i];
          c = Number.isNaN(f) ? (Hh.alt[i] > 0 ? P.poche : P.bg) : mix(P.bg, rgbOf(shadeColour(f)), SHADE_MAX * f);
        }
      }
      const p = (r * 365 + d - 1) * 4;
      im.data[p] = c[0]; im.data[p + 1] = c[1]; im.data[p + 2] = c[2]; im.data[p + 3] = 255;
    }
  }
  cx.putImageData(im, 0, 0);
  img = { key, url: cv.toDataURL() };
  return img.url;
}

export function drawSunYear(F, Hh) {
  const { S, T: TG } = F, G = yearGeom(), { X0, X1, Y0, Y1, px, py } = G, mode = S.timeMode;
  let g = '';
  g += T(X0, 22, 'Day of year × time of day, ' + CLOCK_NAME[mode] + ' clock', { size: 9.5, fill: 'var(--ink2)', mono: false });
  g += T(X0, 35, 'white: the glass the sun is in front of all in sun · darker: more of it shaded · grey: night', { size: 8, fill: 'var(--ink3)', mono: false });
  g += T(X1, 22, 'click or drag: date and time', { anchor: 'end', size: 8.5, fill: 'var(--ink3)' });
  const url = yearImage(Hh, mode, [TG.key || '-', mode, Hh ? 'h' : 'n', S.wx].join('|'));
  g += RECT(X0, Y0, X1 - X0, Y1 - Y0, { fill: 'var(--panel)' });
  if (url) g += El('image', { href: url, x: X0, y: Y0, width: X1 - X0, height: Y1 - Y0, preserveAspectRatio: 'none', style: 'image-rendering:pixelated' });
  // the day's length on the same clock
  const rise = [], set = [];
  for (let d = 1; d <= 365; d += 2) {
    const ss = sunriseSunsetSolar(d);
    if (!ss) continue;
    rise.push([px(d), py(solarToClock(ss[0], d, mode))]); set.push([px(d), py(solarToClock(ss[1], d, mode))]);
  }
  const line = pts => pts.map((p, k) => (k ? 'L' : 'M') + fmt(p[0], 1) + ',' + fmt(p[1], 1)).join(' ');
  g += PATH(line(rise), { stroke: 'var(--ink2)', w: 1 }) + PATH(line(set), { stroke: 'var(--ink2)', w: 1 });
  // the grid: a line every hour - every third heavier, and named - and one at the start of every month
  for (let h = 0; h <= 24; h++) {
    g += L(X0, py(h), X1, py(h), { stroke: 'var(--ink3)', w: h % 3 ? .3 : .6, op: h % 3 ? .22 : .45 });
    if (h % 3 === 0) g += T(X0 - 5, py(h) + 3, String(h).padStart(2, '0') + ':00', { anchor: 'end', size: 7.5, fill: 'var(--ink3)' });
  }
  [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335].forEach((d, mo) => {
    g += L(px(d), Y0, px(d), Y1 + 4, { stroke: 'var(--ink3)', w: .5, op: .4 });
    g += T(px(d) + 2, Y1 + 13, MONTHS[mo].slice(0, 3), { size: 8, fill: 'var(--ink3)' });
  });
  g += RECT(X0, Y0, X1 - X0, Y1 - Y0, { fill: 'none', stroke: 'var(--ink2)', 'stroke-width': 1 });
  if (!Hh && TG.items && TG.items.length) g += TB((X0 + X1) / 2, (Y0 + Y1) / 2, 'working…', { anchor: 'middle', size: 10, fill: 'var(--ink3)', bg: .9 });
  if (TG.items && !TG.items.length) g += TB((X0 + X1) / 2, (Y0 + Y1) / 2, 'no glazing in the results scope', { anchor: 'middle', size: 10, fill: 'var(--ink3)', bg: .9 });
  // the moment set: its day, its hour, and the point where they cross
  const x = px(S.doy + 0.5), y = py(S.hour), md = monthDayOf(S.doy), up = solarPosition(S.doy, S.hour, mode).alt > 0;
  g += L(x, Y0, x, Y1, { stroke: 'var(--sun)', w: .9, op: .8 }) + L(X0, y, X1, y, { stroke: 'var(--sun)', w: .9, op: .8, dash: '4 3' });
  g += CIRCLE(x, y, 9, { fill: 'var(--sun)', opacity: .18 }) + CIRCLE(x, y, 5, { fill: up ? 'var(--sun)' : 'var(--ink3)', stroke: 'var(--panel)', 'stroke-width': 1.4 });
  g += TB(clamp(x, X0 + 40, X1 - 40), Math.max(Y0 + 12, y - 12), MONTHS[md.m - 1] + ' ' + md.d + ' · ' + hhmm(S.hour), { anchor: 'middle', size: 8.5, fill: 'var(--sun)', bg: .9 });
  // the key: the sun path chart's gradient, the poche, the night
  const ky = H - 16, k0 = X0 + 30;
  g += T(X0, ky + 8, 'in sun', { size: 8, fill: 'var(--ink3)' });
  for (let k = 0; k <= 10; k++) g += RECT(k0 + k * 7, ky, 7.3, 9, { fill: shadeColour(k / 10), opacity: (SHADE_MAX * k / 10).toFixed(3) });
  g += RECT(k0, ky, 77, 9, { fill: 'none', stroke: 'var(--rule)', 'stroke-width': .5 }) + T(k0 + 81, ky + 8, 'shaded', { size: 8, fill: 'var(--ink3)' });
  g += RECT(X0 + 160, ky, 12, 9, { fill: 'var(--poche)', opacity: SHADE_MAX }) + T(X0 + 176, ky + 8, 'no glass faces sun', { size: 8, fill: 'var(--ink3)' });
  return svg(g, 'The year as days across and hours down, shaded by how much of the glass is in shade');
}
