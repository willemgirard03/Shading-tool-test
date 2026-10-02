/* The site: a rectangle about the ground floor, each of its four sides set
   off from that storey's wall face by its own distance, and each a condition -
   a street, a lane, an adjoining property line, or open ground. A street or a
   lane has a width, from the property line across, and a curb set in from the
   property line; where two street sides meet, the street wraps the corner.

   The site is what the by-law reads a shading device against. A device that
   reaches past an adjoining property line is not allowed at all; one that
   reaches past the property line into a street or a lane may project only so
   far, by its height above the street and the street's width (VBBL 1.8.9.3),
   and must keep its outer edge 600 mm from the curb. siteChecks() tests every
   device on every unit of the building and says which are not compliant. */

import { SHGC_MAX } from '../library.js';
import { D2R } from '../util.js';
import { boxSpan } from './boxes.js';
import { storeyRot, storeyCentre, FACADES } from './building.js';

export const SITE_KINDS = { street: 'Street', lane: 'Lane', property: 'Adjoining property', open: 'Open ground' };
const seg = (kind, off, width, curb) => ({ kind, off, width, curb });
export const site0 = () => ({ edit: 'S', N: seg('property', 3, 6, 0), E: seg('property', 3, 6, 0), S: seg('street', 0, 20, 3), W: seg('property', 3, 6, 0) });
export const SITE_FIELDS = { off: [0, 40], width: [3, 60], curb: [0, 15] };
export const isStreet = s => s && (s.kind === 'street' || s.kind === 'lane');

const turn = (a, x, y) => { const r = a * D2R, c = Math.cos(r), s = Math.sin(r); return [x * c + y * s, -x * s + y * c]; };
/** the site in the ground floor's own axes, and the way between those and the world */
export function siteFrame(S) {
  const p = S.storeys[0], a = storeyRot(S, 0), C = storeyCentre(S, 0), sg = Object.assign(site0(), S.site || {});
  const x0 = -p.w / 2 - sg.W.off, x1 = p.w / 2 + sg.E.off, y0 = -p.d / 2 - sg.S.off, y1 = p.d / 2 + sg.N.off;
  const toW = (x, y) => { const q = turn(a, x, y); return [q[0] + C[0], q[1] + C[1]]; };
  const toL = P => turn(-a, P[0] - C[0], P[1] - C[1]);
  // each side's outward normal, in the world
  const nrm = f => { const l = { S: [0, -1], N: [0, 1], E: [1, 0], W: [-1, 0] }[f]; return turn(a, l[0], l[1]); };
  return { a, C, x0, x1, y0, y1, toW, toL, nrm, seg: sg, w: p.w, d: p.d,
    corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => toW(x, y)) };
}
/** how far a world point stands inside the boundary on side f (negative: past it) */
export function insideBy(SF, f, P) {
  const [x, y] = SF.toL(P);
  return f === 'S' ? y - SF.y0 : f === 'N' ? SF.y1 - y : f === 'E' ? SF.x1 - x : x - SF.x0;
}

/** VBBL 1.8.9.3: the projection allowed into a street at a height above it, in mm */
export function projectionAt(h, streetW) {
  if (streetW < 10) return h >= 7.62 ? { mm: 915, band: '7.62 m and up, street under 10 m', narrow: true } : { mm: 0, band: 'below 7.62 m, street under 10 m', narrow: true };
  if (h < 2.75) return { mm: 0, band: 'below 2.75 m' };
  if (h <= 5.2) return { mm: 500, band: '2.75 m to 5.2 m' };
  if (h <= 7.62) return { mm: 915, band: '5.2 m to 7.62 m' };
  return { mm: 1370, band: 'more than 7.62 m' };
}

/** one unit's devices read against its side's boundary: { sys, reach, low, beyond, allow, ok, why } each */
export function unitChecks(S, SF, row, q) {
  const f = row.f, sg = SF.seg[f], c = q.cell, fr = row.frame;
  const P = [fr.O[0] + fr.U[0] * q.cc, fr.O[1] + fr.U[1] * q.cc], dist = insideBy(SF, f, P);
  const n = SF.nrm(f), cosA = Math.max(0, fr.W[0] * n[0] + fr.W[1] * n[1]);
  const by = new Map();
  for (const b of c.elements) {
    if (b.ctx) continue;
    const e = by.get(b.sys) || { sys: b.sys, D: b.D, reach: 0, low: Infinity };
    e.reach = Math.max(e.reach, b.c[2] + boxSpan(b, 2) - c.reveal);
    e.low = Math.min(e.low, b.c[1] - boxSpan(b, 1));
    by.set(b.sys, e);
  }
  const out = [];
  for (const e of by.values()) {
    const low = row.zb + e.low, beyond = e.reach * cosA - dist;
    let ok = true, allow = null, why = '';
    if (beyond > 1e-3) {
      if (sg.kind === 'property') { ok = false; why = 'reaches ' + Math.round(beyond * 1000) + ' mm past an adjoining property line'; }
      else if (isStreet(sg)) {
        const lim = projectionAt(low, sg.width), byCurb = Math.max(0, (sg.curb - 0.6) * 1000);
        allow = Math.min(lim.mm, byCurb);
        ok = beyond * 1000 <= allow + 0.5;
        why = Math.round(beyond * 1000) + ' mm into the ' + sg.kind + ' at ' + low.toFixed(2) + ' m, ' + (lim.mm ? 'up to ' + Math.min(lim.mm, byCurb) + ' mm allowed' : 'none allowed') + (byCurb < lim.mm ? ' (the curb governs)' : '');
      }
    }
    out.push({ sys: e.sys, D: e.D, reach: e.reach, low, beyond, dist, allow, ok, why, kind: sg.kind });
  }
  return out;
}
/** every device of the building against the site: Map 'f|st|i' -> checks, and the totals */
export function siteChecks(S, B) {
  const SF = siteFrame(S), map = new Map();
  let devices = 0, past = 0, bad = 0;
  for (const f of Object.keys(FACADES)) for (const row of B.facades[f].rows) {
    if (!row.cell) continue;
    for (const q of row.units) {
      if (!q.cell.elements.length) continue;
      const cs = unitChecks(S, SF, row, q);
      if (!cs.length) continue;
      map.set(f + '|' + row.st + '|' + q.i, cs);
      for (const x of cs) { devices++; if (x.beyond > 1e-3) past++; if (!x.ok) bad++; }
    }
  }
  // glass over the by-law's SHGC: the control stops at it, so only a design made some other way has any
  const glass = new Set();
  for (const f of Object.keys(FACADES)) for (const row of B.facades[f].rows) if (row.cell) for (const q of row.units)
    if ((q.cell.glz.shgc ?? 0) > SHGC_MAX + 1e-9) glass.add(f + '|' + row.st + '|' + q.i);
  return { SF, map, devices, past, bad, glassOver: glass.size,
    /** is a unit's glass over the SHGC the by-law allows */
    glassBad: (f, st, i) => glass.has(f + '|' + st + '|' + i),
    /** the device indices on a unit that are not compliant */
    badOf: (f, st, i) => { const cs = map.get(f + '|' + st + '|' + i); return cs ? new Set(cs.filter(x => !x.ok).map(x => x.sys)) : null; } };
}
