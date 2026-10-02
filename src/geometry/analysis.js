/* Where the beam lands: the ray test and every study built on it.

   From each sample point on the glass a ray is fired along the sun vector. It
   is lit only if the sun is in front of the facade, the ray gets out of the
   reveal, and it meets no element. The reveal is exact and needs no geometry of
   its own: the aperture is convex and the ray straight, so it clears the whole
   depth of the wall if and only if it is still inside the aperture where it
   crosses the wall's outside face. That models a wall that carries on beyond
   the window, which is what a real one does. A window wall's aperture runs on
   without end across the facade, so only its slab edges take part.

   Every study comes in two forms: for one unit (m), exactly as v4 computed it,
   and for an analysis target (T) - a unit, a storey or a facade - as the
   glass-weighted mean over its distinct units. A target of one unit returns
   the unit's own figures untouched.                                         */

import { clamp } from '../util.js';
import { solarPosition, sunLocal, sunriseSunsetSolar, solarToClock } from '../solar.js';
import { buildDevice, isLive } from './device.js';
import { boxSpan } from './boxes.js';

/* A ray from the glass can only meet a box while it is still within the depth
   the devices reach, so for one sun direction only the boxes in the band the
   opening sweeps through that depth can be hit. Dropping the rest changes no
   verdict - it only spares a unit the tests against every far neighbour.    */
const BB = new WeakMap();
/** the boxes' bounds, flat, six to a box, and how far out the furthest reaches;
 *  kept per list, so a unit's are worked out once */
function boundsOf(boxes) {
  let q = BB.get(boxes);
  if (!q) {
    const a = new Float64Array(boxes.length * 6);
    let wHi = 0;
    boxes.forEach((b, i) => {
      const su = boxSpan(b, 0), sv = boxSpan(b, 1), sw = boxSpan(b, 2), k = i * 6;
      a[k] = b.c[0] - su; a[k + 1] = b.c[0] + su; a[k + 2] = b.c[1] - sv; a[k + 3] = b.c[1] + sv; a[k + 4] = b.c[2] - sw; a[k + 5] = b.c[2] + sw;
      if (a[k + 5] > wHi) wHi = a[k + 5];
    });
    BB.set(boxes, q = { a, wHi });
  }
  return q;
}
export function cull(m, sl, boxes) {
  if (boxes.length < 8 || sl[2] <= 1e-9) return boxes;
  const { a, wHi } = boundsOf(boxes);
  const t = wHi / sl[2], du = sl[0] * t, dv = sl[1] * t, o = m.opening, e = 1e-9;
  const u0 = o.u0 + Math.min(0, du) - e, u1 = o.u1 + Math.max(0, du) + e;
  const v0 = o.v0 + Math.min(0, dv) - e, v1 = o.v1 + Math.max(0, dv) + e;
  const out = [];
  for (let i = 0, k = 0; i < boxes.length; i++, k += 6)
    if (a[k + 5] > 0 && a[k + 1] >= u0 && a[k] <= u1 && a[k + 3] >= v0 && a[k + 2] <= v1) out.push(boxes[i]);
  return out;
}

