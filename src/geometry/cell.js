/* One cell of the facade: a storey of one side of the building, with its
   glazing and the shading it carries.

   A cell is built in its own facade coordinates - u across from the middle of
   one glazing unit, v up from the storey's floor, w outward from the glass,
   which is the plane w = 0 - and repeats unit by unit along the facade.

   There is one kind of glazing: a unit in a wall of given thickness, its glass
   set back from the face, so its head, sill and jambs shade it. A unit can
   fill its bay - glass to glass, no wall between it and the next - and its
   height up to the slab, the band at the top of the storey. A window wall and
   a curtain wall are just such units: they differ in their sill and in how
   far the glass is set back, a window wall's set-back being the slab edge
   standing proud of it. So any unit can be broken out of a run of curtain
   wall and given a wall of its own.

   The wall face is always the plate line, and a cell's glass sits `reveal`
   behind it. The glass is a sealed unit whose OUTSIDE face is the plane w = 0.

   The wall is decomposed, never cut: openNURBS has no booleans, and a hole
   cannot be sorted for hidden-surface drawing either. wallPieces() gives it as
   solids that tile a rectangle and leave the glazing void; wallFaces() gives
   the same slab as the faces a drawing needs.                               */

import { clamp } from '../util.js';
import { aaBox } from './boxes.js';
import { buildDevice, deviceNotes, deviceLabel, isLive, GEOM_KEYS } from './device.js';

export const GLASS_T = 0.024;             // a nominal sealed unit
export const BLANK_WALL_T = 0.30;         // a storey with no glazing system
export const SLAB0 = 0.30;                // a storey's slab, the band at its top, when none is given
export const GLAZING_TYPES = { punched: 'Glazing' };

/** a flat glazing record, as the test fixtures and the worked cases write one */
export const GLAZING0 = () => ({
  type: 'punched', name: null,
  winW: 3.0, winH: 2.4, sill: 0.9, wallT: 0.28, reveal: 0, fillW: false, fillH: false,
  winBy: 'number', winN: 4, winSp: 7.5,
  shgc: 0.40,                                 // the glass: share of the beam that becomes heat inside
  offU: 0,                                    // a broken-out window, moved along its bay (right +)
  devices: [], dev: 0
});
export const GLAZING_KEYS = ['name', 'winW', 'winH', 'sill', 'wallT', 'reveal', 'fillW', 'fillH', 'winBy', 'winN', 'winSp', 'shgc', 'offU'];
/* An older record's window wall or curtain wall, read as units that fill their
   bays and their storey to the slab; its slab is returned for the storey. */
export function normGlazing(g) {
  if (!g || !g.type || g.type === 'punched') return g;
  return Object.assign({}, g, { type: 'punched', fillW: true, fillH: true, sill: 0, reveal: g.type === 'windowwall' ? g.reveal || 0 : 0,
    winBy: g.modBy === 'number' ? 'number' : 'spacing', winN: g.modN || 20, winSp: g.module || 1.5, wallT: 0.30, slab0: g.slabT });
}
/** the width of a unit's glass in a bay of `pitch`: the bay, or its own width held to it */
export const glassWidth = (glz, pitch) => glz.fillW ? pitch : Math.min(Math.max(0.05, glz.winW), pitch);
/** how far a window may move along its bay: it stays wholly inside it */
export const offRange = (glz, pitch) => Math.max(0, (pitch - glassWidth(normGlazing(glz), pitch)) / 2);
/** the units of an array broken out in their window ('win'), their shading ('shd'), or either */
export const brokenUnits = (g, part) => {
  if (!g) return [];
  const keys = new Set([...(part !== 'shd' && g.broken ? Object.keys(g.broken) : []), ...(part !== 'win' && g.brokenShd ? Object.keys(g.brokenShd) : [])]);
  return [...keys].map(Number).sort((a, b) => a - b);
};

