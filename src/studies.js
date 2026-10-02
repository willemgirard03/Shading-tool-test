/* The costly studies, cached against the target they were computed for.

   The sky mask and the annual study re-run the ray test thousands of times -
   once per distinct unit when a storey or a facade is analysed - so they are
   recomputed after a control settles rather than on every tick; in the
   meantime the last one is shown. The limit lines and the day's samples are
   quick enough to compute when asked, but are kept until the target changes. */

import { computeMaskT, envelopeT, annualStudyBy, daySamplesBy, dailyProfileBy, fracOfT, daySpan,
  computeMaskW, annualStudyW, daySamplesW, dailyProfileW, daySpanW } from './geometry/analysis.js';
import { doyOf } from './util.js';
import { CLIMATE } from './data/climate.js';

export const ALT_MAX = 72;                // Vancouver peaks at 64.3 deg on 21 Jun
const C = { mask: null, env: { key: '', real: null, ideal: null }, annual: { key: '', v: null }, day: { key: '', v: null }, prof: { key: '', v: null } };

export function resetStudies() {
  C.mask = null; C.env = { key: '', real: null, ideal: null };
  C.annual = { key: '', v: null }; C.day = { key: '', v: null }; C.prof = { key: '', v: null };
}

/** the mask as it stands; computed now only if there is none at all */
export function getMask(T, compute = false) {
  if (!T.items.length) return null;
  if (C.mask && C.mask.key === T.key) return C.mask;
  if (compute || !C.mask) C.mask = T.multi ? computeMaskW(T) : computeMaskT(T);
  return C.mask;
}
export const maskStale = T => T.items.length > 0 && (!C.mask || C.mask.key !== T.key);

/** the two limit lines. One unit's are quick and computed when asked; a
 *  storey's or a side's wait for the settled pass like the mask, and the last
 *  pair is shown meanwhile. */
export function getEnvelopes(T, compute = false) {
  // a limit line is a cut-off seen from one side; round a corner it means nothing
  if (!T.items.length || T.multi) return null;
  if (C.env.key === T.key) return C.env;
  if (compute || T.items.length === 1 || !C.env.real)
    C.env = { key: T.key, real: envelopeT(T, false, ALT_MAX), ideal: envelopeT(T, true, ALT_MAX) };
  return C.env;
}
export const envStale = T => T.items.length > 0 && !T.multi && C.env.key !== T.key;

const annualKey = (T, wx) => T.key + '|' + wx;
export function getAnnual(T, wx, compute = false) {
  if (!T.items.length) return null;
  const key = annualKey(T, wx);
  if (C.annual.v && C.annual.key === key) return C.annual.v;
  if (compute || !C.annual.v) C.annual = { key, v: T.multi ? annualStudyW(T, CLIMATE[wx], doyOf) : annualStudyBy(T.gf, fracOfT(T, 17, 13), CLIMATE[wx], doyOf) };
  return C.annual.v;
}
export const annualStale = (T, wx) => T.items.length > 0 && (!C.annual.v || C.annual.key !== annualKey(T, wx));

export function getDaySamples(T, doy, timeMode) {
  if (!T.items.length) return [];
  const key = T.key + '|' + doy + '|' + timeMode;
  if (C.day.key !== key) C.day = { key, v: T.multi ? daySamplesW(T, doy, timeMode) : daySamplesBy(T.gf, fracOfT(T, 9, 7), doy, timeMode) };
  return C.day.v;
}
export function getDailyProfile(T, doy, timeMode) {
  if (!T.items.length) return null;
  const key = T.key + '|' + doy + '|' + timeMode;
  if (C.prof.key !== key) C.prof = { key, v: T.multi ? dailyProfileW(T, doy, timeMode) : dailyProfileBy(T.gf, fracOfT(T, 21, 17), doy, timeMode) };
  return C.prof.v;
}
/** sunrise, sunset and the spells with sun on the target's side or sides */
export const getDaySpan = (T, doy, timeMode) => T.multi && T.items.length ? daySpanW(T, doy, timeMode) : daySpan(T.gf, doy, timeMode);

/* ---------- direct solar gain and the room ----------
   One unit's are quick and computed when asked; a storey's, a side's or the
   building's, and the room's day and year maps, wait for the settled pass and
   show "working" until then - a stale total would be a wrong one.          */