/** slab-method ray / oriented-box test: does p + t*dir (t > eps) hit the box? */
export function hitBox(p, dir, b) {
  const rx = p[0] - b.c[0], ry = p[1] - b.c[1], rz = p[2] - b.c[2];
  const ax = [b.e1, b.e2, b.e3];
  let tmin = 1e-6, tmax = 1e9;
  for (let i = 0; i < 3; i++) {
    const e = ax[i];
    const oc = rx * e[0] + ry * e[1] + rz * e[2];
    const dc = dir[0] * e[0] + dir[1] * e[1] + dir[2] * e[2];
    const h = b.h[i];
    if (Math.abs(dc) < 1e-12) { if (oc < -h || oc > h) return false; continue; }
    let t1 = (-h - oc) / dc, t2 = (h - oc) / dc;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return tmax > 1e-6;
}

/** does a beam from glass point (u, v) get out past the reveal? The wall is
 *  closed, like every element: a ray that grazes the arris is blocked, and
 *  "grazes" is taken to a nanometre so the verdict does not hang on rounding. */
const ARRIS = 1e-9;
export function revealClear(m, u, v, sl) {
  if (m.reveal <= 1e-9) return true;
  const t = m.reveal / sl[2], o = m.aperture;
  const uu = u + sl[0] * t, vv = v + sl[1] * t;
  return uu > o.u0 + ARRIS && uu < o.u1 - ARRIS && vv > o.v0 + ARRIS && vv < o.v1 - ARRIS;
}

export function sunlit(m, p, sl, boxes = m.elements) {
  if (sl[2] <= 1e-9) return false;                 // sun behind the facade plane
  if (!revealClear(m, p[0], p[1], sl)) return false;
  for (let i = 0; i < boxes.length; i++) if (hitBox(p, sl, boxes[i])) return false;
  return true;
}

/** share of the glazing in shade, by even sampling of the opening. A unit that
 *  is one of many in a target may carry a coarser grid of its own (m.grid,
 *  set by analysisTarget), set off by its own phase. */
export function shadeFraction(m, sl, nu = 41, nv = 33, boxes = m.elements) {
  if (sl[2] <= 1e-9) return { frac: 1, lit: 0, sunOnFacade: false };
  const o = m.opening, p = [0, 0, 0], G = m.grid;
  let pu = 0.5, pv = 0.5;
  if (G) { nu = Math.max(2, Math.round(nu * G.r)); nv = Math.max(2, Math.round(nv * G.r)); pu = G.pu; pv = G.pv; }
  boxes = cull(m, sl, boxes);
  let lit = 0;
  for (let i = 0; i < nu; i++) {
    p[0] = o.u0 + m.winW * (i + pu) / nu;
    for (let j = 0; j < nv; j++) {
      p[1] = o.v0 + m.winH * (j + pv) / nv;
      if (sunlit(m, p, sl, boxes)) lit++;
    }
  }
  const tot = nu * nv;
  return { frac: 1 - lit / tot, lit: lit / tot, sunOnFacade: true };
}

/** the lit/shaded runs along one line of the glass, for the section and plan */
export function scanLine(m, sl, onFacade, axis, at, n = 260) {
  const o = m.opening;
  const [a0, a1] = axis === 'v' ? [o.v0, o.v1] : [o.u0, o.u1];
  if (!onFacade) return [[a0, a1, false]];
  const segs = [], p = [0, 0, 0], bs = cull(m, sl, m.elements);
  let prev = null, start = a0;
  for (let i = 0; i <= n; i++) {
    const s = a0 + (a1 - a0) * i / n;
    if (axis === 'v') { p[0] = at; p[1] = s; } else { p[0] = s; p[1] = at; }
    const lit = sunlit(m, p, sl, bs);
    if (prev === null) { prev = lit; start = s; }
    else if (lit !== prev) { segs.push([start, s, prev]); prev = lit; start = s; }
  }
  segs.push([start, a1, prev]);
  return segs;
}

/* ---------- the sky mask ----------
   The shaded fraction for every 3 x 3 degree cell of the half-sky the facade
   sees, on a coarse 7 x 5 grid on the opening. */
export function computeMask(m) {
  const dAz = 3, nAz = 60, dAlt = 3, nAlt = 24, az0 = m.gf - 90;
  const cells = new Float32Array(nAz * nAlt);
  for (let i = 0; i < nAz; i++) for (let j = 0; j < nAlt; j++)
    cells[i * nAlt + j] = shadeFraction(m, sunLocal((j + 0.5) * dAlt, az0 + (i + 0.5) * dAz, m.gf), 7, 5).frac;
  return { az0, dAz, nAz, dAlt, nAlt, cells, key: m.key };
}

/* ---------- the outer limit of the sky that can still reach the glass ----------
   True when at least ENV_MIN of the opening is still struck from a direction.
   The grid is even, so this is an area test: a sliver one ray wide at the
   reveal does not count as daylight. */
export const ENV_NU = 15, ENV_NV = 13, ENV_MIN = 0.015;
const envP = [0, 0, 0];
export function envLit(m, sl, boxes) {
  if (sl[2] <= 1e-9) return false;
  const need = Math.ceil(ENV_MIN * ENV_NU * ENV_NV), o = m.opening;
  boxes = cull(m, sl, boxes);
  let lit = 0;
  for (let i = 0; i < ENV_NU; i++) {
    envP[0] = o.u0 + m.winW * (i + 0.5) / ENV_NU;
    for (let j = 0; j < ENV_NV; j++) {
      envP[1] = o.v0 + m.winH * (j + 0.5) / ENV_NV;
      if (sunlit(m, envP, sl, boxes) && ++lit >= need) return true;
    }
  }
  return false;
}

/** the same devices as a shading-mask protractor takes them: running right
 *  across the facade, flush on the glass and infinitely thin. Only depth,
 *  pitch and tilt survive. The gap between this limit and the real one is the
 *  price of a finite device with a standoff and a thickness. The reveal is
 *  kept; the neighbours are not, since a continuous device has none. */
export function idealElements(m) {
  const BIG = 1e4, out = [];
  for (const { D } of m.live || []) {
    if (!isLive(D)) continue;
    for (const b of buildDevice(Object.assign({}, D, { offset: -m.reveal, thick: 1e-4, hinge: 'start' }), m.g, true)) {
      const h = b.h.slice();
      if (b.kind === 'h') h[0] = BIG; else h[1] = BIG;
      out.push(Object.assign({}, b, { h }));
    }
  }
  return out;
}

/** for one surface azimuth, the band of altitudes still delivering sun */
function scanCol(gf, az, litSl, altMax) {
  const STEP = 4, A0 = 0.25, A1 = altMax;
  const lit = a => litSl(sunLocal(a, az, gf));
  const ref = (l, d) => {
    for (let k = 0; k < 7; k++) { const x = (l + d) / 2; if (lit(x)) l = x; else d = x; }
    return (l + d) / 2;
  };
  let lo = lit(A0) ? 0 : null, hi = lit(A1) ? A1 : null;
  if (lo !== null && hi !== null) return { lo, hi };
  if (lo === null) {
    let prev = A0;
    for (let a = A0 + STEP; a <= A1; a += STEP) { if (lit(a)) { lo = ref(a, prev); break; } prev = a; }
    if (lo === null) return { lo: null, hi: null };
  }
  if (hi === null) {
    let prev = A1;
    for (let a = A1 - STEP; a >= A0; a -= STEP) { if (lit(a)) { hi = ref(a, prev); break; } prev = a; }
    if (hi === null || hi < lo) hi = lo;
  }
  return { lo, hi };
}
/** scanned coarsely across the facade's half-sky, each crossing bisected */
export const envelope = (m, boxes, altMax) => envelopeBy(m.gf, sl => envLit(m, sl, boxes), altMax);
export function envelopeBy(gf, litSl, altMax) {
  const cols = [];
  const at = gam => Object.assign({ gam, az: gf + gam }, scanCol(gf, gf + gam, litSl, altMax));
  for (let i = 0; i <= 36; i++) cols.push(at(clamp(-90 + i * 5, -89.9, 89.9)));
  // a fin array shuts the sky off in azimuth, so the sides of the run are
  // bisected too - otherwise the cut-off is only read to the column spacing
  const edge = (lit, dark) => {
    let a = lit.gam, b = dark.gam;
    for (let k = 0; k < 4; k++) {
      const x = (a + b) / 2;
      if (scanCol(gf, gf + x, litSl, altMax).lo !== null) a = x; else b = x;
    }
    return a;
  };
  const out = [];
  cols.forEach((c, i) => {
    const prev = cols[i - 1], next = cols[i + 1];
    if (c.lo !== null && prev && prev.lo === null) { const e = at(edge(c, prev)); if (e.lo !== null) out.push(e); }
    out.push(c);
    if (c.lo !== null && next && next.lo === null) { const e = at(edge(c, next)); if (e.lo !== null) out.push(e); }
  });
  return out;
}
/** the limit square on the facade (gamma nearest 0), or null if shut */
export const limitAtNormal = cols => {
  const c = cols.reduce((a, b) => Math.abs(b.gam) < Math.abs(a.gam) ? b : a);
  return c.lo === null ? null : c.hi;
};

/* ---------- studies over time ----------
   Each takes the facade azimuth and a function giving the shaded fraction for
   a sun direction, so the same code serves one unit and a whole facade.     */
/** the selected day on the user's clock, each sample flagged with whether any
 *  direct sun still reaches the glass once the devices have had their say */
export const daySamples = (m, doy, timeMode) => daySamplesBy(m.gf, sl => shadeFraction(m, sl, 9, 7).frac, doy, timeMode);
export function daySamplesBy(gf, frac, doy, timeMode) {
  const ss = sunriseSunsetSolar(doy);
  if (!ss) return [];
  const out = [];
  const t0 = solarToClock(ss[0], doy, timeMode), t1 = solarToClock(ss[1], doy, timeMode);
  const step = Math.max(0.015, (t1 - t0) / 260);
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const sp = solarPosition(doy, t, timeMode);
    if (sp.alt < 0) continue;
    const sl = sunLocal(sp.alt, sp.az, gf);
    const onFace = sl[2] > 1e-6;
    out.push({ t, alt: sp.alt, az: sp.az, onFace, lit: onFace && frac(sl) < 0.985 });
  }
  return out;
}
/** runs of clock time in which the glass is in direct sun */
export function litSpans(samples) {
  const out = []; let run = null;
  for (const p of samples) {
    if (p.lit) { if (!run) { run = [p.t, p.t]; out.push(run); } else run[1] = p.t; }
    else run = null;
  }
  return out.filter(r => r[1] - r[0] > 1 / 60);
}
/** sunrise and sunset on the clock, and every spell with sun on this facade -
 *  a north wall gets two in June, so they are kept apart */
