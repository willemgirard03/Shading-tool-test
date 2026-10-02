/* Shadows on the glass: every element's convex shadow on the plane w = 0,
   clipped to a rectangle of it - the opening, or the part of it the beam can
   still reach. Shared by the drawings and the room behind the glass.       */

import { clipRect } from '../util.js';
import { boxShadow } from './boxes.js';

export function glassShadowsOf(m, sl, r = m.opening) {
  if (!sl || sl[2] <= 1e-6) return [];
  const out = [];
  for (const b of m.elements) {
    const hl = boxShadow(b, sl);
    if (!hl || hl.length < 3) continue;
    const c = clipRect(hl, r.u0, r.u1, r.v0, r.v1);
    if (c.length > 2) out.push(c);
  }
  return out;
}