/** what a glazing is called: its own name, or what it is */
export const glazingLabel = g => (g && g.name) || (g ? 'Glazing' : 'No glazing');

/* How the units are set out along a side of length `len`. By number, they
   divide the side evenly and their bays tile it. By spacing, they stand at
   that pitch, centred on the side, and whatever is left at the two ends is
   plain wall. A unit's glass is never wider than its bay, so the bays never
   overlap. Returns the count, the pitch and the centre of the first unit. */
export function unitLayout(glz0, len) {
  const glz = normGlazing(glz0), byNumber = glz.winBy !== 'spacing';
  if (byNumber) {
    const n = Math.max(1, Math.round(glz.winN));
    return { n, pitch: len / n, first: -len / 2 + len / n / 2, fits: n, want: n, byNumber };
  }
  const sp = Math.max(0.3, glz.winSp), w = glassWidth(glz, sp);
  // a window must stand wholly on the side
  const n = Math.max(1, Math.floor((len - w) / sp + 1e-9) + 1);
  return { n, pitch: sp, first: -(n - 1) * sp / 2, fits: n, want: n, byNumber };
}

/* ---------- the cell model ----------
   h the storey height, len the facade length, gf the facade azimuth, slab the
   storey's slab - the band at its top, under the floor above. Returns
   everything the ray test, the drawings and the export read:
     opening   the glass of one unit, the rectangle the ray test samples
     aperture  the hole at the wall face the beam must pass; across a run of
               units that fill their bays it runs on without end
     run       the unit fills its bay: no jambs, glass to glass
     reveal    how far the wall face stands in front of the glass
     wIn       the back of the wall                                        */
export function buildCell(glz0, h, len, gf, slab) {
  const glz = normGlazing(glz0), lay = unitLayout(glz, len), notes = [];
  if (slab === undefined) slab = glz.slab0 ?? 0;
  const mm = x => Math.round(x * 1000) + ' mm';
  // the glass stands between its sill and the slab, and within its bay
  const top = Math.max(0.1, h - clamp(slab, 0, h - 0.1));
  const sill = clamp(glz.sill || 0, 0, Math.max(0, top - 0.05));
  const w = glassWidth(glz, lay.pitch), run = w >= lay.pitch - 1e-9;
  const hh = glz.fillH ? top - sill : Math.min(Math.max(0.05, glz.winH), top - sill);
  if (sill < (glz.sill || 0) - 1e-9) notes.push('The sill is held at ' + mm(sill) + ', under the slab.');
  if (!glz.fillW && glz.winW > lay.pitch + 1e-9) notes.push('The window is held to its ' + mm(lay.pitch) + ' bay, so the windows meet glass to glass.');
  if (!glz.fillH && glz.winH > top - sill + 1e-9) notes.push('The window is held under the slab: ' + mm(hh) + ' high, the storey less its slab and sill.');
  const r = Math.max(0, (lay.pitch - w) / 2), du = clamp(glz.offU || 0, -r, r);
  if (Math.abs(du) < Math.abs(glz.offU || 0) - 1e-9) notes.push('The window is moved only ' + mm(Math.abs(du)) + ', which keeps it inside its bay.');
  const opening = { u0: du - w / 2, u1: du + w / 2, v0: sill, v1: sill + hh };
  const aperture = run ? { u0: -Infinity, u1: Infinity, v0: opening.v0, v1: opening.v1 } : opening;
  const wallT = glz.wallT, reveal = Math.min(glz.reveal || 0, wallT);
  const g = { u0: opening.u0, u1: opening.u1, v0: opening.v0, v1: opening.v1, reveal };
  const live = [], elements = [];
  (glz.devices || []).forEach((D, i) => {
    if (!isLive(D)) return;
    const boxes = buildDevice(D, g);
    boxes.forEach(b => { b.sys = i; elements.push(b); });
    live.push({ D, i, boxes });
    deviceNotes(D, boxes, g, deviceLabel(D, i)).forEach(n => notes.push(n));
  });
  return {
    type: 'punched', gf, storeyH: h, slab, glz, run,
    n: lay.n, pitch: lay.pitch, fits: lay.fits, first: lay.first, len,
    opening, aperture, g,
    winW: opening.u1 - opening.u0, winH: opening.v1 - opening.v0, sill: opening.v0, head: opening.v1,
    reveal, wallT, wIn: reveal - wallT,
    live, elements, notes,
    key: cellKey(glz, h, len, gf, slab)
  };
}

