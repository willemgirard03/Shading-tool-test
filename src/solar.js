/* Solar position for the site: Cooper's declination, a Spencer-style equation
   of time, and the standard spherical relations. Accurate to about a tenth of a
   degree - well inside the tolerance of a preliminary louvre study, well
   outside what a heliodon calibration would want.

   Clock time is one of three:
     'lst'  Pacific Standard Time (UTC-8), the convention the weather files use
     'pdt'  Pacific Daylight Time, LST + 1 h
     'sol'  apparent solar time, given directly                              */

import { D2R, R2D, clamp, wrap360, wrap180 } from './util.js';

/** taken from the weather-file header */
export const SITE = { lat: 49.19, lon: -123.18, tzMeridian: -120, tz: -8 };
export const CLOCK_NAME = { lst: 'UTC−8 (PST)', pdt: 'UTC−7 (PDT)', sol: 'solar' };

export function equationOfTime(doy) {               // minutes
  const B = (doy - 81) * 360 / 364 * D2R;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}
export function declination(doy) {                  // degrees
  return 23.45 * Math.sin(360 * (284 + doy) / 365 * D2R);
}

export function solarPosition(doy, clockTime, timeMode) {
  const dec = declination(doy);
  let solarTime;
  if (timeMode === 'sol') solarTime = clockTime;
  else {
    const lst = timeMode === 'pdt' ? clockTime - 1 : clockTime;
    solarTime = lst + (4 * (SITE.lon - SITE.tzMeridian) + equationOfTime(doy)) / 60;
  }
  const H = (solarTime - 12) * 15;                  // hour angle, deg, +ve afternoon
  const sd = Math.sin(dec * D2R), cd = Math.cos(dec * D2R);
  const sl = Math.sin(SITE.lat * D2R), cl = Math.cos(SITE.lat * D2R);
  const sinB = clamp(sl * sd + cl * cd * Math.cos(H * D2R), -1, 1);
  const alt = Math.asin(sinB) * R2D;
  const y = Math.sin(H * D2R) * cd;
  const x = Math.cos(H * D2R) * cd * sl - sd * cl;
  const az = wrap360(Math.atan2(y, x) * R2D + 180);
  return { alt, az, dec, solarTime, eot: equationOfTime(doy) };
}

/** sunrise and sunset in solar-time hours, or null when the sun never rises */
export function sunriseSunsetSolar(doy) {
  const dec = declination(doy) * D2R, lat = SITE.lat * D2R;
  const c = -Math.tan(lat) * Math.tan(dec);
  if (c >= 1) return null;
  if (c <= -1) return [0, 24];
  const ha = Math.acos(c) * R2D / 15;
  return [12 - ha, 12 + ha];
}
export function solarToClock(solarT, doy, timeMode) {
  if (timeMode === 'sol') return solarT;
  const lst = solarT - (4 * (SITE.lon - SITE.tzMeridian) + equationOfTime(doy)) / 60;
  return timeMode === 'pdt' ? lst + 1 : lst;
}

/** the sun as a unit vector in world axes */
export const sunVec = (alt, az) => [
  Math.cos(alt * D2R) * Math.sin(az * D2R), Math.cos(alt * D2R) * Math.cos(az * D2R), Math.sin(alt * D2R)];

/** the facade's own frame in world axes, from the compass direction its outward
 *  normal faces: n outward, u = z x n to the right seen from outside, v up */
export function facadeAxes(gf) {
  const g = gf * D2R;
  return { n: [Math.sin(g), Math.cos(g), 0], u: [-Math.cos(g), Math.sin(g), 0], v: [0, 0, 1] };
}

/** a sun direction expressed in facade coordinates [su, sv, sw] */
export function sunLocal(alt, az, gf) {
  const s = sunVec(alt, az), f = facadeAxes(gf);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return [dot(s, f.u), dot(s, f.v), dot(s, f.n)];
}

/** every derived angle for one instant, against a facade looking at gf */
export function solarAt(doy, hour, timeMode, gf) {
  const sp = solarPosition(doy, hour, timeMode);
  const gamma = wrap180(sp.az - gf);
  const sl = sunLocal(sp.alt, sp.az, gf);
  const cosInc = sl[2];
  const vsa = cosInc > 1e-6 ? Math.atan2(Math.tan(sp.alt * D2R), Math.cos(gamma * D2R)) * R2D : NaN;
  return {
    doy, ...sp, gf, gamma, sl, cosInc,
    inc: Math.acos(clamp(cosInc, -1, 1)) * R2D,
    vsa, hsa: gamma,
    onFacade: sp.alt > 0 && cosInc > 1e-6,
    up: sp.alt > 0
  };
}