export function daySpan(gf, doy, timeMode) {
  const ss = sunriseSunsetSolar(doy);
  const rise = ss ? solarToClock(ss[0], doy, timeMode) : null;
  const set = ss ? solarToClock(ss[1], doy, timeMode) : null;
  const on = [];
  let cur = null;
  for (let t = 0; t <= 24.0001; t += 1 / 30) {
    const sp = solarPosition(doy, t, timeMode);
    const lit = sp.alt > 0 && sunLocal(sp.alt, sp.az, gf)[2] > 0;
    if (lit) { if (!cur) { cur = [t, t]; on.push(cur); } else cur[1] = t; }
    else cur = null;
  }
  return { rise, set, on: on.filter(s => s[1] - s[0] > 1 / 30) };
}
export const dailyProfile = (m, doy, timeMode) => dailyProfileBy(m.gf, sl => shadeFraction(m, sl, 21, 17).frac, doy, timeMode);
export function dailyProfileBy(gf, frac, doy, timeMode) {
  const out = [];
  for (let t = 0; t <= 24.001; t += 0.25) {
    const sp = solarPosition(doy, t, timeMode);
    if (sp.alt <= 0) { out.push({ t, alt: sp.alt, on: false, frac: null }); continue; }
    const sl = sunLocal(sp.alt, sp.az, gf);
    if (sl[2] <= 0) { out.push({ t, alt: sp.alt, on: false, frac: null }); continue; }
    out.push({ t, alt: sp.alt, on: true, frac: frac(sl) });
  }
  return out;
}
/** a representative day each month, every hour, weighted by the weather file's
 *  direct normal irradiance reduced to the facade by cos(theta). Beam only. */