/** everything a cell's geometry depends on, as one string */
export function cellKey(glz0, h, len, gf, slab = 0) {
  const glz = normGlazing(glz0);
  // the glass's SHGC is not geometry, but units that differ in it must not be taken for one another
  return ['u', ...['winW', 'winH', 'sill', 'wallT', 'reveal', 'winBy', 'winN', 'winSp', 'shgc', 'offU'].map(k => glz[k] || 0), glz.fillW ? 1 : 0, glz.fillH ? 1 : 0, h, len, gf, slab,
    (glz.devices || []).map(D => GEOM_KEYS.map(k => k === 'arr' ? (D.arr ? Object.values(D.arr).join(':') : '-') : D[k]).join(',')).join(';')].join('|');
}

/* ---------- the wall ----------
   Over a rectangle of the facade [u0,u1] x [v0,v1], with the glazing in it: a
   band under the sill, a band over the head - the slab - and a pier either
   side, any of which a unit that fills its bay or its height leaves out. They
   tile the rectangle with the glazing exactly and nothing is cut.          */
export function wallPieces(m, rect) {
  const { u0, u1, v0, v1 } = rect, o = m.opening, out = [];
  const put = (name, a0, a1, b0, b1, w0, w1, role = 'wall') => {
    if (a1 - a0 > 1e-9 && b1 - b0 > 1e-9 && w1 - w0 > 1e-9)
      out.push(aaBox(a0, a1, b0, b1, w0, w1, { name, role }));
  };
  const s0 = clamp(o.v0, v0, v1), s1 = clamp(o.v1, v0, v1);
  put('spandrel', u0, u1, v0, s0, m.wIn, m.reveal);
  put('header', u0, u1, s1, v1, m.wIn, m.reveal);
  put('pier-left', u0, clamp(o.u0, u0, u1), s0, s1, m.wIn, m.reveal);
  put('pier-right', clamp(o.u1, u0, u1), u1, s0, s1, m.wIn, m.reveal);
  return out;
}

/** the glazing of one unit as a solid, its outside face on the plane w = 0 */
export const glazingBox = m => aaBox(m.opening.u0, m.opening.u1, m.opening.v0, m.opening.v1,
  -GLASS_T, 0, { name: 'glazing', role: 'glass' });

/** the same wall as the faces a drawing needs, each tagged with what it is:
 *    'wall'      the outside face; pieces carry no stroke - a seam is not a line
 *    'spandrel'  a curtain wall's opaque panel, in the plane of the glass
 *    'cut'       where the rectangle ends in a real cut, showing the thickness
 *    'return'    the faces of the reveal, from the face back to the glass
 *  The back of the wall is never seen from outside and is left out.          */
