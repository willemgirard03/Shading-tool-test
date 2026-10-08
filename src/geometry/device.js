/* A shading device: one member, and optionally an array of it.

   The member is a blade - horizontal, running across the facade - or a fin -
   vertical, running up it. It is placed by justification on the opening it
   shades (left, centre or right; top, centre or bottom), nudged off that point
   if asked, and stood off the wall face by its offset - the gap between the
   wall and its wall edge, laid flat. It rotates about a hinge line on its own
   depth: the wall edge, the middle or the outer edge; moving the hinge moves
   the line it turns about, not the member.
   With the usual positive angle - a blade's outer edge dropped, a fin's swung
   right - the wall edge is the blade's top and the fin's left, which is what
   the Top / Left words in the panel mean.
     A member hinged anywhere but its wall edge, or tilted about it, reaches
   back behind its hinge. Where the offset asked for would bury that part in
   the wall, the member is held out just far enough that its nearest point
   touches the wall face; the offset keeps the value it was given.

   An array repeats the member either along the facade (blades down it, fins
   across it) or out from the wall. It is anchored where the member was, so the
   member's justification is the array's; the member itself is simply an array
   of one. Because members swing about their hinge, a tilted array can stand a
   little outside its own length, exactly as a built one does.

   Everything here is a pure function of the parameters and the opening.     */

import { D2R } from '../util.js';
import { arrayPositions, memberSpan, arrayLimits } from './arrays.js';

export const HINGE_F = { start: 0, centre: 0.5, end: 1 };   // fraction of the depth from the wall edge

export const DEVICE0 = (dir = 'h') => ({
  // len: with lenRel, how far the member runs past the window's own width (a blade) or height (a fin) -
  // negative is shorter; without it, its length outright. Left unset, a length of 0 or less is the window's own
  dir, name: null, depth: 0.30, thick: 0.05, angle: 0, len: 0, lenRel: undefined,
  hinge: 'start', justU: dir === 'h' ? 'centre' : 'start', justV: dir === 'h' ? 'start' : 'centre',
  offOn: false, offU: 0, offV: 0, offset: 0,
  arr: null
});
export const DEVICE_KEYS = Object.keys(DEVICE0());
/** the keys the geometry depends on - a name is not one of them */
export const GEOM_KEYS = DEVICE_KEYS.filter(k => k !== 'name');
export const ARRAY_KEYS = ['along', 'mode', 'count', 'spacing', 'len', 'ends'];

/** an array as it is first offered: along the facade over the whole opening,
 *  louvres at a pitch equal to their depth, fins at 500 */
export function array0(D, g) {
  const out = false;
  return { along: 'facade', mode: 'spacing', count: 5, ends: true,
    spacing: D.dir === 'h' ? Math.max(0.05, D.depth) : 0.5,
    len: arrayLen0(D, g, out) };
}
/** the length an array is given when it is created or turned: the opening's
 *  own dimension along the facade, a workable canopy reach out from the wall */
export const arrayLen0 = (D, g, out) => out ? 1.2 : D.dir === 'h' ? g.v1 - g.v0 : g.u1 - g.u0;

/* ---------- words ---------- */
/** what a device is called, from what it is. An array keeps its name at zero
 *  length, so a slider dragged to the end does not rename it under the hand. */
export function deviceName(D) {
  const arr = !!D.arr, out = arr && D.arr.along === 'out';
  if (D.dir === 'h') return !arr ? (D.justV === 'start' ? 'Overhang' : 'Blade') : out ? 'Louvred canopy' : 'Horizontal louvres';
  return !arr ? 'Fin' : out ? 'Fins stepping out' : 'Vertical fins';
}
/** is a member's length measured from the window's own dimension (rather than given outright) */
export const lenFromWindow = D => D.lenRel ?? !(D.len > 0);
/** a member's length along a span of the window: the span plus its extension, or its own length */
export const memberLen = (D, span) => Math.max(0.01, lenFromWindow(D) ? span[1] - span[0] + (D.lenRel === undefined ? 0 : D.len || 0) : D.len);
/** what a device is called on the page: its own name, or what it is */
export const deviceLabel = (D, i) => D.name || (i === undefined ? deviceName(D) : 'Device ' + (i + 1) + ' (' + deviceName(D).toLowerCase() + ')');
export const JUST_WORDS = {
  u: { start: 'Left', centre: 'Centre', end: 'Right' },
  v: { start: 'Top', centre: 'Centre', end: 'Bottom' }
};
/** the hinge, in the words of the axis the member's depth swings across */
export const hingeWords = () => ({ start: 'Inside', centre: 'Centre', end: 'Outside' });
/** the array as it is laid out on an opening: one that follows the window runs the window's own
 *  dimension along it and what it runs past it (rel, its len the extension); otherwise its own length */
export function arrayOn(D, g) {
  const A = D && D.arr;
  if (!A || !A.rel || A.along === 'out') return A || null;
  const span = D.dir === 'h' ? g.v1 - g.v0 : g.u1 - g.u0;
  return Object.assign({}, A, { len: Math.max(0, span + (A.len || 0)) });
}
/** the window's own dimension that an array along the facade follows */
export const arraySpan = (D, g) => D.dir === 'h' ? g.v1 - g.v0 : g.u1 - g.u0;

export const isLive = D => !!D && D.depth > 0;

/* ---------- a device as boxes ----------
   Each box: { c, e1, e2, e3, h } plus kind ('h' blade or 'v' fin), anchor (its
   height for a blade, its u for a fin), at (its position along the axis its
   array repeats on) and D, the device it came from.
     g = { u0, u1, v0, v1 } the opening in facade coordinates, and reveal, the
   depth of the wall face in front of the glass. Offsets are read from the wall
   face, which is where a device is fixed. `free` builds it exactly where its
   hinge says, wall or no wall - the idealised protractor device wants that. */