export const annualStudy = (m, C, doyOf) => annualStudyBy(m.gf, sl => shadeFraction(m, sl, 17, 13).frac, C, doyOf);
export function annualStudyBy(gf, frac, C, doyOf) {
  const heat = [], monthBare = [], monthShaded = [];
  for (let mo = 0; mo < 12; mo++) {
    const doy = doyOf(mo + 1, 15), row = [];
    let bare = 0, shd = 0;
    for (let h = 0; h < 24; h++) {
      // EPW hour h+1 covers h..h+1 in Pacific Standard Time; use the midpoint
      const sp = solarPosition(doy, h + 0.5, 'lst');
      let f = null, cosI = 0;
      if (sp.alt > 0) {
        const sl = sunLocal(sp.alt, sp.az, gf);
        cosI = Math.max(0, sl[2]);
        if (cosI > 0) f = frac(sl);
      }
      row.push(f);
      const beam = C.dni[mo][h] * cosI / 1000;               // kWh/m2 per hour of glazing
      bare += beam * C.ndays[mo];
      shd += beam * (1 - (f === null ? 0 : f)) * C.ndays[mo];
    }
    heat.push(row); monthBare.push(bare); monthShaded.push(shd);
  }
  return { heat, monthBare, monthShaded,
    bare: monthBare.reduce((a, b) => a + b, 0), shaded: monthShaded.reduce((a, b) => a + b, 0) };
}

