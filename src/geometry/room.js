/* The storey behind a glazing unit, and where the direct beam lands in it.

   The floor is taken as open plan - no partitions, no columns - so the beam
   runs on until it meets the floor or the building's own outside walls: the
   facade opposite, and the two sides at the ends. In unit coordinates: u
   across, v up from the floor, w outward, so the interior lies at w < 0
   behind the glass. Drawings show only the part of it the sun can reach.

   Light travels along -s, the reverse of the sun vector. A point inside is lit
   exactly when a ray from it toward the sun gets out through the opening -
   past the inside of the wall, through the glass, past the reveal and every
   device - so the interior is found by tracing back, which needs nothing the
   ray test does not already have. The crisp sunlit patches the drawings show
   are the lit part of the glass carried along -s onto each surface: the map is
   affine, so a polygon on the glass stays a polygon on the floor, and because
   the room is convex each ray lands on exactly one surface.                 */

import { clipRect } from '../util.js';
import { GLASS_T } from './cell.js';
import { sunlit } from './analysis.js';
import { facadeLength, plateDepth } from './building.js';
import { solarPosition, sunLocal } from '../solar.js';
import { glassShadowsOf } from './shadows.js';

const OUTER_WALL = 0.3;                   // the other sides' walls, as far as the interior is concerned

/** the storey behind a unit model m, to the inside of the building's other walls */
export function roomOf(m, S) {
  // a window in a wall: the interior starts behind the wall; glass that fills
  // its bay has no wall round it, and the interior starts at the glass
  const w1 = m.run ? -GLASS_T : Math.min(m.wIn, -GLASS_T);
  const len = facadeLength(S, m.f, m.st), deep = plateDepth(S, m.f, m.st);
  const w0 = m.reveal - deep + OUTER_WALL;
  return { u0: -len / 2 + OUTER_WALL - m.cc, u1: len / 2 - OUTER_WALL - m.cc, w1, w0, h: m.storeyH, depth: w1 - w0 };
}

/* ---------- how far in the sun can get ----------
   The lit glass carried onto the floor, corner by corner, over a span of
   time: the floor region the drawings need to show, so the view neither
   crops the patch nor shows an empty storey. It is set by the date (or the
   year), not the hour, so it holds still while the day plays. */
export function reachRegion(m, R, doys) {
  let u0 = Math.min(m.opening.u0, 0), u1 = Math.max(m.opening.u1, 0), w0 = R.w1 - 2.5;
  for (const doy of doys) for (let t = 0.25; t < 24; t += 0.25) {
    const sp = solarPosition(doy, t, 'sol');
    if (sp.alt <= 0.5) continue;
    const sl = sunLocal(sp.alt, sp.az, m.gf);
    if (sl[2] <= 1e-3 || sl[1] <= 1e-3) continue;
    const L = litGlass(m, sl);
    if (!L) continue;
    for (const v of [L.v0, L.v1]) for (const u of [L.u0, L.u1]) {
      const k = v / sl[1], fu = u - sl[0] * k, fw = -sl[2] * k;
      u0 = Math.min(u0, fu); u1 = Math.max(u1, fu); w0 = Math.min(w0, fw);
    }
  }
  const pad = 0.6;
  return { u0: Math.max(R.u0, u0 - pad), u1: Math.min(R.u1, u1 + pad), w0: Math.max(R.w0, w0 - pad), w1: R.w1 };
}

/* ---------- the surfaces ----------
   Each: its plane, its inward normal, the two coordinates it is drawn in, the
   rectangle it spans in them, and how the beam's energy lands on it - the
   cosine between the beam and the surface normal. */
export function roomSurfaces(R) {
  // the building's outside walls; the ceiling only catches a beam from below, which there never is
  return [
    { key: 'floor', n: [0, 1, 0], ax: 1, at: 0, uv: [0, 2], rect: [R.u0, R.u1, R.w0, R.w1], cos: sl => sl[1] },
    { key: 'back', n: [0, 0, 1], ax: 2, at: R.w0, uv: [0, 1], rect: [R.u0, R.u1, 0, R.h], cos: sl => sl[2] },
    { key: 'left', n: [1, 0, 0], ax: 0, at: R.u0, uv: [2, 1], rect: [R.w0, R.w1, 0, R.h], cos: sl => sl[0] },
    { key: 'right', n: [-1, 0, 0], ax: 0, at: R.u1, uv: [2, 1], rect: [R.w0, R.w1, 0, R.h], cos: sl => -sl[0] },
    { key: 'ceiling', n: [0, -1, 0], ax: 1, at: R.h, uv: [0, 2], rect: [R.u0, R.u1, R.w0, R.w1], cos: sl => -sl[1] }
  ];
}
export const SURFACE_NAMES = { floor: 'the floor', back: 'the facade opposite', left: 'the left end wall', right: 'the right end wall', ceiling: 'the ceiling' };

