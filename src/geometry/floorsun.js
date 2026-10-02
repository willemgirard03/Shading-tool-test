/* The sun on the floor of the working storey, through more than one window.

   The plan shows the floor lit by the windows the results are for: the
   selected one, every window of its side on this storey, or every window of
   the storey. A storey is one open, rectangular room, so a ray from a point of
   its floor toward the sun leaves it through exactly one facade, and the
   point is lit if that ray gets out through a window there, past its reveal
   and every device. Each window's own test is the one the single window uses;
   this only asks it of each window in turn, in that window's own frame. */

import { unitModel } from './building.js';
import { roomOf, sunPatches, interiorLit } from './room.js';
import { storeyParts } from './storey.js';
import { sunLocal, solarPosition } from '../solar.js';
import { floorGrid, beamAt, clearDNI } from '../energy.js';
import { CLIMATE } from '../data/climate.js';
import { doyOf } from '../util.js';

/** which windows light the plan, for each choice of results */
export const PLAN_LIGHT = { unit: 'unit', storey: 'side', facade: 'side', level: 'floor', building: 'floor' };
export const PLAN_LIGHT_WORDS = { unit: 'the selected window', side: 'every window of this side', floor: 'every window of the storey' };

/** the windows of the working storey whose sun the plan shows: { P, m, R } */
export function lightUnits(F) {
  const { S, B, sel, m } = F, k = PLAN_LIGHT[S.scope] || 'unit';
  if (!m.opening) return [];
  return storeyParts(F).filter(P => P.kind === 'unit' && (k === 'floor' || P.f === sel.f) && (k !== 'unit' || P.sel))
    .map(P => { const mu = P.sel ? m : unitModel(B, P.f, sel.st, P.i); return { P, m: mu, R: roomOf(mu, S) }; });
}

/** at this instant: every window's patch on the floor, in the selected frame */
export function floorNowAll(F, units, dni) {
  const { cur } = F, patches = [];
  let max = 0, far = Infinity;
  if (!cur.up || dni <= 0) return { patches, max, far: null, n: 0 };
  let n = 0;
  for (const x of units) {
    const sl = sunLocal(cur.alt, cur.az, x.m.gf);
    if (sl[2] <= 1e-9 || sl[1] <= 1e-6) continue;
    const toSel = ([a, b]) => { const q = x.P.map([a, 0, b]); return [q[0], q[2]]; };
    let any = false;
    for (const p of sunPatches(x.m, x.R, sl)) {
      if (p.S.key !== 'floor') continue;
      const lit = p.lit.map(toSel);
      patches.push({ lit, shade: p.shade.map(sh => sh.map(toSel)) });
      for (const q of lit) far = Math.min(far, q[1]);
      any = true;
    }
    if (any) { n++; max = Math.max(max, dni * x.m.shgc * sl[1]); }
  }
  return { patches, max, far: isFinite(far) ? far : null, n };
}

/** over the day (Wh/m2) or the year (kWh/m2), on a grid over the whole storey
 *  R, in the selected frame - the same steps and weights as one window's map */
export function floorTotalAll(F, units, R, sky, wx, span, doy, mode) {
  const G = floorGrid(R), n = G.nu * G.nw, v = new Float32Array(n), C = CLIMATE[wx];
  // every cell in every window's own frame, worked out once
  const local = units.map(x => {
    const a = new Float64Array(n * 2);
    for (let i = 0; i < G.nu; i++) for (let j = 0; j < G.nw; j++) {
      const q = x.P.inv([G.u0 + (i + 0.5) * G.du, 1e-6, G.w1 - (j + 0.5) * G.dw]), k = (i * G.nw + j) * 2;
      a[k] = q[0]; a[k + 1] = q[2];
    }
    return a;
  });
  const P = [0, 1e-6, 0];
  const add = (sp, dni, weight) => {
    if (sp.alt <= 0 || dni <= 0) return;
    units.forEach((x, ui) => {
      const sl = sunLocal(sp.alt, sp.az, x.m.gf);
      if (sl[2] <= 1e-9 || sl[1] <= 1e-6) return;
      const E = dni * x.m.shgc * sl[1] * weight, a = local[ui];
      for (let c = 0; c < n; c++) { P[0] = a[c * 2]; P[2] = a[c * 2 + 1]; if (interiorLit(x.m, P, sl)) v[c] += E; }
    });
  };
  if (span === 'day') {
    for (let t = 0.125; t < 24; t += 0.25) { const b = beamAt(sky, wx, doy, t, mode); add(b.sp, b.dni, 0.25); }
  } else {
    for (let mo = 0; mo < 12; mo++) {
      const d = doyOf(mo + 1, sky === 'clear' ? 21 : 15);
      for (let h = 0; h < 24; h++) {
        const sp = solarPosition(d, h + 0.5, 'lst');
        add(sp, sky === 'clear' ? clearDNI(d, sp.alt) : C.dni[mo][h], C.ndays[mo] / 1000);
      }
    }
  }
  let max = 0;
  for (const x of v) if (x > max) max = x;
  return Object.assign(G, { v, max });
}