/** the pitch a device is really built at: the widest gap between neighbours,
 *  which steps over the shorter leftover gap an added end member makes */
export function systemPitch(boxes) {
  let q = NaN;
  for (let i = 1; i < boxes.length; i++) {
    const d = Math.abs(boxes[i].at - boxes[i - 1].at);
    if (!(q >= d)) q = d;
  }
  return q;
}

/* ---------- over an analysis target ---------- */
/** the glass-weighted shaded fraction of a target; one unit is its own figure */
export function fracT(T, sl, nu, nv) {
  const it = T.items;
  if (!it.length) return 1;
  if (it.length === 1) return shadeFraction(it[0].m, sl, nu, nv).frac;
  let a = 0, w = 0;
  for (const x of it) { a += x.w * shadeFraction(x.m, sl, nu, nv).frac; w += x.w; }
  return a / w;
}
export const fracOfT = (T, nu, nv) => sl => fracT(T, sl, nu, nv);

export function computeMaskT(T) {
  if (T.items.length === 1) return Object.assign(computeMask(T.items[0].m), { key: T.key });
  const parts = T.items.map(x => [x.w, computeMask(x.m)]);
  const base = parts[0][1], cells = new Float32Array(base.cells.length), W = T.area;
  for (const [w, mk] of parts) for (let i = 0; i < cells.length; i++) cells[i] += w * mk.cells[i] / W;
  return Object.assign({}, base, { cells, key: T.key });
}

/** a direction reaches the target when at least ENV_MIN of its glass, taken
 *  over all its units, is still struck */
export function envLitT(T, sl, which) {
  const it = T.items;
  if (it.length === 1) return envLit(it[0].m, sl, which(it[0]));
  if (sl[2] <= 1e-9) return false;
  const need = ENV_MIN * T.area, n = ENV_NU * ENV_NV, p = [0, 0, 0];
  let acc = 0;
  for (const x of it) {
    const m = x.m, o = m.opening, bs = cull(m, sl, which(x));
    let lit = 0;
    for (let i = 0; i < ENV_NU; i++) {
      p[0] = o.u0 + m.winW * (i + 0.5) / ENV_NU;
      for (let j = 0; j < ENV_NV; j++) {
        p[1] = o.v0 + m.winH * (j + 0.5) / ENV_NV;
        if (sunlit(m, p, sl, bs)) lit++;
      }
    }
    acc += x.w * lit / n;
    if (acc >= need) return true;
  }
  return false;
}
/** the limit as built, and as a protractor would draw it */
export function envelopeT(T, ideal, altMax) {
  const which = x => ideal ? (x.ideal || (x.ideal = idealElements(x.m))) : x.m.elements;
  if (T.items.length === 1) return envelope(T.items[0].m, which(T.items[0]), altMax);
  return envelopeBy(T.gf, sl => envLitT(T, sl, which), altMax);
}

/* ---------- over more than one side ----------
   A storey all round, or the whole building. Units facing different ways see
   the same sun from different angles, so each takes it in its own coordinates,
   and glass the sun is behind counts as glass in shade - which it is. The
   figures are shares of all the target's glass; the beam is summed per unit.
   A target on one side never comes here: it goes through the functions above. */