import { dayGain, yearGain, hourlyStudy, floorTotal } from './energy.js';
import { floorTotalAll, PLAN_LIGHT } from './geometry/floorsun.js';
const G = { day: { key: '', v: null }, hours: { key: '', v: null } };
/* The room's maps are kept a few at a time, by key, the oldest let go: a plan
   of a saved window can stand beside the plan of the selection, and each keeps
   its own floor without the other recomputing it away. */
const KEEP = 8;
const put = (c, key, v) => { c.delete(key); c.set(key, v); while (c.size > KEEP) c.delete(c.keys().next().value); return v; };
const FL = { day: new Map(), year: new Map() };
const gainKey = (T, S, withDay) => [T.key, S.sky, S.wx].concat(withDay ? [S.doy, S.timeMode] : []).join('|');
const cheap = T => T.items.length <= 2;
export function getDayGain(T, S, compute = false) {
  if (!T.items.length) return null;
  const key = gainKey(T, S, true);
  if (G.day.key !== key && (compute || cheap(T))) G.day = { key, v: dayGain(T, S.sky, S.wx, S.doy, S.timeMode) };
  return G.day.key === key ? G.day.v : null;
}
export const dayGainStale = (T, S) => T.items.length > 0 && G.day.key !== gainKey(T, S, true);
/** every hour of the year's geometry for a target: run once, whatever the sky */
export function getHourly(T, compute = false) {
  if (!T.items.length) return null;
  if (G.hours.key !== T.key && compute) G.hours = { key: T.key, v: hourlyStudy(T) };
  return G.hours.key === T.key ? G.hours.v : null;
}
export function getYearGain(T, S, compute = false) {
  const H = getHourly(T, compute);
  return H ? yearGain(H, S.sky, S.wx) : null;
}
export const yearGainStale = T => T.items.length > 0 && G.hours.key !== T.key;

const plateKey = (S, m) => { const p = S.storeys[m.st] || S.storeys[0]; return [p.w, p.d, p.ox || 0, p.oy || 0].join('x'); };
// units alike in every way but where they stand along the side still see different rooms
const floorKey = (m, S, span) => [m.key, m.f, m.cc, plateKey(S, m), S.sky, S.wx].concat(span === 'day' ? [S.doy, S.timeMode] : []).join('|');
export function getFloor(m, R, S, span, compute = false) {
  if (!m.opening) return null;
  const c = FL[span === 'day' ? 'day' : 'year'], key = floorKey(m, S, span);
  if (!c.has(key) && compute) put(c, key, floorTotal(m, getRegion(m, R, S, span), S.sky, S.wx, span, S.doy, S.timeMode));
  return c.has(key) ? c.get(key) : null;
}
export const floorStale = (m, S, span) => !!m.opening && !FL[span === 'day' ? 'day' : 'year'].has(floorKey(m, S, span));
/* the storey's floor lit through every window the results are for: keyed on
   the whole design, since any window of the storey, or a device above it, can
   change it */
const FA = { day: new Map(), year: new Map() };
// the map is kept in the selected window's frame, so it belongs to that window too
const floorAllKey = (F, span) => [PLAN_LIGHT[F.S.scope], F.sel.f, F.sel.st, F.sel.unit, F.S.rot || 0, JSON.stringify(F.S.storeys), F.S.sky, F.S.wx]
  .concat(span === 'day' ? [F.S.doy, F.S.timeMode] : []).join('|');
export function getFloorAll(F, units, R, span, compute = false) {
  const c = FA[span === 'day' ? 'day' : 'year'], key = floorAllKey(F, span);
  if (!c.has(key) && compute) put(c, key, floorTotalAll(F, units, R, F.S.sky, F.S.wx, span, F.S.doy, F.S.timeMode));
  return c.has(key) ? c.get(key) : null;
}
export const floorAllStale = (F, span) => !FA[span === 'day' ? 'day' : 'year'].has(floorAllKey(F, span));
export function resetGains() {
  for (const k of Object.keys(G)) G[k] = { key: '', v: null };
  for (const c of [FL.day, FL.year, FA.day, FA.year]) c.clear();
}

/* how far in the sun gets: by the date for this instant and the day, by the
   year for the year - kept until the geometry or the date moves */
import { reachRegion } from './geometry/room.js';
const REG = { day: new Map(), year: new Map() };
const DOY21 = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];
export function getRegion(m, R, S, span) {
  const c = REG[span === 'year' ? 'year' : 'day'], key = [m.key, m.f, m.cc, plateKey(S, m), span === 'year' ? 'year' : S.doy].join('|');
  if (!c.has(key)) put(c, key, reachRegion(m, R, span === 'year' ? DOY21 : [S.doy]));
  return c.get(key);
}