/* ---------- tracing back from inside ---------- */
/** is interior point P reached by the beam? */
export function interiorLit(m, P, sl) {
  if (sl[2] <= 1e-9) return false;
  const o = m.opening, t = -P[2] / sl[2];
  const u = P[0] + sl[0] * t, v = P[1] + sl[1] * t;
  if (!(u > o.u0 && u < o.u1 && v > o.v0 && v < o.v1)) return false;
  // a punched opening's inside reveal: the ray must still be in the hole where it leaves the wall
  if (!m.run && m.wIn < -1e-9) {
    const t2 = (m.wIn - P[2]) / sl[2], a = m.aperture;
    const u2 = P[0] + sl[0] * t2, v2 = P[1] + sl[1] * t2;
    if (!(u2 > a.u0 && u2 < a.u1 && v2 > a.v0 && v2 < a.v1)) return false;
  }
  return sunlit(m, [u, v, 0], sl);
}

/* ---------- the patches ----------
   The glass the beam still reaches inside is the opening, cut by the outside
   reveal and by the inside of the wall (both rectangles), less the shadows the
   devices throw. Each piece is carried along -s onto every surface and clipped
   to it. The lit rectangle is painted, the shadows painted back over it in the
   surface's own colour - the same order the glass itself is drawn in.       */
export function litGlass(m, sl) {
  if (sl[2] <= 1e-6) return null;
  const o = m.opening, a = m.aperture;
  let u0 = o.u0, u1 = o.u1, v0 = o.v0, v1 = o.v1;
  const cut = (du, dv) => {
    u0 = Math.max(u0, a.u0 + du); u1 = Math.min(u1, a.u1 + du);
    v0 = Math.max(v0, a.v0 + dv); v1 = Math.min(v1, a.v1 + dv);
  };
  if (m.reveal > 1e-9) { const t = m.reveal / sl[2]; cut(-sl[0] * t, -sl[1] * t); }
  if (!m.run && m.wIn < -1e-9) { const t = -m.wIn / sl[2]; cut(sl[0] * t, sl[1] * t); }
  return u1 - u0 > 1e-9 && v1 - v0 > 1e-9 ? { u0, u1, v0, v1 } : null;
}
/** a glass point (u, v) carried along -s onto a surface, in the surface's two coordinates */
function onto(S, sl, u, v) {
  const P = [u, v, 0], d = [-sl[0], -sl[1], -sl[2]];
  const den = d[S.ax];
  if (Math.abs(den) < 1e-12) return null;
  const t = (S.at - P[S.ax]) / den;
  if (t < -1e-12) return null;              // glass standing on the floor meets it at t = 0
  const Q = [P[0] + d[0] * t, P[1] + d[1] * t, P[2] + d[2] * t];
  return [Q[S.uv[0]], Q[S.uv[1]]];
}
export function sunPatches(m, R, sl) {
  const L = litGlass(m, sl);
  if (!L) return [];
  const shadows = glassShadowsOf(m, sl, L);
  const out = [];
  for (const S of roomSurfaces(R)) {
    if (S.cos(sl) <= 1e-6) continue;          // the beam cannot reach a surface facing away
    const map = poly => { const q = poly.map(([u, v]) => onto(S, sl, u, v)); return q.some(x => !x) ? null : q; };
    const lit = map([[L.u0, L.v0], [L.u1, L.v0], [L.u1, L.v1], [L.u0, L.v1]]);
    if (!lit) continue;
    const [a0, a1, b0, b1] = S.rect;
    const c = clipRect(lit, a0, a1, b0, b1);
    if (c.length < 3) continue;
    const shade = shadows.map(map).filter(Boolean).map(p => clipRect(p, a0, a1, b0, b1)).filter(p => p.length > 2);
    out.push({ S, lit: c, shade });
  }
  return out;
}
/** a patch polygon, in the surface's two coordinates, back into unit coordinates */
export function toUnit(S, [a, b]) {
  const P = [0, 0, 0];
  P[S.ax] = S.at; P[S.uv[0]] = a; P[S.uv[1]] = b;
  return P;
}