export function buildDevice(D, g, free = false) {
  const boxes = [];
  if (!isLive(D)) return boxes;
  const d = D.depth, t = D.thick, a = D.angle * D2R, ca = Math.cos(a), sa = Math.sin(a);
  const f = HINGE_F[D.hinge] ?? 0, k = (0.5 - f) * d;        // hinge to centre, along the depth
  const offU = D.offOn ? D.offU : 0, offV = D.offOn ? D.offV : 0;
  // the hinge line stands its own distance into the depth past the offset, so the member laid flat keeps its gap to the wall
  const wh = D.offset + f * d, w0 = g.reveal + (free ? wh : Math.max(wh, reachBack(D)));
  const uSpan = [g.u0, g.u1], vSpan = [g.v0, g.v1];
  const AA = arrayOn(D, g), A = AA && AA.len > 1e-9 ? AA : null;
  const out = A && A.along === 'out';
  const outs = out ? arrayPositions(A, [w0, w0 + A.len], 1, 'start') : [w0];

  if (D.dir === 'h') {
    const eD = [0, -sa, ca], eN = [0, ca, sa];             // depth runs from the wall edge outward
    const [uc, uh] = memberSpan(memberLen(D, uSpan), uSpan, 1, D.justU);
    const rows = arrayPositions(out ? null : A, vSpan, -1, D.justV);
    for (const v0 of rows) for (const ww of outs) {
      const vv = v0 + offV;
      boxes.push({ c: [uc + offU, vv + k * eD[1], ww + k * eD[2]], e1: [1, 0, 0], e2: eD, e3: eN,
        h: [uh, d / 2, t / 2], kind: 'h', anchor: vv, at: out ? ww : vv, D });
    }
  } else {
    const eD = [sa, 0, ca], eN = [ca, 0, -sa];
    const [vc, vh] = memberSpan(memberLen(D, vSpan), vSpan, -1, D.justV);
    const cols = arrayPositions(out ? null : A, uSpan, 1, D.justU);
    for (const u0 of cols) for (const ww of outs) {
      const uu = u0 + offU;
      boxes.push({ c: [uu + k * eD[0], vc + offV, ww + k * eD[2]], e1: eD, e2: [0, 1, 0], e3: eN,
        h: [d / 2, vh, t / 2], kind: 'v', anchor: uu, at: out ? ww : uu, D });
    }
  }
  return boxes;
}

/** how far a member reaches back toward the wall from its hinge line: the
 *  part of its depth on the wall side of the hinge, and its thickness, turned
 *  through its angle. Zero for an untilted member hinged at its wall edge. */
export function reachBack(D) {
  const a = D.angle * D2R, f = HINGE_F[D.hinge] ?? 0;
  const ends = [-f * D.depth, (1 - f) * D.depth];             // along the depth, from the hinge
  let lo = 0;
  for (const s of ends) for (const n of [-D.thick / 2, D.thick / 2]) lo = Math.min(lo, s * Math.cos(a) - n * Math.sin(a) * (D.dir === 'h' ? 1 : -1));
  return -lo;
}

/** what was held back, and how far a member was held off the wall */
export function deviceNotes(D, boxes, g, label) {
  const notes = arrayLimits(arrayOn(D, g)).map(n => label + ': ' + n);
  const back = reachBack(D), wh = D.offset + (HINGE_F[D.hinge] ?? 0) * D.depth;
  if (boxes.length && back > wh + 0.0005)
    notes.push(label + ' is held ' + Math.round((back - wh) * 1000) + ' mm further out than its offset, so that turning it does not bury it in the wall.');
  return notes;
}

/* ---------- from the v4 description ----------
   v4 described a system by type - overhang, louvres, canopy, fins - with the
   array offset measured along the array and a length of 0 meaning the opening.
   This turns one into a member and an array, exactly: the test suite builds
   both and requires the same boxes, and the test scenarios are written this way. */
export function deviceFromV4(P, winW, winH) {
  const D = Object.assign(DEVICE0(P.dev === 'fin-v' ? 'v' : 'h'), {
    depth: P.depth, thick: P.thick, angle: P.angle, offset: P.offset, hinge: 'start', len: P.elemLen || 0 });
  const arrLen = (P.arrLen > 0 ? P.arrLen : null);
  const arr = len => ({ along: 'facade', mode: P.arrMode || 'spacing', count: P.count ?? 5, spacing: P.spacing,
    len, ends: P.ends !== false });
  if (P.dev === 'overhang') {
    Object.assign(D, { justV: P.arrJust || 'start', justU: P.elemJust || 'centre', offV: -(P.arrOff || 0), offU: P.elemOff || 0 });
  } else if (P.dev === 'louvre-h') {
    Object.assign(D, { justV: P.arrJust || 'start', justU: P.elemJust || 'centre', offV: -(P.arrOff || 0), offU: P.elemOff || 0,
      arr: arr(arrLen ?? winH) });
  } else if (P.dev === 'louvre-oh') {
    // v4 set the canopy's height off the head and ran it out from the wall face plus its offset
    Object.assign(D, { justV: 'start', justU: P.elemJust || 'centre', offV: P.ohV || 0, offU: P.elemOff || 0,
      offset: P.offset + (P.arrOff || 0), arr: Object.assign(arr(arrLen ?? winH), { along: 'out' }) });
  } else if (P.dev === 'fin-v') {
    Object.assign(D, { justU: P.arrJust || 'start', justV: P.elemJust || 'centre', offU: P.arrOff || 0, offV: -(P.elemOff || 0),
      arr: arr(arrLen ?? winW) });
  } else return null;
  D.offOn = !!(D.offU || D.offV);
  return D;
}