const slAt = (x, alt, az) => sunLocal(alt, az, x.m.gf);
/** one sun in each side's coordinates, worked out once per side, not per unit */
export function sunBySide(alt, az) {
  const c = new Map();
  return gf => { let v = c.get(gf); if (!v) c.set(gf, v = sunLocal(alt, az, gf)); return v; };
}
/** is the sun on any glass of the target? */
export const onGlassW = (T, alt, az) => alt > 0 && T.items.some(x => slAt(x, alt, az)[2] > 1e-6);
export function fracW(T, alt, az, nu, nv) {
  if (!T.items.length) return 1;
  let a = 0;
  const sl = sunBySide(alt, az);
  for (const x of T.items) a += x.w * shadeFraction(x.m, sl(x.m.gf), nu, nv).frac;
  return a / T.area;
}
/** the mask over the whole sky: every 3 degrees of bearing round the horizon */
export function computeMaskW(T) {
  const dAz = 3, nAz = 120, dAlt = 3, nAlt = 24, az0 = 0;
  const cells = new Float32Array(nAz * nAlt);
  for (let i = 0; i < nAz; i++) for (let j = 0; j < nAlt; j++)
    cells[i * nAlt + j] = fracW(T, (j + 0.5) * dAlt, az0 + (i + 0.5) * dAz, 7, 5);
  return { az0, dAz, nAz, dAlt, nAlt, cells, key: T.key };
}
export function daySamplesW(T, doy, timeMode) {
  const ss = sunriseSunsetSolar(doy);
  if (!ss) return [];
  const out = [];
  const t0 = solarToClock(ss[0], doy, timeMode), t1 = solarToClock(ss[1], doy, timeMode);
  const step = Math.max(0.015, (t1 - t0) / 260);
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const sp = solarPosition(doy, t, timeMode);
    if (sp.alt < 0) continue;
    const onFace = onGlassW(T, sp.alt, sp.az);
    out.push({ t, alt: sp.alt, az: sp.az, onFace, lit: onFace && fracW(T, sp.alt, sp.az, 9, 7) < 0.985 });
  }
  return out;
}
export function daySpanW(T, doy, timeMode) {
  const ss = sunriseSunsetSolar(doy);
  const rise = ss ? solarToClock(ss[0], doy, timeMode) : null;
  const set = ss ? solarToClock(ss[1], doy, timeMode) : null;
  const on = [];
  let cur = null;
  for (let t = 0; t <= 24.0001; t += 1 / 30) {
    const sp = solarPosition(doy, t, timeMode);
    if (onGlassW(T, sp.alt, sp.az)) { if (!cur) { cur = [t, t]; on.push(cur); } else cur[1] = t; }
    else cur = null;
  }
  return { rise, set, on: on.filter(s => s[1] - s[0] > 1 / 30) };
}
export function dailyProfileW(T, doy, timeMode) {
  const out = [];
  for (let t = 0; t <= 24.001; t += 0.25) {
    const sp = solarPosition(doy, t, timeMode);
    if (!onGlassW(T, sp.alt, sp.az)) { out.push({ t, alt: sp.alt, on: false, frac: null }); continue; }
    out.push({ t, alt: sp.alt, on: true, frac: fracW(T, sp.alt, sp.az, 21, 17) });
  }
  return out;
}
export function annualStudyW(T, C, doyOf) {
  const heat = [], monthBare = [], monthShaded = [];
  for (let mo = 0; mo < 12; mo++) {
    const doy = doyOf(mo + 1, 15), row = [];
    let bare = 0, shd = 0;
    for (let h = 0; h < 24; h++) {
      const sp = solarPosition(doy, h + 0.5, 'lst');
      if (!onGlassW(T, sp.alt, sp.az)) { row.push(null); continue; }
      let fa = 0, b = 0, s = 0;
      for (const x of T.items) {
        const sl = slAt(x, sp.alt, sp.az), cosI = Math.max(0, sl[2]);
        const f = shadeFraction(x.m, sl, 17, 13).frac;
        fa += x.w * f;
        const beam = C.dni[mo][h] * cosI / 1000;
        b += x.w * beam; s += x.w * beam * (1 - f);
      }
      row.push(fa / T.area);
      bare += b / T.area * C.ndays[mo];
      shd += s / T.area * C.ndays[mo];
    }
    heat.push(row); monthBare.push(bare); monthShaded.push(shd);
  }
  return { heat, monthBare, monthShaded,
    bare: monthBare.reduce((a, b) => a + b, 0), shaded: monthShaded.reduce((a, b) => a + b, 0) };
}
