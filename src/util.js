/* Small shared pieces: angles, number formatting, the calendar and 3-vectors.
   Nothing here knows about the facade, the sun or the page.

   Conventions, used everywhere and never switched:
     World axes     x = true east, y = true north, z = up (right-handed)
     Azimuth        from true north, clockwise positive, normalised to [0, 360)
     Altitude       degrees above the horizon
     Facade frame   u across (to the right, seen from OUTSIDE), v up, w outward
                    from the glass. The glass is the plane w = 0.            */

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const wrap360 = a => ((a % 360) + 360) % 360;
export const wrap180 = a => { const x = wrap360(a); return x > 180 ? x - 360 : x; };
/** fixed decimals, with a tiny negative printed as 0 rather than -0 */
export const fmt = (x, n = 1) => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(n);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const doyOf = (m, d) => { let n = d; for (let i = 0; i < m - 1; i++) n += MDAYS[i]; return n; };
/** the calendar date a day of year lands on, 1 Jan being day 1 */
export const monthDayOf = doy => {
  let n = clamp(Math.round(doy), 1, 365), m = 0;
  while (n > MDAYS[m]) { n -= MDAYS[m]; m++; }
  return { m: m + 1, d: n };
};
export const dateLabel = doy => { const o = monthDayOf(doy); return o.d + ' ' + MONTHS[o.m - 1]; };
/** a time of day as hh:mm, rounded to the minute first so 11:59.7 reads 12:00, not 11:60 */
export const hhmm = t => { const m = Math.round(t * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0'); };

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
};

/** convex hull of 2D points, monotone chain, counter-clockwise */
export function hull2(pts) {
  if (pts.length < 3) return pts;
  const q = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const r of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], r) <= 0) lo.pop(); lo.push(r); }
  for (let i = q.length - 1; i >= 0; i--) {
    const r = q[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], r) <= 0) up.pop();
    up.push(r);
  }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/** Sutherland-Hodgman clip of a polygon to an axis-aligned rectangle */
export function clipRect(poly, u0, u1, v0, v1) {
  const passes = [
    [q => q[0] >= u0, (a, b) => [u0, a[1] + (b[1] - a[1]) * (u0 - a[0]) / ((b[0] - a[0]) || 1e-12)]],
    [q => q[0] <= u1, (a, b) => [u1, a[1] + (b[1] - a[1]) * (u1 - a[0]) / ((b[0] - a[0]) || 1e-12)]],
    [q => q[1] >= v0, (a, b) => [a[0] + (b[0] - a[0]) * (v0 - a[1]) / ((b[1] - a[1]) || 1e-12), v0]],
    [q => q[1] <= v1, (a, b) => [a[0] + (b[0] - a[0]) * (v1 - a[1]) / ((b[1] - a[1]) || 1e-12), v1]]
  ];
  let out = poly;
  for (const [inside, cut] of passes) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}

/** Liang-Barsky clip of a segment to a rectangle; null if wholly outside */
export function clipSeg(x0, y0, x1, y1, xa, ya, xb, yb) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy], q = [x0 - xa, xb - x0, y0 - ya, yb - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}
