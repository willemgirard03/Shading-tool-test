/* Direct solar gain: how much of the sun's beam comes in through the glass.

   Only the direct beam is counted - no diffuse sky, no reflections - because
   that is the part shading geometry controls and the part the drawings show.
   For one unit at one instant:

     beam on the glass   q = DNI x cos i          (W per m2 of glass)
     incident            q x sunlit glass area    (W)
     entering            incident x SHGC          (W of heat inside)

   where i is the angle of incidence (cos i = the sun's component along the
   facade normal), the sunlit area comes from the ray test, and the SHGC is the
   glass's solar heat gain coefficient, taken as constant with angle.

   The beam itself is one of three:
     clear      the ASHRAE clear-sky model textbooks use for peaks: every day sunny
     average    the weather file's mean beam for the month and hour, cloud
                included - a smooth typical day
     recorded   the weather file's own hour, as recorded - one real day, which
                may be sunny or overcast
   Peaks for sizing; the weather file for totals. Over a year the two weather
   skies agree, and are summed hour by hour at the sun's true position.     */

import { clamp, D2R, monthDayOf, doyOf } from './util.js';
import { solarPosition, sunLocal, solarToClock } from './solar.js';
import { shadeFraction, sunBySide } from './geometry/analysis.js';
import { interiorLit, roomSurfaces } from './geometry/room.js';
import { CLIMATE } from './data/climate.js';
import { hourly, recordAt } from './weather.js';

export const SKIES = { clear: 'Clear day', average: 'Average day', recorded: 'Recorded day' };

/* ASHRAE clear-sky beam, DNI = A exp(-B / sin beta), with A (W/m2) and B for
   the 21st of each month (ASHRAE Handbook of Fundamentals, 1985). Between the
   21sts the coefficients are interpolated by day. */
const ASH_A = [1230, 1215, 1186, 1136, 1104, 1088, 1085, 1107, 1151, 1192, 1221, 1233];
const ASH_B = [0.142, 0.144, 0.156, 0.180, 0.196, 0.205, 0.207, 0.201, 0.177, 0.160, 0.149, 0.142];
const D21 = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];
export function clearCoef(doy) {
  let i = D21.findIndex(d => d > doy);            // the next 21st
  if (i < 0) i = 12;
  const a = (i + 11) % 12, b = i % 12;
  const da = i === 0 ? D21[11] - 365 : D21[a], db = i === 12 ? D21[0] + 365 : D21[b];
  const f = (doy - da) / (db - da);
  return { A: ASH_A[a] + (ASH_A[b] - ASH_A[a]) * f, B: ASH_B[a] + (ASH_B[b] - ASH_B[a]) * f };
}
export function clearDNI(doy, alt) {
  if (alt <= 0) return 0;
  const { A, B } = clearCoef(doy);
  return A * Math.exp(-B / Math.sin(alt * D2R));
}

/** Pacific Standard Time for a clock reading, which is how the weather file is indexed */
export function lstOf(doy, t, mode) {
  if (mode === 'lst') return t;
  if (mode === 'pdt') return t - 1;
  return solarToClock(t, doy, 'lst');
}
/** the weather file's mean beam for that month at that hour; hour h covers
 *  h..h+1, so values are taken at the half hours and interpolated between */
export function typicalDNI(wx, doy, lst) {
  const C = CLIMATE[wx], mo = monthDayOf(doy).m - 1;
  const x = lst - 0.5, h0 = Math.floor(x), f = x - h0;
  const at = h => C.dni[mo][((h % 24) + 24) % 24];
  return at(h0) + (at(h0 + 1) - at(h0)) * f;
}
/** the beam at a clock time: the sun's position and its normal irradiance */
export function beamAt(sky, wx, doy, t, mode) {
  const sp = solarPosition(doy, t, mode);
  if (sp.alt <= 0) return { sp, dni: 0 };
  const lst = lstOf(doy, t, mode);
  return { sp, dni: sky === 'clear' ? clearDNI(doy, sp.alt)
    : Math.max(0, sky === 'recorded' ? recordAt(wx, 'dni', doy, lst) : typicalDNI(wx, doy, lst)) };
}

