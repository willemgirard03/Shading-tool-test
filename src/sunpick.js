/* Finding the date and time of a sun position. Both sun drawings place the
   sun by altitude and azimuth, and the handles in the section and the plan ask
   for one by angle, so each is turned back into a date and a time here. */

import { clamp } from './util.js';
import { solarPosition, sunVec } from './solar.js';

let samples = { key: '', pts: null };
export function sunSamples(mode) {
  if (samples.key === mode) return samples.pts;
  const pts = [];
  for (let doy = 1; doy <= 365; doy += 3) for (let t = 2; t <= 22.001; t += 0.2) {
    const sp = solarPosition(doy, t, mode);
    if (sp.alt <= 0) continue;
    const v = sunVec(sp.alt, sp.az);
    pts.push([doy, t, sp.alt, sp.az, v[0], v[1], v[2]]);
  }
  samples = { key: mode, pts };
  return pts;
}

/* The sun found from an altitude and an azimuth, for the handles in the
   section and the plan: the date and time whose sun stands nearest that
   direction. Not every direction is reached - Vancouver's sun is never above
   64.3 degrees, and only near midsummer noon up there - so a handle asked for
   the impossible gets the nearest sun there is. Each direction the sun does
   reach it reaches on two dates, one either side of a solstice; the nearer to
   the date already set is kept, so a drag stays on its side of the year. */
export function pickSunAt(S, alt, az) {
  const t = sunVec(alt, az), cyc = d => { const a = Math.abs(d - S.doy); return Math.min(a, 365 - a); };
  const LAM = 1e-7, score = (v, doy) => (v[0] - t[0]) ** 2 + (v[1] - t[1]) ** 2 + (v[2] - t[2]) ** 2 + LAM * cyc(doy) ** 2;
  let best = null, bs = Infinity;
  for (const p of sunSamples(S.timeMode)) { const sc = score([p[4], p[5], p[6]], p[0]); if (sc < bs) { bs = sc; best = p; } }
  if (!best) return null;
  let bDoy = best[0], bT = best[1];
  for (let dd = -3; dd <= 3; dd++) {
    const doy = clamp(best[0] + dd, 1, 365);
    for (let h = best[1] - 0.2; h <= best[1] + 0.2001; h += 0.01) {
      const sp = solarPosition(doy, h, S.timeMode);
      if (sp.alt <= 0) continue;
      const sc = score(sunVec(sp.alt, sp.az), doy);
      if (sc < bs) { bs = sc; bDoy = doy; bT = h; }
    }
  }
  return { doy: bDoy, hour: clamp(bT, 0, 24) };
}