export function wallFaces(m, rect, withCuts) {
  const { u0, u1, v0, v1 } = rect, o = m.opening, rev = m.reveal;
  const out = [], up = [0, 0, 1];
  const pieces = wallPieces(m, rect);
  // where a piece meets the rectangle's edge the patch is cut; runs of pieces
  // along one edge are merged, so the cut face carries no false seam
  const runs = { L: [], R: [], B: [], T: [] };
  for (const p of pieces) {
    const a0 = p.c[0] - p.h[0], a1 = p.c[0] + p.h[0], b0 = p.c[1] - p.h[1], b1 = p.c[1] + p.h[1];
    const wf = p.c[2] + p.h[2], wb = p.c[2] - p.h[2];
    out.push({ pts: [[a0, b0, wf], [a1, b0, wf], [a1, b1, wf], [a0, b1, wf]], n: up, kind: p.role === 'spandrel' ? 'spandrel' : 'wall' });
    if (!withCuts || wf - wb < 0.03) continue;
    if (Math.abs(a0 - u0) < 1e-9) runs.L.push([b0, b1, wf, wb]);
    if (Math.abs(a1 - u1) < 1e-9) runs.R.push([b0, b1, wf, wb]);
    if (Math.abs(b0 - v0) < 1e-9) runs.B.push([a0, a1, wf, wb]);
    if (Math.abs(b1 - v1) < 1e-9) runs.T.push([a0, a1, wf, wb]);
  }
  const merged = list => {
    const s = list.slice().sort((p, q) => p[0] - q[0]), outR = [];
    for (const r of s) {
      const last = outR[outR.length - 1];
      if (last && Math.abs(last[1] - r[0]) < 1e-9 && last[2] === r[2] && last[3] === r[3]) last[1] = r[1];
      else outR.push(r.slice());
    }
    return outR;
  };
  const cut = (pts, n) => out.push({ pts, n, kind: 'cut' });
  merged(runs.L).forEach(([b0, b1, wf, wb]) => cut([[u0, b1, wf], [u0, b0, wf], [u0, b0, wb], [u0, b1, wb]], [-1, 0, 0]));
  merged(runs.R).forEach(([b0, b1, wf, wb]) => cut([[u1, b0, wf], [u1, b1, wf], [u1, b1, wb], [u1, b0, wb]], [1, 0, 0]));
  merged(runs.B).forEach(([a0, a1, wf, wb]) => cut([[a0, v0, wf], [a1, v0, wf], [a1, v0, wb], [a0, v0, wb]], [0, -1, 0]));
  merged(runs.T).forEach(([a0, a1, wf, wb]) => cut([[a1, v1, wf], [a0, v1, wf], [a0, v1, wb], [a1, v1, wb]], [0, 1, 0]));
  if (rev > 1e-4) {
    // an opening has four returns; across a run of units filling their bays the head and sill run on, and there are no jambs
    const L = m.run ? u0 : o.u0, R = m.run ? u1 : o.u1;
    const ret = (a, b, n) => out.push({ pts: [[a[0], a[1], rev], [b[0], b[1], rev], [b[0], b[1], 0], [a[0], a[1], 0]], n, kind: 'return' });
    if (o.v1 < v1 - 1e-9 || !m.run) ret([L, o.v1], [R, o.v1], [0, -1, 0]);
    if (o.v0 > v0 + 1e-9 || !m.run) ret([R, o.v0], [L, o.v0], [0, 1, 0]);
    if (!m.run) {
      ret([o.u0, o.v0], [o.u0, o.v1], [1, 0, 0]);
      ret([o.u1, o.v1], [o.u1, o.v0], [-1, 0, 0]);
    }
  }
  return out;
}

/* ---------- where the beam can reach ---------- */
/** the part of the glass the reveal lets the beam reach: the opening, and the
 *  aperture at the face of the wall run back along the sun - both rectangles,
 *  so their overlap is one too. Null when the reveal lets nothing through.   */
export function revealLit(m, sl) {
  const o = m.opening, a = m.aperture;
  if (sl[2] <= 1e-6) return null;
  const t = m.reveal / sl[2], du = -sl[0] * t, dv = -sl[1] * t;
  const u0 = Math.max(o.u0, a.u0 + du), u1 = Math.min(o.u1, a.u1 + du);
  const v0 = Math.max(o.v0, a.v0 + dv), v1 = Math.min(o.v1, a.v1 + dv);
  return u1 - u0 > 1e-9 && v1 - v0 > 1e-9 ? { u0, u1, v0, v1 } : null;
}