/* ---------- gains ---------- */
/** one unit, one sun direction in its own coordinates, one beam */
export function unitGain(m, sl, dni, nu = 21, nv = 17, frac = null) {
  const A = m.winW * m.winH;
  if (sl[2] <= 1e-9 || dni <= 0) return { A, lit: 0, q: 0, inc: 0, ent: 0, bareInc: 0, bareEnt: 0 };
  const f = frac === null ? shadeFraction(m, sl, nu, nv).frac : frac;
  const q = dni * sl[2], lit = A * (1 - f);
  return { A, lit, q, inc: q * lit, ent: q * lit * m.shgc, bareInc: q * A, bareEnt: q * A * m.shgc };
}
/** summed over a target's units - a gain adds up, it is not averaged */
export function targetGain(T, alt, az, dni, nu = 21, nv = 17) {
  const g = { A: 0, lit: 0, inc: 0, ent: 0, bareInc: 0, bareEnt: 0 };
  if (alt <= 0) { for (const x of T.items) g.A += x.count * x.m.winW * x.m.winH; return g; }
  const side = sunBySide(alt, az);
  for (const x of T.items) {
    const u = unitGain(x.m, side(x.m.gf), dni, nu, nv);
    for (const k of Object.keys(g)) g[k] += x.count * u[k];
  }
  return g;
}

/** through the selected day, every quarter hour: W entering with the shading,
 *  and what the same glass would take with none */
export function dayGain(T, sky, wx, doy, mode) {
  const pts = [];
  let wh = 0, whBare = 0;
  for (let t = 0; t <= 24.001; t += 0.25) {
    const { sp, dni } = beamAt(sky, wx, doy, t, mode);
    const g = targetGain(T, sp.alt, sp.az, dni, 17, 13);
    pts.push({ t, ent: g.ent, bare: g.bareEnt, dni });
    if (t < 24) { wh += g.ent * 0.25; whBare += g.bareEnt * 0.25; }
  }
  return { pts, wh, whBare };
}

/* ---------- the year, hour by hour ----------
   The geometry of a year does not depend on the sky, so it is run once: for
   every hour the sun is up, at the half hour, each unit's shaded share and the
   glass area the beam then reaches, times cos i and the SHGC - an area that,
   times the beam, is watts. A sky only supplies the beam. */
export function hourlyStudy(T) {
  // frac: the share of all the glass shaded, glass the sun is behind counted shaded;
  // fface: the share shaded of the glass the sun is in front of, and face: how much of it there is
  const n = 8760, frac = new Float32Array(n).fill(NaN), fface = new Float32Array(n).fill(NaN), face = new Float32Array(n);
  const ent = new Float32Array(n), bare = new Float32Array(n), alt = new Float32Array(n);
  const [nu, nv] = T.items.length <= 2 ? [11, 9] : [7, 5];
  for (let doy = 1; doy <= 365; doy++) for (let h = 0; h < 24; h++) {
    const i = (doy - 1) * 24 + h, sp = solarPosition(doy, h + 0.5, 'lst');
    alt[i] = sp.alt;
    if (sp.alt <= 0 || !T.items.length) continue;
    let fa = 0, e = 0, b = 0, any = false, fw = 0, fs = 0;
    const side = sunBySide(sp.alt, sp.az);
    for (const x of T.items) {
      const sl = side(x.m.gf), A = x.m.winW * x.m.winH;
      if (sl[2] <= 1e-6) { fa += x.w; continue; }          // behind this side: its glass is in shade
      const f = shadeFraction(x.m, sl, nu, nv).frac;
      any = true; fa += x.w * f; fw += x.w; fs += x.w * f;
      e += x.count * A * (1 - f) * sl[2] * x.m.shgc; b += x.count * A * sl[2] * x.m.shgc;
    }
    if (any) { frac[i] = fa / T.area; fface[i] = fs / fw; face[i] = fw / T.area; }
    ent[i] = e; bare[i] = b;
  }
  return { frac, fface, face, ent, bare, alt };
}
/** the year's gain from an hourly study and a sky, month by month, in kWh */
export function yearGain(H, sky, wx) {
  const rec = hourly(wx).dni, C = CLIMATE[wx], months = Array.from({ length: 12 }, () => ({ ent: 0, bare: 0 }));
  for (let doy = 1; doy <= 365; doy++) {
    const mo = monthDayOf(doy).m - 1;
    for (let h = 0; h < 24; h++) {
      const i = (doy - 1) * 24 + h;
      if (!(H.bare[i] > 0)) continue;
      const dni = sky === 'clear' ? clearDNI(doy, H.alt[i]) : sky === 'recorded' ? rec[i] : C.dni[mo][h];
      months[mo].ent += dni * H.ent[i] / 1000; months[mo].bare += dni * H.bare[i] / 1000;
    }
  }
  return { months, ent: months.reduce((a, m) => a + m.ent, 0), bare: months.reduce((a, m) => a + m.bare, 0) };
}

/* ---------- inside ----------
   Irradiance on an interior surface is the beam, less what the glass keeps
   (SHGC), on the surface's own tilt: DNI x SHGC x cos(beam, surface normal). */
/** a grid over a region of the floor: 200 mm cells, coarser on a big region
 *  so a winter's reach does not cost a million traces */
export function floorGrid(G0) {
  const W = G0.u1 - G0.u0, D = G0.w1 - G0.w0, cell = Math.max(0.2, Math.sqrt(W * D / 3000));
  const nu = Math.max(4, Math.round(W / cell)), nw = Math.max(4, Math.round(D / cell));
  return { u0: G0.u0, w1: G0.w1, nu, nw, du: W / nu, dw: D / nw };
}
/** W/m2 on every floor cell at one instant */
export function floorNow(m, R, sl, dni) {
  const G = floorGrid(R), v = new Float32Array(G.nu * G.nw);
  if (sl[1] <= 1e-6 || sl[2] <= 1e-9 || dni <= 0) return Object.assign(G, { v, max: 0 });
  const E = dni * m.shgc * sl[1];
  let max = 0;
  for (let i = 0; i < G.nu; i++) for (let j = 0; j < G.nw; j++) {
    const P = [G.u0 + (i + 0.5) * G.du, 1e-6, G.w1 - (j + 0.5) * G.dw];
    if (interiorLit(m, P, sl)) { v[i * G.nw + j] = E; max = E; }
  }
  return Object.assign(G, { v, max });
}
/** Wh/m2 on every floor cell over the selected day, or kWh/m2 over the year */
export function floorTotal(m, R, sky, wx, span, doy, mode) {
  const G = floorGrid(R), v = new Float32Array(G.nu * G.nw);
  const C = CLIMATE[wx];
  const add = (sp, dni, weight) => {
    if (sp.alt <= 0 || dni <= 0) return;
    const sl = sunLocal(sp.alt, sp.az, m.gf);
    if (sl[2] <= 1e-9 || sl[1] <= 1e-6) return;
    const E = dni * m.shgc * sl[1] * weight;
    for (let i = 0; i < G.nu; i++) for (let j = 0; j < G.nw; j++) {
      const P = [G.u0 + (i + 0.5) * G.du, 1e-6, G.w1 - (j + 0.5) * G.dw];
      if (interiorLit(m, P, sl)) v[i * G.nw + j] += E;
    }
  };
  if (span === 'day') {
    for (let t = 0.125; t < 24; t += 0.25) { const b = beamAt(sky, wx, doy, t, mode); add(b.sp, b.dni, 0.25); }   // Wh/m2
  } else {
    for (let mo = 0; mo < 12; mo++) {
      const d = doyOf(mo + 1, sky === 'clear' ? 21 : 15);
      for (let h = 0; h < 24; h++) {
        const sp = solarPosition(d, h + 0.5, 'lst');
        // a representative day a month is enough for a map; its beam is the month's mean
        add(sp, sky === 'clear' ? clearDNI(d, sp.alt) : C.dni[mo][h], C.ndays[mo] / 1000);   // kWh/m2
      }
    }
  }
  let max = 0;
  for (const x of v) if (x > max) max = x;
  return Object.assign(G, { v, max });
}

/** where the entering beam lands at one instant, surface by surface, in W -
 *  found by tracing back from a fine grid on each; what is left over fell on
 *  the inside of the window reveal before it reached the room. The floor is
 *  searched over the region the sun can reach, and an outside wall only where
 *  that region meets it. */
export function landing(m, R, sl, dni, Rg = R) {
  const out = {};
  let total = 0;
  if (sl[2] <= 1e-9 || dni <= 0) return { by: out, total };
  const step = 0.1;
  const e = 1e-6, touches = { floor: true, ceiling: false, back: Rg.w0 <= R.w0 + e, left: Rg.u0 <= R.u0 + e, right: Rg.u1 >= R.u1 - e };
  for (const S of roomSurfaces(R)) {
    const c = S.cos(sl);
    if (c <= 1e-6 || !touches[S.key]) continue;
    let [a0, a1, b0, b1] = S.rect;
    if (S.key === 'floor') [a0, a1, b0, b1] = [Rg.u0, Rg.u1, Rg.w0, Rg.w1];
    else if (S.key === 'back') [a0, a1] = [Rg.u0, Rg.u1];
    else [a0, a1] = [Rg.w0, Rg.w1];
    const na = Math.max(2, Math.min(400, Math.round((a1 - a0) / step))), nb = Math.max(2, Math.min(400, Math.round((b1 - b0) / step)));
    const da = (a1 - a0) / na, db = (b1 - b0) / nb;
    let lit = 0;
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
      const P = [0, 0, 0];
      P[S.ax] = S.at + S.n[S.ax] * 1e-6; P[S.uv[0]] = a0 + (i + 0.5) * da; P[S.uv[1]] = b0 + (j + 0.5) * db;
      if (interiorLit(m, P, sl)) lit++;
    }
    const W = lit * da * db * dni * m.shgc * c;
    if (W > 0) { out[S.key] = W; total += W; }
  }
  return { by: out, total };
}
export { clamp };
